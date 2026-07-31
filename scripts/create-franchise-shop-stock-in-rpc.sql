-- ============================================================================
-- FRANCHISE SHOP STOCK — franchise_shop_stock_in RPC (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 11.2
-- Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10,
--               18.11, 18.12
--
-- Defines franchise_shop_stock_in(p_franchise_id, p_product_id, p_quantity,
-- p_actor_user_id): the AUTHORITATIVE, single-transaction Stock_In path for a
-- Franchise's own shop, the direct twin of clinic_shop_stock_in
-- (create-clinic-shop-stock-in-rpc.sql) but over franchise_inventory_lots /
-- franchise_product_settings / franchise_inventory_ledger and for exactly one
-- product per call (design.md's signature is singular, not a jsonb lines
-- array — a franchise Stock_In submits one product at a time).
--
-- What it does, in order, within one transaction:
--   1. Resolve and validate the Franchise exists (Req 18.10 — the scope check
--      itself is enforced by the caller passing scope.franchise_id, never a
--      client-supplied value; this RPC only re-validates existence).
--   2. Resolve and validate the acting user exists.
--   3. Resolve and validate the Shop_Product exists and carries a Product_Link
--      (Req 18.9); resolve its linked Master_Catalog_Product id.
--   4. Validate the quantity is an integer in [1, 1,000,000] (Req 18.7).
--   5. Create a missing franchise_product_settings row at (0, is_visible =
--      false) when absent (Req 18.3 — note the asymmetry with the clinic
--      overlay's visible-by-default: a franchise settings row defaults
--      HIDDEN), then SELECT ... FOR UPDATE that row — this is what serialises
--      two concurrent Stock_In submissions for the same (franchise, product)
--      so their quantities compose additively rather than racing (Req 18.5).
--      Creating the row here is safe even though validation is not finished:
--      the whole function is one transaction, so a later RAISE undoes this
--      insert too (Req 18.4).
--   6. Validate the resulting stock_quantity would not exceed
--      Stock_Quantity_Maximum (Req 18.8).
--   7. FIFO-deplete franchise_inventory_lots for this franchise + linked
--      Master_Catalog_Product, oldest-first (expiry_date ASC, received_at
--      ASC, matching idx_fil_fifo), locking ACTIVE lots with FOR UPDATE.
--      Raise naming the quantity currently available when insufficient
--      (Req 18.6).
--   8. Write ONE OUT franchise_inventory_ledger entry whose stock_out_reason
--      is 'SHOP_STOCK_IN' (Req 18.2) — a new reason value, added to the
--      ledger's stock_out_reason CHECK constraint by this same script (see
--      "Reason-value migration" below) — with a batch_breakdown built from
--      the depleted lots, matching the shape record_franchise_stock_out
--      writes.
--   9. Increase franchise_product_settings.stock_quantity by the quantity
--      (Req 18.2).
--  10. Return a jsonb report of what was applied.
--
-- Reason-value migration (documented choice):
-- franchise_inventory_ledger.stock_out_reason is constrained by an inline
-- CHECK naming a fixed set of reasons (MEAL_SUBSCRIPTION_SALE,
-- KIT_SUBSCRIPTION_SALE, ONE_TIME_PURCHASE_SALE, SPOILED, DAMAGED, OTHER —
-- create-franchise-inventory-ledger-table.sql), none of which identify a shop
-- stock-in. src/test/shop/clinicStockModel.ts's FRANCHISE_SHOP_STOCK_IN_REASON
-- constant is already "SHOP_STOCK_IN", so the design intends a NEW allowed
-- value rather than reusing OTHER. This script widens that CHECK constraint
-- INLINE (step 0 below) rather than as a separate migration file: the change
-- is a single-line, tightly-coupled addition that only this RPC's callers
-- exercise, and create-clinic-shop-stock-in-rpc.sql (task 4.1) set the
-- precedent of an RPC-creation script owning the schema tweaks it uniquely
-- depends on. The widening follows the house convention used by
-- add-franchise-dispatch-to-inventory-transactions.sql (DROP CONSTRAINT IF
-- EXISTS ... ADD CONSTRAINT ...), but ADDS the new value to the existing
-- fixed set rather than dropping the constraint outright, since the other six
-- reason values must remain the only other allowed values.
--
-- Error message prefixes (reusing src/test/shop/clinicStockModel.ts's
-- MODEL_ERROR_PREFIXES, which documents that the franchise twin deliberately
-- reuses the clinic prefixes for the cap and unlinked-product cases (Req
-- 18.8, 18.9) and for the warehouse shortfall wording (Req 18.6)):
--   CLINIC_REFERENCE_NOT_FOUND:          franchise, product, or actor not found
--   CLINIC_STOCK_INVALID_QUANTITY:       quantity not an integer in [1, 1,000,000] (Req 18.7)
--   CLINIC_STOCK_UNLINKED_PRODUCT:       product has no Product_Link (Req 18.9)
--   CLINIC_STOCK_EXCEEDS_MAXIMUM:        resulting stock would exceed 1,000,000 (Req 18.8)
--   CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: franchise warehouse stock is insufficient (Req 18.6)
--
-- DELIBERATE DEVIATIONS from src/test/shop/clinicStockModel.ts's
-- franchiseShopStockIn, documented per the task instructions:
--   * The model checks the Stock_Quantity_Maximum cap BEFORE planning FIFO
--     depletion, using the settings row's value without creating it. This RPC
--     creates-and-locks the settings row first (step 5) so the SELECT ... FOR
--     UPDATE genuinely serialises concurrent submissions (Req 18.5) before any
--     check runs — matching clinic_shop_stock_in's own ordering (lock the
--     overlay, then check availability, then check the cap). Both orderings
--     are equivalent in final state: every check happens before any lot or
--     ledger mutation, and a RAISE at any point rolls back the whole
--     transaction, including the settings-row insert (Req 18.4).
--   * The report is returned with snake_case keys (franchise_id, product_id,
--     quantity, stock_before, stock_after, transaction_lot_ids,
--     ledger_entry_id, settings_created) — matching
--     create-clinic-shop-stock-in-rpc.sql's snake_case-over-the-wire
--     convention — rather than the model's camelCase FranchiseStockInReport.
--
-- SECURITY DEFINER: invoked by the service-role admin client from
-- franchiseShopStockInAction after resolveScope() authorization and Zod
-- validation. Running as DEFINER keeps the atomic Stock_In behaving
-- consistently regardless of the caller's row-level privileges, matching
-- record_franchise_stock_out and receive_franchise_transfer.
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (public.franchises)
--   - create-franchise-inventories-table.sql (public.franchise_inventories)
--   - create-franchise-inventory-lots-table.sql (public.franchise_inventory_lots)
--   - create-franchise-inventory-ledger-table.sql (public.franchise_inventory_ledger)
--   - franchise-product-settings.sql (public.franchise_product_settings)
--   - add-inventory-product-link-to-products.sql (products.inventory_product_id)
--   - public.users exists
--
-- Safety: Widens one CHECK constraint (additive value only, no existing value
-- removed) and creates/replaces a function; no table is dropped, no column is
-- altered, no existing row is touched. Idempotent (re-runnable) via
-- DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT and CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.franchise_shop_stock_in(uuid, uuid, integer, uuid);
--   ALTER TABLE public.franchise_inventory_ledger
--     DROP CONSTRAINT IF EXISTS franchise_inventory_ledger_stock_out_reason_check;
--   ALTER TABLE public.franchise_inventory_ledger
--     ADD CONSTRAINT franchise_inventory_ledger_stock_out_reason_check
--     CHECK (stock_out_reason IN (
--       'MEAL_SUBSCRIPTION_SALE','KIT_SUBSCRIPTION_SALE','ONE_TIME_PURCHASE_SALE',
--       'SPOILED','DAMAGED','OTHER'
--     ));
-- ============================================================================

