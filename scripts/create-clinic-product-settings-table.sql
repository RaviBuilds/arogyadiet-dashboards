-- ============================================================================
-- CLINIC SHOP STOCK — clinic_product_settings table (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 1.1
-- Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12,
--               8.2, 8.3
--
-- Model: "shared catalog + per-clinic overlay", the Core Clinic twin of the
-- franchise overlay in scripts/franchise-product-settings.sql.
--   * `products` stays the single admin-owned shop catalog.
--   * Each CORE Clinic (clinics.franchise_id IS NULL) gets ONE overlay row per
--     product carrying:
--       - stock_quantity  (that clinic's own shop stock, 0 .. 1,000,000)
--       - is_visible      (show/hide on that clinic's customer-facing shop)
--   * `products.stock_quantity` is retained untouched as a pre-migration
--     historical value (Req 1.15). Every clinic shop read/write in this feature
--     uses this overlay instead.
--
-- Deliberate differences from franchise_product_settings, each requirement
-- driven:
--   * is_visible DEFAULTs to true          (Req 1.1, 1.10, 1.11)
--   * stock_quantity has an upper bound    (Req 1.5, 1.7)
--   * clinic_id must be a CORE clinic      (Req 1.9)
--   * increases are gated to stock-in only (Req 8.2, 8.3)
--
-- Creates:
--   1. clinic_product_settings table + uq_clinic_product unique (Req 1.1, 1.3, 1.4)
--   2. idx_cps_clinic / idx_cps_product indexes
--   3. update_cps_updated_at()             + trg_cps_updated_at
--   4. enforce_cps_core_clinic_only()      + trg_cps_core_clinic_only   (Req 1.2, 1.9)
--   5. enforce_cps_stock_increase_guard()  + trg_cps_increase_guard     (Req 8.2, 8.3)
--   6. seed_clinic_product_settings_for_product() + trg_products_seed_clinic_settings (Req 1.10, 1.12)
--   7. seed_clinic_product_settings_for_clinic()  + trg_clinics_seed_product_settings (Req 1.11, 1.12)
--   8. RLS + GRANT SELECT TO authenticated + policy cps_read_authenticated
--
-- Notes on the two guard triggers:
--   * trg_cps_core_clinic_only reads clinics.franchise_id rather than relying on
--     a hand-maintained list, so it cannot drift the way a CHECK on an enum-ish
--     text column does.
--   * trg_cps_increase_guard rejects ANY raise of stock_quantity unless the
--     transaction-local flag app.clinic_stock_in = 'on' is set. Only
--     clinic_shop_stock_in() and migrate_shop_stock_to_clinics() set that flag
--     (via set_config('app.clinic_stock_in','on',true)), which is what makes
--     "stock enters a clinic only through Stock In" a database guarantee and not
--     a convention. This mirrors the existing current_setting('app.role', true)
--     session-helper pattern used by the franchise RLS policies.
--
-- Backfill triggers give Requirements 1.10-1.12 real same-transaction
-- guarantees: a trigger failure aborts the enclosing INSERT automatically, so
-- no product or clinic can ever exist without its overlay row set.
--
-- ORDERING: This script MUST run AFTER:
--   - products table exists (public.products, with deleted_at)
--   - create-clinic-hierarchy-tables.sql (public.clinics, with franchise_id)
--
-- Safety: Brand new table, functions, and triggers. No existing row is read for
-- writing, no column is dropped or altered. The two AFTER INSERT triggers added
-- to public.products and public.clinics only insert into the new table.
-- Idempotent (re-runnable) via IF NOT EXISTS / CREATE OR REPLACE /
-- DROP TRIGGER IF EXISTS / DROP POLICY IF EXISTS.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_clinics_seed_product_settings ON public.clinics;
--   DROP TRIGGER IF EXISTS trg_products_seed_clinic_settings ON public.products;
--   DROP POLICY  IF EXISTS "cps_read_authenticated" ON public.clinic_product_settings;
--   DROP TABLE   IF EXISTS public.clinic_product_settings;  -- drops its own triggers
--   DROP FUNCTION IF EXISTS public.seed_clinic_product_settings_for_clinic();
--   DROP FUNCTION IF EXISTS public.seed_clinic_product_settings_for_product();
--   DROP FUNCTION IF EXISTS public.enforce_cps_stock_increase_guard();
--   DROP FUNCTION IF EXISTS public.enforce_cps_core_clinic_only();
--   DROP FUNCTION IF EXISTS public.update_cps_updated_at();
-- ============================================================================

-- ============================================================================
-- 1. CLINIC_PRODUCT_SETTINGS (new) — per-clinic shop stock + visibility
--    (Req 1.1, 1.3, 1.4, 1.5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.clinic_product_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Must reference an existing CORE clinic (Req 1.2, 1.9 — see trigger below)
  clinic_id      UUID NOT NULL REFERENCES public.clinics(id)  ON DELETE CASCADE,

  -- Must reference an existing shop product (Req 1.2)
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- Never negative, never above Stock_Quantity_Maximum (Req 1.5, 1.6, 1.7).
  -- INTEGER also rejects a non-whole quantity outright (Req 1.8).
  stock_quantity INTEGER NOT NULL DEFAULT 0
                 CHECK (stock_quantity >= 0 AND stock_quantity <= 1000000),

  -- Visible by default, unlike the franchise overlay (Req 1.1, 1.10, 1.11)
  is_visible     BOOLEAN NOT NULL DEFAULT true,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One overlay row per (clinic, product) pair (Req 1.3, 1.4)
  CONSTRAINT uq_clinic_product UNIQUE (clinic_id, product_id)
);

-- ============================================================================
-- 2. INDEXES — per-clinic listing and per-product aggregation
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cps_clinic  ON public.clinic_product_settings(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cps_product ON public.clinic_product_settings(product_id);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER — house pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_cps_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cps_updated_at ON public.clinic_product_settings;
CREATE TRIGGER trg_cps_updated_at
  BEFORE UPDATE ON public.clinic_product_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_cps_updated_at();

-- ============================================================================
-- 4. CORE-CLINIC-ONLY GUARD (Req 1.2, 1.9)
-- ============================================================================
-- Clinic shop stock is a CORE business concept. A clinic owned by a franchise
-- carries its stock in franchise_product_settings instead, so an overlay row
-- naming such a clinic is rejected outright.
--
-- The clinic lookup also gives a clearer failure than the raw FK violation when
-- the clinic row does not exist at all (Req 1.2).

CREATE OR REPLACE FUNCTION public.enforce_cps_core_clinic_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_found        BOOLEAN;
  v_franchise_id UUID;
BEGIN
  -- Only re-check when the clinic reference is new or actually changed.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.clinic_id IS NOT DISTINCT FROM OLD.clinic_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT true, c.franchise_id
    INTO v_found, v_franchise_id
    FROM public.clinics c
   WHERE c.id = NEW.clinic_id;

  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION
      'CLINIC_REFERENCE_NOT_FOUND: clinic % was not found', NEW.clinic_id;
  END IF;

  IF v_franchise_id IS NOT NULL THEN
    RAISE EXCEPTION
      'CLINIC_NOT_CORE: clinic shop stock applies to Core Clinics only; clinic % belongs to franchise %',
      NEW.clinic_id, v_franchise_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cps_core_clinic_only ON public.clinic_product_settings;
CREATE TRIGGER trg_cps_core_clinic_only
  BEFORE INSERT OR UPDATE ON public.clinic_product_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cps_core_clinic_only();

-- ============================================================================
-- 5. STOCK-INCREASE GUARD (Req 8.2, 8.3)
-- ============================================================================
-- Clinic shop stock rises ONLY through the Stock In operation (Requirement 7)
-- and the data migration (Requirement 20). Both set the transaction-local flag
-- app.clinic_stock_in = 'on' immediately before raising stock_quantity; every
-- other code path — including a direct SQL UPDATE and the existing Dispatch
-- Stock flow — gets a hard rejection here.

CREATE OR REPLACE FUNCTION public.enforce_cps_stock_increase_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity > OLD.stock_quantity
     AND current_setting('app.clinic_stock_in', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'CLINIC_STOCK_INCREASE_FORBIDDEN: clinic shop stock increases only through stock-in (clinic %, product %, % -> %)',
      NEW.clinic_id, NEW.product_id, OLD.stock_quantity, NEW.stock_quantity;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cps_increase_guard ON public.clinic_product_settings;
CREATE TRIGGER trg_cps_increase_guard
  BEFORE UPDATE ON public.clinic_product_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cps_stock_increase_guard();

-- ============================================================================
-- 6. BACKFILL ON PRODUCT INSERT (Req 1.10, 1.12)
-- ============================================================================
-- A new shop product appears in every Core Clinic immediately, at stock 0 and
-- visible. Running as an AFTER INSERT trigger keeps this inside the product
-- insert's own transaction, so a failure here rolls the product insert back
-- (Req 1.12) with no application code needing to coordinate it.

CREATE OR REPLACE FUNCTION public.seed_clinic_product_settings_for_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.clinic_product_settings (clinic_id, product_id, stock_quantity, is_visible)
  SELECT c.id, NEW.id, 0, true
    FROM public.clinics c
   WHERE c.franchise_id IS NULL
  ON CONFLICT (clinic_id, product_id) DO NOTHING;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_products_seed_clinic_settings ON public.products;
CREATE TRIGGER trg_products_seed_clinic_settings
  AFTER INSERT ON public.products
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.seed_clinic_product_settings_for_product();

-- ============================================================================
-- 7. BACKFILL ON CORE CLINIC INSERT (Req 1.11, 1.12)
-- ============================================================================
-- A new Core Clinic starts with an overlay row for every live shop product, at
-- stock 0 and visible. Soft-deleted products are skipped (Req 1.11). The WHEN
-- clause keeps franchise-owned clinics out entirely, matching the core-clinic
-- guard above.

CREATE OR REPLACE FUNCTION public.seed_clinic_product_settings_for_clinic()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.clinic_product_settings (clinic_id, product_id, stock_quantity, is_visible)
  SELECT NEW.id, p.id, 0, true
    FROM public.products p
   WHERE p.deleted_at IS NULL
  ON CONFLICT (clinic_id, product_id) DO NOTHING;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_clinics_seed_product_settings ON public.clinics;
CREATE TRIGGER trg_clinics_seed_product_settings
  AFTER INSERT ON public.clinics
  FOR EACH ROW
  WHEN (NEW.franchise_id IS NULL)
  EXECUTE FUNCTION public.seed_clinic_product_settings_for_clinic();

-- ============================================================================
-- 8. RLS — authenticated users may READ (the customer shop needs this via the
--    SSR client). All writes go through service-role server actions and the
--    SECURITY DEFINER RPCs, which bypass RLS.
-- ============================================================================

ALTER TABLE public.clinic_product_settings ENABLE ROW LEVEL SECURITY;

-- Table-level privilege. RLS only decides WHICH rows are visible; the role
-- still needs a base GRANT or every query fails with 42501 "permission denied
-- for table". Supabase does not always auto-grant tables created via SQL.
GRANT SELECT ON public.clinic_product_settings TO authenticated;

DROP POLICY IF EXISTS "cps_read_authenticated" ON public.clinic_product_settings;
CREATE POLICY "cps_read_authenticated"
  ON public.clinic_product_settings FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- DONE. The table is additive and isolated.
-- Run AFTER public.products and public.clinics exist.
-- Next in this spec: scripts/create-clinic-product-ledger-table.sql
-- ============================================================================
