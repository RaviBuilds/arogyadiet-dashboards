-- ============================================================================
-- DELIVERY CHARGES MANAGEMENT — rate_configs table (SAFE: Additive only)
-- ============================================================================
-- Spec: delivery-charges-management — Task 1.1
-- Requirements: 1.1, 1.2, 1.7
--
-- Introduces the multi-tenant per-km rate configuration store. One row per
-- Rate_Scope (Core_Business or a specific Franchise) holding both the
-- delivery rate and the rider-payout rate. A NULL rate column means "not
-- configured for this scope" and the fallback rules (franchise -> core ->
-- built-in default) apply at read time in RateConfigService.
--
-- Creates:
--   1. rate_configs table (new) with CHECK constraints
--   2. uq_rate_configs_core unique index — exactly one Core row (Req 1.1)
--   3. uq_rate_configs_franchise unique index — at most one row per franchise (Req 1.2)
--   4. Seed Core row: delivery_rate_per_km = 13.00, rider_payout_rate_per_km
--      copied from system_settings.rider_payout_per_km (default 16.00)
--
-- ORDERING: This script MUST run AFTER the franchises and system_settings
-- tables exist. It references public.franchises(id) via foreign key.
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards and a guarded seed insert.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.uq_rate_configs_franchise;
--   DROP INDEX IF EXISTS public.uq_rate_configs_core;
--   DROP TABLE IF EXISTS public.rate_configs;
-- ============================================================================

-- ============================================================================
-- 1. RATE_CONFIGS TABLE (Req 1.1, 1.2, 1.7)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_configs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type               TEXT NOT NULL CHECK (scope_type IN ('CORE_BUSINESS', 'FRANCHISE')),
  franchise_id             UUID REFERENCES public.franchises(id) ON DELETE CASCADE,
  delivery_rate_per_km     NUMERIC(8,2) CHECK (delivery_rate_per_km >= 0 AND delivery_rate_per_km <= 999999.99),
  rider_payout_rate_per_km NUMERIC(8,2) CHECK (rider_payout_rate_per_km >= 0 AND rider_payout_rate_per_km <= 999999.99),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- CORE_BUSINESS rows must have no franchise_id; FRANCHISE rows must have one.
  CONSTRAINT rate_configs_scope_shape CHECK (
    (scope_type = 'CORE_BUSINESS' AND franchise_id IS NULL) OR
    (scope_type = 'FRANCHISE'     AND franchise_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.rate_configs IS
  'Per-km delivery rate and rider-payout rate configuration, scoped to the Core Business or a specific Franchise. A NULL rate means "not configured" and falls back to franchise -> core -> built-in default at read time.';

COMMENT ON COLUMN public.rate_configs.scope_type IS
  'CORE_BUSINESS (exactly one row) or FRANCHISE (at most one row per franchise).';

COMMENT ON COLUMN public.rate_configs.franchise_id IS
  'NULL for the CORE_BUSINESS row; required for FRANCHISE rows.';

COMMENT ON COLUMN public.rate_configs.delivery_rate_per_km IS
  'INR per kilometer used to compute customer delivery charges. NULL = not configured for this scope.';

COMMENT ON COLUMN public.rate_configs.rider_payout_rate_per_km IS
  'INR per kilometer used to compute rider payouts. NULL = not configured for this scope.';

-- ============================================================================
-- 2. UNIQUE INDEXES (Req 1.1, 1.2)
-- ============================================================================

-- Exactly one Core row across the whole table (Req 1.1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_configs_core
  ON public.rate_configs ((true))
  WHERE scope_type = 'CORE_BUSINESS';

-- At most one row per franchise (Req 1.2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_configs_franchise
  ON public.rate_configs (franchise_id)
  WHERE scope_type = 'FRANCHISE';

-- ============================================================================
-- 3. SEED CORE ROW (Req 1.1, 1.7)
-- ============================================================================
-- Inserts the single Core_Business row with delivery_rate_per_km = 13.00 and
-- rider_payout_rate_per_km copied from system_settings.rider_payout_per_km
-- (defaulting to 16.00 if system_settings has no row yet), preserving
-- existing payout behavior at cutover. Guarded so re-running this script
-- does not insert a duplicate Core row.

INSERT INTO public.rate_configs (scope_type, franchise_id, delivery_rate_per_km, rider_payout_rate_per_km)
SELECT
  'CORE_BUSINESS',
  NULL,
  13.00,
  COALESCE((SELECT rider_payout_per_km FROM public.system_settings LIMIT 1), 16.00)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rate_configs WHERE scope_type = 'CORE_BUSINESS'
);

-- ============================================================================
-- DONE. The database now has:
--   - rate_configs table with scope-shape and rate-bound CHECK constraints
--   - Uniqueness guarantees: exactly one Core row, at most one row per franchise
--   - A seeded Core row (delivery ₹13.00/km, payout copied from system_settings)
--
-- Next steps:
--   - Task 1.2: Create rate_config_audit_logs table
--   - Task 1.3: Add delivery_charge column to payments
--   - Task 1.4: Add delivery_charge column to subscriptions
-- ============================================================================
