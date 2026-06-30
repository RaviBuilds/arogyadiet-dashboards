-- ============================================================================
-- MULTI-TENANT FRANCHISE — Atomic Stock Transfer RPC (SAFE)
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 1.7 — Requirements 19.2, 19.3, 19.4, 19.5, 19.7
--
-- Defines transfer_stock(p_source_kind, p_source_franchise_id, p_dest_franchise_id,
-- p_product_id, p_quantity, p_created_by): the AUTHORITATIVE, single-transaction
-- path that moves product stock INTO a destination Franchise warehouse from
-- either the CORE business or another Franchise, and records exactly one
-- stock_transfers ledger row describing the movement.
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- source decrement, destination increment, and ledger insert either commit
-- together or roll back together. On ANY validation failure the function
-- RAISEs an exception, which aborts the transaction: balances are left
-- unchanged and NO ledger row is written (Req 19.3, 19.4).
--
-- What it does, in order, within one transaction:
--   1. Validate p_quantity > 0, else RAISE EXCEPTION 'invalid transfer quantity' (Req 19.4).
--   2. Resolve the destination warehouse: the franchise's single warehouse via
--      franchise_warehouses.franchise_id = p_dest_franchise_id (Req 19.1). If the
--      franchise has no warehouse, RAISE EXCEPTION.
--   3. Source handling (Req 19.7 — source may be CORE or another FRANCHISE):
--        - 'FRANCHISE': resolve the source franchise's warehouse, check its
--          available stock for p_product_id; if available < p_quantity,
--          RAISE EXCEPTION 'insufficient source stock' (Req 19.3); otherwise
--          decrement the source franchise_warehouse_stock row by p_quantity.
--          Total stock across both franchises is conserved (Req 19.2).
--        - 'CORE': core is the origin. There is NO franchise source row to
--          decrement in this franchise model, so franchise stock is left alone.
--          Core stock accounting (the core inventory_* / manufacturing_* tables)
--          is OUT OF SCOPE for this table and is intentionally left untouched.
--        - anything else: RAISE EXCEPTION 'invalid source kind'.
--   4. Upsert/increment the destination franchise_warehouse_stock row by
--      p_quantity so the destination increases by exactly p_quantity (Req 19.2).
--   5. INSERT exactly one stock_transfers ledger row and RETURN its id (Req 19.5).
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the transferStock Server Action after the action has
-- authorized the caller and validated inputs. Running as DEFINER keeps the
-- atomic transfer behaving consistently regardless of the caller's row-level
-- privileges, mirroring create-move-pincode-rpc.sql and the franchise schema.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- ORDERING REQUIREMENT: This file MUST run AFTER both
-- create-franchise-warehouse-tables.sql (provides franchise_warehouses and
-- franchise_warehouse_stock) and create-stock-transfers-table.sql (provides the
-- stock_transfers ledger). All three tables must exist before this RPC is created.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.transfer_stock(text, uuid, uuid, uuid, numeric, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_source_kind         text,
  p_source_franchise_id uuid,
  p_dest_franchise_id   uuid,
  p_product_id          uuid,
  p_quantity            numeric,
  p_created_by          uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dest_warehouse_id   uuid;
  v_source_warehouse_id uuid;
  v_available           numeric;
  v_transfer_id         uuid;
BEGIN
  -- 1. Validate transfer quantity (Req 19.4). A non-positive quantity aborts the
  --    transaction before any balance is touched and before any ledger row exists.
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid transfer quantity';
  END IF;

  -- 2. Resolve the destination warehouse — each franchise owns exactly one
  --    warehouse (Req 19.1). A missing warehouse is a hard error.
  SELECT id
    INTO v_dest_warehouse_id
    FROM public.franchise_warehouses
   WHERE franchise_id = p_dest_franchise_id;

  IF v_dest_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'destination warehouse not found for franchise %', p_dest_franchise_id;
  END IF;

  -- 3. Source handling (Req 19.7). Source can be CORE or another FRANCHISE.
  IF p_source_kind = 'FRANCHISE' THEN
    -- Resolve the source franchise's single warehouse.
    SELECT id
      INTO v_source_warehouse_id
      FROM public.franchise_warehouses
     WHERE franchise_id = p_source_franchise_id;

    IF v_source_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'source warehouse not found for franchise %', p_source_franchise_id;
    END IF;

    -- Check available stock for the product in the source warehouse. A missing
    -- stock row means zero available.
    SELECT quantity
      INTO v_available
      FROM public.franchise_warehouse_stock
     WHERE warehouse_id = v_source_warehouse_id
       AND product_id = p_product_id;

    IF v_available IS NULL OR v_available < p_quantity THEN
      RAISE EXCEPTION 'insufficient source stock';  -- Req 19.3
    END IF;

    -- Decrement the source row by p_quantity. Combined with the destination
    -- increment below, total stock across both franchises is conserved (Req 19.2).
    UPDATE public.franchise_warehouse_stock
       SET quantity = quantity - p_quantity
     WHERE warehouse_id = v_source_warehouse_id
       AND product_id = p_product_id;

  ELSIF p_source_kind = 'CORE' THEN
    -- CORE is the origin. There is no franchise source row to decrement in this
    -- franchise model, so franchise stock is left untouched. Core stock
    -- accounting (the core inventory_* / manufacturing_* tables) is OUT OF SCOPE
    -- for this ledger and is intentionally NOT modified here.
    NULL;

  ELSE
    RAISE EXCEPTION 'invalid source kind';
  END IF;

  -- 4. Upsert/increment the destination stock row by exactly p_quantity (Req 19.2).
  --    The UNIQUE(warehouse_id, product_id) constraint backs the ON CONFLICT.
  INSERT INTO public.franchise_warehouse_stock (warehouse_id, franchise_id, product_id, quantity)
  VALUES (v_dest_warehouse_id, p_dest_franchise_id, p_product_id, p_quantity)
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET quantity = public.franchise_warehouse_stock.quantity + p_quantity;

  -- 5. Record exactly one ledger row describing the movement and return its id (Req 19.5).
  INSERT INTO public.stock_transfers (
    source_kind,
    source_franchise_id,
    dest_warehouse_id,
    dest_franchise_id,
    product_id,
    quantity,
    created_by
  )
  VALUES (
    p_source_kind,
    p_source_franchise_id,
    v_dest_warehouse_id,
    p_dest_franchise_id,
    p_product_id,
    p_quantity,
    p_created_by
  )
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- ============================================================================
-- DONE. transfer_stock is the authoritative atomic stock-transfer path.
-- Invoke it from the transferStock Server Action via
-- createAdminClient().rpc("transfer_stock", { ... }).
-- Run only AFTER create-franchise-warehouse-tables.sql and
-- create-stock-transfers-table.sql.
-- ============================================================================
