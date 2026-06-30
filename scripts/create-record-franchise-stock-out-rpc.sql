-- ============================================================================
-- FRANCHISE INVENTORY — Atomic Record Franchise Stock Out RPC (SAFE)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.5 — Requirements 9.4, 9.5, 10.2, 10.3, 10.7, 11.2, 11.7
--
-- Defines record_franchise_stock_out(p_franchise_id, p_product_id, p_quantity,
-- p_reason, p_comment): the AUTHORITATIVE, single-transaction path that
-- records a stock-out against a franchise inventory, depleting the
-- earliest-expiry FIFO lots first, and writing one OUT ledger entry.
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- lot depletion, status updates, and ledger insert either commit together
-- or roll back together. On ANY validation failure the function RAISEs an
-- exception, which aborts the transaction: lot quantities are left unchanged
-- and NO ledger row is written (Req 11.7).
--
-- What it does, in order, within one transaction:
--   1. Validate p_reason is in the allowed set (Req 10.1). Raise if invalid.
--   2. Validate p_quantity is a positive whole number (> 0, integer). Raise if
--      invalid (Req 10.4).
--   3. If p_reason = 'OTHER', validate p_comment length is BETWEEN 1 AND 500.
--      Raise if missing or invalid (Req 10.5, 10.6).
--   4. SELECT franchise_inventory_lots WHERE franchise_id = p_franchise_id
--      AND product_id = p_product_id AND status = 'ACTIVE'
--      ORDER BY expiry_date ASC, received_at ASC FOR UPDATE (FIFO lock).
--   5. Sum available quantity across the selected lots. If p_quantity exceeds
--      the available total, RAISE with both values in the error message (Req 10.3).
--   6. Deplete earliest-expiry lots first (FIFO), fully consuming each batch
--      before moving to the next (Req 10.2):
--      - Deduct min(lot.quantity_remaining, remaining_to_deplete) from each lot.
--      - Set lot status = 'DEPLETED' when quantity_remaining reaches 0.
--      - Track per-batch depletion for the ledger entry's batch_breakdown.
--   7. Write one franchise_inventory_ledger entry with direction = 'OUT',
--      product_id, quantity, stock_out_reason = p_reason, comment = p_comment,
--      and batch_breakdown as JSONB (Req 10.7, 11.2).
--   8. Return the newly created ledger entry id.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the recordStockOutAction Server Action after the
-- action has authorized the caller and validated inputs. Running as DEFINER
-- keeps the atomic stock-out behaving consistently regardless of the caller's
-- row-level privileges, mirroring create-transfer-stock-rpc.sql and
-- create-provision-franchise-inventory-rpc.sql.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- ORDERING REQUIREMENT: This file MUST run AFTER:
--   - create-franchise-inventory-lots-table.sql (franchise_inventory_lots)
--   - create-franchise-inventory-ledger-table.sql (franchise_inventory_ledger)
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_franchise_stock_out(uuid, uuid, numeric, text, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_franchise_stock_out(
  p_franchise_id uuid,
  p_product_id   uuid,
  p_quantity     numeric,
  p_reason       text,
  p_comment      text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid_reasons    text[] := ARRAY[
    'MEAL_SUBSCRIPTION_SALE',
    'KIT_SUBSCRIPTION_SALE',
    'ONE_TIME_PURCHASE_SALE',
    'SPOILED',
    'DAMAGED',
    'OTHER'
  ];
  v_lot              RECORD;
  v_available        numeric := 0;
  v_remaining        numeric;
  v_deduct           numeric;
  v_batch_breakdown  jsonb := '[]'::jsonb;
  v_ledger_id        bigint;
BEGIN
  -- ==========================================================================
  -- 1. Validate reason is in the allowed set (Req 10.1)
  -- ==========================================================================
  IF p_reason IS NULL OR NOT (p_reason = ANY(v_valid_reasons)) THEN
    RAISE EXCEPTION 'invalid stock_out_reason: %. Must be one of: MEAL_SUBSCRIPTION_SALE, KIT_SUBSCRIPTION_SALE, ONE_TIME_PURCHASE_SALE, SPOILED, DAMAGED, OTHER', COALESCE(p_reason, 'NULL');
  END IF;

  -- ==========================================================================
  -- 2. Validate quantity is a positive whole number (Req 10.4)
  -- ==========================================================================
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity != trunc(p_quantity) THEN
    RAISE EXCEPTION 'invalid quantity: %. Must be a positive whole number', COALESCE(p_quantity::text, 'NULL');
  END IF;

  -- ==========================================================================
  -- 3. If reason = 'OTHER', validate comment length 1–500 (Req 10.5, 10.6)
  -- ==========================================================================
  IF p_reason = 'OTHER' THEN
    IF p_comment IS NULL OR char_length(p_comment) < 1 OR char_length(p_comment) > 500 THEN
      RAISE EXCEPTION 'comment is required for reason OTHER and must be between 1 and 500 characters';
    END IF;
  END IF;

  -- ==========================================================================
  -- 4. FIFO lot selection: lock ACTIVE lots ordered by expiry ASC, received ASC
  --    (Req 10.2, 12.5)
  -- ==========================================================================
  -- First, compute total available and validate sufficiency before depletion.
  SELECT COALESCE(SUM(fil.quantity_remaining), 0)
    INTO v_available
    FROM public.franchise_inventory_lots fil
   WHERE fil.franchise_id = p_franchise_id
     AND fil.product_id = p_product_id
     AND fil.status = 'ACTIVE';

  -- ==========================================================================
  -- 5. Check available stock vs requested (Req 10.3)
  -- ==========================================================================
  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'insufficient stock: requested % but only % available', p_quantity, v_available;
  END IF;

  -- ==========================================================================
  -- 6. FIFO depletion: deplete earliest-expiry lots first (Req 10.2)
  -- ==========================================================================
  v_remaining := p_quantity;

  FOR v_lot IN
    SELECT fil.id, fil.batch_number, fil.quantity_remaining, fil.expiry_date
      FROM public.franchise_inventory_lots fil
     WHERE fil.franchise_id = p_franchise_id
       AND fil.product_id = p_product_id
       AND fil.status = 'ACTIVE'
     ORDER BY fil.expiry_date ASC, fil.received_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Deduct the lesser of lot's remaining quantity or what we still need
    v_deduct := LEAST(v_lot.quantity_remaining, v_remaining);

    -- Update the lot: reduce quantity_remaining, mark DEPLETED if 0
    UPDATE public.franchise_inventory_lots
       SET quantity_remaining = quantity_remaining - v_deduct,
           status = CASE
                      WHEN quantity_remaining - v_deduct = 0 THEN 'DEPLETED'
                      ELSE status
                    END
     WHERE id = v_lot.id;

    -- Track per-batch depletion for the ledger batch_breakdown
    v_batch_breakdown := v_batch_breakdown || jsonb_build_array(
      jsonb_build_object(
        'batch_number', v_lot.batch_number,
        'quantity', v_deduct,
        'expiry_date', v_lot.expiry_date
      )
    );

    v_remaining := v_remaining - v_deduct;
  END LOOP;

  -- ==========================================================================
  -- 7. Write one OUT ledger entry (Req 10.7, 11.2, 11.7)
  -- ==========================================================================
  INSERT INTO public.franchise_inventory_ledger (
    franchise_id,
    direction,
    product_id,
    quantity,
    batch_breakdown,
    stock_out_reason,
    comment
  )
  VALUES (
    p_franchise_id,
    'OUT',
    p_product_id,
    p_quantity,
    v_batch_breakdown,
    p_reason,
    p_comment
  )
  RETURNING id INTO v_ledger_id;

  -- ==========================================================================
  -- 8. Return the ledger entry id
  -- ==========================================================================
  RETURN v_ledger_id;
END;
$$;

-- ============================================================================
-- DONE. record_franchise_stock_out is the authoritative atomic stock-out path.
-- Invoke it from the recordStockOutAction Server Action via
-- createAdminClient().rpc("record_franchise_stock_out", {
--   p_franchise_id, p_product_id, p_quantity, p_reason, p_comment
-- }).
-- Run only AFTER create-franchise-inventory-lots-table.sql and
-- create-franchise-inventory-ledger-table.sql.
-- ============================================================================
