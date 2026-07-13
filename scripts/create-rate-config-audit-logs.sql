-- ============================================================================
-- DELIVERY CHARGES MANAGEMENT — rate_config_audit_logs table (SAFE: Additive only)
-- ============================================================================
-- Spec: delivery-charges-management — Task 1.2
-- Requirements: 12.3, 12.5
--
-- Introduces an append-only audit trail for changes made through the Master
-- Rate Config Card. Every create/update of a Delivery_Rate or
-- Rider_Payout_Rate writes one row here containing the acting user, the
-- previous value, the new value, and a timestamp accurate to the second
-- (Req 12.3). Rows are permanently immutable: RLS grants INSERT to
-- master-authorized sessions only, and deliberately defines no UPDATE or
-- DELETE policy so no role — including MASTER_ADMIN — can modify or remove
-- a recorded entry (Req 12.5).
--
-- Creates:
--   1. rate_config_audit_logs table (new)
--   2. RLS enabled with:
--      - SELECT + INSERT policies for master-authorized sessions (ADMIN/MASTER_ADMIN)
--      - NO UPDATE policy, NO DELETE policy (append-only / immutable)
--   3. Indexes on franchise_id and created_at DESC for audit-trail lookups
--
-- ORDERING: This script MUST run AFTER create-rate-configs-table.sql (Task 1.1)
-- and after create-franchise-rls-policies.sql (defines is_global_role()).
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS / DROP POLICY IF EXISTS guards.
--
-- Rollback:
--   DROP POLICY IF EXISTS rate_config_audit_logs_select_master ON public.rate_config_audit_logs;
--   DROP POLICY IF EXISTS rate_config_audit_logs_insert_master ON public.rate_config_audit_logs;
--   DROP TABLE IF EXISTS public.rate_config_audit_logs;
-- ============================================================================

-- ============================================================================
-- 1. RATE_CONFIG_AUDIT_LOGS TABLE (Req 12.3, 12.5)
-- ============================================================================
-- No updated_at column and no update trigger: entries are write-once. There
-- is intentionally no foreign key requiring franchise_id to exist, since a
-- Core_Business change legitimately has franchise_id = NULL.

CREATE TABLE IF NOT EXISTS public.rate_config_audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID NOT NULL,
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('CORE_BUSINESS', 'FRANCHISE')),
  franchise_id   UUID REFERENCES public.franchises(id) ON DELETE CASCADE,
  field          TEXT NOT NULL CHECK (field IN ('delivery_rate_per_km', 'rider_payout_rate_per_km')),
  previous_value NUMERIC(10,2),
  new_value      NUMERIC(10,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rate_config_audit_logs IS
  'Append-only audit trail for Master Rate Config Card writes to rate_configs. No UPDATE or DELETE policy exists — every row is permanently immutable once inserted (Req 12.5).';

COMMENT ON COLUMN public.rate_config_audit_logs.actor_user_id IS
  'The master-authorized user who performed the rate change (Req 12.3).';

COMMENT ON COLUMN public.rate_config_audit_logs.field IS
  'Which rate was changed: delivery_rate_per_km or rider_payout_rate_per_km.';

COMMENT ON COLUMN public.rate_config_audit_logs.previous_value IS
  'The rate value before this change. NULL when the scope had no prior value configured.';

COMMENT ON COLUMN public.rate_config_audit_logs.new_value IS
  'The rate value after this change (Req 12.3).';

-- ============================================================================
-- 2. ROW LEVEL SECURITY — append-only / immutable (Req 12.3, 12.5)
-- ============================================================================
-- Depends on is_global_role() from create-franchise-rls-policies.sql, which
-- identifies master-authorized sessions (ADMIN, MASTER_ADMIN). Only SELECT
-- and INSERT policies are defined. Deliberately NO UPDATE policy and NO
-- DELETE policy — with RLS enabled and no matching policy, Postgres denies
-- all UPDATE/DELETE statements from any role, making every row immutable.

ALTER TABLE public.rate_config_audit_logs ENABLE ROW LEVEL SECURITY;

-- Master-authorized sessions may read the audit trail.
DROP POLICY IF EXISTS rate_config_audit_logs_select_master ON public.rate_config_audit_logs;
CREATE POLICY rate_config_audit_logs_select_master
  ON public.rate_config_audit_logs FOR SELECT
  USING (
    is_global_role()
  );

-- Master-authorized sessions may append new audit entries (Req 12.3).
DROP POLICY IF EXISTS rate_config_audit_logs_insert_master ON public.rate_config_audit_logs;
CREATE POLICY rate_config_audit_logs_insert_master
  ON public.rate_config_audit_logs FOR INSERT
  WITH CHECK (
    is_global_role()
  );

-- NOTE: No UPDATE or DELETE policy is created for this table, by design
-- (Req 12.5). Do not add one — audit entries must remain permanently
-- read-only once written.

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rate_config_audit_logs_franchise_id
  ON public.rate_config_audit_logs(franchise_id);

CREATE INDEX IF NOT EXISTS idx_rate_config_audit_logs_created_at
  ON public.rate_config_audit_logs(created_at DESC);

-- ============================================================================
-- DONE. The database now has:
--   - rate_config_audit_logs table, append-only by RLS design
--   - SELECT/INSERT restricted to master-authorized sessions
--   - No UPDATE/DELETE policy of any kind — entries are immutable (Req 12.5)
--
-- Next steps:
--   - Task 1.3: Add delivery_charge column to payments
--   - Task 1.4: Add delivery_charge column to subscriptions
-- ============================================================================
