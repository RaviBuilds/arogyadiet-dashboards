-- ============================================================================
-- CLINIC SHOP STOCK — clinic_shop_stock_in RPC (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 4.1
-- Requirements: 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.14, 7.15, 7.16, 2.5,
--               2.6, 2.8, 2.11, 3.6, 19.4, 19.9
--
-- Defines clinic_shop_stock_in(p_clinic_id, p_lines, p_actor_user_id): the
-- AUTHORITATIVE, single-transaction Stock_In path (Requirement 7) that moves a
-- chosen quantity of one or more Shop_Products from warehouse
-- Master_Catalog_Product stock into one Core_Clinic's Clinic_Shop_Stock.
--
-- Construction mirrors the house pattern for multi-table atomic mutation
-- (scripts/create-dispatch-to-franchise-rpc.sql,
-- scripts/create-receive-franchise-transfer-rpc.sql): a plpgsql function body
-- runs inside one implicit transaction, so every RAISE EXCEPTION on this
-- path — a validation failure or a mid-loop safety-net trip — rolls back
-- every write the function made up to that point, leaving every
-- Clinic_Shop_Stock record, every inventory_lots quantity, every
-- Clinic_Shop_Ledger entry, and every inventory_transactions entry unchanged
-- (Req 7.10).
--
-- What it does, in order, within one transaction:
--   1. Resolve and validate the destination is an existing Core_Clinic
--      (rejects a franchise-owned clinic outright — Req 19.4, 19.9) and that
--      the acting user exists (Req 2.4).
--   2. Parse p_lines (jsonb array of {product_id, quantity}) and aggregate by
--      product_id — a defensive safety net so a duplicate product_id in one
--      submission is summed rather than double-applied — ordered by
--      product_id, which is also the lock order used in step 4 (Req 7.11).
--   3. Validate EVERY line before mutating anything, in fixed categories,
--      each raising only after every offending line in that category is
--      collected (Req 7.10, 7.12, 7.14):
--        a. every product_id references an existing Shop_Product
--        b. every quantity is an integer in [1, 1,000,000]
--        c. every Shop_Product carries a Product_Link (Req 7.15)
--   4. Create a missing clinic_product_settings row at (0, visible=true) for
--      every line (Req 7.7), then SELECT ... FOR UPDATE those rows ordered by
--      product_id — deadlock-free serialisation of concurrent multi-line
--      Stock_In submissions for this clinic (Req 7.11). Creating the row here
--      is safe even though validation is not finished: the whole function is
--      one transaction, so a later RAISE undoes this insert too.
--   5. Validate warehouse availability, POOLED per linked Master_Catalog
--      Product since more than one Shop_Product may share one
--      (Req 3.9, 7.12), and validate the resulting clinic level would not
--      exceed Stock_Quantity_Maximum (Req 7.14).
--   6. For every accepted line: FIFO-deplete inventory_lots oldest-first
--      (expiry_date ASC, created_at ASC), writing ONE OUT
--      inventory_transactions row PER DEPLETED LOT with
--      reason = 'shop-clinic:<clinic_uuid>' (Req 7.8, 7.9, 7.16, 3.6); set
--      the transaction-local app.clinic_stock_in flag and raise the overlay
--      (Req 8.3); write exactly ONE IN clinic_product_ledger entry per line,
--      referencing the FIRST of that line's depleted-lot transactions
--      (Req 2.5, 2.6, 2.8, 2.11 — matches the ck_cpl_reference CHECK on
--      clinic_product_ledger, which accepts exactly one
--      inventory_transaction_id per WAREHOUSE_STOCK_IN entry).
--   7. Return a jsonb report of what was applied.
--
-- Error message prefixes (see design.md's "Message mapping" table and
-- src/test/shop/clinicStockModel.ts's MODEL_ERROR_PREFIXES):
--   CLINIC_REFERENCE_NOT_FOUND:        clinic, product, or actor not found (Req 1.2, 2.4)
--   CLINIC_NOT_CORE:                   destination clinic belongs to a franchise (Req 1.9, 19.4, 19.9)
--   CLINIC_STOCK_INVALID_SUBMISSION:   no pending lines
--   CLINIC_STOCK_INVALID_QUANTITY:     quantity not an integer in [1, 1,000,000] (Req 7.13)
--   CLINIC_STOCK_UNLINKED_PRODUCT:     product has no Product_Link (Req 7.15)
--   CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: pooled warehouse demand exceeds availability (Req 7.12)
--   CLINIC_STOCK_EXCEEDS_MAXIMUM:      resulting clinic level would exceed 1,000,000 (Req 7.14)
--
-- DELIBERATE DEVIATIONS from src/test/shop/clinicStockModel.ts, documented
-- here per the task instructions since that model is what Task 4.14's
-- integration tests will pin to this RPC:
--   * The model's requireCoreClinic() distinguishes a franchise-*id* passed as
--     the destination (CLINIC_STOCK_FRANCHISE_DESTINATION:) from a clinic row
--     that is franchise-owned (CLINIC_NOT_CORE:), because the model's World
--     has a separate franchise-id namespace standing in for the
--     franchise_shop_stock_in() RPC's own p_franchise_id parameter. This RPC
--     has only p_clinic_id — there is no second id space to distinguish — so
--     it raises CLINIC_NOT_CORE: for a franchise-owned clinic, matching this
--     table's own trg_cps_core_clinic_only trigger and design.md's message
--     mapping table (Req 1.9, 13.12), which is the authoritative prefix for
--     exactly this rejection. Task 4.14 should treat CLINIC_STOCK_FRANCHISE_
--     DESTINATION: and CLINIC_NOT_CORE: as equivalent for this RPC.
--   * CLINIC_STOCK_INVALID_QUANTITY: and CLINIC_STOCK_INVALID_SUBMISSION: are
--     not in design.md's message-mapping table (that table omits a prefix for
--     Req 7.13's quantity-range rejection and for an empty submission) but ARE
--     in the model's MODEL_ERROR_PREFIXES list, so this RPC uses the model's
--     values to close that gap rather than inventing new ones.
--   * The report is returned with snake_case keys (clinic_id, applied[
--     {product_id, quantity, stock_before, stock_after, transaction_ids,
--     ledger_entry_id}], total_quantity) — matching the jsonb comment in
--     design.md's RPC signature list and the project's snake_case-over-the-
--     wire convention — rather than the model's camelCase StockInReport.
--     Task 4.14's integration tests should map field names accordingly.
--   * A duplicate product_id across two lines in one submission is summed
--     into a single applied line (one overlay update, one ledger entry)
--     rather than rejected as DUPLICATE_LINE. The Shop_Products_Cart already
--     guarantees uniqueness per (clinic, product) via mergeStockInLine before
--     a submission reaches this RPC (Req 7.4), so this is a defensive
--     safety net, not a documented rejection path.
--
-- SECURITY DEFINER: invoked by the service-role admin client from
-- clinicStockInAction after authorization (checkWarehouseAccess) and Zod
-- validation. Running as DEFINER keeps the atomic Stock_In behaving
-- consistently regardless of the caller's row-level privileges, matching
-- dispatch_to_franchise and receive_franchise_transfer.
--
-- ORDERING: This script MUST run AFTER:
--   - create-clinic-hierarchy-tables.sql (public.clinics, with franchise_id)
--   - create-clinic-product-settings-table.sql (public.clinic_product_settings,
--     with trg_cps_increase_guard reading app.clinic_stock_in)
--   - create-clinic-product-ledger-table.sql (public.clinic_product_ledger,
--     with ck_cpl_reference)
--   - add-inventory-product-link-to-products.sql (products.inventory_product_id)
--   - inventory_lots and inventory_transactions tables exist, with the
--     inventory_lot_status enum and the reason column's fixed-value CHECK
--     already dropped (add-inventory-transaction-reason.sql,
--     add-franchise-dispatch-to-inventory-transactions.sql)
--   - public.users exists
--
-- Safety: Creates/replaces a function only; no table is altered or dropped.
-- Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.clinic_shop_stock_in(uuid, jsonb, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clinic_shop_stock_in(
  p_clinic_id     uuid,
  p_lines         jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_found          boolean;
  v_clinic_franchise_id   uuid;
  v_actor_found           boolean;

  -- Aggregated, product_id-ordered submission (Req 7.11)
  v_product_ids           uuid[];
  v_quantities            numeric[];
  v_line_count            integer;

  -- Per-line working state, aligned by index with v_product_ids
  v_inventory_product_ids uuid[] := ARRAY[]::uuid[];
  v_current_stocks        integer[] := ARRAY[]::integer[];

  -- Error accumulators (collect every offender before raising)
  v_missing_products      text := '';
  v_missing_count         integer := 0;
  v_bad_quantity_products text := '';
  v_bad_quantity_count    integer := 0;
  v_unlinked_products     text := '';
  v_unlinked_count        integer := 0;
  v_shortfall_products    text := '';
  v_shortfall_count       integer := 0;
  v_overflow_products     text := '';
  v_overflow_count        integer := 0;

  -- Pooled warehouse demand/availability per Master_Catalog_Product (Req 3.9)
  v_demand_by_inv         jsonb := '{}'::jsonb;
  v_available_by_inv      jsonb := '{}'::jsonb;

  i                       integer;
  v_product_id            uuid;
  v_quantity              integer;
  v_inventory_product_id  uuid;
  v_current_stock         integer;
  v_resulting_stock       integer;
  v_pool_demand           numeric;
  v_pool_available        numeric;

  -- FIFO depletion working state
  v_lot                   RECORD;
  v_remaining             numeric;
  v_deduct                numeric;
  v_new_qty               numeric;
  v_new_status            text;
  v_transaction_id        uuid;
  v_first_transaction_id  uuid;
  v_transaction_ids       jsonb;

  v_ledger_id             bigint;
  v_reason                text;
  v_applied               jsonb := '[]'::jsonb;
  v_total_quantity        integer := 0;
BEGIN
  -- ==========================================================================
  -- 1. Resolve and validate the destination Core_Clinic (Req 1.9, 19.4, 19.9)
  -- ==========================================================================
  SELECT true, franchise_id
    INTO v_clinic_found, v_clinic_franchise_id
    FROM public.clinics
   WHERE id = p_clinic_id;

  IF NOT COALESCE(v_clinic_found, false) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: clinic % was not found', p_clinic_id;
  END IF;

  IF v_clinic_franchise_id IS NOT NULL THEN
    RAISE EXCEPTION
      'CLINIC_NOT_CORE: clinic shop stock-in applies to Core Clinics only; clinic % belongs to franchise % — use franchise_shop_stock_in instead',
      p_clinic_id, v_clinic_franchise_id;
  END IF;

  -- ==========================================================================
  -- 2. Resolve and validate the acting user (Req 2.1, 2.4)
  -- ==========================================================================
  SELECT true INTO v_actor_found FROM public.users WHERE id = p_actor_user_id;
  IF NOT COALESCE(v_actor_found, false) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: acting user % was not found', p_actor_user_id;
  END IF;

  -- ==========================================================================
  -- 3. Parse and aggregate submitted lines by product_id, ordered by
  --    product_id (Req 7.11's lock order; a duplicate product_id is summed
  --    rather than double-applied — see header note).
  -- ==========================================================================
  SELECT array_agg(product_id ORDER BY product_id),
         array_agg(qty ORDER BY product_id)
    INTO v_product_ids, v_quantities
    FROM (
      SELECT (elem->>'product_id')::uuid AS product_id,
             SUM((elem->>'quantity')::numeric) AS qty
        FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS elem
       GROUP BY (elem->>'product_id')::uuid
    ) grouped;

  v_line_count := COALESCE(array_length(v_product_ids, 1), 0);

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: the stock-in submission has no pending lines';
  END IF;

  -- ==========================================================================
  -- 4. Validate EVERY line before mutating anything (Req 7.10, 7.12, 7.14).
  --    Each category collects every offender before raising.
  -- ==========================================================================

  -- 4a. Every product_id must reference an existing Shop_Product (Req 1.2, 2.4)
  FOR i IN 1..v_line_count LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_ids[i]) THEN
      v_missing_count := v_missing_count + 1;
      v_missing_products := v_missing_products
        || CASE WHEN v_missing_products = '' THEN '' ELSE ', ' END
        || COALESCE(v_product_ids[i]::text, '(missing product_id)');
    END IF;
  END LOOP;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: shop product(s) not found: %', v_missing_products;
  END IF;

  -- 4b. Every quantity must be an integer in [1, 1,000,000] (Req 7.13)
  FOR i IN 1..v_line_count LOOP
    IF v_quantities[i] IS NULL
       OR v_quantities[i] != trunc(v_quantities[i])
       OR v_quantities[i] < 1
       OR v_quantities[i] > 1000000
    THEN
      v_bad_quantity_count := v_bad_quantity_count + 1;
      v_bad_quantity_products := v_bad_quantity_products
        || CASE WHEN v_bad_quantity_products = '' THEN '' ELSE ', ' END
        || format('%s (quantity %s)', COALESCE(v_product_ids[i]::text, '(missing product_id)'), v_quantities[i]);
    END IF;
  END LOOP;

  IF v_bad_quantity_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INVALID_QUANTITY: quantity must be a whole number between 1 and 1,000,000 for: %',
      v_bad_quantity_products;
  END IF;

  -- 4c. Every Shop_Product must carry a Product_Link (Req 7.15). Also
  --     resolves inventory_product_id for every line, used from here on.
  FOR i IN 1..v_line_count LOOP
    SELECT inventory_product_id INTO v_inventory_product_id
      FROM public.products
     WHERE id = v_product_ids[i];

    v_inventory_product_ids := v_inventory_product_ids || v_inventory_product_id;

    IF v_inventory_product_id IS NULL THEN
      v_unlinked_count := v_unlinked_count + 1;
      v_unlinked_products := v_unlinked_products
        || CASE WHEN v_unlinked_products = '' THEN '' ELSE ', ' END
        || v_product_ids[i]::text;
    END IF;
  END LOOP;

  IF v_unlinked_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_UNLINKED_PRODUCT: shop product(s) must be linked to a Master Catalog Product before stock-in: %',
      v_unlinked_products;
  END IF;

  -- ==========================================================================
  -- 5. Create a missing overlay row for every line at (0, visible=true)
  --    (Req 7.7), then lock every line's overlay row, ordered by product_id,
  --    so concurrent multi-line Stock_In submissions for this clinic
  --    serialise deadlock-free (Req 7.11). A row created here is rolled back
  --    with everything else if a later step raises (Req 7.10).
  -- ==========================================================================
  FOR i IN 1..v_line_count LOOP
    INSERT INTO public.clinic_product_settings (clinic_id, product_id, stock_quantity, is_visible)
    VALUES (p_clinic_id, v_product_ids[i], 0, true)
    ON CONFLICT (clinic_id, product_id) DO NOTHING;
  END LOOP;

  FOR i IN 1..v_line_count LOOP
    SELECT stock_quantity INTO v_current_stock
      FROM public.clinic_product_settings
     WHERE clinic_id = p_clinic_id AND product_id = v_product_ids[i]
     FOR UPDATE;
    v_current_stocks := v_current_stocks || v_current_stock;
  END LOOP;

  -- ==========================================================================
  -- 6. Warehouse availability, POOLED per linked Master_Catalog_Product
  --    since several Shop_Products may share one (Req 3.9, 7.12). Demand and
  --    availability are each summed once per distinct inventory_product_id.
  -- ==========================================================================
  FOR v_inventory_product_id IN
    SELECT DISTINCT unnest(v_inventory_product_ids)
  LOOP
    SELECT COALESCE(SUM(v_quantities[k]), 0)
      INTO v_pool_demand
      FROM generate_subscripts(v_inventory_product_ids, 1) AS k
     WHERE v_inventory_product_ids[k] = v_inventory_product_id;

    SELECT COALESCE(SUM(quantity_remaining), 0)
      INTO v_pool_available
      FROM public.inventory_lots
     WHERE product_id = v_inventory_product_id
       AND status = 'ACTIVE';

    v_demand_by_inv := jsonb_set(v_demand_by_inv, ARRAY[v_inventory_product_id::text], to_jsonb(v_pool_demand), true);
    v_available_by_inv := jsonb_set(v_available_by_inv, ARRAY[v_inventory_product_id::text], to_jsonb(v_pool_available), true);
  END LOOP;

  FOR i IN 1..v_line_count LOOP
    v_pool_demand := (v_demand_by_inv ->> v_inventory_product_ids[i]::text)::numeric;
    v_pool_available := (v_available_by_inv ->> v_inventory_product_ids[i]::text)::numeric;
    IF v_pool_demand > v_pool_available THEN
      v_shortfall_count := v_shortfall_count + 1;
      v_shortfall_products := v_shortfall_products
        || CASE WHEN v_shortfall_products = '' THEN '' ELSE ', ' END
        || format('%s (requested %s, available %s)', v_product_ids[i]::text, v_quantities[i], v_pool_available);
    END IF;
  END LOOP;

  IF v_shortfall_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: insufficient warehouse stock for: %',
      v_shortfall_products;
  END IF;

  -- ==========================================================================
  -- 7. Stock_Quantity_Maximum cap on the resulting clinic level (Req 7.14)
  -- ==========================================================================
  FOR i IN 1..v_line_count LOOP
    v_resulting_stock := v_current_stocks[i] + v_quantities[i];
    IF v_resulting_stock > 1000000 THEN
      v_overflow_count := v_overflow_count + 1;
      v_overflow_products := v_overflow_products
        || CASE WHEN v_overflow_products = '' THEN '' ELSE ', ' END
        || format('%s (would become %s)', v_product_ids[i]::text, v_resulting_stock);
    END IF;
  END LOOP;

  IF v_overflow_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_EXCEEDS_MAXIMUM: the maximum stock quantity is 1,000,000 — rejected for: %',
      v_overflow_products;
  END IF;

  -- ==========================================================================
  -- Every line accepted. Apply each: FIFO-deplete the warehouse, raise the
  -- overlay, and write exactly one IN ledger entry (Req 2.5, 2.6, 2.8, 2.11,
  -- 7.6, 7.8, 7.9, 7.16, 3.6).
  -- ==========================================================================

  v_reason := 'shop-clinic:' || p_clinic_id::text;

  FOR i IN 1..v_line_count LOOP
    v_product_id := v_product_ids[i];
    v_quantity := v_quantities[i];
    v_inventory_product_id := v_inventory_product_ids[i];
    v_remaining := v_quantity;
    v_first_transaction_id := NULL;
    v_transaction_ids := '[]'::jsonb;

    -- 7a. FIFO-deplete inventory_lots oldest-first, one OUT
    --     inventory_transactions row PER DEPLETED LOT, fully auditable
    --     (Req 7.8, 7.9, 3.6). Row lock prevents a concurrent depletion of
    --     the same lot.
    FOR v_lot IN
      SELECT id, quantity_remaining
        FROM public.inventory_lots
       WHERE product_id = v_inventory_product_id
         AND status = 'ACTIVE'
         AND quantity_remaining > 0
       ORDER BY expiry_date ASC, created_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_deduct := LEAST(v_lot.quantity_remaining, v_remaining);
      v_new_qty := v_lot.quantity_remaining - v_deduct;
      v_new_status := CASE WHEN v_new_qty = 0 THEN 'DEPLETED' ELSE 'ACTIVE' END;

      UPDATE public.inventory_lots
         SET quantity_remaining = v_new_qty,
             status = v_new_status::inventory_lot_status
       WHERE id = v_lot.id;

      INSERT INTO public.inventory_transactions (
        lot_id, transaction_type, quantity_changed, reason
      ) VALUES (
        v_lot.id, 'OUT', -v_deduct, v_reason
      )
      RETURNING id INTO v_transaction_id;

      IF v_first_transaction_id IS NULL THEN
        v_first_transaction_id := v_transaction_id;
      END IF;
      v_transaction_ids := v_transaction_ids || to_jsonb(v_transaction_id);

      v_remaining := v_remaining - v_deduct;
    END LOOP;

    -- Safety net mirroring dispatch_to_franchise: should not trigger given
    -- the pooled availability check above, but guards against a concurrent
    -- depletion of the same pool between validation and this loop.
    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'CLINIC_STOCK_INSUFFICIENT_WAREHOUSE: warehouse stock changed concurrently and is now insufficient for product %',
        v_product_id;
    END IF;

    -- 7b. Raise the overlay. The transaction-local flag is what
    --     trg_cps_increase_guard requires before permitting an increase
    --     (Req 8.3) — set immediately before the UPDATE, per design.md.
    PERFORM set_config('app.clinic_stock_in', 'on', true);

    UPDATE public.clinic_product_settings
       SET stock_quantity = stock_quantity + v_quantity
     WHERE clinic_id = p_clinic_id AND product_id = v_product_id;

    -- 7c. Exactly one IN ledger entry per line, referencing the FIRST
    --     depleted-lot transaction (Req 2.5, 2.6, 2.8, 2.11; matches
    --     ck_cpl_reference on clinic_product_ledger).
    INSERT INTO public.clinic_product_ledger (
      clinic_id, product_id, direction, quantity, movement_source,
      actor_user_id, addon_order_id, inventory_transaction_id
    ) VALUES (
      p_clinic_id, v_product_id, 'IN', v_quantity, 'WAREHOUSE_STOCK_IN',
      p_actor_user_id, NULL, v_first_transaction_id
    )
    RETURNING id INTO v_ledger_id;

    v_applied := v_applied || jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'stock_before', v_current_stocks[i],
      'stock_after', v_current_stocks[i] + v_quantity,
      'transaction_ids', v_transaction_ids,
      'ledger_entry_id', v_ledger_id
    );
    v_total_quantity := v_total_quantity + v_quantity;
  END LOOP;

  -- ==========================================================================
  -- 8. Return the report
  -- ==========================================================================
  RETURN jsonb_build_object(
    'clinic_id', p_clinic_id,
    'applied', v_applied,
    'total_quantity', v_total_quantity
  );
END;
$$;

-- ============================================================================
-- DONE. clinic_shop_stock_in is the authoritative atomic Stock_In path.
-- Invoke it from clinicStockInAction via
-- createAdminClient().rpc("clinic_shop_stock_in", { ... }).
-- Run only AFTER clinics, clinic_product_settings, clinic_product_ledger,
-- products.inventory_product_id, inventory_lots, inventory_transactions, and
-- users exist.
-- ============================================================================
