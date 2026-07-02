-- ============================================================================
-- ADD PIN AUTHENTICATION COLUMNS TO USERS TABLE — (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: customer-pin-auth (Task 1.1)
-- Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
--
-- PIN-based authentication replaces SMS OTP for the Customer Portal login.
-- Admin sets (or auto-generates) a 6-digit temporary PIN during onboarding;
-- the customer logs in with mobile + PIN, is forced to set a permanent PIN on
-- first login, and thereafter authenticates with mobile + permanent PIN.
--
-- Three new columns on public.users:
--
--   pin_hash     TEXT          — bcrypt hash of the customer's PIN.
--                                Nullable (null for non-customer users or
--                                customers not yet onboarded with a PIN).
--
--   is_temp_pin  BOOLEAN       — Whether the current pin_hash represents an
--                NOT NULL        admin-set temporary PIN that must be changed
--                DEFAULT true    on next login. Defaults to true so that newly
--                                onboarded customers are forced through the
--                                "Set New PIN" flow.
--
--   pin_set_at   TIMESTAMPTZ   — Records when the PIN was last set or changed.
--                                Nullable (null until first PIN is set).
--
-- These columns are accessed ONLY via the service-role client (no RLS exposure).
-- The existing otp_login_throttle table is reused as-is for brute-force
-- protection — it is NOT modified by this migration.
--
-- Rollback:
--   ALTER TABLE public.users DROP COLUMN IF EXISTS pin_hash;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS is_temp_pin;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS pin_set_at;
-- ============================================================================

-- PIN hash column (Req 10.1) ---------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- Temporary PIN flag (Req 10.2) ------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_temp_pin BOOLEAN NOT NULL DEFAULT true;

-- PIN set timestamp (Req 10.3) -------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;

-- ============================================================================
-- DONE. Additive, idempotent columns only; no existing columns or tables
-- modified. otp_login_throttle remains unchanged (Req 10.4, 10.5, 10.6).
-- ============================================================================
