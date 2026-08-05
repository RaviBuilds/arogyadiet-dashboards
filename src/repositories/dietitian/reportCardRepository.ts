// src/repositories/dietitian/reportCardRepository.ts
// Data-access layer for the Report_Card lifecycle: `report_cards` plus the
// `v_report_card_editability` read model.
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// `src/services/ReportCardService.ts`) and no `'use server'` wrappers (those
// live in `src/actions/dietitian-actions/*`). Uses the service-role admin
// client, mirroring `healthLogRepository.ts`.
//
// THE LOCK RULE IS NOT RE-IMPLEMENTED HERE. `is_editable` / `is_reopenable`
// are always READ from `v_report_card_editability`, never derived in
// TypeScript — the view is the single source of truth (see
// scripts/create-report-card-lifecycle.sql). Every read that a caller might
// gate a write on therefore joins the view rather than inspecting `status`.
//
// Requirements: report-card-lifecycle Phase 2 (read path).

import { isRetrospectiveReport } from "@/lib/dietitian/reportCardLifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CustomerCategory,
  ReportCard,
  ReportCardStatus,
  ReportCardSubjectType,
  ReportCardWithEditability,
} from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a `report_cards` row in the database (snake_case). */
export interface ReportCardRow {
  id: string;
  customer_profile_id: string;
  subject_type: ReportCardSubjectType;
  subscription_id: string | null;
  stay_entry_id: string | null;
  customer_category: CustomerCategory;
  window_start: string;
  window_end: string;
  status: ReportCardStatus;
  report_closing_comment: string | null;
  finalised_at: string | null;
  finalised_by: string | null;
  reopen_count: number;
  last_reopened_at: string | null;
  last_reopened_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for {@link ensureReportCardForSubject}. */
export interface EnsureReportCardInput {
  customerProfileId: string;
  subjectType: ReportCardSubjectType;
  /** Set iff `subjectType === "SUBSCRIPTION"`. */
  subscriptionId: string | null;
  /** Set iff `subjectType === "STAY"`. */
  stayEntryId: string | null;
  category: CustomerCategory;
  windowStart: string;
  windowEnd: string;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const REPORT_CARD_COLUMNS =
  "id, customer_profile_id, subject_type, subscription_id, stay_entry_id, customer_category, window_start, window_end, status, report_closing_comment, finalised_at, finalised_by, reopen_count, last_reopened_at, last_reopened_by, created_at, updated_at";

/** Postgres SQLSTATE for a unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapRow(row: ReportCardRow): ReportCard {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    subjectType: row.subject_type,
    subscriptionId: row.subscription_id,
    stayEntryId: row.stay_entry_id,
    category: row.customer_category,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    status: row.status,
    reportClosingComment: row.report_closing_comment,
    finalisedAt: row.finalised_at,
    finalisedBy: row.finalised_by,
    reopenCount: row.reopen_count,
    lastReopenedAt: row.last_reopened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Derived here, in the one mapper every read goes through, so no caller can
    // hold a Report_Card whose classification disagrees with another's.
    isRetrospective: isRetrospectiveReport({
      windowEnd: row.window_end,
      createdAt: row.created_at,
    }),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every Report_Card for a customer, newest first, each carrying its derived
 * `isEditable` / `isReopenable` flags from `v_report_card_editability`.
 *
 * This is the "all subscriptions / stays" list behind the Dietitian's report
 * history: it spans every MEAL/KIT subscription and every stay the customer has
 * ever had, including ones whose report is still unfinished. Ordered by
 * `window_start` descending so the current period leads and older periods
 * follow, which is how the history reads on screen.
 */
export async function listReportCardsForCustomer(
  customerProfileId: string,
): Promise<ReportCardWithEditability[]> {
  const admin = createAdminClient();

  const [cardsResult, editabilityResult] = await Promise.all([
    admin
      .from("report_cards")
      .select(REPORT_CARD_COLUMNS)
      .eq("customer_profile_id", customerProfileId)
      .order("window_start", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("v_report_card_editability")
      .select("report_card_id, is_editable, is_reopenable")
      .eq("customer_profile_id", customerProfileId),
  ]);

  if (cardsResult.error) {
    throw new Error(
      `Failed to list report cards for customer ${customerProfileId}: ${cardsResult.error.message}`,
    );
  }
  if (editabilityResult.error) {
    throw new Error(
      `Failed to read report card editability for customer ${customerProfileId}: ${editabilityResult.error.message}`,
    );
  }

  const flags = new Map<string, { is_editable: boolean; is_reopenable: boolean }>();
  for (const row of (editabilityResult.data ?? []) as Array<{
    report_card_id: string;
    is_editable: boolean;
    is_reopenable: boolean;
  }>) {
    flags.set(row.report_card_id, row);
  }

  return ((cardsResult.data ?? []) as unknown as ReportCardRow[]).map((row) => {
    const flag = flags.get(row.id);
    return {
      ...mapRow(row),
      // Absent from the view only if the row vanished between the two reads;
      // default to NOT editable so a race can never open a write window.
      isEditable: flag?.is_editable ?? false,
      isReopenable: flag?.is_reopenable ?? false,
    };
  });
}

/**
 * One Report_Card by id, with its derived lock flags. Returns `null` when no
 * such report card exists.
 *
 * This is the read the write gate uses: callers check `isEditable` rather than
 * inspecting `status`, so a CLOSED-but-reopenable report is handled correctly
 * without duplicating the rule.
 */
export async function getReportCardById(
  reportCardId: string,
): Promise<ReportCardWithEditability | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("report_cards")
    .select(REPORT_CARD_COLUMNS)
    .eq("id", reportCardId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get report card ${reportCardId}: ${error.message}`,
    );
  }
  if (!data) return null;

  const { data: flagData, error: flagError } = await admin
    .from("v_report_card_editability")
    .select("is_editable, is_reopenable")
    .eq("report_card_id", reportCardId)
    .maybeSingle();

  if (flagError) {
    throw new Error(
      `Failed to read editability for report card ${reportCardId}: ${flagError.message}`,
    );
  }

  return {
    ...mapRow(data as unknown as ReportCardRow),
    isEditable: (flagData as { is_editable: boolean } | null)?.is_editable ?? false,
    isReopenable:
      (flagData as { is_reopenable: boolean } | null)?.is_reopenable ?? false,
  };
}

/**
 * The Report_Card covering a given subject, or `null` when none exists yet.
 * Keyed on the partial unique indexes `uniq_report_card_per_subscription` /
 * `uniq_report_card_per_stay`, so there is at most one match.
 */
export async function getReportCardForSubject(
  subjectType: ReportCardSubjectType,
  subjectId: string,
): Promise<ReportCard | null> {
  const admin = createAdminClient();

  const column =
    subjectType === "SUBSCRIPTION" ? "subscription_id" : "stay_entry_id";

  const { data, error } = await admin
    .from("report_cards")
    .select(REPORT_CARD_COLUMNS)
    .eq(column, subjectId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get report card for ${subjectType.toLowerCase()} ${subjectId}: ${error.message}`,
    );
  }

