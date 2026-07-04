-- ============================================================================
-- KIT DAILY LOGS RLS POLICIES
-- ============================================================================
--
-- Spec: kit-subscription — Task 1.6 — Requirements: 11.1, 12.1
--
-- Enables RLS and creates policies for the kit_daily_logs table.
-- Daily logs are customer-specific data tied to a KIT subscription.
--
-- Policy Logic:
--   ADMIN / MASTER_ADMIN (global role) → Full SELECT, INSERT, UPDATE access
--   CUSTOMERS → SELECT, INSERT, UPDATE only their own subscription's logs
--     (resolved via subscriptions → customer_profiles → users join)
--
-- Access Patterns:
--   - Customer Portal (KIT Tracker): Create and update daily log entries
--   - Admin Portal (Customer360 KIT tab): Read-only view of customer logs
--
-- Security Model:
--   - Customers filtered by subscription ownership chain:
--     kit_daily_logs.subscription_id → subscriptions.customer_profile_id →
--     customer_profiles.user_id → users.auth_user_id = auth.uid()
--   - No DELETE policy — daily log rows are never deleted through the app
--
-- Depends on: is_global_role() helper function from create-franchise-rls-policies.sql
--
-- Requirements validated: 11.1 (kit_daily_logs table access), 12.1 (KIT-only isolation)
-- ============================================================================

-- ─── kit_daily_logs ────────────────────────────────────────────────────────

-- Base table-level GRANTs (Postgres checks these BEFORE evaluating RLS
-- policies). Without them, `authenticated` gets "permission denied for table
-- kit_daily_logs" regardless of how permissive the RLS policy is below.
-- RLS still gates which ROWS each grantee can see/write.
-- No DELETE grant — logs are never deleted through the app.
GRANT SELECT, INSERT, UPDATE ON public.kit_daily_logs TO authenticated;

ALTER TABLE public.kit_daily_logs ENABLE ROW LEVEL SECURITY;

-- SELECT Policy: Admins see all records; customers see only their own subscription's logs
DROP POLICY IF EXISTS kit_daily_logs_select ON public.kit_daily_logs;
CREATE POLICY kit_daily_logs_select ON public.kit_daily_logs
  FOR SELECT USING (
    is_global_role()
    OR subscription_id IN (
      SELECT s.id FROM public.subscriptions s
      JOIN public.customer_profiles cp ON cp.id = s.customer_profile_id
      JOIN public.users u ON u.id = cp.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- INSERT Policy: Admins can insert for any subscription; customers only for their own
DROP POLICY IF EXISTS kit_daily_logs_insert ON public.kit_daily_logs;
CREATE POLICY kit_daily_logs_insert ON public.kit_daily_logs
  FOR INSERT WITH CHECK (
    is_global_role()
    OR subscription_id IN (
      SELECT s.id FROM public.subscriptions s
      JOIN public.customer_profiles cp ON cp.id = s.customer_profile_id
      JOIN public.users u ON u.id = cp.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- UPDATE Policy: Admins can update any log; customers only their own subscription's logs
DROP POLICY IF EXISTS kit_daily_logs_update ON public.kit_daily_logs;
CREATE POLICY kit_daily_logs_update ON public.kit_daily_logs
  FOR UPDATE USING (
    is_global_role()
    OR subscription_id IN (
      SELECT s.id FROM public.subscriptions s
      JOIN public.customer_profiles cp ON cp.id = s.customer_profile_id
      JOIN public.users u ON u.id = cp.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- No DELETE policy is granted — Daily_Log rows are never deleted through the
-- app (the Admin_KIT_Tab has no delete control, and the customer flow only
-- ever creates or updates a day's status via INSERT ... ON CONFLICT DO UPDATE).

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST:
--
-- As admin (service role):
--   SELECT count(*) FROM kit_daily_logs;                    -- Should see ALL records
--   INSERT INTO kit_daily_logs (subscription_id, log_date, status)
--     VALUES ('<kit-sub-uuid>', '2025-01-15', 'FOOD_TAKEN'); -- Should succeed
--   UPDATE kit_daily_logs SET status = 'FOOD_SKIPPED'
--     WHERE id = '<log-uuid>';                              -- Should succeed
--
-- As customer (authenticated user, non-admin):
--   SELECT count(*) FROM kit_daily_logs
--     WHERE subscription_id = '<own-kit-sub-id>';           -- Should see own logs
--   SELECT count(*) FROM kit_daily_logs
--     WHERE subscription_id != '<own-kit-sub-id>';          -- Should see 0
--   INSERT INTO kit_daily_logs (subscription_id, log_date, status)
--     VALUES ('<own-kit-sub-id>', '2025-01-16', 'FOOD_TAKEN'); -- Should succeed
--   INSERT INTO kit_daily_logs (subscription_id, log_date, status)
--     VALUES ('<other-sub-id>', '2025-01-16', 'FOOD_TAKEN');   -- Should FAIL
--   UPDATE kit_daily_logs SET status = 'FOOD_SKIPPED'
--     WHERE subscription_id = '<own-kit-sub-id>';           -- Should succeed
--   DELETE FROM kit_daily_logs WHERE id = '<any-id>';       -- Should FAIL (no grant)
--
-- As anonymous (not authenticated):
--   SELECT count(*) FROM kit_daily_logs;                    -- Should see 0
--   INSERT INTO kit_daily_logs (...);                       -- Should FAIL
-- ============================================================================
