-- ============================================================================
-- REPORT CARD LIFECYCLE — per-subscription / per-stay closable report cards
-- (SAFE: Additive only)
-- ============================================================================
-- Spec: report-card-lifecycle — Phase 1 of 4 (schema + attribution).
--
-- WHAT THIS SOLVES
-- Today the Report_Card is not an entity at all. `DietitianReportService`
-- assembles it on every request from `getHealthLogTimeline(customerProfileId)`,
-- which reads `v_health_log_timeline` filtered ONLY by customer with no date
-- window — so one document spans a customer's entire history across every
-- subscription and stay. There is nothing to close, nothing to lock, and no way
-- to say "this report covers subscription X".
--
-- This script introduces the missing entity:
--   1. public.report_cards — one row per MEAL/KIT subscription and per
--      accommodation stay. Carries the report-level Closing_Comment, the
--      ACTIVE → CLOSED lifecycle, and the finalisation audit fields.
--   2. public.v_report_card_editability — derives, per customer, which report
--      cards may still be written to: every ACTIVE one, plus the single
--      most-recently-CLOSED one (the reopen window). Expressed as a view so the
--      service layer and the UI cannot drift from each other.
--   3. public.health_logs.report_card_id — the owning report card for each log.
--   4. A backfill that attributes every existing Dietitian_Log to the
--      subscription/stay whose Logging_Window contains its `log_date`.
--
-- WHY A report_card_id FK RATHER THAN A DATE WINDOW
-- `healthReportRepository` already attributes logs to a subscription by date
-- window, and that is fine for a read-only customer-facing report. It is NOT
-- sufficient here: `health_logs_one_dietitian_log_per_day` allows only one
-- Dietitian_Log per customer per calendar day, so if two records' windows ever
-- touched, a log's owning record would be ambiguous and the lock rule
-- ("only the most recent closed report is editable") could not be evaluated.
-- One explicit FK makes the lock a single join and removes the ambiguity
-- permanently.
--
-- The no-overlap rule holds for ACTIVE records only. Confirmed with the product
-- owner AND verified against live data: at most one MEAL / KIT / stay record per
-- customer is ACTIVE at any time, and the next one starts only after the
-- previous moves to EXPIRED. Historical windows, however, DO overlap — live data
-- shows 10 customers with overlapping EXPIRED / CANCELLED / STOPPED
-- subscriptions (same start date, or one contained inside another), most likely
-- from test data or cancelled-and-rebooked flows.
--
-- The overlaps come from BACKDATED creation, not from concurrency. Live data
-- shows one bulk import on 2026-07-03 that created 84 subscriptions, 82 of them
-- backdated by up to 568 days, so a plan created in July can retroactively cover
-- a period that a different, already-expired plan actually served.
--
-- This matters only for the backfill. Going forward, attribution never uses
-- dates at all: the write path takes the report card of the ACTIVE governing
-- record from `getGoverningRecords`, so there is exactly one candidate by
-- construction. For historical rows, section 4c attributes each log to the
-- record that ALREADY EXISTED when the log was written — a Dietitian can only
-- have been logging against something that existed at the time — which today
-- affects zero logs (verified: all 4 existing Dietitian_Logs resolve to exactly
-- one candidate record).
--
-- MULTIPLE ACTIVE REPORT CARDS ARE LEGAL — deliberately no unique constraint on
-- (customer_profile_id) WHERE status = 'ACTIVE'. A Dietitian may leave an old
-- subscription's report unfinished while the customer's next subscription is
-- already running; both report cards stay ACTIVE so the old one can still be
-- completed. Uniqueness is enforced per SUBJECT (one report card per
-- subscription, one per stay), which is the real invariant.
--
-- ACCOMMODATION: the subject is the STAY, not the subscription. A
-- Stay_Extension prolongs the same `stay_entries` row, so extended nights fold
-- into the same report card automatically — no new row, no window surgery
-- beyond refreshing `window_end`.
--
-- Backfill status: every backfilled report card is created ACTIVE with a NULL
-- Closing_Comment, including those for long-expired subscriptions. That is
-- accurate rather than convenient — nothing has ever been finalised because the
-- capability did not exist. It also matches the intended behaviour that a
-- Dietitian can go back and finish an old, unfinished report.
--
-- RLS: enabled on report_cards, following the health_logs precedent exactly —
-- SELECT/INSERT/UPDATE granted, NO DELETE grant and NO DELETE policy, so a
-- report card can never be destroyed. Server Actions use the service-role
-- client with admin/dietitian authorisation enforced in the action layer.
--
-- ORDERING: This script MUST run AFTER:
--   - create-dietitian-management.sql      (public.health_logs)
--   - create-dietitian-management-rls.sql  (is_global_role, current_app_user_id,
--                                           dietitian_can_read_customer)
--   - create-accommodation-tables.sql      (public.stay_entries)
--   - public.subscriptions, public.customer_profiles, public.users exist
--
-- Safety: one new table, one new view, one additive nullable column, one
-- backfill of a column that is NULL everywhere beforehand. No table dropped, no
-- column removed, no pre-existing column rewritten. Idempotent via CREATE TABLE
-- / ADD COLUMN / CREATE INDEX IF NOT EXISTS, DO-guarded ADD CONSTRAINT, and
-- CREATE OR REPLACE VIEW. The backfill is re-runnable: it only ever fills rows
-- whose report_card_id IS NULL, and get-or-create is keyed on the unique
-- subject indexes.
--
-- Rollback:
--   ALTER TABLE public.health_logs DROP COLUMN IF EXISTS report_card_id;
--   DROP VIEW IF EXISTS public.v_report_card_editability;
--   DROP TABLE IF EXISTS public.report_cards;
--   DROP FUNCTION IF EXISTS public.update_report_cards_updated_at();
-- ============================================================================

