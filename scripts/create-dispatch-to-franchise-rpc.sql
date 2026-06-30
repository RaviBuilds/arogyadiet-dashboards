-- ============================================================================
-- FRANCHISE INVENTORY — dispatch_to_franchise RPC (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.2 — Requirements 6.1, 6.2, 6.3, 6.4,
-- 6.6, 6.7, 13.2, 13.3
--
-- Defines dispatch_to_franchise(p_dest_franchise_id, p_product_id, p_quantity,
-- p_dispatched_by, p_source_kitchen_id): the AUTHORITATIVE, single-transaction
-- path that dispatches finished-product stock FROM the central kitchen TO a
-- destination franchise, creating a franchise stock transfer record.
--
-- A plpgsql function body runs inside a single implicit transaction, so all
-- steps either commit together or roll back together. On ANY validation failure
-- the function RAISEs an exception, which aborts the transaction: central lot
-- balances are left unchanged, no transfer is created, and no ledger entry is
-- written (Req 6.4, 6.6, 6.7, 13.3).
--
-- What it does, in order, within one transaction:
--   1. Assert destination franchise is active — raise on inactive/non-existent (Req 6.7)
--   2. Assert quantity > 0 — raise on invalid (Req 6.6)
--   3. Deplete central FIFO lots ordered by expiry_date ASC, created_at ASC
--      where status = 'ACTIVE' and product_id = p_product_id (Req 6.3):
--        - For each lot, deduct min(lot.quantity_remaining, remaining_to_deplete)
--        - Set lot status to 'DEPLETED' when quantity_remaining reaches 0
--        - Track the per-lot depletion for transfer lines
--   4. Raise when central available is insufficient — roll back (Req 6.4)
--   5. Create one franchise_stock_transfers record in state DISPATCHED (Req 6.1, 6.2)
--   6. Create franchise_stock_transfer_lines rows (one per depleted central lot)
--      summing to the total quantity (Req 6.2)
--   7. Write one central outgoing inventory_transactions row with dest_franchise_id
--      and franchise_transfer_id stamped (Req 13.2)
--   8. Return the created transfer id
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the dispatchToFranchiseAction after the action has
-- authorized the caller and validated inputs. Running as DEFINER keeps the
-- atomic dispatch behaving consistently regardless of the caller's row-level
-- privileges.
--
-- Safety: additive only — creates/replaces a function, alters no table.
-- Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (public.franchises)
--   - inventory_lots table exists (public.inventory_lots)
--   - inventory_transactions table exists (public.inventory_transactions)
--   - create-franchise-stock-transfers-tables.sql (franchise_stock_transfers,
--     franchise_stock_transfer_lines)
--   - add-franchise-dispatch-to-inventory-transactions.sql (dest_franchise_id,
--     franchise_transfer_id columns)
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.dispatch_to_franchise(uuid, uuid, numeric, uuid, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_to_franchise(
  p_dest_franchise_id   uuid,
  p_product_id          uuid,
  p_quantity            numeric,
  p_dispatched_by       uuid,
  p_source_kitchen_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_status    text;
  v_transfer_id         uuid;
  v_total_available     numeric := 0;
  v_remaining           numeric;
  v_lot                 record;
  v_deduct              numeric;
  v_new_quantity        numeric;
  v_new_status          text;
  v_line_number         int := 0;
  v_first_lot_id        uuid;  -- for the single central ledger entry
BEGIN
  -- ──────────────────────────────────────────────────────────────────────────
  -- 1. Assert destination is an active franchise (Req 6.7)
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT status
    INTO v_franchise_status
    FROM public.franchises
   WHERE id = p_dest_franchise_id;

  IF v_franchise_status IS NULL THEN
    RAISE EXCEPTION 'Destination franchise does not exist: %', p_dest_franchise_id;
  END IF;

  IF v_franchise_status <> 'active' THEN
    RAISE EXCEPTION 'Destination franchise is not active (status: %)', v_franchise_status;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 2. Assert quantity > 0 (Req 6.6)
  -- ──────────────────────────────────────────────────────────────────────────
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Dispatched quantity must be greater than zero';
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 3. Check total available central stock for the product
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT COALESCE(SUM(quantity_remaining), 0)
    INTO v_total_available
    FROM public.inventory_lots
   WHERE product_id = p_product_id
     AND status = 'ACTIVE';

  IF p_quantity > v_total_available THEN
    RAISE EXCEPTION 'Insufficient central stock. Requested: %, Available: %',
      p_quantity, v_total_available;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 4. Create the franchise_stock_transfers header in state DISPATCHED (Req 6.1, 6.2)
  --    We create it first so we can reference transfer_id in the lines and ledger.
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO public.franchise_stock_transfers (
    dest_franchise_id,
    product_id,
    quantity,
    state,
    source_central_kitchen_id,
    dispatched_by
  )
  VALUES (
    p_dest_franchise_id,
    p_product_id,
    p_quantity,
    'DISPATCHED',
    p_source_kitchen_id,
    p_dispatched_by
  )
  RETURNING id INTO v_transfer_id;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 5. Deplete central FIFO lots — earliest expiry first, ties by created_at ASC
  --    (Req 6.3). For each lot, deduct min(lot.quantity_remaining, remaining).
  --    Set lot status to DEPLETED when quantity_remaining reaches 0.
  --    Create one franchise_stock_transfer_lines row per depleted lot.
  -- ──────────────────────────────────────────────────────────────────────────
  v_remaining := p_quantity;

  FOR v_lot IN
    SELECT id, batch_number, quantity_remaining, expiry_date
      FROM public.inventory_lots
     WHERE product_id = p_product_id
       AND status = 'ACTIVE'
       AND quantity_remaining > 0
     ORDER BY expiry_date ASC, created_at ASC
     FOR UPDATE  -- lock rows to prevent concurrent depletion
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_deduct := LEAST(v_lot.quantity_remaining, v_remaining);
    v_new_quantity := v_lot.quantity_remaining - v_deduct;

    IF v_new_quantity = 0 THEN
      v_new_status := 'DEPLETED';
    ELSE
      v_new_status := 'ACTIVE';
    END IF;

    -- Update the central lot
    UPDATE public.inventory_lots
       SET quantity_remaining = v_new_quantity,
           status = v_new_status::inventory_lot_status
     WHERE id = v_lot.id;

    -- Track first lot for the central ledger entry
    IF v_line_number = 0 THEN
      v_first_lot_id := v_lot.id;
    END IF;

    -- Create a transfer line for this lot depletion (Req 6.2)
    INSERT INTO public.franchise_stock_transfer_lines (
      transfer_id,
      franchise_id,
      batch_number,
      quantity,
      expiry_date,
      source_lot_id
    )
    VALUES (
      v_transfer_id,
      p_dest_franchise_id,
      v_lot.batch_number,
      v_deduct,
      v_lot.expiry_date,
      v_lot.id
    );

    v_line_number := v_line_number + 1;
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  -- Safety check: if remaining > 0 after exhausting all lots, raise (Req 6.4).
  -- This should not happen because we checked total available above, but acts as
  -- a safety net against concurrent modifications.
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient central stock after depletion. Remaining: %', v_remaining;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- 6. Write one central outgoing inventory_transactions row (Req 13.2)
  --    with dest_franchise_id and franchise_transfer_id stamped.
  --    Uses the first depleted lot_id as reference for the ledger entry.
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO public.inventory_transactions (
    lot_id,
    transaction_type,
    quantity_changed,
    financial_value_changed,
    reason,
    dest_franchise_id,
    franchise_transfer_id
  )
  VALUES (
    v_first_lot_id,
    'OUT',
    -(p_quantity),
    0,  -- financial value can be computed by caller if needed
    'Franchise Dispatch',
    p_dest_franchise_id,
    v_transfer_id
  );

  -- ──────────────────────────────────────────────────────────────────────────
  -- 7. Return the created transfer id
  -- ──────────────────────────────────────────────────────────────────────────
  RETURN v_transfer_id;
END;
$$;

-- ============================================================================
-- DONE. dispatch_to_franchise is the authoritative atomic dispatch path.
-- Invoke it from the dispatchToFranchiseAction via
-- createAdminClient().rpc("dispatch_to_franchise", { ... }).
-- Run only AFTER franchises, inventory_lots, inventory_transactions,
-- franchise_stock_transfers, and franchise_stock_transfer_lines exist.qq
-- ============================================================================
