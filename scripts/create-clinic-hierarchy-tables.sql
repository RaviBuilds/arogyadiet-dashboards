-- ============================================================================
-- CORE CLINIC ARCHITECTURE — Schema Foundation (SAFE: Additive only)
-- ============================================================================
-- Establishes the City -> Kitchen -> Clinic hierarchy for the CORE business.
--
-- Creates:
--   1. cities                (new) — geographic city, owns kitchens
--   2. clinics               (new) — rider pickup + routing origin; franchise-ready
--   3. workload_snapshots    (new) — persisted, finalized per-clinic prep workload
--
-- Adds (nullable, NULL = unassigned, zero production impact):
--   - kitchens.city_id
--   - rider_service_areas.clinic_id
--   - rider_profiles.clinic_id
--   - customer_profiles.clinic_id
--   - addresses.clinic_id
--
-- Enforces:
--   - uq_cities_name_lower             (case-insensitive unique city name)
--   - uq_service_area_pincode          (one pincode -> exactly one clinic)
--   - uq_snapshot_clinic_kitchen_date  (one snapshot per clinic/kitchen/date)
--   - latitude/longitude CHECK ranges on clinics
--   - 0..100000 count CHECK ranges on workload_snapshots
--
-- Franchise readiness (Req 18):
--   clinics.franchise_id is nullable; NULL = Core Clinic. New table, so every
--   row defaults to NULL and resolves as a Core Clinic. No franchise behavior.
--
-- Safety: All new tables are brand new; all new columns are nullable. No
-- existing data is dropped or altered destructively. Idempotent (re-runnable).
--
-- RLS: Policies are CREATED here following the established additive pattern but
-- RLS is NOT enabled (policies sit idle). Enabling is a separate, deliberate
-- step — exactly like create-franchise-rls-policies.sql. This keeps the
-- migration zero-impact in production. Respects Supabase RLS (Req 15.10).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.workload_snapshots;
--   DROP TABLE IF EXISTS public.clinics;
--   DROP TABLE IF EXISTS public.cities;
--   ALTER TABLE public.kitchens             DROP COLUMN IF EXISTS city_id;
--   ALTER TABLE public.rider_service_areas  DROP COLUMN IF EXISTS clinic_id;
--   ALTER TABLE public.rider_profiles       DROP COLUMN IF EXISTS clinic_id;
--   ALTER TABLE public.customer_profiles    DROP COLUMN IF EXISTS clinic_id;
--   ALTER TABLE public.addresses            DROP COLUMN IF EXISTS clinic_id;
-- ============================================================================

-- ============================================================================
-- 1. CITIES (new) — Requirement 1, 2.2
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness of city name (Req 1.1)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_name_lower
  ON public.cities (lower(name));

-- ============================================================================
-- 2. KITCHENS (existing, retained) — add city_id (Req 2.1, 2.2)
-- ============================================================================

ALTER TABLE public.kitchens
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id);

CREATE INDEX IF NOT EXISTS idx_kitchens_city ON public.kitchens(city_id);