-- ============================================================================
-- 1. REPORT_CARDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL
    REFERENCES public.customer_profiles(id) ON DELETE CASCADE,

  -- Which kind of record this report covers. MEAL/KIT report on a
  -- subscription; ACCOMMODATION reports on a stay.
  subject_type TEXT NOT NULL CHECK (subject_type IN ('SUBSCRIPTION', 'STAY')),
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  stay_entry_id UUID REFERENCES public.stay_entries(id) ON DELETE CASCADE,

  -- Denormalised for convenience in the Dietitian UI; the authoritative value
  -- remains on the subscription / customer_profiles row.
  customer_category TEXT NOT NULL
    CHECK (customer_category IN ('MEAL', 'KIT', 'ACCOMMODATION')),

  -- Logging_Window snapshot. Refreshed while ACTIVE (a Stay_Extension moves
  -- window_end); frozen at finalisation so a closed report always states the
  -- period it actually covered.
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,

  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),

  -- The REPORT-level Closing_Comment the Dietitian writes when finalising.
  -- Distinct from health_logs.closing_comment, which is a mandatory per-day
  -- note on every individual log.
  report_closing_comment TEXT
    CHECK (report_closing_comment IS NULL
           OR char_length(report_closing_comment) BETWEEN 1 AND 4000),

  finalised_at TIMESTAMPTZ,
  finalised_by UUID REFERENCES public.users(id),

  -- Reopen audit. The most-recently-closed report may be reopened and re-closed
  -- any number of times while it holds that position.
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  last_reopened_at TIMESTAMPTZ,
  last_reopened_by UUID REFERENCES public.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one subject FK is set, matching subject_type. DO-guarded: Postgres
-- has no ADD CONSTRAINT IF NOT EXISTS for CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_report_card_single_subject'
       AND conrelid = 'public.report_cards'::regclass
  ) THEN
    ALTER TABLE public.report_cards
      ADD CONSTRAINT chk_report_card_single_subject
      CHECK (
        (subject_type = 'SUBSCRIPTION'
           AND subscription_id IS NOT NULL AND stay_entry_id IS NULL)
        OR
        (subject_type = 'STAY'
           AND stay_entry_id IS NOT NULL AND subscription_id IS NULL)
      );
  END IF;
