-- ============================================================================
-- ADD franchise_id TO USERS TABLE — Phase 1 (SAFE: Nullable column only)
-- ============================================================================
-- Existing users (ADMIN, MASTER_ADMIN, RIDER, CUSTOMER) keep NULL — no impact.
-- Only new FRANCHISE_ADMIN users will have a non-null franchise_id.
--
-- Rollback: ALTER TABLE public.users DROP COLUMN franchise_id;
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_franchise ON public.users(franchise_id);
