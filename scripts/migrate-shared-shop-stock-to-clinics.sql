-- ============================================================================
-- CLINIC SHOP STOCK — migrate_shop_stock_to_clinics() (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 12.1
-- Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10,
--               20.11, 20.12, 20.13
--
-- Defines migrate_shop_stock_to_clinics(): the one-off, idempotent migration
-- that moves the single pre-feature shared shop stock
-- (public.products.stock_quantity) into the per-clinic overlay
-- (clinic_product_settings) this feature introduces, with one MIGRATION IN
-- ledger entry per positive migrated quantity.
--
-- What it does, in order, within one transaction (mirrors the "Migration
-- model" section of design.md exactly):
--   1. Abort with a report when no Core Clinic exists (Req 20.13). Returned,
--      not raised — a report is the requested outcome for this case, and
--      nothing has been written yet.
--   2. Pre-scan public.products for any non-deleted row whose stock_quantity
--      is an INTEGER strictly greater than Stock_Quantity_Maximum
--      (1,000,000). If any exist, abort the WHOLE run with a report naming
--      every offending product (Req 20.6) — no Clinic_Shop_Stock record and
--      no Clinic_Shop_Ledger entry is created. A negative or non-integral
--      value does NOT trigger this abort; it is clamped instead (step 4/5;
--      Req 20.5). The two conditions are mutually exclusive: a value cannot
--      simultaneously be "not an integer" and "an integer above the cap".
--   3. Resolve the Migration_Target_Clinic: the Core Clinic with the
--      earliest created_at (ties broken by id, for a fully deterministic
--      target when clocks collide).
--   4. Resolve the migration ledger actor — see "Judgment call" below.
--   5. INSERT ... ON CONFLICT (clinic_id, product_id) DO NOTHING for every
--      (Core Clinic × non-deleted Shop Product) pair: is_visible =
--      products.is_active; stock_quantity = the Migration_Target_Clinic's
--      clamped products.stock_quantity value for the target clinic, 0 for
--      every other Core Clinic (Req 20.1, 20.4, 20.12). A pair that already
--      holds a record is left completely untouched by DO NOTHING — this is
--      what makes a pre-existing pair immune (Req 20.9) and a second run a
--      total no-op (Req 20.10). RETURNING captures exactly the rows THIS run
--      inserted, never a pre-existing row.
--   6. For every row step 5 actually inserted with stock_quantity > 0 —
--      which, by construction, can only be a Migration_Target_Clinic row —
--      insert exactly one MIGRATION IN clinic_product_ledger entry with a
--      matching quantity (Req 20.7). Driving this off the RETURNING set
--      (not off a fresh SELECT) is what keeps a second run from writing any
--      ledger entry at all (Req 20.2, 20.10).
--   7. Return a jsonb report.
--
-- Clamping rule (Req 20.5), mirrored exactly from the pure-logic reference in
-- src/lib/shop/clinicStock.ts's normaliseStoredStock() / the TypeScript model
-- migrateShopStockToClinics() in src/test/shop/clinicStockModel.ts: a
-- products.stock_quantity value that is NULL, negative, or not a whole
-- number is not usable as a real stock level, so it is treated as 0. A NULL
-- value is the documented default (Req 20.4 — "treating a NULL value as 0")
-- and is NOT reported as clamped; only an actually-invalid non-NULL value
-- (negative or non-integral) is reported in clamped_product_ids, matching
-- the model precisely.
--
-- Idempotency (Req 20.10): overlay creation is INSERT ... ON CONFLICT DO
-- NOTHING over the full (Core Clinic × non-deleted product) cross product,
-- and ledger writes are driven off the RETURNING set of THAT insert only.
-- Every pair that already existed before this run — whether seeded by the
-- backfill triggers on clinics/products or created by an earlier migration
-- run — is left byte-for-byte unchanged, and a second run therefore creates
-- zero new rows anywhere.
--
-- JUDGMENT CALL — migration ledger actor_user_id:
-- clinic_product_ledger.actor_user_id is NOT NULL and references an existing
-- public.users row (create-clinic-product-ledger-table.sql). Both
-- design.md's RPC signature list and this spec's task 12.1 wording give
-- migrate_shop_stock_to_clinics() NO parameters at all (unlike
-- clinic_shop_stock_in / clinic_shop_apply_sale, which take p_actor_user_id
-- from their caller) — this is a one-off, DBA-run data migration, not an
-- application-invoked RPC, so there is no acting admin session to thread
-- through. No SYSTEM_ACTOR / placeholder-user convention exists anywhere
-- else in this codebase (searched: every scripts/*.sql migration that writes
-- an actor/created-by column takes it as an explicit input parameter or a
-- request-scoped session value — see create-onboard-customer-rpc.sql's
-- v_user->>'created_by' and update-onboard-customer-with-*.sql). Absent a
-- documented convention, this function resolves the earliest-created
-- MASTER_ADMIN user (public.roles.code = 'MASTER_ADMIN', the single
-- super-admin account per update-master-admin-credentials.sql), falling back
-- to the earliest-created ADMIN user if no MASTER_ADMIN row exists, and
-- raises a clear, distinctly-prefixed exception if neither exists — a
-- deployment state that should not occur in practice but must not silently
-- write a wrong actor. PLEASE VERIFY this resolution matches your actual
-- system-user setup before relying on it in production; if a different
-- convention is preferred (e.g. a dedicated system/service user row), this
-- SELECT is the only place that needs to change.
--
-- Report shape (jsonb, snake_case — matching this spec's other RPCs):
--   {
--     "status": "APPLIED" | "NO_CORE_CLINIC" | "EXCEEDS_MAXIMUM",
--     "target_clinic_id": uuid | null,
--     "overlays_created": integer,
--     "ledger_entries_written": integer,
--     "clamped_product_ids": uuid[],    -- Req 20.5
--     "exceeding_product_ids": uuid[]   -- Req 20.6
--   }
-- Only "APPLIED" changes the database; "NO_CORE_CLINIC" and
-- "EXCEEDS_MAXIMUM" are reports over an untouched database (Req 20.3, 20.13).
--
-- Leaves untouched (never written by this function): products.stock_quantity,
-- products.inventory_product_id (Req 20.11), and every franchise_product_settings
-- row (Req 20.11). Every read against products, clinics, and roles/users in
-- this function is read-only.
--
-- SECURITY DEFINER: matches every other mutation RPC in this spec
-- (clinic_shop_stock_in, franchise_shop_stock_in); this function is intended
-- to be run once, directly, by a database administrator via the Supabase SQL
-- editor or an equivalent privileged session (SELECT
-- public.migrate_shop_stock_to_clinics();), not invoked from application code.
--
-- ORDERING: This script MUST run AFTER:
--   - create-clinic-hierarchy-tables.sql (public.clinics, with franchise_id
--     and created_at)
--   - create-clinic-product-settings-table.sql (public.clinic_product_settings,
--     with uq_clinic_product and trg_cps_increase_guard)
--   - create-clinic-product-ledger-table.sql (public.clinic_product_ledger,
--     with ck_cpl_direction_source and ck_cpl_reference)
--   - public.products exists (with deleted_at, is_active, stock_quantity)
--   - public.users and public.roles exist (with role_id / roles.code)
-- Run this function itself only ONCE per environment, after every other
-- script in this spec's task list up to and including Task 4 has been
-- applied. Re-running it is safe (idempotent) but produces no further effect.
--
-- Safety: Creates/replaces one function only; no table is altered or
-- dropped. No existing row in products, clinics, users, roles, or
-- franchise_product_settings is ever written. Idempotent via CREATE OR
-- REPLACE FUNCTION and the ON CONFLICT DO NOTHING insert described above.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.migrate_shop_stock_to_clinics();
--   -- Note: dropping the function does NOT undo a migration that already
--   -- ran. To undo an already-applied run, delete the MIGRATION-sourced
--   -- rows explicitly, e.g.:
--   --   DELETE FROM public.clinic_product_ledger WHERE movement_source = 'MIGRATION';
--   --   DELETE FROM public.clinic_product_settings cps
--   --     WHERE NOT EXISTS (
--   --       SELECT 1 FROM public.clinic_product_ledger l
--   --        WHERE l.clinic_id = cps.clinic_id AND l.product_id = cps.product_id
--   --     ) AND cps.stock_quantity = 0 AND cps.is_visible = true;
--   -- (The DELETE examples above are illustrative only and are NOT executed
--   -- by this script's own rollback.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_shop_stock_to_clinics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_clinic_id       uuid;
  v_actor_user_id          uuid;

  v_exceeding_ids          uuid[];
  v_clamped_ids            uuid[];

  v_overlays_created       integer := 0;
  v_ledger_entries_written integer := 0;
BEGIN
  -- ==========================================================================
  -- 1. Abort with a report when no Core Clinic exists (Req 20.13)
  -- ==========================================================================
  SELECT id
    INTO v_target_clinic_id
    FROM public.clinics
   WHERE franchise_id IS NULL
   ORDER BY created_at ASC, id ASC
   LIMIT 1;

  IF v_target_clinic_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NO_CORE_CLINIC',
      'target_clinic_id', NULL,
      'overlays_created', 0,
      'ledger_entries_written', 0,
      'clamped_product_ids', '[]'::jsonb,
      'exceeding_product_ids', '[]'::jsonb
    );
  END IF;

  -- ==========================================================================
  -- 2. Pre-scan: abort the WHOLE run when any non-deleted product's
  --    stock_quantity is an INTEGER strictly above Stock_Quantity_Maximum
  --    (Req 20.6). A negative or non-integral value is NOT an abort
  --    condition here — it is clamped in step 5 instead (Req 20.5).
  -- ==========================================================================
  SELECT array_agg(id ORDER BY id)
    INTO v_exceeding_ids
    FROM public.products
   WHERE deleted_at IS NULL
     AND stock_quantity IS NOT NULL
     AND stock_quantity = TRUNC(stock_quantity)
     AND stock_quantity > 1000000;

  IF v_exceeding_ids IS NOT NULL AND array_length(v_exceeding_ids, 1) > 0 THEN
    RETURN jsonb_build_object(
      'status', 'EXCEEDS_MAXIMUM',
      'target_clinic_id', NULL,
      'overlays_created', 0,
      'ledger_entries_written', 0,
      'clamped_product_ids', '[]'::jsonb,
      'exceeding_product_ids', to_jsonb(v_exceeding_ids)
    );
  END IF;

  -- ==========================================================================
  -- 3. Migration_Target_Clinic already resolved in step 1
  --    (earliest created_at, tie-broken by id).
  -- ==========================================================================

  -- ==========================================================================
  -- 4. Resolve the migration ledger actor (see "JUDGMENT CALL" header note).
  --    Prefers the earliest-created MASTER_ADMIN; falls back to the
  --    earliest-created ADMIN.
  -- ==========================================================================
  SELECT u.id
    INTO v_actor_user_id
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
   WHERE r.code IN ('MASTER_ADMIN', 'ADMIN')
     AND u.is_active IS NOT FALSE
   ORDER BY (r.code = 'MASTER_ADMIN') DESC, u.created_at ASC, u.id ASC
   LIMIT 1;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'CLINIC_MIGRATION_NO_SYSTEM_ACTOR: no MASTER_ADMIN or ADMIN user exists to record as the migration ledger actor';
  END IF;

  -- ==========================================================================
  -- 5-6. Report which live products' legacy stock_quantity is clamped to 0
  --      (negative or non-integral; NULL is the documented default and is
  --      NOT reported — Req 20.5), then INSERT ... ON CONFLICT DO NOTHING
  --      for every (Core Clinic x non-deleted Shop Product) pair, and write
  --      one MIGRATION IN ledger entry per row THIS run actually inserted
  --      with a positive stock_quantity (Req 20.1, 20.2, 20.4, 20.7, 20.9,
  --      20.10, 20.12).
  -- ==========================================================================
  SELECT array_agg(id ORDER BY id)
    INTO v_clamped_ids
    FROM public.products
   WHERE deleted_at IS NULL
     AND stock_quantity IS NOT NULL
     AND (stock_quantity < 0 OR stock_quantity <> TRUNC(stock_quantity));

  -- Documented, harmless per design.md: both clinic_shop_stock_in and
  -- migrate_shop_stock_to_clinics set this transaction-local flag before
  -- touching stock_quantity. trg_cps_increase_guard only fires on UPDATE, and
  -- this step only INSERTs brand-new rows, so the flag is not load-bearing
  -- here — it documents intent and future-proofs against the guard ever
  -- being extended to cover INSERT.
  PERFORM set_config('app.clinic_stock_in', 'on', true);

  WITH usable_products AS (
    SELECT
      p.id AS product_id,
      p.is_active,
      CASE
        WHEN p.stock_quantity IS NOT NULL
         AND p.stock_quantity = TRUNC(p.stock_quantity)
         AND p.stock_quantity >= 0
        THEN p.stock_quantity::integer
        ELSE 0
      END AS usable_stock
    FROM public.products p
   WHERE p.deleted_at IS NULL
  ),
  target_clinics AS (
    SELECT id AS clinic_id
      FROM public.clinics
     WHERE franchise_id IS NULL
  ),
  inserted_settings AS (
    INSERT INTO public.clinic_product_settings (clinic_id, product_id, stock_quantity, is_visible)
    SELECT
      tc.clinic_id,
      up.product_id,
      CASE WHEN tc.clinic_id = v_target_clinic_id THEN up.usable_stock ELSE 0 END,
      up.is_active
    FROM target_clinics tc
    CROSS JOIN usable_products up
    ON CONFLICT (clinic_id, product_id) DO NOTHING
    RETURNING clinic_id, product_id, stock_quantity
  ),
  inserted_ledger AS (
    INSERT INTO public.clinic_product_ledger (
      clinic_id, product_id, direction, quantity, movement_source,
      actor_user_id, addon_order_id, inventory_transaction_id
    )
    SELECT
      clinic_id, product_id, 'IN', stock_quantity, 'MIGRATION',
      v_actor_user_id, NULL, NULL
    FROM inserted_settings
   WHERE stock_quantity > 0
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM inserted_settings),
    (SELECT count(*) FROM inserted_ledger)
    INTO v_overlays_created, v_ledger_entries_written;

  -- ==========================================================================
  -- 7. Return the report
  -- ==========================================================================
  RETURN jsonb_build_object(
    'status', 'APPLIED',
    'target_clinic_id', v_target_clinic_id,
    'overlays_created', v_overlays_created,
    'ledger_entries_written', v_ledger_entries_written,
    'clamped_product_ids', to_jsonb(COALESCE(v_clamped_ids, ARRAY[]::uuid[])),
    'exceeding_product_ids', '[]'::jsonb
  );
END;
$$;

-- ============================================================================
-- DONE. migrate_shop_stock_to_clinics() is the one-off migration of
-- pre-feature shared shop stock into the per-clinic overlay. Run it ONCE,
-- directly (SELECT public.migrate_shop_stock_to_clinics();), after every
-- other script in this spec's task list up to and including Task 4 has been
-- applied. A second run is a safe no-op.
-- ============================================================================