END $$;

-- A CLOSED report must carry its Closing_Comment and finalisation stamp; an
-- ACTIVE one must not claim to be finalised. This makes "closed" a meaningful
-- state at the database level rather than a bare string.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_report_card_closed_shape'
       AND conrelid = 'public.report_cards'::regclass
  ) THEN
    ALTER TABLE public.report_cards
      ADD CONSTRAINT chk_report_card_closed_shape
      CHECK (
        (status = 'CLOSED'
           AND report_closing_comment IS NOT NULL
           AND finalised_at IS NOT NULL)
        OR
        (status = 'ACTIVE' AND finalised_at IS NULL)
      );
  END IF;
END $$;

-- The real uniqueness invariant: at most ONE report card per subject.
-- Partial indexes so the unused FK column's NULLs never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_card_per_subscription
  ON public.report_cards(subscription_id)
  WHERE subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_card_per_stay
  ON public.report_cards(stay_entry_id)
  WHERE stay_entry_id IS NOT NULL;

-- Customer's report history, newest first — the "all subscriptions / stays"
-- list and the most-recently-closed lookup both read this order.
CREATE INDEX IF NOT EXISTS idx_report_cards_customer
  ON public.report_cards(customer_profile_id, created_at DESC);

-- Supports the editability view's per-customer "latest CLOSED" scan.
CREATE INDEX IF NOT EXISTS idx_report_cards_customer_closed
  ON public.report_cards(customer_profile_id, finalised_at DESC)
  WHERE status = 'CLOSED';

CREATE OR REPLACE FUNCTION public.update_report_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_cards_updated_at ON public.report_cards;
CREATE TRIGGER trg_report_cards_updated_at
  BEFORE UPDATE ON public.report_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_report_cards_updated_at();

COMMENT ON TABLE public.report_cards IS
  'One closable Report_Card per MEAL/KIT subscription and per accommodation stay. Holds the report-level Closing_Comment and the ACTIVE -> CLOSED lifecycle. Multiple ACTIVE rows per customer are legal: an unfinished older report coexists with the current one. Never deletable (no DELETE grant or policy).';

-- ============================================================================
-- 2. EDITABILITY READ MODEL — public.v_report_card_editability
-- ============================================================================
-- Which report cards may still be written to, per customer:
--   - every ACTIVE report card, and
--   - the SINGLE most-recently-CLOSED one (the reopen window).
-- Every older CLOSED report is permanently locked for everyone, including
-- MASTER_ADMIN. Closing the current report shifts the window forward: the newly
-- closed report becomes reopenable and the previous one locks for good.
--
-- Tie-break on `id DESC` after `finalised_at DESC` so the result is
-- deterministic even if two reports somehow share a finalisation timestamp.
--
-- A view rather than duplicated logic in TypeScript: the write gate in
-- HealthLogService, the finalise/reopen actions and the UI all read the same
-- derivation, so they cannot disagree about what is locked.

CREATE OR REPLACE VIEW public.v_report_card_editability
WITH (security_invoker = true) AS
SELECT
  rc.id                  AS report_card_id,
  rc.customer_profile_id AS customer_profile_id,
  rc.status              AS status,
  rc.finalised_at        AS finalised_at,
  (
    rc.status = 'ACTIVE'
    OR rc.id = (
      SELECT latest.id
        FROM public.report_cards latest
       WHERE latest.customer_profile_id = rc.customer_profile_id
         AND latest.status = 'CLOSED'
       ORDER BY latest.finalised_at DESC, latest.id DESC
       LIMIT 1
    )
  )                      AS is_editable,
  -- True only for the one CLOSED report that may be reopened. Drives the
  -- "Reopen" affordance without the UI re-deriving the rule.
  (
    rc.status = 'CLOSED'
    AND rc.id = (
      SELECT latest.id
        FROM public.report_cards latest
       WHERE latest.customer_profile_id = rc.customer_profile_id
         AND latest.status = 'CLOSED'
       ORDER BY latest.finalised_at DESC, latest.id DESC
       LIMIT 1
    )
  )                      AS is_reopenable
