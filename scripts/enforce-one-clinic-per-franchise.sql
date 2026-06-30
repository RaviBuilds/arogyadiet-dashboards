-- ============================================================================
-- ENFORCE ONE CLINIC PER FRANCHISE (UI + DB safeguard)
-- ============================================================================
-- The franchise business model requires exactly ONE clinic per franchise.
-- Core business (franchise_id IS NULL) is NOT affected — multiple core clinics
-- per kitchen/city remain allowed.
--
-- This script:
--   1. Deletes the accidental duplicate clinic for Be-Fit Vizag (if it still exists)
--   2. Adds a partial unique index on clinics.franchise_id WHERE franchise_id IS NOT NULL
--      to prevent future duplicates at the database level.
--
-- Impact on Core Business: NONE. The partial unique index only covers rows
-- WHERE franchise_id IS NOT NULL. Core clinics (franchise_id = NULL) are excluded.
--
-- Safety: Additive. The partial index does not affect existing core clinic rows.
-- Rollback: DROP INDEX IF EXISTS uq_one_clinic_per_franchise;
-- ============================================================================

-- 1. Delete the duplicate clinic (no service areas, no riders, no customers)
DELETE FROM public.clinics
WHERE id = '8eb246f7-f64e-48cd-a689-0fe295feb320';

-- 2. Enforce one clinic per franchise at DB level (excludes core clinics)
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_clinic_per_franchise
  ON public.clinics (franchise_id)
  WHERE franchise_id IS NOT NULL;
