-- ============================================================================
-- PER-FRANCHISE HOLIDAY CALENDAR + GLOBAL DISCOUNTS
-- ============================================================================
-- Run in Supabase SQL Editor.
--
-- Model: "independent per-entity". Core (franchise_id IS NULL) and each
-- franchise own their OWN holidays / global coupons.
--
-- Safety: additive. Existing core rows keep franchise_id = NULL and behave
-- exactly as before.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HOLIDAYS — add franchise_id and replace the global UNIQUE(holiday_date)
--    with scope-aware partial unique indexes.
-- ----------------------------------------------------------------------------

ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL
    REFERENCES public.franchises(id) ON DELETE CASCADE;

-- Drop the old global unique constraint on holiday_date (name may vary).
-- The original create script defined `holiday_date date NOT NULL UNIQUE`,
-- which Postgres names "holidays_holiday_date_key".
ALTER TABLE public.holidays
  DROP CONSTRAINT IF EXISTS holidays_holiday_date_key;

-- Core holidays: one row per date when franchise_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_core_date
  ON public.holidays (holiday_date)
  WHERE franchise_id IS NULL;

-- Franchise holidays: one row per (franchise, date).
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_franchise_date
  ON public.holidays (franchise_id, holiday_date)
  WHERE franchise_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_holidays_franchise
  ON public.holidays (franchise_id);

-- ----------------------------------------------------------------------------
-- 2. COUPONS — franchise_id already added by add-franchise-id-columns.sql.
--    This guarantees it exists even if that migration was not run.
-- ----------------------------------------------------------------------------

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL
    REFERENCES public.franchises(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_coupons_franchise
  ON public.coupons (franchise_id);
