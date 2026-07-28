-- ============================================================================
-- DIETITIAN MANAGEMENT — READ MODEL + RLS POLICIES (ADDITIVE, IDEMPOTENT)
-- ============================================================================
-- Feature: dietitian-management — Task 1.2
-- Requirements: 5.7, 18.4, 25.4, 26.2, 26.3, 26.4
--
-- ORDERING: run AFTER
--   1. scripts/create-franchise-rls-policies.sql — defines is_global_role()
--      and current_app_user_id()
--   2. scripts/create-dietitian-management.sql   — creates health_logs,
--      health_log_audit_entries, users.dietitian_clinic_id and
--      customer_profiles.dietitian_id
--
-- What this script adds:
--   1. public.v_health_log_timeline — the Health_Log read model: a read-only
--      UNION ALL view over health_logs plus the three legacy log tables
--      (Req 26.4). Because it is a UNION ALL there is no writable path from a
--      Dietitian to a Self_Log (Req 25.4).
--   2. public.current_dietitian() / public.dietitian_can_read_customer() —
--      security-definer scope helpers mirroring the Dietitian read scope
--      (Req 5.5, 5.6, 5.7, 5.11).
--   3. RLS: an ADDITIVE SELECT policy on customer_profiles, select/insert/
--      update policies on health_logs with deliberately NO delete policy
--      (Req 18.4), and select/insert policies on health_log_audit_entries with
--      no update/delete policy (Req 26.2).
--
-- Purely additive (Req 26.3, 26.7):
--   * `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` are only
--     ever READ. No column, index, policy, trigger or row of theirs is touched,
--     so Accommodation health logging and the Customer_Portal KIT tracker keep
--     working byte-for-byte (Req 25.5).
--   * every existing policy on customer_profiles is left in place; the new
--     SELECT policy is permissive and therefore OR-ed with them, so no session
--     loses a row it could already see (Req 26.5, 26.6).
--
-- Idempotent (Req 26.8): CREATE OR REPLACE for the view and the functions,
-- DROP POLICY IF EXISTS + CREATE POLICY for every policy.
--
-- Rollback:
--   DROP POLICY IF EXISTS health_log_audit_entries_insert ON public.health_log_audit_entries;
--   DROP POLICY IF EXISTS health_log_audit_entries_select ON public.health_log_audit_entries;
--   DROP POLICY IF EXISTS health_logs_update ON public.health_logs;
--   DROP POLICY IF EXISTS health_logs_insert ON public.health_logs;
--   DROP POLICY IF EXISTS health_logs_select ON public.health_logs;
--   DROP POLICY IF EXISTS dietitian_select_customer_profiles ON public.customer_profiles;
--   DROP VIEW IF EXISTS public.v_health_log_timeline;
--   DROP FUNCTION IF EXISTS public.dietitian_can_read_customer(uuid);
--   DROP FUNCTION IF EXISTS public.current_dietitian();
-- ============================================================================

-- ============================================================================
-- 1. HEALTH_LOG READ MODEL — public.v_health_log_timeline (Req 26.4)
-- ============================================================================
-- One date-ordered timeline over four sources (Req 25.3). Legacy rows are
-- mapped, not migrated: each source row is projected onto its Customer_Record
-- (customer_profile_id) and its log_date, with the parameter columns folded
-- into the same sparse `parameters` JSONB shape the new table uses —
--   number : { "value": n, "unit": "kg" }
--   bp     : { "systolic": s, "diastolic": d, "unit": "mmHg" }
-- and an ABSENT key meaning "no value recorded" (jsonb_strip_nulls).
--
-- Legacy columns with no counterpart in the fixed field set (activity name and
-- duration) are surfaced as `custom_parameters` entries — the same
-- { label, value, unit } shape the Custom_Parameter editor writes — so the
-- timeline renders them generically without inventing new field keys.
--
-- security_invoker = true makes the view run with the CALLING role's
-- privileges, so the RLS policies of every underlying table still apply
-- (Req 5.7); without it the view would be evaluated as its owner and silently
-- bypass RLS.
--
-- DROP first: CREATE OR REPLACE VIEW cannot change an existing view's column
-- list or types, so a re-run after any edit to the projection would fail.
DROP VIEW IF EXISTS public.v_health_log_timeline;

