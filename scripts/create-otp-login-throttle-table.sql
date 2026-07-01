-- ============================================================================
-- CUSTOMER MOBILE ONBOARDING — OTP Login Throttle (SAFE: Additive only)
-- ============================================================================
-- Spec: customer-mobile-onboarding — Task 1.4 — Requirements 2.5, 2.7, 2.9, 2.10
--
-- Backs the OTP login policy state machine (`evaluateOtpPolicy`) with a single
-- persisted throttle record per mobile number (normalized 10-digit form). The
-- application layer reads/writes this row through the service-role client inside
-- `mobileAuthActions` to enforce:
--   - the 5-failed-attempt lockout for 900s        (Req 2.5, 2.7)
--   - the 30s resend cooldown                       (Req 2.9, 2.10)
--   - the max 3 resends per 900s window             (Req 2.9, 2.10)
--
-- Columns:
--   mobile            — PRIMARY KEY, normalized 10-digit customer mobile
--   window_started_at — start of the current 900s policy window
--   failed_attempts   — failed OTP verifications in the current window (Req 2.5, 2.7)
--   resend_count      — resends issued in the current window (Req 2.9, 2.10)
--   last_sent_at      — timestamp of the last OTP send (drives 30s cooldown)
--   locked_until      — when set + in the future, all sends/verifies are blocked
--   updated_at        — last mutation timestamp
--
-- Security: RLS is ENABLED with NO policies. All access is performed through the
-- service-role (admin) client, which bypasses RLS — so the table is intentionally
-- unreachable by anon / authenticated (customer) roles directly.
--
-- Safety: Brand new table; no existing data is dropped or altered. Idempotent
-- (re-runnable) via CREATE TABLE IF NOT EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.otp_login_throttle;
-- ============================================================================

-- ============================================================================
-- 1. OTP_LOGIN_THROTTLE (new) — Requirements 2.5, 2.7, 2.9, 2.10
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.otp_login_throttle (
  mobile            TEXT PRIMARY KEY
                      CHECK (mobile ~ '^[6-9][0-9]{9}$'),   -- normalized 10-digit mobile
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),     -- start of current 900s window
  failed_attempts   INTEGER NOT NULL DEFAULT 0
                      CHECK (failed_attempts >= 0),         -- Req 2.5, 2.7
  resend_count      INTEGER NOT NULL DEFAULT 0
                      CHECK (resend_count >= 0),            -- Req 2.9, 2.10
  last_sent_at      TIMESTAMPTZ,                            -- drives 30s resend cooldown (Req 2.9, 2.10)
  locked_until      TIMESTAMPTZ,                            -- lockout expiry (Req 2.7)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. ROW LEVEL SECURITY — service-role only (no anon/customer policies)
-- ----------------------------------------------------------------------------
-- Enable RLS but intentionally add NO policies. Reads/writes happen exclusively
-- through the service-role client in `mobileAuthActions`, which bypasses RLS.
-- This keeps throttle state inaccessible to anon / authenticated roles directly.
-- ============================================================================

ALTER TABLE public.otp_login_throttle ENABLE ROW LEVEL SECURITY;
