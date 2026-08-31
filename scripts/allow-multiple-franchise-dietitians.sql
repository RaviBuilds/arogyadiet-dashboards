-- scripts/allow-multiple-franchise-dietitians.sql
--
-- Feature: franchise-scoped-access — Task 11.
--
-- TWO CHANGES, both scoped to FRANCHISE Dietitians only:
--
--   1. Allow MANY Dietitians per Franchise. The partial unique index
--      `users_one_active_dietitian_per_franchise` capped each Franchise at one
--      active Dietitian; a Franchise now needs a team.
--
--   2. Narrow a Franchise Dietitian's READ scope to the Customer_Records
--      explicitly assigned to them. Until now a Franchise Dietitian read their
--      whole tenant (`cp.franchise_id = d.franchise_id`). With one Dietitian per
--      Franchise that was equivalent to "their own customers"; with a team it
--      would mean every Dietitian sees every colleague's customers.
--
-- (2) is the same narrowing `restrict-dietitian-read-scope-to-assigned.sql`
-- already applied to CORE Dietitians, now extended to the franchise branch. The
-- tenant predicate is RETAINED alongside the link (defence in depth: a link that
-- somehow pointed across tenants still would not grant a cross-tenant read).
--
-- ─── CORE_BUSINESS IS DELIBERATELY UNTOUCHED ────────────────────────────────
-- The second disjunct — `(d.franchise_id IS NULL AND cp.dietitian_id =
-- d.user_id)` — is carried over BYTE-IDENTICAL from
-- `restrict-dietitian-read-scope-to-assigned.sql`. Core Dietitians sign in on
-- the ADMIN portal, so any change there would be an admin-dashboard behaviour
-- change, which this project explicitly forbids. A plain admin is not a
-- Dietitian at all: `current_dietitian()` returns no rows for them, so this
-- function is already false on their behalf and they read customers through
-- other policies entirely.
--
-- !! READ THIS BEFORE RUNNING — MEASURED DRIFT BETWEEN REPO AND DATABASE !!
-- The "byte-identical" claim above holds against the REPO FILE, not against the
-- database as observed. `restrict-dietitian-read-scope-to-assigned.sql` was
-- NEVER APPLIED to the live database. The deployed function body still carries a
-- third, clinic-based disjunct in its CORE branch:
--
--     OR (d.franchise_id IS NULL AND (
--           cp.dietitian_id = d.user_id
--           OR (d.clinic_id IS NOT NULL AND cp.clinic_id = d.clinic_id)
--         ))
--
-- So running THIS script also lands that earlier pending narrowing. Measured
-- exposure at the time of writing: 5 active Core Dietitians, all with a linked
-- Clinic, and 1854 (dietitian x customer) pairs readable ONLY via that clinic
-- disjunct — one Dietitian's raw-SQL visibility drops 417 -> 0.
--
-- That is nonetheless a NO-OP for observable Core_Business behaviour, for two
-- independent and separately verified reasons:
--
--   a. `customer_profiles` is read through the SSR (RLS-bearing) client, but
--      `guardDietitianCustomer` in `src/lib/auth/adminAccess.ts` then applies the
--      APPLICATION predicate `dietitianCanRead` to the returned row — an
--      INTERSECTION of both gates. List reads go through `applyDietitianScope`,
--      which appends `.eq(dietitian_id, <me>)`. Neither has a clinic disjunct
--      (see the REMOVED-`dietitianScopeOrFilter` note in
--      `src/lib/dietitian/scope.ts`), so the effective Core scope is ALREADY
--      assignment-only and the wider SQL disjunct is inert.
--   b. Every `health_logs` and `report_cards` read in the application uses
--      `createAdminClient()` (service role), which BYPASSES RLS entirely. The
--      policies on those tables therefore do not gate Dietitian access in the
--      app, and replacing this function cannot affect those paths.
--
-- Consequence for review: this script brings the DATABASE down to the narrower
-- scope the APPLICATION already enforces (defence in depth), rather than
-- changing what any Core Dietitian can see in the UI. Confirm (a) and (b) still
-- hold before running — if any Core read path is ever switched to the anon key
-- WITHOUT the application predicate, this stops being a no-op.
--
-- ─── BLAST RADIUS — REVIEW BEFORE RUNNING ───────────────────────────────────
-- `dietitian_can_read_customer` is referenced by live RLS policies in:
--   * create-dietitian-management-rls.sql
--       - dietitian_select_customer_profiles  ON public.customer_profiles
--       - health_logs_select / _insert / _update ON public.health_logs
--   * create-report-card-lifecycle.sql
--       - the report-card select / insert / update policies
-- Replacing the function in place updates every one of them automatically; no
-- policy DDL is required. That is also why this must be reviewed: a mistake here
-- changes what several tables expose.
--
-- NO BACKFILL IS PERFORMED. Assigning links is a deliberate operator action via
-- the Franchise_Portal Customer_360 dietitian selector
-- (`franchiseAssignCustomerDietitian`). Consequence: immediately after this runs,
-- a Franchise Dietitian sees ONLY customers already linked to them — an
-- unassigned customer is invisible to every Dietitian until assigned. This is
-- intended, and is safe here because the assignment UI shipped first.
--
-- Idempotent: safe to run more than once. Mirrors
-- `src/lib/dietitian/scope.ts` (`dietitianCanRead`) exactly — the two are
-- load-bearing together and MUST agree row for row.
--
-- ─── ROLLBACK ───────────────────────────────────────────────────────────────
-- To restore the previous behaviour (one Dietitian per Franchise, tenant-wide
-- franchise read scope), run:
--
--   CREATE UNIQUE INDEX IF NOT EXISTS users_one_active_dietitian_per_franchise
--     ON public.users (franchise_id)
--     WHERE admin_access_level = 'dietitian' AND is_active AND franchise_id IS NOT NULL;
--
--   -- then restore the function body AS IT WAS ACTUALLY DEPLOYED. Do NOT use
--   -- scripts/restrict-dietitian-read-scope-to-assigned.sql for this: that file
--   -- was never applied here, so it is NOT the previous state (see the MEASURED
--   -- DRIFT note above). The body read back from the live database was:
--   --
--   --   CREATE OR REPLACE FUNCTION public.dietitian_can_read_customer(p_profile_id uuid)
--   --   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
--   --     SELECT EXISTS (
--   --       SELECT 1
--   --       FROM public.current_dietitian() d
--   --       JOIN public.customer_profiles cp ON cp.id = p_profile_id
--   --       WHERE (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
--   --          OR (d.franchise_id IS NULL AND (
--   --                cp.dietitian_id = d.user_id
--   --                OR (d.clinic_id IS NOT NULL AND cp.clinic_id = d.clinic_id)
--   --              ))
--   --     )
--   --   $$;
--   --
--   -- Re-verify after rollback with:
--   --   SELECT pg_get_functiondef('public.dietitian_can_read_customer(uuid)'::regprocedure);
--
-- NOTE: recreating the index will FAIL if any Franchise has more than one active
-- Dietitian by then. Deactivate the extras first.
-- ============================================================================

-- ─── 1. Lift the one-Dietitian-per-Franchise cap ────────────────────────────
--
-- Core_Business rows were already excluded from this index (it is partial on
-- `franchise_id IS NOT NULL`), so dropping it cannot affect Core Dietitians.

DROP INDEX IF EXISTS public.users_one_active_dietitian_per_franchise;

-- `users_dietitian_mobile_check` and `idx_users_dietitian_clinic_id` are
-- intentionally left in place — neither has anything to do with cardinality.

-- ─── 2. Narrow the Franchise Dietitian read scope to the Dietitian_Link ─────

CREATE OR REPLACE FUNCTION public.dietitian_can_read_customer(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.current_dietitian() d
    JOIN public.customer_profiles cp ON cp.id = p_profile_id
    WHERE (d.franchise_id IS NOT NULL
             AND cp.franchise_id = d.franchise_id
             AND cp.dietitian_id = d.user_id)
       OR (d.franchise_id IS NULL AND cp.dietitian_id = d.user_id)
  )
$$;

COMMENT ON FUNCTION public.dietitian_can_read_customer(uuid) IS
  'True when the calling Dietitian may READ the given Customer_Record (Req 5.5, 5.6, 5.11). EVERY Dietitian — Core and Franchise alike — reads only their Dietitian_Link-assigned customers; a Franchise Dietitian must additionally match the tenant. Neither the linked Clinic nor the tenant alone widens the scope. Mirrors src/lib/dietitian/scope.ts exactly. Grants no write access of any kind (Req 5.10, 16.5).';

-- ============================================================================
-- DONE. After this script:
--   - a Franchise may have any number of active Dietitians
--   - each Franchise Dietitian reads only the Customer_Records assigned to them
--     within their own tenant
--   - Core_Business Dietitian scope is unchanged AS OBSERVED THROUGH THE APP.
--     At the DATABASE level the core branch does lose the clinic disjunct that
--     was still deployed here (see MEASURED DRIFT above); the application
--     already intersected it away, so no Core Dietitian's UI scope moves.
--   - no customer data was modified
-- ============================================================================