CREATE VIEW public.v_health_log_timeline
WITH (security_invoker = true) AS

  -- ── 1. Dietitian_Logs and any customer-authored rows in the new table ─────
  SELECT
    h.id                        AS id,
    h.customer_profile_id       AS customer_profile_id,
    h.log_date                  AS log_date,
    h.author_type               AS author_type,
    h.author_user_id            AS author_user_id,
    'health_logs'::text         AS source,
    h.parameters                AS parameters,
    h.custom_parameters         AS custom_parameters,
    h.closing_comment::text     AS closing_comment,
    h.submitted_at              AS submitted_at
  FROM public.health_logs h

  UNION ALL

  -- ── 2. Legacy Accommodation admin logs (weight / BP / sugar / notes) ──────
  -- Authored by staff, so they surface as DIETITIAN entries. The legacy table
  -- records no author, hence a NULL author_user_id.
  SELECT
    a.id,
    a.customer_profile_id,
    a.log_date,
    'DIETITIAN'::text,
    NULL::uuid,
    'admin_health_logs'::text,
    jsonb_strip_nulls(jsonb_build_object(
      'weight',        CASE WHEN a.weight_kg IS NULL THEN NULL
                            ELSE jsonb_build_object('value', a.weight_kg, 'unit', 'kg') END,
      'bp',            CASE WHEN a.bp_systolic IS NULL AND a.bp_diastolic IS NULL THEN NULL
                            ELSE jsonb_build_object('systolic',  a.bp_systolic,
                                                    'diastolic', a.bp_diastolic,
                                                    'unit',      'mmHg') END,
      'fasting_sugar', CASE WHEN a.sugar_level_mgdl IS NULL THEN NULL
                            ELSE jsonb_build_object('value', a.sugar_level_mgdl, 'unit', 'mg/dL') END
    )),
    '[]'::jsonb,
    a.notes::text,
    a.created_at
  FROM public.admin_health_logs a

  UNION ALL

  -- ── 3. Legacy Accommodation customer logs (water / activity) ──────────────
  SELECT
    c.id,
    c.customer_profile_id,
    c.log_date,
    'CUSTOMER'::text,
    NULL::uuid,
    'customer_health_logs'::text,
    jsonb_strip_nulls(jsonb_build_object(
      'water_intake', CASE WHEN c.water_intake_liters IS NULL THEN NULL
                           ELSE jsonb_build_object('value', c.water_intake_liters, 'unit', 'litres') END
    )),
    (
      CASE WHEN c.activity_name IS NULL OR btrim(c.activity_name) = '' THEN '[]'::jsonb
           ELSE jsonb_build_array(jsonb_build_object(
                  'label', 'Activity', 'value', c.activity_name, 'unit', '')) END
      ||
      CASE WHEN c.activity_duration_minutes IS NULL THEN '[]'::jsonb
           ELSE jsonb_build_array(jsonb_build_object(
                  'label', 'Activity duration',
                  'value', c.activity_duration_minutes::text, 'unit', 'mins')) END
    ),
    NULL::text,
    c.created_at
  FROM public.customer_health_logs c

  UNION ALL

  -- ── 4. KIT Self_Logs (weight / steps / water / activity) ──────────────────
  -- kit_daily_logs is keyed to the subscription, so the Customer_Record comes
  -- from the join. Adherence (status IN (FOOD_TAKEN, FOOD_SKIPPED)) is NOT part
  -- of the timeline: Req 16.3 reads kit_daily_logs directly for that.
  SELECT
    k.id,
    s.customer_profile_id,
    k.log_date,
    'CUSTOMER'::text,
    NULL::uuid,
    'kit_daily_logs'::text,
    jsonb_strip_nulls(jsonb_build_object(
      'weight',       CASE WHEN k.weight_kg IS NULL THEN NULL
                           ELSE jsonb_build_object('value', k.weight_kg, 'unit', 'kg') END,
      'step_count',   CASE WHEN k.step_count IS NULL THEN NULL
                           ELSE jsonb_build_object('value', k.step_count, 'unit', 'steps') END,
      'water_intake', CASE WHEN k.water_intake_liters IS NULL THEN NULL
                           ELSE jsonb_build_object('value', k.water_intake_liters, 'unit', 'litres') END
    )),
    (
      CASE WHEN k.physical_activity_name IS NULL OR btrim(k.physical_activity_name) = ''
           THEN '[]'::jsonb
           ELSE jsonb_build_array(jsonb_build_object(
                  'label', 'Activity', 'value', k.physical_activity_name, 'unit', '')) END
      ||
      CASE WHEN k.physical_activity_minutes IS NULL THEN '[]'::jsonb
           ELSE jsonb_build_array(jsonb_build_object(
                  'label', 'Activity duration',
                  'value', k.physical_activity_minutes::text, 'unit', 'mins')) END
    ),
    NULL::text,
    k.created_at
  FROM public.kit_daily_logs k
  JOIN public.subscriptions s ON s.id = k.subscription_id
  WHERE s.customer_profile_id IS NOT NULL;