FROM public.report_cards rc;

COMMENT ON VIEW public.v_report_card_editability IS
  'Per report card: is_editable (ACTIVE, or the single most-recently-CLOSED report) and is_reopenable (that most-recently-CLOSED report only). Every older CLOSED report is permanently locked. Single source of truth for the lock rule.';

GRANT SELECT ON public.v_report_card_editability TO authenticated, service_role;

-- ============================================================================
-- 3. HEALTH_LOGS -> REPORT_CARDS LINKAGE
-- ============================================================================
-- Nullable: a log that cannot be attributed to any Logging_Window (e.g. one
-- recorded outside every subscription/stay period) keeps NULL and is simply not
-- part of any report. ON DELETE SET NULL mirrors health_log_audit_entries'
-- treatment of health_log_id — the log itself is never destroyed.

ALTER TABLE public.health_logs
  ADD COLUMN IF NOT EXISTS report_card_id UUID
    REFERENCES public.report_cards(id) ON DELETE SET NULL;

-- The lock check and the per-report timeline both filter by this column.
CREATE INDEX IF NOT EXISTS idx_health_logs_report_card
  ON public.health_logs(report_card_id, log_date);

COMMENT ON COLUMN public.health_logs.report_card_id IS
  'The Report_Card whose Logging_Window contains this log. NULL for a log that falls outside every subscription/stay window. Editability of the log is gated on this report card via v_report_card_editability.';

-- ============================================================================
-- 4. BACKFILL
-- ============================================================================
-- Creates a report card for every existing subject, then attributes every
-- Dietitian_Log to the one whose window contains its log_date.
--
-- The window formulas below are transcribed from
-- `src/repositories/dietitian/cadenceRepository.ts` (getGoverningRecords) so
-- the backfilled windows match what the application computes:
--   MEAL          starts_on                            -> effective_end_on ?? ends_on ?? starts_on
--   KIT           kit_received_date ?? starts_on        -> kit_tracker_end_date ?? effective_end_on ?? ends_on ?? window_start
--   ACCOMMODATION stay.start_date                       -> start_date + total_nights - 1
--
-- Re-runnable: the INSERTs skip subjects that already have a report card (via
-- the unique subject indexes + NOT EXISTS), and the UPDATE only ever fills
-- health_logs rows whose report_card_id IS NULL.

-- 4a. Report cards for MEAL / KIT subscriptions.
INSERT INTO public.report_cards (
  customer_profile_id, subject_type, subscription_id, customer_category,
  window_start, window_end, status
)
SELECT
  s.customer_profile_id,
  'SUBSCRIPTION',
  s.id,
  s.customer_category,
  CASE WHEN s.customer_category = 'KIT'
       THEN COALESCE(s.kit_received_date, s.starts_on)
       ELSE s.starts_on
  END AS window_start,
  CASE WHEN s.customer_category = 'KIT'
       THEN COALESCE(s.kit_tracker_end_date, s.effective_end_on, s.ends_on,
                     COALESCE(s.kit_received_date, s.starts_on))
       ELSE COALESCE(s.effective_end_on, s.ends_on, s.starts_on)
  END AS window_end,
  'ACTIVE'
