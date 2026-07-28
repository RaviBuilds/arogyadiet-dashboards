-- ============================================================================
-- DIETITIAN MANAGEMENT — SCHEMA MIGRATION (ADDITIVE, IDEMPOTENT)
-- ============================================================================
-- Feature: dietitian-management
-- Requirements: 1.1, 1.2, 2.7, 2.8, 6.1, 10.5, 15.11, 18.4, 18.7, 26.1, 26.7, 26.8
--
-- Adds the `dietitian` admin_access_level, the Dietitian_Clinic_Link
-- (`users.dietitian_clinic_id`), the Dietitian_Link
-- (`customer_profiles.dietitian_id`), the `health_logs` write target and the
-- append-only `health_log_audit_entries` audit trail.
--
-- Purely additive (Req 26.1, 26.7):
--   * no column is dropped, renamed or retyped
--   * `admin_health_logs`, `customer_health_logs` and `kit_daily_logs` are left
--     untouched, so Accommodation logging and the Customer_Portal KIT tracker
--     keep working byte-for-byte
--   * every existing `admin_access_level` value stays valid
--
-- Idempotent (Req 1.3, 26.8): every statement is `IF NOT EXISTS` or
-- `DROP … IF EXISTS` + recreate, so a second execution leaves the schema and
-- the data unchanged.
--
-- The read model (`v_health_log_timeline`), the Dietitian scope helpers and the
-- RLS policies ship in the companion script
-- `scripts/create-dietitian-management-rls.sql`, which MUST run after this one.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_health_log_audit_immutable ON public.health_log_audit_entries;
--   DROP FUNCTION IF EXISTS public.reject_audit_mutation();
--   DROP TABLE IF EXISTS public.health_log_audit_entries;
--   DROP TABLE IF EXISTS public.health_logs;
--   ALTER TABLE public.customer_profiles DROP COLUMN IF EXISTS dietitian_id;
--   DROP INDEX IF EXISTS public.users_one_active_dietitian_per_franchise;
--   DROP INDEX IF EXISTS public.idx_users_dietitian_clinic_id;
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_dietitian_mobile_check;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS dietitian_clinic_id;
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_admin_access_level_check;
--   ALTER TABLE public.users ADD CONSTRAINT users_admin_access_level_check
--     CHECK (admin_access_level IS NULL OR admin_access_level = ANY (ARRAY[
--       'inventory','operations','inventory_operations']));
-- ============================================================================

-- 1. Access level -------------------------------------------------------------
-- Extend the enum with `dietitian` (Req 1.1, 1.2). Drop-then-add keeps the
-- statement idempotent; every pre-existing value remains admissible (Req 26.7).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_admin_access_level_check;
ALTER TABLE public.users ADD CONSTRAINT users_admin_access_level_check
  CHECK (admin_access_level IS NULL OR admin_access_level = ANY (ARRAY[
    'inventory','operations','inventory_operations','dietitian'
  ]));

-- 2. Dietitian_Clinic_Link ----------------------------------------------------
-- 0..1 Clinic per Dietitian, stored as a column rather than a join table so the
-- franchise cardinality rule can be a single partial unique index.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dietitian_clinic_id uuid
    REFERENCES public.clinics(id) ON DELETE SET NULL;

-- Mobile is mandatory and exactly 10 digits for a Dietitian, so a direct
-- database write cannot bypass the application checks (Req 2.7).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_dietitian_mobile_check;
ALTER TABLE public.users ADD CONSTRAINT users_dietitian_mobile_check
  CHECK (
    admin_access_level IS DISTINCT FROM 'dietitian'
    OR (mobile IS NOT NULL AND mobile ~ '^[0-9]{10}$')
  );

-- At most one ACTIVE Dietitian per Franchise (Req 10.2, 10.5, 10.6).
-- Core_Business rows (franchise_id IS NULL) are excluded, so a Core Clinic may
-- carry many Dietitians (Req 10.1). The index — not a read-then-write check —
-- is what makes two concurrent creates safe (Req 2.12).
CREATE UNIQUE INDEX IF NOT EXISTS users_one_active_dietitian_per_franchise
  ON public.users (franchise_id)
  WHERE admin_access_level = 'dietitian' AND is_active AND franchise_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_dietitian_clinic_id
  ON public.users (dietitian_clinic_id)
  WHERE admin_access_level = 'dietitian';

-- 3. Dietitian_Link -----------------------------------------------------------
-- 0..1 Dietitian per Customer_Record (Req 6.1). Adding the column nullable sets
-- every existing Customer_Record's link to empty (Req 6.3); ON DELETE SET NULL
-- clears the link when a Dietitian account is deleted while retaining the
-- Customer_Record (Req 6.5).
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS dietitian_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_profiles_dietitian_id
  ON public.customer_profiles (dietitian_id);

-- 4. Health_Log ---------------------------------------------------------------
-- Single write target for Dietitian_Logs. Parameter values live in one sparse
-- JSONB map: an absent key means no value and therefore no unit.
CREATE TABLE IF NOT EXISTS public.health_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
  log_date            date NOT NULL,
  author_type         text NOT NULL CHECK (author_type IN ('DIETITIAN','CUSTOMER')),
  author_user_id      uuid NOT NULL REFERENCES public.users(id),
  customer_category   text NOT NULL CHECK (customer_category IN ('MEAL','KIT','ACCOMMODATION')),
  parameters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_parameters   jsonb NOT NULL DEFAULT '[]'::jsonb,
  closing_comment     text NOT NULL CHECK (char_length(closing_comment) BETWEEN 1 AND 2000),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  submission_date_ist date NOT NULL,
  clinic_id           uuid REFERENCES public.clinics(id),
  franchise_id        uuid REFERENCES public.franchises(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- At most one Dietitian_Log per Customer_Record per log_date (Req 15.11).
-- Also the upsert conflict target used by the same-day edit path.
CREATE UNIQUE INDEX IF NOT EXISTS health_logs_one_dietitian_log_per_day
  ON public.health_logs (customer_profile_id, log_date)
  WHERE author_type = 'DIETITIAN';

CREATE INDEX IF NOT EXISTS idx_health_logs_customer_date
  ON public.health_logs (customer_profile_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_author
  ON public.health_logs (author_user_id, log_date DESC);

-- 5. Log_Audit_Trail (append-only) -------------------------------------------
-- Records accepted AND rejected write attempts (Req 18.5, 18.6).
CREATE TABLE IF NOT EXISTS public.health_log_audit_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_log_id       uuid REFERENCES public.health_logs(id) ON DELETE SET NULL,
  customer_profile_id uuid NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
  log_date            date NOT NULL,
  actor_user_id       uuid REFERENCES public.users(id),
  action              text NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE')),
  outcome             text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED')),
  rejection_reason    text,
  changed_values      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_log_audit_customer
  ON public.health_log_audit_entries (customer_profile_id, created_at DESC);

-- Immutability. RLS alone is insufficient because every server action uses the
-- service-role key, which bypasses RLS (Req 18.7). Health_Logs themselves are
-- never deletable either: no DELETE policy is granted (Req 18.4).
CREATE OR REPLACE FUNCTION public.reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'health_log_audit_entries is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_health_log_audit_immutable ON public.health_log_audit_entries;
CREATE TRIGGER trg_health_log_audit_immutable
  BEFORE UPDATE OR DELETE ON public.health_log_audit_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
