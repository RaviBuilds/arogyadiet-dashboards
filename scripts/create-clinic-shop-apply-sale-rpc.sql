-- ============================================================================
-- CLINIC SHOP STOCK — clinic_shop_apply_sale() + set_clinic_product_visibility()
-- (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 4.2
-- Requirements: 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3, 11.4, 6.4, 6.6, 19.6
--
-- Two SECURITY DEFINER RPCs over public.clinic_product_settings /
-- public.clinic_product_ledger:
--
--   clinic_shop_apply_sale(p_clinic_id, p_addon_order_id, p_lines,
--                          p_movement_source, p_actor_user_id)
--     The authoritative, single-transaction sale-side stock decrement for all
--     three selling channels (customer-app purchase, assisted order, walk-in
--     sale — Req 11.3). Every line's availability is checked BEFORE any line
--     is mutated, so a shortfall on one line rejects the whole submission and
--     names EVERY shortfall product with the quantity currently available
--     (Req 11.1), not just the first one encountered. The decrement itself is
--     a conditional `UPDATE ... WHERE stock_quantity >= qty`, so overselling
--     is structurally impossible even if something slipped past the earlier
--     check (Req 11.2, 11.4) — belt and braces around the row lock, exactly
--     the guard `decrement_franchise_product_stock` in
--     scripts/franchise-product-settings.sql uses for one line, extended here
--     to many lines with a ledger write.
--
--   set_clinic_product_visibility(p_clinic_id, p_product_id, p_is_visible)
--     Upsert-shaped (Req 6.4, 19.6): a missing overlay row is created at
--     stock_quantity = 0 with the submitted visibility; an existing row only
--     has is_visible updated. Never touches stock_quantity on an existing row
--     and never writes a ledger entry — a visibility change is not a stock
--     movement (Req 6.6).
--
-- NEITHER function ever raises clinic_product_settings.stock_quantity, so
-- NEITHER sets the transaction-local app.clinic_stock_in flag that
-- trg_cps_increase_guard checks (scripts/create-clinic-product-settings-table.sql):
--   * clinic_shop_apply_sale only ever DECREASES stock_quantity.
--   * set_clinic_product_visibility only ever creates a NEW row at 0, or
--     updates is_visible on an existing row — stock_quantity is untouched in
--     both cases, so the increase guard never even evaluates a change.
--
-- Lock ordering (Req 10.10): clinic_shop_apply_sale locks every referenced
-- overlay row with `SELECT ... FOR UPDATE ... ORDER BY product_id`, the same
-- deterministic order Task 4.1's clinic_shop_stock_in uses, so two concurrent
-- multi-line submissions against overlapping products can never deadlock —
-- both always acquire row locks in ascending product_id order.
--
-- Validation order inside clinic_shop_apply_sale (first failure decides,
-- mirroring src/lib/shop/clinicStock.ts::evaluateSaleSubmission and the
-- reference model in src/test/shop/clinicStockModel.ts):
--   1. p_movement_source must be one of the three OUT-only sources
--      (CUSTOMER_APP_SALE, ASSISTED_SALE, WALKIN_SALE). WAREHOUSE_STOCK_IN and
--      MIGRATION are IN-only sources and are never valid here — the
--      clinic_movement_source enum type alone does not stop a caller from
--      passing one of those two by mistake, so this is checked explicitly
--      rather than left to the ledger table's ck_cpl_direction_source CHECK,
--      which would otherwise surface as an opaque constraint-violation error.
--   2. p_clinic_id must resolve to an existing Core Clinic (not a franchise
--      id, not a franchise-owned clinic, not missing).
--   3. p_actor_user_id must reference an existing user.
--   4. p_addon_order_id must reference an existing shop order.
--   5. p_lines must be a non-empty jsonb array; each line needs a product_id
--      and a quantity field.
--   6. No line may repeat a product_id.
--   7. Every product_id must reference an existing shop product.
--   8. Every quantity must be a whole number between 1 and 1,000,000
--      inclusive — every offending line is named, not just the first.
--   9. Every line's quantity must not exceed the fulfilling clinic's current
--      Effective_Clinic_Stock for that product (0 when no overlay row exists)
--      — every shortfall line is named with the quantity available, not just
--      the first (Req 11.1).
-- Only once every line clears every check does any UPDATE or INSERT run.
--
-- Report shape (RETURNS jsonb), snake_case fields matching the design's
-- clinic_shop_stock_in report convention ({applied:[...], total}):
--   {
--     "clinic_id": "<uuid>",
--     "addon_order_id": "<uuid>",
--     "applied": [
--       { "product_id": "<uuid>", "quantity": <int>,
--         "stock_before": <int>, "stock_after": <int>,
--         "ledger_entry_id": <bigint> },
--       ...
--     ],
--     "total_quantity": <int>
--   }
--
-- set_clinic_product_visibility report shape:
--   { "clinic_id": "<uuid>", "product_id": "<uuid>",
--     "is_visible": <bool>, "overlay_created": <bool> }
--
-- Error prefixes (stable, RAISE EXCEPTION — action layer maps these to the
-- design's "Message mapping" wording without string-sniffing Postgres
-- internals). CLINIC_STOCK_INSUFFICIENT_CLINIC:, CLINIC_NOT_CORE:, and
-- CLINIC_REFERENCE_NOT_FOUND: are the three the design's table lists for this
-- RPC (Req 11.1, 1.9, 1.2/2.4/3.8); CLINIC_STOCK_INVALID_SUBMISSION:,
-- CLINIC_STOCK_INVALID_QUANTITY:, and CLINIC_STOCK_FRANCHISE_DESTINATION: are
-- the additional prefixes the reference model in
-- src/test/shop/clinicStockModel.ts (MODEL_ERROR_PREFIXES) defines for the
-- payload-shape, quantity-range, and wrong-destination cases the design's
-- table does not enumerate separately:
--   CLINIC_STOCK_INVALID_SUBMISSION:      malformed payload / no lines / duplicate product / bad movement_source
--   CLINIC_STOCK_FRANCHISE_DESTINATION:   p_clinic_id names a franchise, not a Core Clinic
--   CLINIC_NOT_CORE:                      p_clinic_id names a franchise-owned clinic
--   CLINIC_REFERENCE_NOT_FOUND:           clinic / actor / order / product not found
--   CLINIC_STOCK_INVALID_QUANTITY:        one or more quantities outside [1, 1000000]
--   CLINIC_STOCK_INSUFFICIENT_CLINIC:     one or more products short of clinic stock
--
-- SECURITY DEFINER, invoked via the service-role admin client from
-- src/actions/admin-actions/clinicShopInventoryActions.ts and the checkout /
-- assisted-order write paths (Task 7.1, 9.1, 9.4) — mirrors
-- receive_franchise_transfer and place_assisted_addon_order, which are also
-- SECURITY DEFINER with no explicit GRANT EXECUTE, since the service-role key
-- already bypasses RLS and GRANTs entirely.
--
-- ORDERING: This script MUST run AFTER:
--   - create-clinic-product-settings-table.sql (public.clinic_product_settings)
--   - create-clinic-product-ledger-table.sql (public.clinic_product_ledger,
--     clinic_movement_source enum)
--   - public.clinics, public.products, public.users, public.addon_orders,
--     public.franchises already exist
--
-- Safety: Creates/replaces two functions only; no table is altered or
-- dropped. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- NOT EXECUTED: there is no live database available in this environment.
-- This script has been reviewed for correctness but has not been run against
-- Postgres. Task 4.14's integration tests are the first real execution.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_clinic_product_visibility(uuid, uuid, boolean);
--   DROP FUNCTION IF EXISTS public.clinic_shop_apply_sale(uuid, uuid, jsonb, clinic_movement_source, uuid);
-- ============================================================================

-- ============================================================================
-- 1. CLINIC_SHOP_APPLY_SALE — sale-side decrement, all-or-nothing (Req 10.8,
--    10.9, 10.10, 10.11, 11.1, 11.2, 11.3, 11.4)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clinic_shop_apply_sale(
  p_clinic_id       uuid,
  p_addon_order_id  uuid,
  p_lines           jsonb,
  p_movement_source clinic_movement_source,
  p_actor_user_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_id       uuid;
  v_line               jsonb;
  v_line_no            integer := 0;
  v_product_id         uuid;
  v_quantity_text      text;
  v_quantity_num       numeric;

  -- Parsed, index-aligned line data (index 1..N, N = number of submitted lines)
  v_product_ids        uuid[]    := ARRAY[]::uuid[];
  v_quantities         numeric[] := ARRAY[]::numeric[];
  v_availables         integer[];

  v_dup_ids            uuid[] := ARRAY[]::uuid[];
  v_missing_ids        uuid[];

  v_invalid_qty_detail text := '';
  v_invalid_qty_count  integer := 0;

  v_shortfall_detail   text := '';
  v_shortfall_count    integer := 0;

  v_idx                integer;
  v_stock_before        integer;
  v_stock_after         integer;
  v_ledger_id           bigint;
  v_applied             jsonb := '[]'::jsonb;
  v_total_quantity      integer := 0;

  rec                  RECORD;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. Movement source must be one of the three OUT-only sale sources.
  --    WAREHOUSE_STOCK_IN and MIGRATION are IN-only and never valid here.
  -- --------------------------------------------------------------------------
  IF p_movement_source NOT IN ('CUSTOMER_APP_SALE', 'ASSISTED_SALE', 'WALKIN_SALE') THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INVALID_SUBMISSION: movement_source % is not a valid sale source; must be CUSTOMER_APP_SALE, ASSISTED_SALE, or WALKIN_SALE',
      p_movement_source;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. p_clinic_id must resolve to an existing Core Clinic.
  -- --------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.franchises f WHERE f.id = p_clinic_id) THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_FRANCHISE_DESTINATION: % is a franchise, not a Core Clinic; clinic shop sales are applied through this function only for Core Clinics',
      p_clinic_id;
  END IF;

  SELECT franchise_id INTO v_franchise_id
    FROM public.clinics
   WHERE id = p_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: clinic % was not found', p_clinic_id;
  END IF;

  IF v_franchise_id IS NOT NULL THEN
    RAISE EXCEPTION
      'CLINIC_NOT_CORE: clinic shop stock applies to Core Clinics only; clinic % belongs to franchise %',
      p_clinic_id, v_franchise_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. p_actor_user_id and p_addon_order_id must reference existing rows.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_user_id) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: acting user % was not found', p_actor_user_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.addon_orders o WHERE o.id = p_addon_order_id) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: shop order % was not found', p_addon_order_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. p_lines must be a non-empty jsonb array of {product_id, quantity}.
  -- --------------------------------------------------------------------------
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: at least one sale line is required';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. Parse every line into the index-aligned arrays, rejecting a malformed
  --    line outright (payload shape, not a business rule — no accumulation).
  --    Duplicate product ids are collected here and reported together below.
  -- --------------------------------------------------------------------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_no := v_line_no + 1;

    BEGIN
      v_product_id := NULLIF(v_line ->> 'product_id', '')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: sale line % has a malformed product_id', v_line_no;
    END;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: sale line % is missing a product_id', v_line_no;
    END IF;

    IF v_product_id = ANY(v_product_ids) AND NOT (v_product_id = ANY(v_dup_ids)) THEN
      v_dup_ids := array_append(v_dup_ids, v_product_id);
    END IF;

    v_quantity_text := v_line ->> 'quantity';
    BEGIN
      v_quantity_num := NULLIF(v_quantity_text, '')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: sale line % has a non-numeric quantity', v_line_no;
    END;

    IF v_quantity_num IS NULL THEN
      RAISE EXCEPTION 'CLINIC_STOCK_INVALID_SUBMISSION: sale line % is missing a quantity', v_line_no;
    END IF;

    v_product_ids := array_append(v_product_ids, v_product_id);
    v_quantities  := array_append(v_quantities, v_quantity_num);
  END LOOP;

  IF array_length(v_dup_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INVALID_SUBMISSION: duplicate product(s) in sale submission: %',
      v_dup_ids;
  END IF;

  -- --------------------------------------------------------------------------
  -- 6. Every product_id must reference an existing shop product.
  -- --------------------------------------------------------------------------
  SELECT array_agg(pid) INTO v_missing_ids
    FROM unnest(v_product_ids) AS pid
   WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = pid);

  IF v_missing_ids IS NOT NULL AND array_length(v_missing_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'CLINIC_REFERENCE_NOT_FOUND: shop product(s) not found: %',
      v_missing_ids;
  END IF;

  -- --------------------------------------------------------------------------
  -- 7. Every quantity must be a whole number in [1, 1000000]. Every offending
  --    line is collected and named in one exception (Req 11.1 applies the
  --    "name every offender" treatment to quantity as well as shortfall).
  -- --------------------------------------------------------------------------
  FOR v_idx IN 1 .. array_length(v_product_ids, 1)
  LOOP
    IF v_quantities[v_idx] <> trunc(v_quantities[v_idx])
       OR v_quantities[v_idx] < 1
       OR v_quantities[v_idx] > 1000000
    THEN
      v_invalid_qty_count := v_invalid_qty_count + 1;
      v_invalid_qty_detail := v_invalid_qty_detail
        || CASE WHEN v_invalid_qty_detail = '' THEN '' ELSE '; ' END
        || format('product %s: quantity %s', v_product_ids[v_idx], v_quantities[v_idx]);
    END IF;
  END LOOP;

  IF v_invalid_qty_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INVALID_QUANTITY: % line(s) have a quantity that is not a whole number between 1 and 1000000: %',
      v_invalid_qty_count, v_invalid_qty_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- 8. Lock every referenced overlay row FOR UPDATE, ordered by product_id
  --    (Req 10.10) — deadlock-free against concurrent multi-line submissions,
  --    identical ordering to Task 4.1's clinic_shop_stock_in. A product with
  --    no overlay row is left at its array default of 0 (Effective_Clinic_Stock
  --    of an absent record — Req 1.13).
  -- --------------------------------------------------------------------------
  v_availables := array_fill(0, ARRAY[array_length(v_product_ids, 1)]);

  FOR rec IN
    SELECT product_id, stock_quantity
      FROM public.clinic_product_settings
     WHERE clinic_id = p_clinic_id
       AND product_id = ANY(v_product_ids)
     ORDER BY product_id
     FOR UPDATE
  LOOP
    v_idx := array_position(v_product_ids, rec.product_id);
    IF v_idx IS NOT NULL THEN
      v_availables[v_idx] := rec.stock_quantity;
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 9. Every line's quantity must not exceed the locked Effective_Clinic_Stock.
  --    Every shortfall line is collected and named with the quantity currently
  --    available before any mutation happens (Req 11.1) — the whole submission
  --    is rejected together, not line by line.
  -- --------------------------------------------------------------------------
  FOR v_idx IN 1 .. array_length(v_product_ids, 1)
  LOOP
    IF v_quantities[v_idx]::integer > v_availables[v_idx] THEN
      v_shortfall_count := v_shortfall_count + 1;
      v_shortfall_detail := v_shortfall_detail
        || CASE WHEN v_shortfall_detail = '' THEN '' ELSE '; ' END
        || format('product %s: requested %s, available %s',
             v_product_ids[v_idx], v_quantities[v_idx]::integer, v_availables[v_idx]);
    END IF;
  END LOOP;

  IF v_shortfall_count > 0 THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INSUFFICIENT_CLINIC: % product(s) have insufficient clinic stock: %',
      v_shortfall_count, v_shortfall_detail;
  END IF;

  -- --------------------------------------------------------------------------
  -- 10. Apply. Every line has now cleared every check under the row lock, so
  --     this loop only ever mutates rows known to have enough stock — the
  --     conditional `WHERE stock_quantity >= qty` is belt-and-braces on top of
  --     the lock, structurally preventing a negative result even if something
  --     unforeseen slipped through (Req 11.2, 11.4). One OUT ledger entry is
  --     written per line, referencing p_addon_order_id (Req 10.8, 2.10).
  -- --------------------------------------------------------------------------
  FOR v_idx IN 1 .. array_length(v_product_ids, 1)
  LOOP
    v_stock_before := v_availables[v_idx];

    UPDATE public.clinic_product_settings
       SET stock_quantity = stock_quantity - v_quantities[v_idx]::integer
     WHERE clinic_id = p_clinic_id
       AND product_id = v_product_ids[v_idx]
       AND stock_quantity >= v_quantities[v_idx]::integer
     RETURNING stock_quantity INTO v_stock_after;

    IF NOT FOUND THEN
      -- Unreachable given the lock and check above; kept so a future change to
      -- either side surfaces as a rejection rather than a silent oversell.
      RAISE EXCEPTION
        'CLINIC_STOCK_INSUFFICIENT_CLINIC: product %: stock changed concurrently and is no longer sufficient',
        v_product_ids[v_idx];
    END IF;

    INSERT INTO public.clinic_product_ledger (
      clinic_id, product_id, direction, quantity, movement_source,
      actor_user_id, addon_order_id, inventory_transaction_id
    ) VALUES (
      p_clinic_id, v_product_ids[v_idx], 'OUT', v_quantities[v_idx]::integer, p_movement_source,
      p_actor_user_id, p_addon_order_id, NULL
    )
    RETURNING id INTO v_ledger_id;

    v_applied := v_applied || jsonb_build_object(
      'product_id', v_product_ids[v_idx],
      'quantity', v_quantities[v_idx]::integer,
      'stock_before', v_stock_before,
      'stock_after', v_stock_after,
      'ledger_entry_id', v_ledger_id
    );

    v_total_quantity := v_total_quantity + v_quantities[v_idx]::integer;
  END LOOP;

  RETURN jsonb_build_object(
    'clinic_id', p_clinic_id,
    'addon_order_id', p_addon_order_id,
    'applied', v_applied,
    'total_quantity', v_total_quantity
  );
END;
$$;

-- ============================================================================
-- 2. SET_CLINIC_PRODUCT_VISIBILITY — upsert-shaped, no ledger write (Req 6.4,
--    6.6, 19.6)
-- ============================================================================
-- Never touches stock_quantity on an existing row (only is_visible), and only
-- ever creates a NEW row at stock_quantity = 0 — so this never raises
-- stock_quantity on an existing row and never needs the app.clinic_stock_in
-- flag. Idempotent: setting the same value twice leaves one record at that
-- value. Two concurrent calls for the same (clinic, product) apply serially
-- under the row lock the INSERT/UPDATE takes, so the stored value ends up
-- equal to whichever call's write committed last (Req 6.6).

CREATE OR REPLACE FUNCTION public.set_clinic_product_visibility(
  p_clinic_id  uuid,
  p_product_id uuid,
  p_is_visible boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_id uuid;
  v_created      boolean;
  v_is_visible   boolean;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. p_clinic_id must resolve to an existing Core Clinic.
  -- --------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.franchises f WHERE f.id = p_clinic_id) THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_FRANCHISE_DESTINATION: % is a franchise, not a Core Clinic',
      p_clinic_id;
  END IF;

  SELECT franchise_id INTO v_franchise_id
    FROM public.clinics
   WHERE id = p_clinic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: clinic % was not found', p_clinic_id;
  END IF;

  IF v_franchise_id IS NOT NULL THEN
    RAISE EXCEPTION
      'CLINIC_NOT_CORE: clinic shop stock applies to Core Clinics only; clinic % belongs to franchise %',
      p_clinic_id, v_franchise_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. p_product_id must reference an existing shop product.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id) THEN
    RAISE EXCEPTION 'CLINIC_REFERENCE_NOT_FOUND: shop product % was not found', p_product_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Upsert. `INSERT ... ON CONFLICT DO NOTHING` tells us via FOUND whether
  --    the row was newly created; on a conflict (existing row) the follow-up
  --    UPDATE takes the row's lock and applies the submitted value. This is
  --    race-safe: whichever of two concurrent calls' INSERT/UPDATE commits
  --    second determines the final stored value (Req 6.6), and neither branch
  --    ever writes stock_quantity on an existing row (Req 6.4, 6.6).
  -- --------------------------------------------------------------------------
  INSERT INTO public.clinic_product_settings (clinic_id, product_id, stock_quantity, is_visible)
  VALUES (p_clinic_id, p_product_id, 0, p_is_visible)
  ON CONFLICT (clinic_id, product_id) DO NOTHING;

  IF FOUND THEN
    v_created := true;
  ELSE
    v_created := false;
    UPDATE public.clinic_product_settings
       SET is_visible = p_is_visible
     WHERE clinic_id = p_clinic_id
       AND product_id = p_product_id;
  END IF;

  SELECT is_visible INTO v_is_visible
    FROM public.clinic_product_settings
   WHERE clinic_id = p_clinic_id
     AND product_id = p_product_id;

  RETURN jsonb_build_object(
    'clinic_id', p_clinic_id,
    'product_id', p_product_id,
    'is_visible', v_is_visible,
    'overlay_created', v_created
  );
END;
$$;

-- ============================================================================
-- DONE. Both functions are additive and isolated.
-- Run AFTER clinic_product_settings, clinic_product_ledger, clinics,
-- products, users, addon_orders, and franchises exist.
-- Next in this spec: scripts/create-verify-clinic-stock-ledger-parity-rpc.sql
-- (Task 4.3, already present) and src/repositories/clinic/*.ts (Task 4.4).
-- ============================================================================