FROM public.subscriptions s
WHERE s.customer_category IN ('MEAL', 'KIT')
  -- A record with no resolvable window start has no Logging_Window and
  -- therefore no slots; skip it rather than inventing dates.
  --
  -- NOTE the KIT branch: an ACTIVE KIT subscription legitimately carries
  -- starts_on = NULL and ends_on = NULL until the customer confirms receipt, so
  -- its window exists only via kit_received_date. Filtering on `starts_on IS NOT
  -- NULL` here would silently drop live KIT plans.
  AND (CASE WHEN s.customer_category = 'KIT'
            THEN COALESCE(s.kit_received_date, s.starts_on)
            ELSE s.starts_on
       END) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.report_cards rc WHERE rc.subscription_id = s.id
  );

-- 4b. Report cards for accommodation stays.
INSERT INTO public.report_cards (
  customer_profile_id, subject_type, stay_entry_id, customer_category,
  window_start, window_end, status
)
SELECT
  se.customer_profile_id,
  'STAY',
  se.id,
  'ACCOMMODATION',
  se.start_date,
  (se.start_date + (se.total_nights - 1) * INTERVAL '1 day')::date,
  'ACTIVE'
FROM public.stay_entries se
WHERE se.start_date IS NOT NULL
  AND se.total_nights IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.report_cards rc WHERE rc.stay_entry_id = se.id
  );

-- 4c. Attribute existing Dietitian_Logs to the report card whose window
-- contains the log_date.
--
-- No two ACTIVE records per customer ever overlap (verified: 11 overlapping
-- pairs exist in live data, none of them ACTIVE-vs-ACTIVE), but BACKDATED
-- records do overlap already-finished ones, so a log inside an overlap needs a
-- deterministic winner.
--
-- Preference order — "the record that was actually in force when the Dietitian
-- wrote the log":
--   1. The record that ALREADY EXISTED when the log was written, i.e. its
--      created_at (IST) is on or before the log's submission_date_ist. A
--      Dietitian can only have been logging against a subscription/stay that
--      existed at the time; a record backdated into that period months later
--      was never on screen.
--   2. Then the ACTIVE record, for the case where several candidates all
--      already existed.
--   3. Then the record that STARTED most recently while still containing the
--      log — the one most plausibly in effect that day.
--   4. Then the most recently created record, purely for determinism.
--
-- Worked example from live data (customer 1d3a82da-…):
--   SUB-MNWRH5  20 days  28 May → 16 Jun 2026  EXPIRED  created 27 May 2026
--   SUB-7EUHE2  90 days  19 May → 16 Aug 2026  ACTIVE   created  3 Jul 2026 (backdated 45d)
-- Their windows overlap 28 May – 16 Jun. A log dated 5 June goes to
-- SUB-MNWRH5: it is the only one of the two that existed on 5 June. Rule 1
-- decides it; an ACTIVE-first rule would have wrongly chosen SUB-7EUHE2.
--
-- Rules 2-4 currently decide nothing — all 4 existing Dietitian_Logs resolve to
-- exactly one candidate. Anything left unattributed keeps NULL and simply
-- belongs to no report; the verification query at the foot of this script
-- reports that count.
--
-- Going forward this heuristic is never used: the write path attributes a log
-- to the report card of the ACTIVE governing record from `getGoverningRecords`,
-- so there is exactly one candidate by construction.
UPDATE public.health_logs hl
   SET report_card_id = (
         SELECT rc.id
           FROM public.report_cards rc
           LEFT JOIN public.subscriptions s ON s.id = rc.subscription_id
           LEFT JOIN public.stay_entries se ON se.id = rc.stay_entry_id
          WHERE rc.customer_profile_id = hl.customer_profile_id
            AND hl.log_date BETWEEN rc.window_start AND rc.window_end
          ORDER BY
            -- 1. Existed when the log was written.
            CASE
              WHEN (COALESCE(s.created_at, se.created_at)
                      AT TIME ZONE 'Asia/Kolkata')::date <= hl.submission_date_ist
              THEN 0 ELSE 1
            END,
            -- 2. ACTIVE.
            CASE WHEN COALESCE(s.status, se.status) = 'ACTIVE' THEN 0 ELSE 1 END,
            -- 3. Started most recently.
            rc.window_start DESC,
            -- 4. Created most recently (determinism).
            COALESCE(s.created_at, se.created_at) DESC
          LIMIT 1
       )
 WHERE hl.report_card_id IS NULL;