-- ============================================================================
-- 3. CLINICS (new) — Requirements 3, 18
-- ============================================================================
-- Widest declared name/address bounds (Req 14: 1..200 / 1..500). The stricter
-- Req 3 create bounds (1..120 / 1..255) are enforced by the application-layer
-- validator per the design ("validate against the field's declared bound for
-- the surface, persist within column width").
--
-- franchise_id is nullable; NULL = Core Clinic (Req 3.4, 18.1, 18.2). The FK to
-- public.franchises is added conditionally below so the script remains robust
-- regardless of whether the franchise schema is present.

CREATE TABLE IF NOT EXISTS public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NOT NULL,
  latitude  DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  kitchen_id   UUID NOT NULL REFERENCES public.kitchens(id),
  franchise_id UUID NULL,  -- NULL = Core Clinic; FK added conditionally below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conditionally wire franchise_id -> public.franchises(id) when that table
-- exists, without failing if the franchise schema has not been applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'franchises'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'clinics'
      AND constraint_name = 'fk_clinics_franchise'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT fk_clinics_franchise
      FOREIGN KEY (franchise_id) REFERENCES public.franchises(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_clinics_kitchen   ON public.clinics(kitchen_id);
CREATE INDEX IF NOT EXISTS idx_clinics_franchise ON public.clinics(franchise_id);

-- ============================================================================
-- 4. RIDER_SERVICE_AREAS (existing) — clinic_id + one-pincode-one-clinic (Req 4)
-- ============================================================================

ALTER TABLE public.rider_service_areas
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

-- One pincode belongs to exactly one clinic (Req 4.1, 4.2, 4.5).
-- A global unique constraint on pincode is the source of truth for the
-- one-pincode-one-clinic invariant and is robust against concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_area_pincode
  ON public.rider_service_areas(pincode);

CREATE INDEX IF NOT EXISTS idx_service_areas_clinic
  ON public.rider_service_areas(clinic_id);

-- ============================================================================
-- 5. RIDER_PROFILES (existing) — single clinic linkage (Req 8)
-- ============================================================================

ALTER TABLE public.rider_profiles
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

CREATE INDEX IF NOT EXISTS idx_rider_profiles_clinic
  ON public.rider_profiles(clinic_id);

-- ============================================================================
-- 6. CUSTOMER_PROFILES (existing) — stamped clinic (Req 6)
-- ============================================================================

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_clinic
  ON public.customer_profiles(clinic_id);

-- ============================================================================
-- 7. ADDRESSES (existing) — clinic stamp mirrors customer (Req 6.2, 7.2)
-- ============================================================================

ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

CREATE INDEX IF NOT EXISTS idx_addresses_clinic
  ON public.addresses(clinic_id);

-- ============================================================================
-- 8. WORKLOAD_SNAPSHOTS (new, persisted) — Requirement 12
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workload_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES public.clinics(id),
  kitchen_id UUID NOT NULL REFERENCES public.kitchens(id),
  target_date DATE NOT NULL,
  veg_count     INTEGER NOT NULL DEFAULT 0 CHECK (veg_count     BETWEEN 0 AND 100000),
  non_veg_count INTEGER NOT NULL DEFAULT 0 CHECK (non_veg_count BETWEEN 0 AND 100000),
  egg_count     INTEGER NOT NULL DEFAULT 0 CHECK (egg_count     BETWEEN 0 AND 100000),
  shop_product_counts JSONB NOT NULL DEFAULT '{}'::jsonb, -- {productId: count(0..100000)}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One finalized snapshot per (clinic, kitchen, date) (Req 12.2)
  CONSTRAINT uq_snapshot_clinic_kitchen_date UNIQUE (clinic_id, kitchen_id, target_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_target_date ON public.workload_snapshots(target_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_clinic      ON public.workload_snapshots(clinic_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_kitchen     ON public.workload_snapshots(kitchen_id);

-- ============================================================================
-- 9. updated_at TRIGGERS for cities and clinics (mirrors franchise pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_cities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cities_updated_at ON public.cities;
CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON public.cities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_cities_updated_at();

CREATE OR REPLACE FUNCTION public.update_clinics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinics_updated_at ON public.clinics;
CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON public.clinics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_clinics_updated_at();

-- ============================================================================
-- 10. RLS POLICIES (CREATED, NOT ENABLED) — additive pattern, Req 15.10
-- ============================================================================
-- IMPORTANT: This section CREATES policies only. RLS is NOT enabled here, so
-- policies sit idle and production behavior is unchanged — identical to the
-- philosophy of create-franchise-rls-policies.sql. Enable deliberately later
-- with: ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
--
-- Policy intent:
--   cities / clinics            — global roles (ADMIN, MASTER_ADMIN) manage;
--                                 franchise users see their own clinic, core
--                                 users see Core Clinics (franchise_id IS NULL).
--   workload_snapshots          — global roles only (Req 13.4 / 13.5).
--
-- Reuses the franchise session helpers is_global_role() / current_franchise_id().
-- They are defined defensively below only if absent, so this script is
-- self-sufficient regardless of franchise-script ordering.

-- Ensure session helpers exist (no-op if franchise RLS script already created them)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_global_role'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_global_role()
      RETURNS boolean AS $body$
      BEGIN
        RETURN current_setting('app.role', true) IN ('ADMIN', 'MASTER_ADMIN');
      EXCEPTION
        WHEN OTHERS THEN RETURN false;
      END;
      $body$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_franchise_id'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.current_franchise_id()
      RETURNS uuid AS $body$
      DECLARE
        fid text;
      BEGIN
        fid := current_setting('app.franchise_id', true);
        IF fid IS NULL OR fid = '' THEN
          RETURN NULL;
        END IF;
        RETURN fid::uuid;
      EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
      END;
      $body$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
    $fn$;
  END IF;
END
$$;

-- ─── cities (reference data: global roles manage; everyone may read) ─────────

DROP POLICY IF EXISTS clinic_select_cities ON public.cities;
CREATE POLICY clinic_select_cities ON public.cities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS clinic_insert_cities ON public.cities;
CREATE POLICY clinic_insert_cities ON public.cities
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS clinic_update_cities ON public.cities;
CREATE POLICY clinic_update_cities ON public.cities
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS clinic_delete_cities ON public.cities;
CREATE POLICY clinic_delete_cities ON public.cities
  FOR DELETE USING (is_global_role());

-- ─── clinics (global roles manage; franchise/core visibility by franchise_id) ─

DROP POLICY IF EXISTS clinic_select_clinics ON public.clinics;
CREATE POLICY clinic_select_clinics ON public.clinics
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS clinic_insert_clinics ON public.clinics;
CREATE POLICY clinic_insert_clinics ON public.clinics
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS clinic_update_clinics ON public.clinics;
CREATE POLICY clinic_update_clinics ON public.clinics
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS clinic_delete_clinics ON public.clinics;
CREATE POLICY clinic_delete_clinics ON public.clinics
  FOR DELETE USING (is_global_role());

-- ─── workload_snapshots (global roles only — Req 13.4, 13.5) ─────────────────

DROP POLICY IF EXISTS clinic_select_workload_snapshots ON public.workload_snapshots;
CREATE POLICY clinic_select_workload_snapshots ON public.workload_snapshots
  FOR SELECT USING (is_global_role());

DROP POLICY IF EXISTS clinic_insert_workload_snapshots ON public.workload_snapshots;
CREATE POLICY clinic_insert_workload_snapshots ON public.workload_snapshots
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS clinic_update_workload_snapshots ON public.workload_snapshots;
CREATE POLICY clinic_update_workload_snapshots ON public.workload_snapshots
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS clinic_delete_workload_snapshots ON public.workload_snapshots;
CREATE POLICY clinic_delete_workload_snapshots ON public.workload_snapshots
  FOR DELETE USING (is_global_role());

-- ============================================================================
-- DONE. New tables and columns are additive and nullable; RLS policies are
-- created but not enabled. Run the seed migration (seed-madhapur-clinic.sql)
-- separately to populate the initial Core Clinic and backfill associations.
-- ============================================================================