  return data ? mapRow(data as unknown as ReportCardRow) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Get-or-create the Report_Card for a subject, and keep its Logging_Window in
 * step while the report is still ACTIVE.
 *
 * Called on the write path before a Health_Log is persisted, so a log always
 * has a report card to belong to. Two behaviours worth naming:
 *
 * - **Window refresh.** An ACTIVE report card's window is updated whenever the
 *   subject's window has moved — a Stay_Extension adds nights, and a MEAL
 *   pause pushes `effective_end_on` out. A CLOSED report card is never touched:
 *   its window is frozen at finalisation so a closed report always states the
 *   period it actually covered.
 * - **Concurrent creation.** The partial unique indexes make a double INSERT
 *   raise 23505; that is caught and resolved by re-reading, so two
 *   simultaneous first-log submissions still converge on one report card.
 *   Mirrors `upsertHealthLog`'s check-then-write retry.
 */
export async function ensureReportCardForSubject(
  input: EnsureReportCardInput,
): Promise<ReportCard> {
  const subjectId =
    input.subjectType === "SUBSCRIPTION" ? input.subscriptionId : input.stayEntryId;

  if (!subjectId) {
    throw new Error(
      `ensureReportCardForSubject requires ${
        input.subjectType === "SUBSCRIPTION" ? "subscriptionId" : "stayEntryId"
      } for subjectType ${input.subjectType}`,
    );
  }

  const existing = await getReportCardForSubject(input.subjectType, subjectId);

  if (existing) {
    const windowMoved =
      existing.windowStart !== input.windowStart ||
      existing.windowEnd !== input.windowEnd;

    // Only an ACTIVE report tracks its subject; a CLOSED one stays frozen.
    if (existing.status === "ACTIVE" && windowMoved) {
      return refreshReportCardWindow(
        existing.id,
        input.windowStart,
        input.windowEnd,
      );
    }
    return existing;
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("report_cards")
    .insert({
      customer_profile_id: input.customerProfileId,
      subject_type: input.subjectType,
      subscription_id: input.subscriptionId,
      stay_entry_id: input.stayEntryId,
      customer_category: input.category,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      status: "ACTIVE",
    })
    .select(REPORT_CARD_COLUMNS)
    .single();

  if (error) {
    // A concurrent writer won the race — re-read rather than fail.
    if (error.code === PG_UNIQUE_VIOLATION) {
      const raced = await getReportCardForSubject(input.subjectType, subjectId);
      if (raced) return raced;
    }
    throw new Error(
      `Failed to create report card for ${input.subjectType.toLowerCase()} ${subjectId}: ${error.message}`,
    );
  }

  return mapRow(data as unknown as ReportCardRow);
}

/**
 * Update an ACTIVE Report_Card's Logging_Window snapshot. Guarded on
 * `status = 'ACTIVE'` in the statement itself, so a concurrent finalisation
 * cannot have its frozen window overwritten.
 */
export async function refreshReportCardWindow(
  reportCardId: string,
  windowStart: string,
  windowEnd: string,
): Promise<ReportCard> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("report_cards")
    .update({ window_start: windowStart, window_end: windowEnd })
    .eq("id", reportCardId)
    .eq("status", "ACTIVE")
    .select(REPORT_CARD_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to refresh window for report card ${reportCardId}: ${error.message}`,
    );
  }

  if (!data) {
    // The report closed between the read and this write; return its current
    // state rather than inventing one.
    const current = await getReportCardById(reportCardId);
    if (!current) {
      throw new Error(`Report card ${reportCardId} no longer exists`);
    }
    return current;
  }

  return mapRow(data as unknown as ReportCardRow);
}

/**
 * Close a Report_Card: stamp its Closing_Comment, `finalised_at` and
 * `finalised_by`.
 *
 * Guarded on `status = 'ACTIVE'` in the statement itself, so two concurrent
 * finalisations cannot both succeed — the loser matches no row and gets
 * `null` back, which the service maps to "already closed". The window is
 * deliberately NOT touched here: whatever it holds at this moment becomes the
 * frozen period the closed report reports on.
 *
 * `chk_report_card_closed_shape` enforces at the database level that a CLOSED
 * row carries both a comment and a timestamp, so a partial close is impossible
 * even through a direct SQL write.
 */
export async function finaliseReportCard(
  reportCardId: string,
  closingComment: string,
  finalisedBy: string | null,
): Promise<ReportCard | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("report_cards")
    .update({
      status: "CLOSED",
      report_closing_comment: closingComment,
      finalised_at: new Date().toISOString(),
      finalised_by: finalisedBy,
    })
    .eq("id", reportCardId)
    .eq("status", "ACTIVE")
    .select(REPORT_CARD_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to finalise report card ${reportCardId}: ${error.message}`,
    );
  }