-- ============================================================================
-- 5. RLS — mirrors public.health_logs exactly (no DELETE, ever)
-- ============================================================================

ALTER TABLE public.report_cards ENABLE ROW LEVEL SECURITY;

-- Supabase does not auto-grant tables created via raw SQL; RLS only decides
-- WHICH rows are visible, so without a base GRANT every query fails with 42501.
GRANT SELECT, INSERT, UPDATE ON public.report_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.report_cards TO service_role;

DROP POLICY IF EXISTS report_cards_select ON public.report_cards;
CREATE POLICY report_cards_select
  ON public.report_cards FOR SELECT
  USING (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  );

DROP POLICY IF EXISTS report_cards_insert ON public.report_cards;
CREATE POLICY report_cards_insert
  ON public.report_cards FOR INSERT
  WITH CHECK (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  );

-- The finalise / reopen / window-refresh path. The lock rule itself
-- (only the most-recently-closed report may be reopened) is enforced in
-- ReportCardService against v_report_card_editability — this policy only makes
-- sure a write cannot move a report card out of the caller's scope.
DROP POLICY IF EXISTS report_cards_update ON public.report_cards;
CREATE POLICY report_cards_update
  ON public.report_cards FOR UPDATE
  USING (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  )
  WITH CHECK (
    is_global_role()
    OR public.dietitian_can_read_customer(customer_profile_id)
  );

-- NOTE: No DELETE policy is created for report_cards, by design, and no DELETE
-- is granted. With RLS enabled and no matching policy Postgres denies every
-- DELETE from every non-superuser role. A Report_Card is never deletable —
-- mirroring health_logs (Req 18.4). Do not add one.

-- ============================================================================
-- DONE.
-- public.report_cards is the closable per-subscription / per-stay Report_Card
-- entity. public.v_report_card_editability is the ONLY place the lock rule is
-- expressed. public.health_logs.report_card_id attributes each log to its
-- report. Nothing is finalised by this script — every backfilled report card is
-- ACTIVE, so a Dietitian can still complete historical reports.
--
-- Phase 2 (read path), Phase 3 (finalise / reopen / slot lock) and Phase 4
-- (final report rendering) build on this without further schema changes.
-- Run only AFTER create-dietitian-management.sql,
-- create-dietitian-management-rls.sql and create-accommodation-tables.sql.
--
-- ---------------------------------------------------------------------------
-- VERIFICATION (safe to run separately; expected values from the pre-flight
-- dry run against production on 2026-08-04)
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM public.report_cards)                                   AS report_cards,        -- expect 236
--   (SELECT count(*) FROM public.report_cards WHERE subject_type='SUBSCRIPTION') AS subscription_cards,  -- expect 199
--   (SELECT count(*) FROM public.report_cards WHERE subject_type='STAY')         AS stay_cards,          -- expect 37
--   (SELECT count(*) FROM public.report_cards WHERE status <> 'ACTIVE')          AS non_active,          -- expect 0
--   (SELECT count(*) FROM public.health_logs
--      WHERE author_type='DIETITIAN' AND report_card_id IS NOT NULL)             AS logs_attached,       -- expect 4
--   (SELECT count(*) FROM public.health_logs
--      WHERE author_type='DIETITIAN' AND report_card_id IS NULL)                 AS logs_unattached;     -- expect 0
--
-- Every report card must be editable immediately after the backfill, since all
-- are ACTIVE and none is CLOSED:
-- SELECT count(*) FILTER (WHERE is_editable) AS editable,
--        count(*) FILTER (WHERE is_reopenable) AS reopenable   -- expect 0
--   FROM public.v_report_card_editability;
-- ============================================================================