-- ============================================================================
-- 0. Widen the stock_out_reason CHECK to allow 'SHOP_STOCK_IN' (Req 18.2)
-- ============================================================================
-- The column-level CHECK from create-franchise-inventory-ledger-table.sql is
-- named `franchise_inventory_ledger_stock_out_reason_check` by Postgres's
-- default naming convention (table_column_check). Dropped and re-added with
-- the new value appended so every existing reason remains valid.

ALTER TABLE public.franchise_inventory_ledger
  DROP CONSTRAINT IF EXISTS franchise_inventory_ledger_stock_out_reason_check;

ALTER TABLE public.franchise_inventory_ledger
  ADD CONSTRAINT franchise_inventory_ledger_stock_out_reason_check
  CHECK (stock_out_reason IN (
    'MEAL_SUBSCRIPTION_SALE',
    'KIT_SUBSCRIPTION_SALE',
    'ONE_TIME_PURCHASE_SALE',
    'SPOILED',
    'DAMAGED',
    'OTHER',
    'SHOP_STOCK_IN'
  ));

-- ============================================================================
-- 1. franchise_shop_stock_in RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.franchise_shop_stock_in(
  p_franchise_id  uuid,
  p_product_id    uuid,
  p_quantity      integer,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_found       boolean;
  v_actor_found           boolean;
  v_product_found         boolean;
  v_inventory_product_id  uuid;

  v_stock_before          integer;
  v_settings_created      boolean;
  v_insert_row_count      integer;

  v_lot                   RECORD;
  v_available             numeric := 0;
  v_remaining             numeric;
  v_deduct                numeric;
  v_batch_breakdown       jsonb := '[]'::jsonb;
  v_transaction_lot_ids   jsonb := '[]'::jsonb;

  v_ledger_id             bigint;
BEGIN
  -- ==========================================================================
  -- 1. Resolve and validate the Franchise exists (Req 18.10, 18.11)
  -- ==========================================================================
  SELECT true INTO v_franchise_found FROM public.franchises WHERE id = p_franchise_id;
  IF NOT COALESCE(v_franchise_found, false) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: franchise % was not found', p_franchise_id;
  END IF;

  -- ==========================================================================
  -- 2. Resolve and validate the acting user exists
  -- ==========================================================================
  SELECT true INTO v_actor_found FROM public.users WHERE id = p_actor_user_id;
  IF NOT COALESCE(v_actor_found, false) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: acting user % was not found', p_actor_user_id;
  END IF;

  -- ==========================================================================
  -- 3. Resolve and validate the Shop_Product exists, and resolve its
  --    Product_Link (Req 18.9)
  -- ==========================================================================
  SELECT true, inventory_product_id
    INTO v_product_found, v_inventory_product_id
    FROM public.products
   WHERE id = p_product_id;

  IF NOT COALESCE(v_product_found, false) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: shop product % was not found', p_product_id;
  END IF;

  IF v_inventory_product_id IS NULL THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_UNLINKED_PRODUCT: the shop product must be linked to a Master Catalog Product before stock-in (product %)',
      p_product_id;
  END IF;

  -- ==========================================================================
  -- 4. Validate the quantity is an integer in [1, 1,000,000] (Req 18.7)
  -- ==========================================================================
  IF p_quantity IS NULL
     OR p_quantity != trunc(p_quantity)
     OR p_quantity < 1
     OR p_quantity > 1000000
  THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INVALID_QUANTITY: quantity must be a whole number between 1 and 1,000,000 (received %)',
      p_quantity;
  END IF;

  -- ==========================================================================
  -- 5. Create a missing franchise_product_settings row at (0, is_visible =
  --    false) when absent (Req 18.3), then lock it — this serialises
  --    concurrent Stock_In submissions for the same (franchise, product) so
  --    their quantities compose additively (Req 18.5). A row created here is
  --    rolled back with everything else if a later step raises (Req 18.4).
  -- ==========================================================================
  INSERT INTO public.franchise_product_settings (franchise_id, product_id, stock_quantity, is_visible)
  VALUES (p_franchise_id, p_product_id, 0, false)
  ON CONFLICT (franchise_id, product_id) DO NOTHING;

  GET DIAGNOSTICS v_insert_row_count = ROW_COUNT;
  v_settings_created := (v_insert_row_count > 0);

  SELECT stock_quantity INTO v_stock_before
    FROM public.franchise_product_settings
   WHERE franchise_id = p_franchise_id AND product_id = p_product_id
   FOR UPDATE;

  -- ==========================================================================
  -- 6. Stock_Quantity_Maximum cap on the resulting stock level (Req 18.8)
  -- ==========================================================================
  IF v_stock_before + p_quantity > 1000000 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_EXCEEDS_MAXIMUM: the maximum stock quantity is 1,000,000 (product % would become %)',
      p_product_id, v_stock_before + p_quantity;
  END IF;

  -- ==========================================================================
  -- 7. FIFO-deplete franchise_inventory_lots oldest-first (expiry_date ASC,
  --    received_at ASC — matching idx_fil_fifo), for this franchise and the
  --    linked Master_Catalog_Product (Req 18.2, 18.6).
  -- ==========================================================================
  SELECT COALESCE(SUM(quantity_remaining), 0)
    INTO v_available
    FROM public.franchise_inventory_lots
   WHERE franchise_id = p_franchise_id
     AND product_id = v_inventory_product_id
     AND status = 'ACTIVE';

  IF p_quantity > v_available THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: franchise warehouse stock is insufficient — requested % but only % available for product %',
      p_quantity, v_available, p_product_id;
  END IF;

  v_remaining := p_quantity;

  FOR v_lot IN
    SELECT id, batch_number, quantity_remaining, expiry_date
      FROM public.franchise_inventory_lots
     WHERE franchise_id = p_franchise_id
       AND product_id = v_inventory_product_id
       AND status = 'ACTIVE'
       AND quantity_remaining > 0
     ORDER BY expiry_date ASC, received_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_deduct := LEAST(v_lot.quantity_remaining, v_remaining);

    UPDATE public.franchise_inventory_lots
       SET quantity_remaining = quantity_remaining - v_deduct,
           status = CASE
                      WHEN quantity_remaining - v_deduct = 0 THEN 'DEPLETED'
                      ELSE status
                    END
     WHERE id = v_lot.id;

    v_batch_breakdown := v_batch_breakdown || jsonb_build_array(
      jsonb_build_object(
        'batch_number', v_lot.batch_number,
        'quantity', v_deduct,
        'expiry_date', v_lot.expiry_date
      )
    );
    v_transaction_lot_ids := v_transaction_lot_ids || to_jsonb(v_lot.id);

    v_remaining := v_remaining - v_deduct;
  END LOOP;

  -- Safety net mirroring record_franchise_stock_out / clinic_shop_stock_in:
  -- should not trigger given the availability check above, but guards
  -- against a concurrent depletion of the same lots between the check and
  -- this loop.
  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: franchise warehouse stock changed concurrently and is now insufficient for product %',
      p_product_id;
  END IF;

  -- ==========================================================================
  -- 8. Write ONE OUT franchise_inventory_ledger entry, reason 'SHOP_STOCK_IN'
  --    (Req 18.2)
  -- ==========================================================================
  INSERT INTO public.franchise_inventory_ledger (
    franchise_id, direction, product_id, quantity, batch_breakdown, stock_out_reason
  ) VALUES (
    p_franchise_id, 'OUT', v_inventory_product_id, p_quantity, v_batch_breakdown, 'SHOP_STOCK_IN'
  )
  RETURNING id INTO v_ledger_id;

  -- ==========================================================================
  -- 9. Increase franchise_product_settings.stock_quantity by the quantity
  --    (Req 18.2)
  -- ==========================================================================
  UPDATE public.franchise_product_settings
     SET stock_quantity = stock_quantity + p_quantity
   WHERE franchise_id = p_franchise_id AND product_id = p_product_id;

  -- ==========================================================================
  -- 10. Return the report
  -- ==========================================================================
  RETURN jsonb_build_object(
    'franchise_id', p_franchise_id,
    'product_id', p_product_id,
    'quantity', p_quantity,
    'stock_before', v_stock_before,
    'stock_after', v_stock_before + p_quantity,
    'transaction_lot_ids', v_transaction_lot_ids,
    'ledger_entry_id', v_ledger_id,
    'settings_created', v_settings_created
  );
END;
$$;

-- ============================================================================
-- DONE. franchise_shop_stock_in is the authoritative atomic franchise Stock_In
-- path. Invoke it from franchiseShopStockInAction via
-- createAdminClient().rpc("franchise_shop_stock_in", { ... }).
-- Run only AFTER franchises, franchise_inventories, franchise_inventory_lots,
-- franchise_inventory_ledger, franchise_product_settings,
-- products.inventory_product_id, and users exist.
-- ============================================================================