  return data ? mapRow(data as unknown as ReportCardRow) : null;
}

/**
 * Reopen a closed Report_Card, returning it to ACTIVE so its logs become
 * writable again.
 *
 * Guarded on `status = 'CLOSED'`, so a concurrent reopen cannot double-count
 * `reopen_count`. Whether this PARTICULAR report is allowed to reopen (only the
 * most recently closed one is) is decided by the service against
 * `v_report_card_editability` — that rule lives in exactly one place and is not
 * duplicated here.
 *
 * `finalised_at` must be cleared because `chk_report_card_closed_shape` requires
 * an ACTIVE row to have none. The Closing_Comment is deliberately KEPT: the
 * Dietitian is editing an existing report, so their previous comment should be
 * there to amend rather than retype.
 */
export async function reopenReportCard(
  reportCardId: string,
  reopenedBy: string | null,
  currentReopenCount: number,
): Promise<ReportCard | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("report_cards")
    .update({
      status: "ACTIVE",
      finalised_at: null,
      reopen_count: currentReopenCount + 1,
      last_reopened_at: new Date().toISOString(),
      last_reopened_by: reopenedBy,
    })
    .eq("id", reportCardId)
    .eq("status", "CLOSED")
    .select(REPORT_CARD_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to reopen report card ${reportCardId}: ${error.message}`,
    );
  }

  return data ? mapRow(data as unknown as ReportCardRow) : null;
}

/**
 * Attach a Health_Log to its Report_Card. Separate from `upsertHealthLog` so
 * the linkage can be applied to an existing log without touching its content —
 * used when a log predates its report card (legacy rows the Phase 1 backfill
 * could not resolve, and any log written before this feature shipped).
 */
export async function attachHealthLogToReportCard(
  healthLogId: string,
  reportCardId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("health_logs")
    .update({ report_card_id: reportCardId })
    .eq("id", healthLogId);

  if (error) {
    throw new Error(
      `Failed to attach health log ${healthLogId} to report card ${reportCardId}: ${error.message}`,
    );
  }
}
