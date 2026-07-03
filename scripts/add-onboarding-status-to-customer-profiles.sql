-- ============================================================================
-- CUSTOMER MOBILE ONBOARDING — Add onboarding_status to customer_profiles
-- (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: customer-mobile-onboarding (Task 1.1)
--
-- Adds the onboarding lifecycle state to public.customer_profiles so admin
-- dashboard sections, login eligibility, and the profile-completion flow can
-- be driven by stored state (Req 14.1, 14.2).
--
-- Adds:
--   - customer_profiles.onboarding_status  TEXT NOT NULL DEFAULT 'IN_PROGRESS'
--       Lifecycle state constrained to IN_PROGRESS | COMPLETED (Req 14.1).
--       New quick-onboarded customers start at IN_PROGRESS (Req 14.2); they
--       transition to COMPLETED when the customer finishes/marks completion.
--
-- Adds constraint:
--   - customer_profiles_onboarding_status_chk
--       CHECK (onboarding_status IN ('IN_PROGRESS','COMPLETED')) — rejects any
--       value outside the enumeration (Req 14.1). Added via a guard so the
--       migration stays idempotent (Postgres has no ADD CONSTRAINT IF NOT
--       EXISTS for CHECK constraints).
--
-- Adds index:
--   - idx_customer_profiles_onboarding_status
--       ON customer_profiles(onboarding_status, franchise_id)
--       Drives the per-franchise "Onboarded" (IN_PROGRESS) and "Onboarding
--       Completed" (COMPLETED) dashboard sections (Req 6.9, 6.10).
--
-- DATA BACK-FILL (legacy customers):
--   Every customer_profiles row that pre-existed this migration was created
--   through the legacy (non-mobile-onboarding) path and is already fully live.
--   The column DEFAULT applies IN_PROGRESS to those rows, which would wrongly
--   surface them in the profile-completion dialog and the "Onboarded" section.
--   So, ONLY on the run that first adds the column, we back-fill every
--   pre-existing row to COMPLETED. The back-fill is gated on the column being
--   newly added, so re-running this migration NEVER clobbers genuinely new
--   IN_PROGRESS customers created after rollout.
--
-- Safety: The new column is additive with a safe default; no existing data is
-- dropped. Idempotent (re-runnable): the column, constraint, back-fill, and
-- index are each guarded so repeated runs converge to the same state.
--
-- RLS: This script does NOT enable or alter RLS, following the established
-- additive migration pattern.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_customer_profiles_onboarding_status;
--   ALTER TABLE public.customer_profiles
--     DROP CONSTRAINT IF EXISTS customer_profiles_onboarding_status_chk;
--   ALTER TABLE public.customer_profiles
--     DROP COLUMN IF EXISTS onboarding_status;
-- ============================================================================

-- ============================================================================
-- 1. COLUMN + CHECK CONSTRAINT + LEGACY BACK-FILL (Req 14.1, 14.2)
-- ============================================================================
-- Done in one guarded DO block so the legacy back-fill (COMPLETED) runs EXACTLY
-- on the initial add and never on subsequent re-runs.

DO $$
DECLARE
  column_was_added BOOLEAN := FALSE;
BEGIN
  -- 1a. Additive column (idempotent). Track whether we actually added it.
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'customer_profiles'
       AND column_name  = 'onboarding_status'
  ) THEN
    ALTER TABLE public.customer_profiles
      ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'IN_PROGRESS';
    column_was_added := TRUE;
  END IF;

  -- 1b. CHECK constraint (idempotent — no ADD CONSTRAINT IF NOT EXISTS for CHECK).
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname  = 'customer_profiles_onboarding_status_chk'
       AND conrelid = 'public.customer_profiles'::regclass
  ) THEN
    ALTER TABLE public.customer_profiles
      ADD CONSTRAINT customer_profiles_onboarding_status_chk
      CHECK (onboarding_status IN ('IN_PROGRESS', 'COMPLETED'));  -- Req 14.1
  END IF;

  -- 1c. Legacy back-fill: only on the run that first added the column, mark
  -- every pre-existing customer as COMPLETED so they are unaffected by the
  -- profile-completion dialog and the "Onboarded" section.
  IF column_was_added THEN
    UPDATE public.customer_profiles
       SET onboarding_status = 'COMPLETED'
     WHERE onboarding_status = 'IN_PROGRESS';
  END IF;
END $$;

-- ============================================================================
-- 2. INDEX — drives dashboard sections (Req 6.9, 6.10)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_customer_profiles_onboarding_status
  ON public.customer_profiles(onboarding_status, franchise_id);

-- ============================================================================
-- DONE. onboarding_status is additive (DEFAULT 'IN_PROGRESS'), enum-constrained
-- to IN_PROGRESS | COMPLETED, and indexed with franchise_id. Pre-existing legacy
-- customers were back-filled to COMPLETED on the initial run only. New quick-
-- onboarded customers start at IN_PROGRESS.
-- ============================================================================