COMMENT ON VIEW public.v_health_log_timeline IS
  'Health_Log read model (Req 26.4): read-only UNION ALL over health_logs, admin_health_logs, customer_health_logs and kit_daily_logs. No write path exists to a Self_Log through this view (Req 25.4).';

GRANT SELECT ON public.v_health_log_timeline TO authenticated, service_role;

-- ============================================================================
-- 2. DIETITIAN SCOPE HELPERS (Req 5.5, 5.6, 5.7, 5.11)
-- ============================================================================
-- SECURITY DEFINER because both helpers read public.users, which is itself
-- RLS-protected: an invoker-rights function would recurse into the policies
-- that call it. STABLE so the planner can hoist the call out of a row loop.
-- search_path is pinned to 'public' — mandatory for any definer-rights
-- function, otherwise a caller-controlled search_path could shadow the tables.

-- Is the caller an active Dietitian, and what is their Clinic / Franchise?
-- Returns zero rows for every non-Dietitian and every deactivated Dietitian,
-- which is what makes dietitian_can_read_customer() below fail closed.
CREATE OR REPLACE FUNCTION public.current_dietitian()
RETURNS TABLE (user_id uuid, clinic_id uuid, franchise_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u.id, u.dietitian_clinic_id, u.franchise_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.admin_access_level = 'dietitian'
    AND u.is_active
  LIMIT 1
$$;

COMMENT ON FUNCTION public.current_dietitian() IS
  'The calling session''s active Dietitian row (id, Dietitian_Clinic_Link, tenant), or no rows when the caller is not an active Dietitian.';

-- Readable Customer_Records for a Dietitian (Req 5.5, 5.6, 5.7, 5.11).
--   * Franchise Dietitian (franchise_id IS NOT NULL): the whole tenant, by the
--     same mechanism that already confines the Franchise Owner (Req 21.8,
--     21.11).
--   * Core Dietitian: ONLY the Customer_Records explicitly linked to them via
--     Dietitian_Link (`cp.dietitian_id = d.user_id`). The linked Clinic does
--     NOT widen the read scope — a Dietitian never sees a clinic-mate's
--     customer they were not assigned to.
CREATE OR REPLACE FUNCTION public.dietitian_can_read_customer(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.current_dietitian() d
    JOIN public.customer_profiles cp ON cp.id = p_profile_id
    WHERE (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
       OR (d.franchise_id IS NULL AND cp.dietitian_id = d.user_id)
  )
$$;

COMMENT ON FUNCTION public.dietitian_can_read_customer(uuid) IS
  'True when the calling Dietitian may READ the given Customer_Record (Req 5.5, 5.6, 5.11). Mirrors src/lib/dietitian/scope.ts exactly. Grants no write access of any kind (Req 5.10, 16.5).';

GRANT EXECUTE ON FUNCTION public.current_dietitian() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dietitian_can_read_customer(uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. customer_profiles — ADDITIVE read scope for Dietitians (Req 5.5, 5.6)
-- ============================================================================
-- RLS is already enabled on customer_profiles and its existing policies stay
-- exactly as they are. Postgres OR-s permissive policies of the same command,
-- so this only ever ADDS rows for a Dietitian session and changes nothing for
-- any other Access_Level (Req 26.5, 26.6).
--
-- Deliberately SELECT-only: no INSERT / UPDATE / DELETE policy is created for
-- Dietitians, so the database refuses a Dietitian write against a
-- Customer_Record even if an application guard were bypassed (Req 5.10, 16.5).
DROP POLICY IF EXISTS dietitian_select_customer_profiles ON public.customer_profiles;
CREATE POLICY dietitian_select_customer_profiles
  ON public.customer_profiles FOR SELECT
  USING (
    public.dietitian_can_read_customer(id)
  );

-- ============================================================================
-- 4. health_logs — read scope, authored writes, NO deletion (Req 18.4)
-- ============================================================================
ALTER TABLE public.health_logs ENABLE ROW LEVEL SECURITY;

-- Supabase does not auto-grant tables created via raw SQL; RLS only decides
-- WHICH rows are visible, so without a base GRANT every query fails with
-- 42501 "permission denied for table".
GRANT SELECT, INSERT, UPDATE ON public.health_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.health_logs TO service_role;

-- Global (master/admin) sessions see everything; a Dietitian sees the logs of
-- the Customer_Records in their scope, which includes customer-authored rows
-- (Req 25.1, 25.2).
DROP POLICY IF EXISTS health_logs_select ON public.health_logs;
CREATE POLICY health_logs_select
  ON public.health_logs FOR SELECT
  USING (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  );

-- A write must land on an in-scope Customer_Record AND be self-attributed:
-- author_user_id is the caller and author_type is DIETITIAN. One Dietitian can
-- therefore never author a log in another's name (Req 15.10, 18.1).
DROP POLICY IF EXISTS health_logs_insert ON public.health_logs;
CREATE POLICY health_logs_insert
  ON public.health_logs FOR INSERT
  WITH CHECK (
    (
      is_global_role()
      OR public.dietitian_can_read_customer(customer_profile_id)
    )
    AND author_user_id = current_app_user_id()
    AND author_type = 'DIETITIAN'
  );

-- Same predicate for the same-day edit path (Req 15.9). The day-window and
-- authorship rules themselves live in HealthLogService; this policy only makes
-- sure an edit cannot re-attribute or move a row out of scope.
DROP POLICY IF EXISTS health_logs_update ON public.health_logs;
CREATE POLICY health_logs_update
  ON public.health_logs FOR UPDATE
  USING (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  )
  WITH CHECK (
    (
      is_global_role()
      OR public.dietitian_can_read_customer(customer_profile_id)
    )
    AND author_user_id = current_app_user_id()
    AND author_type = 'DIETITIAN'
  );

-- NOTE: No DELETE policy is created for health_logs, by design (Req 18.4).
-- With RLS enabled and no matching policy Postgres denies every DELETE from
-- every non-superuser role. Do not add one — a Health_Log is never deletable.

-- ============================================================================
-- 5. health_log_audit_entries — append-only (Req 18.7, 18.8, 26.2)
-- ============================================================================
ALTER TABLE public.health_log_audit_entries ENABLE ROW LEVEL SECURITY;

-- The audit trail is a master-admin artefact (Req 18.8): readable by global
-- sessions, appended by the server actions (service-role key). No table-level
-- UPDATE/DELETE is granted, and the trg_health_log_audit_immutable trigger from
-- create-dietitian-management.sql blocks even the service role (Req 18.7).
GRANT SELECT ON public.health_log_audit_entries TO authenticated;
GRANT SELECT, INSERT ON public.health_log_audit_entries TO service_role;

DROP POLICY IF EXISTS health_log_audit_entries_select ON public.health_log_audit_entries;
CREATE POLICY health_log_audit_entries_select
  ON public.health_log_audit_entries FOR SELECT
  USING (
    is_global_role()
  );

DROP POLICY IF EXISTS health_log_audit_entries_insert ON public.health_log_audit_entries;
CREATE POLICY health_log_audit_entries_insert
  ON public.health_log_audit_entries FOR INSERT
  WITH CHECK (
    is_global_role()
  );

-- NOTE: No UPDATE or DELETE policy is created for health_log_audit_entries, by
-- design (Req 18.7, 26.2). Do not add one.

-- ============================================================================
-- DONE. The database now has:
--   - public.v_health_log_timeline exposing all four log sources read-only
--   - public.current_dietitian() / public.dietitian_can_read_customer()
--   - an additive Dietitian SELECT policy on customer_profiles
--   - health_logs select/insert/update policies and NO delete policy
--   - health_log_audit_entries select/insert policies and nothing else
--   - admin_health_logs, customer_health_logs and kit_daily_logs untouched
-- ============================================================================
