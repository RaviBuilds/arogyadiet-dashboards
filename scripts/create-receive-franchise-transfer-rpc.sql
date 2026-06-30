-- ============================================================================
-- FRANCHISE INVENTORY — receive_franchise_transfer RPC (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.4
-- Requirements: 3.4, 8.3, 8.4, 8.5, 8.7, 8.8, 9.1, 9.3, 11.1, 12.1, 12.2
--
-- Defines receive_franchise_transfer(p_transfer_id, p_franchise_id, p_acted_by):
-- the AUTHORITATIVE, single-transaction path that transitions a Stock_Transfer
-- from ACCEPTED → RECEIVED, creates franchise_inventory_lots matching the
-- transfer lines, and writes the IN ledger entry.
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- state change, lot creation, and ledger insert either commit together or roll
-- back together (Req 8.7). On ANY validation failure the function RAISEs an
-- exception, which aborts the transaction: transfer state and on-hand are left
-- unchanged.
--
-- Idempotency (Req 8.8): If the transfer is already in state RECEIVED, the
-- function returns the transfer row as a no-op — no duplicate lots or ledger
-- entries are created.
--
-- Validation:
--   - Transfer must belong to the given franchise (dest_franchise_id match)
--   - Transfer must be in state ACCEPTED (or RECEIVED for idempotent no-op)
--   - Each transfer line must have a non-empty batch_number (Req 12.2)
--   - Each transfer line must have a non-null expiry_date (Req 12.2)
--   - The transfer's product must be a FINISHED_GOOD (Req 3.4)
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
  v_transfer        public.franchise_stock_transfers%ROWTYPE;
  v_inventory_id    uuid;
  v_product_type    text;
  v_line           RECORD;
  v_batch_breakdown jsonb := '[]'::jsonb;
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
  -- 6. Process transfer lines — validate and create lots (Req 8.4, 9.1, 12.1, 12.2)
  -- =========================================================================
  FOR v_line IN
    SELECT batch_number, quantity, expiry_date
      FROM public.franchise_stock_transfer_lines
     WHERE transfer_id = p_transfer_id
  LOOP
    -- 6a. Reject if batch_number is NULL or empty (Req 12.2)
    IF v_line.batch_number IS NULL OR trim(v_line.batch_number) = '' THEN
      RAISE EXCEPTION 'Transfer line has missing or empty batch_number, cannot receive';
    END IF;

    -- 6b. Reject if expiry_date is NULL (Req 12.2)
    IF v_line.expiry_date IS NULL THEN
      RAISE EXCEPTION 'Transfer line has missing expiry_date, cannot receive';
    END IF;

    -- 6c. Create franchise_inventory_lot for this line (Req 9.1, 9.3, 12.1)
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

    -- 6d. Build the batch_breakdown JSONB array for the ledger entry
    v_batch_breakdown := v_batch_breakdown || jsonb_build_object(
      'batch_number', v_line.batch_number,
      'quantity', v_line.quantity,
      'expiry_date', v_line.expiry_date
    );
  END LOOP;

  -- =========================================================================
  -- 7. Transition the transfer to RECEIVED (Req 8.3)
  -- =========================================================================
  UPDATE public.franchise_stock_transfers
     SET state = 'RECEIVED',
         received_at = now(),
         acted_by = p_acted_by
   WHERE id = p_transfer_id;

  -- =========================================================================
  -- 8. Write the IN ledger entry (Req 11.1, 9.3)
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
  -- 9. Return the updated transfer info
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
