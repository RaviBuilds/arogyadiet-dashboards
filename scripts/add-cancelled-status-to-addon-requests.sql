-- ============================================================================
-- ADD-ON SERVICE REQUESTS — allow customers to cancel a pending/confirmed
-- request (SAFE: widens an existing CHECK constraint only)
-- ============================================================================
-- Feature: accommodation add-on services UX fix
--
-- Problem: a customer could submit unlimited duplicate add-on requests
-- (e.g. clicking "Request" on Ayurvedic Massage 3 times created 3 PENDING
-- rows) because nothing let them withdraw one, and the app now blocks a new
-- request while an existing one is open. That means customers need a way
-- out of a request they no longer want, so `status` must support CANCELLED
-- alongside the existing PENDING -> CONFIRMED -> COMPLETED lifecycle.
--
-- Change: widen `addon_service_requests_status_check` to also accept
-- 'CANCELLED'. Purely additive — no existing row's status changes, and every
-- previously-valid status remains valid.
--
-- Safety: DROP + re-CREATE of a CHECK constraint only; no data is touched,
-- no column type changes, fully idempotent (re-runnable).
--
-- Rollback:
--   ALTER TABLE public.addon_service_requests
--     DROP CONSTRAINT IF EXISTS addon_service_requests_status_check;
--   ALTER TABLE public.addon_service_requests
--     ADD CONSTRAINT addon_service_requests_status_check
--     CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED'));
--   -- (only safe if no row currently has status = 'CANCELLED')
-- ============================================================================

ALTER TABLE public.addon_service_requests
  DROP CONSTRAINT IF EXISTS addon_service_requests_status_check;

ALTER TABLE public.addon_service_requests
  ADD CONSTRAINT addon_service_requests_status_check
  CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'));

-- ============================================================================
-- DONE. Existing rows are untouched; CANCELLED is now a valid status value.
-- ============================================================================
