-- ============================================================================
-- CLINIC-SCOPED SHOP INVENTORY — Clinic_Scope_Assignment on Users
-- (SAFE: Additive only)
-- ============================================================================
-- Adds the Clinic_Scope_Assignment: the single Core_Clinic an Admin is confined
-- to for the Shop Products module. A Clinic_Scoped_Admin (admin_access_level
-- `operations` with this column set) sees Shop Products stock, ledger, and shop
-- orders for that one clinic only, while retaining full Core access to
-- customers, subscriptions, and riders.
--
-- Requirements: 13.1 (persist a nullable Clinic_Scope_Assignment referencing an
-- existing Clinic whose `franchise_id` is NULL), 13.12 (reject an assignment
-- referencing a Clinic that does not exist or is not a Core_Clinic).
--
-- Adds (nullable, NULL = Unscoped_Operations_Admin, zero production impact):
--   - users.admin_clinic_id — NULL for every existing user, including every
--       existing operations admin, who therefore remains unscoped and sees all
--       clinics exactly as before.
--
-- Adds indexes:
--   - idx_users_admin_clinic ON users(admin_clinic_id)
--       PARTIAL (WHERE admin_clinic_id IS NOT NULL). Answers "which admins are
--       scoped to this clinic". Partial keeps it tiny: the overwhelming majority
--       of users carry no assignment.
--
-- NULLABILITY (Requirement 13.1): The column is NULLABLE on purpose. NULL is
-- the normal state for customers, riders, franchise admins, master admins, and
-- unscoped operations admins alike.
--
-- CORE-CLINIC RESTRICTION (Requirements 13.1, 13.12): Enforced HERE, in the
-- database, by trg_users_admin_clinic_core_only, which READS
-- clinics.franchise_id instead of relying on a hand-maintained list. This is a
-- deliberate contrast with users_admin_access_level_check, whose hard-coded
-- level list has already drifted (it still omits `dietitian`). Reading the
-- source column cannot drift. The trigger is the load-bearing guard because
-- every server action uses the service-role key and therefore bypasses RLS.
--
-- The exception message carries the stable `CLINIC_NOT_CORE:` prefix so the
-- action layer can map it to Requirement 13.12's wording without string-sniffing
-- Postgres internals.
--
-- NOT enforced here, by design:
--   - "a Clinic_Scope_Assignment requires the `operations` Access_Level"
--     (Requirement 13.14) and "the `operations` / `franchises` groups are
--     unavailable alongside a scope" (Requirement 13.13). Both are cross-column
--     policy rules over admin_access_level and admin_operations_access, enforced
--     in createAdminUser / updateAdminUser per Requirement 13.15. Encoding them
--     as table constraints would freeze the access-level vocabulary in the
--     schema — the exact drift this file avoids.
--   - Re-assignment restrictions. Changing an Admin's scope is permitted and
--     leaves every previously stamped Shop_Order untouched (Requirement 13.18),
--     which the addon_orders stamp-immutability trigger guarantees separately.
--
-- Safety: The new column is nullable and references the already-existing
-- public.clinics(id). No existing data is dropped or altered; the trigger fires
-- only when a non-NULL assignment is written, so no current code path is
-- affected. Idempotent (re-runnable) via ADD COLUMN IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS / CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER.
--
-- RLS: This script does NOT enable or alter RLS on public.users, following the
-- established additive pattern.
--
-- ORDERING: This script MUST run AFTER:
--   - public.users exists with admin_access_level
--     (add-admin-access-level-to-users.sql)
--   - create-clinic-hierarchy-tables.sql (provides public.clinics with the
--     nullable franchise_id the guard trigger reads)
-- It is independent of the clinic overlay and ledger tables.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_users_admin_clinic_core_only ON public.users;
--   DROP FUNCTION IF EXISTS public.enforce_admin_clinic_is_core();
--   DROP INDEX IF EXISTS public.idx_users_admin_clinic;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS admin_clinic_id;
-- ============================================================================

-- ============================================================================
-- 1. USERS (existing) — Clinic_Scope_Assignment (Requirement 13.1)
-- ============================================================================
-- The foreign key delivers "references an existing Clinic row"; the guard
-- trigger below delivers the "whose franchise_id is NULL" half.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_clinic_id UUID REFERENCES public.clinics(id);

-- "Which admins are scoped to this clinic" — used when a clinic is inspected or
-- decommissioned. Partial index excludes the vast unscoped majority.
CREATE INDEX IF NOT EXISTS idx_users_admin_clinic
  ON public.users (admin_clinic_id)
  WHERE admin_clinic_id IS NOT NULL;

-- ============================================================================
-- 2. CORE-CLINIC-ONLY GUARD (Requirements 13.1, 13.12)
-- ============================================================================
-- Rejects an assignment pointing at a franchise Clinic. A non-existent clinic
-- id is left to the foreign key, which produces the referential error for it —
-- the trigger deliberately does not duplicate that check, so there is exactly
-- one source of truth per failure mode.

CREATE OR REPLACE FUNCTION public.enforce_admin_clinic_is_core()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_franchise_id UUID;
BEGIN
  SELECT c.franchise_id
    INTO v_franchise_id
    FROM public.clinics c
   WHERE c.id = NEW.admin_clinic_id;

  -- No such clinic: let the foreign key raise the referential error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_franchise_id IS NOT NULL THEN
    RAISE EXCEPTION
      'CLINIC_NOT_CORE: Clinic level access applies to Core Clinics only; clinic % belongs to franchise %.',
      NEW.admin_clinic_id, v_franchise_id;
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT OR UPDATE OF admin_clinic_id: on UPDATE the trigger fires only
-- when the column appears in the SET list, so unrelated user updates pay
-- nothing. The WHEN clause skips the NULL case (clearing an assignment is always
-- allowed) without needing to reference OLD, which an INSERT has no value for.
DROP TRIGGER IF EXISTS trg_users_admin_clinic_core_only ON public.users;
CREATE TRIGGER trg_users_admin_clinic_core_only
  BEFORE INSERT OR UPDATE OF admin_clinic_id ON public.users
  FOR EACH ROW
  WHEN (NEW.admin_clinic_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_admin_clinic_is_core();

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Every existing user stays
-- unscoped, so existing operations admins continue to see every clinic. A
-- Master Admin assigns a scope through the User_Management_Form.
-- ============================================================================
