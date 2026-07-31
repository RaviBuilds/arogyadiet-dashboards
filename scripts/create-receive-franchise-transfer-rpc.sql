-- ============================================================================
-- FRANCHISE INVENTORY — receive_franchise_transfer RPC (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.4
-- Spec: clinic-scoped-shop-inventory — Task 11.1 (hardened line validation)
-- Requirements: 3.4, 8.3, 8.4, 8.5, 8.7, 8.8, 9.1, 9.3, 11.1, 12.1, 12.2,
--               17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7
--
-- Defines receive_franchise_transfer(p_transfer_id, p_franchise_id, p_acted_by):
-- the AUTHORITATIVE, single-transaction path that transitions a Stock_Transfer
-- from ACCEPTED → RECEIVED, creates franchise_inventory_lots matching the
-- transfer lines, and writes the IN ledger entry.
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- state change, lot creation, and ledger insert either commit together or roll
-- back together (Req 8.7, 17.1, 17.2). On ANY validation failure the function
-- RAISEs an exception, which aborts the transaction: transfer state and
-- on-hand are left unchanged.
--
-- Idempotency (Req 8.8, 17.3): If the transfer is already in state RECEIVED,
-- the function returns the transfer row as a no-op — no duplicate lots or
-- ledger entries are created.
--
-- Validation:
--   - Transfer must belong to the given franchise (dest_franchise_id match)
--   - Transfer must be in state ACCEPTED (or RECEIVED for idempotent no-op)
--   - Every transfer line's quantity must be an integer between 1 and
--     Stock_Quantity_Maximum (1,000,000) inclusive, checked for ALL lines
--     BEFORE any franchise_inventory_lots row is inserted, so an out-of-range
--     line on the receipt fails the whole receipt with no partial inserts
--     (Req 17.4). Every offending line is identified in the exception
--     message, not just the first one encountered.
--   - Each transfer line must have a non-empty batch_number (Req 12.2)
--   - Each transfer line must have a non-null expiry_date (Req 12.2)
--   - The transfer's product must be a FINISHED_GOOD (Req 3.4)
--
-- Error message prefix (mirrors the CLINIC_STOCK_* convention established for
-- clinic-scoped-shop-inventory in design.md's "Message mapping" table):
--   FRANCHISE_TRANSFER_LINE_INVALID: <line-by-line detail> — raised when one
--   or more transfer lines have a quantity that is not an integer in
--   [1, 1000000]. The action layer can map this prefix to requirement 17.4's
--   user-facing wording without string-sniffing Postgres internals.
--
-- SECURITY DEFINER: invoked by the service-role admin client from the
-- receiveTransferAction after authorization and validation. Mirrors the
-- established transfer_stock and create-group-with-kitchen-rpc patterns.
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (public.franchises)
--   - create-franchise-inventories-table.sql (public.franchise_inventories)
--   - create-franchise-stock-transfers-tables.sql (franchise_stock_transfers,
--     franchise_stock_transfer_lines)
--   - create-franchise-inventory-lots-table.sql (public.franchise_inventory_lots)
--   - create-franchise-inventory-ledger-table.sql (public.franchise_inventory_ledger)
--   - inventory_products table exists (public.inventory_products)
--
-- Safety: Creates/replaces a function only; no table is altered or dropped.
-- Idempotent (re-runnable) via CREATE OR REPLACE.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.receive_franchise_transfer(uuid, uuid, uuid);
--   (Rolling back restores the pre-Task-11.1 function body if re-applied from
--   version control; it does not, by itself, restore the earlier definition —
--   re-run the prior committed version of this script to do that.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.receive_franchise_transfer(
  p_transfer_id   uuid,
  p_franchise_id  uuid,
  p_acted_by      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer          public.franchise_stock_transfers%ROWTYPE;
  v_inventory_id      uuid;
  v_product_type      text;
  v_line              RECORD;
  v_batch_breakdown   jsonb := '[]'::jsonb;
  v_invalid_lines     text := '';
  v_invalid_count     integer := 0;
BEGIN
  -- =========================================================================
  -- 1. Lock and fetch the transfer (Req 8.3, 8.5)
  -- =========================================================================
  SELECT *
    INTO v_transfer
    FROM public.franchise_stock_transfers
   WHERE id = p_transfer_id
     AND dest_franchise_id = p_franchise_id
     FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'Transfer not found or does not belong to this franchise';
  END IF;

  -- =========================================================================
  -- 2. Idempotency check (Req 8.8)
  -- If transfer is already RECEIVED, return it as a no-op.
  -- =========================================================================
  IF v_transfer.state = 'RECEIVED' THEN
    RETURN jsonb_build_object(
      'id', v_transfer.id,
      'state', v_transfer.state::text,
      'received_at', v_transfer.received_at,
      'idempotent', true
    );
  END IF;

  -- =========================================================================
  -- 3. Assert source state is ACCEPTED (Req 8.3, 8.5)
  -- =========================================================================
  IF v_transfer.state != 'ACCEPTED' THEN
    RAISE EXCEPTION 'Transfer is not in ACCEPTED state, cannot receive';
  END IF;

  -- =========================================================================
  -- 4. Verify the product is a FINISHED_GOOD (Req 3.4)
  -- =========================================================================
  SELECT type
    INTO v_product_type
    FROM public.inventory_products
   WHERE id = v_transfer.product_id;

  IF v_product_type IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', v_transfer.product_id;
  END IF;

  IF v_product_type != 'FINISHED_GOOD' THEN
    RAISE EXCEPTION 'Product % is not a FINISHED_GOOD, cannot receive into franchise inventory', v_transfer.product_id;
  END IF;

  -- =========================================================================
  -- 5. Resolve the franchise inventory (for inventory_id FK)
  -- =========================================================================
  SELECT id
    INTO v_inventory_id
    FROM public.franchise_inventories
   WHERE franchise_id = p_franchise_id;

  IF v_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Franchise inventory not found for franchise %', p_franchise_id;
  END IF;

  -- =========================================================================
  -- 6. Validate EVERY line's quantity before any lot is inserted (Req 17.4)
  --
  -- Collects every out-of-range line up front so the exception identifies
  -- all offenders in one shot, not just the first one hit. Nothing is
  -- inserted in this loop — it is pure validation, so a failure here leaves
  -- the transaction with zero partial writes.
  -- =========================================================================
  FOR v_line IN
    SELECT batch_number, quantity
      FROM public.franchise_stock_transfer_lines
     WHERE transfer_id = p_transfer_id
  LOOP
    IF v_line.quantity IS NULL
       OR v_line.quantity != trunc(v_line.quantity)
       OR v_line.quantity < 1
       OR v_line.quantity > 1000000
    THEN
      v_invalid_count := v_invalid_count + 1;
      v_invalid_lines := v_invalid_lines
        || CASE WHEN v_invalid_lines = '' THEN '' ELSE '; ' END
        || format('batch %s: quantity %s', coalesce(v_line.batch_number, '(none)'), v_line.quantity);
    END IF;
  END LOOP;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'FRANCHISE_TRANSFER_LINE_INVALID: % transfer line(s) have a quantity that is not a whole number between 1 and 1000000: %',
      v_invalid_count, v_invalid_lines;
  END IF;

  -- =========================================================================
  -- 7. Process transfer lines — validate and create lots (Req 8.4, 9.1, 12.1, 12.2)
  -- =========================================================================
  FOR v_line IN
    SELECT batch_number, quantity, expiry_date
      FROM public.franchise_stock_transfer_lines
     WHERE transfer_id = p_transfer_id
  LOOP
    -- 7a. Reject if batch_number is NULL or empty (Req 12.2)
    IF v_line.batch_number IS NULL OR trim(v_line.batch_number) = '' THEN
      RAISE EXCEPTION 'Transfer line has missing or empty batch_number, cannot receive';
    END IF;

    -- 7b. Reject if expiry_date is NULL (Req 12.2)
    IF v_line.expiry_date IS NULL THEN
      RAISE EXCEPTION 'Transfer line has missing expiry_date, cannot receive';
    END IF;

    -- 7c. Create franchise_inventory_lot for this line (Req 9.1, 9.3, 12.1)
    INSERT INTO public.franchise_inventory_lots (
      franchise_id,
      inventory_id,
      product_id,
      batch_number,
      quantity_remaining,
      expiry_date,
      source_transfer_id
    ) VALUES (
      p_franchise_id,
      v_inventory_id,
      v_transfer.product_id,
      v_line.batch_number,
      v_line.quantity,
      v_line.expiry_date,
      p_transfer_id
    );

    -- 7d. Build the batch_breakdown JSONB array for the ledger entry
    v_batch_breakdown := v_batch_breakdown || jsonb_build_object(
      'batch_number', v_line.batch_number,
      'quantity', v_line.quantity,
      'expiry_date', v_line.expiry_date
    );
  END LOOP;

  -- =========================================================================
  -- 8. Transition the transfer to RECEIVED (Req 8.3)
  -- =========================================================================
  UPDATE public.franchise_stock_transfers
     SET state = 'RECEIVED',
         received_at = now(),
         acted_by = p_acted_by
   WHERE id = p_transfer_id;

  -- =========================================================================
  -- 9. Write the IN ledger entry (Req 11.1, 9.3)
  -- =========================================================================
  INSERT INTO public.franchise_inventory_ledger (
    franchise_id,
    direction,
    product_id,
    quantity,
    batch_breakdown,
    source_transfer_id,
    source_central_kitchen_id
  ) VALUES (
    p_franchise_id,
    'IN',
    v_transfer.product_id,
    v_transfer.quantity,
    v_batch_breakdown,
    p_transfer_id,
    v_transfer.source_central_kitchen_id
  );

  -- =========================================================================
  -- 10. Return the updated transfer info
  -- =========================================================================
  RETURN jsonb_build_object(
    'id', v_transfer.id,
    'state', 'RECEIVED',
    'received_at', now(),
    'idempotent', false
  );
END;
$$;

-- ============================================================================
-- DONE. receive_franchise_transfer is the authoritative atomic receipt path.
-- Invoke it from the receiveTransferAction via
-- createAdminClient().rpc("receive_franchise_transfer", { ... }).
-- Run only AFTER all prerequisite tables and the ledger table exist.
-- ============================================================================
