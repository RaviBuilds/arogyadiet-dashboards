// src/services/ReportCardService.ts
// Feature: report-card-lifecycle — Phase 2 (read path).
//
// Resolves the Report_Card history for one Customer_Record and the per-report
// slot/log view the Dietitian works in. This is the layer that turns "one
// endless customer-wide report" into "one closable report per subscription or
// stay".
//
// LAYERING: Business logic / orchestration only, mirroring `CadenceService` and
// `DietitianLogWorkspaceService`. No `'use server'` wrapper here — those live in
// `src/actions/dietitian-actions/*`, which own scope checks. This module never
// reads `next/headers` or a session.
//
// THE LOCK RULE IS NEVER RE-DERIVED HERE. `isEditable` / `isReopenable` always
// come from `v_report_card_editability` via `reportCardRepository`, which is the
// single source of truth (see scripts/create-report-card-lifecycle.sql). This
// module reads those flags; it never inspects `status` to decide writability.
//
// RECONCILIATION ON READ: the Phase 1 backfill created a Report_Card for every
// subscription and stay that existed when it ran. Anything created afterwards by
// a code path that predates Phase 3 has no report card yet, so
// `getReportCardHistory` reconciles as it reads — every Logging_Window without a
// report card gets one. That keeps the history complete without requiring the
// write path to have been updated first, and makes the two phases independently
// deployable.

import { getISTDateString } from "@/lib/dates/ist";
import {
  ONLY_LATEST_REPORT_CAN_REOPEN,
  REPORT_ALREADY_CLOSED,
  REPORT_CLOSING_COMMENT_REQUIRED,
  REPORT_HAS_NO_SLOTS,
  REPORT_HAS_UNLOGGED_SLOTS,
  REPORT_NOT_CLOSED,
} from "@/lib/dietitian/messages";
import {
  buildLogSlots,
  slotDates,
  type LogSlot,
} from "@/lib/dietitian/logSlots";
import {
  getGoverningRecords,
  getNonEligibleDatesSince,
  listLoggingWindowsForCustomer,
  type GoverningRecord,
} from "@/repositories/dietitian/cadenceRepository";
import {
  getHealthLogTimelineForWindow,
  type TimelineRow,
} from "@/repositories/dietitian/healthLogRepository";
import {
  ensureReportCardForSubject,
  finaliseReportCard,
  getReportCardById,
  listReportCardsForCustomer,
  reopenReportCard,
} from "@/repositories/dietitian/reportCardRepository";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CustomerCategory,
  ReportCardHistory,
  ReportCardHistoryEntry,
  ReportCardWithEditability,
} from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// `ReportCardHistoryEntry` and `ReportCardHistory` live in `@/types/dietitian`
// because client components render them and must not import from a service
// module (which pulls in `createAdminClient`). Re-exported here so server-side
// callers can keep importing everything from one place.
export type { ReportCardHistory, ReportCardHistoryEntry };

/**
 * The slot schedule and logs for ONE Report_Card. Server-only: `TimelineRow` is
 * a repository type and `LogSlot` carries no client dependency, but the shape as
 * a whole is only ever assembled and consumed on the server.
 */
export interface ReportCardDetail {
  reportCard: ReportCardWithEditability;
  slots: LogSlot[];
  /** Every log in this report's window, from all four timeline sources. */
  timeline: TimelineRow[];
  totalSlots: number;
  loggedSlots: number;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Which of `dates` already carry a Dietitian_Log, and which of those are still
 * inside their same-day edit window for `actorUserId`.
 *
 * Mirrors `DietitianLogWorkspaceService.getSlotLogStatuses`. Duplicated rather
 * than shared because that function is private to the workspace service and
 * scoped to the single governing record; this one runs per report card. Both
 * read the same columns, so they cannot disagree about what "logged" means.
 */
async function getSlotLogStatuses(
  customerProfileId: string,
  dates: readonly string[],
  today: string,
  actorUserId: string | null,
): Promise<{ loggedDates: Set<string>; editableLoggedDates: Set<string> }> {
  const loggedDates = new Set<string>();
  const editableLoggedDates = new Set<string>();
  if (dates.length === 0) return { loggedDates, editableLoggedDates };

  const admin = createAdminClient();
  const { data } = await admin
    .from("health_logs")
    .select("log_date, submission_date_ist, author_user_id")
    .eq("customer_profile_id", customerProfileId)
    .eq("author_type", "DIETITIAN")
    .in("log_date", dates as string[]);

  for (const row of (data ?? []) as Array<{
    log_date: string;
    submission_date_ist: string;
    author_user_id: string;
  }>) {
    loggedDates.add(row.log_date);
    if (
      actorUserId !== null &&
      row.author_user_id === actorUserId &&
      row.submission_date_ist === today
    ) {
      editableLoggedDates.add(row.log_date);
    }
  }

  return { loggedDates, editableLoggedDates };
}

/**
 * The Log_Slot deadline dates inside a Report_Card's window.
 *
 * Paused/non-eligible days are excluded exactly as the Cadence_Engine excludes
 * them, so a report's slot count matches the workspace's for the same period.
 */
async function slotDatesForWindow(
  customerProfileId: string,
  category: CustomerCategory,
  windowStart: string,
  windowEnd: string,
  today: string,
): Promise<{ dates: string[]; pausedDates: string[] }> {
  const nonEligible =
    (await getNonEligibleDatesSince([customerProfileId], windowStart)).get(
      customerProfileId,
    ) ?? [];

  return {
    dates: slotDates({
      category,
      windowStart,
      windowEnd,
      today,
      pausedDates: nonEligible,
    }),
    pausedDates: nonEligible,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The customer's full Report_Card history — one entry per subscription/stay,
 * newest period first, each with its lock flags and slot progress.
 *
 * Reconciles as it reads: any Logging_Window that has no Report_Card yet gets
 * one created (see the module header). A window whose record has no resolvable
 * start is skipped by `listLoggingWindowsForCustomer` and therefore never
 * appears here, matching the Cadence_Engine.
 */
export async function getReportCardHistory(
  customerProfileId: string,
  actorUserId: string | null = null,
): Promise<ReportCardHistory> {
  const today = getISTDateString();

  const [windows, governingRecords] = await Promise.all([
    listLoggingWindowsForCustomer(customerProfileId),
    getGoverningRecords([customerProfileId]),
  ]);

  const governing = governingRecords.get(customerProfileId);
  const category = governing?.category ?? windows[0]?.category ?? "MEAL";

  // Reconcile: make sure every window has a Report_Card before listing.
  await Promise.all(
    windows.map((window) =>
      ensureReportCardForSubject({
        customerProfileId,
        subjectType: window.subjectType,
        subscriptionId: window.subjectType === "SUBSCRIPTION" ? window.recordId : null,
        stayEntryId: window.subjectType === "STAY" ? window.recordId : null,
        category: window.category,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
      }),
    ),
  );

  const cards = await listReportCardsForCustomer(customerProfileId);

  const entries = await Promise.all(
    cards.map(async (card): Promise<ReportCardHistoryEntry> => {
      const { dates } = await slotDatesForWindow(
        customerProfileId,
        card.category,
        card.windowStart,
        card.windowEnd,
        today,
      );
      const { loggedDates } = await getSlotLogStatuses(
        customerProfileId,
        dates,
        today,
        actorUserId,
      );

      const totalSlots = dates.length;
      const loggedSlots = dates.filter((date) => loggedDates.has(date)).length;

      return {
        reportCard: card,
        totalSlots,
        loggedSlots,
        // A window with zero slots is not "complete" — there is nothing to
        // report on, so finalising it would produce an empty report.
        isComplete: totalSlots > 0 && loggedSlots === totalSlots,
        isCurrent:
          governing !== undefined &&
          governing.subjectType === card.subjectType &&
          governing.recordId ===
            (card.subjectType === "SUBSCRIPTION"
              ? card.subscriptionId
              : card.stayEntryId),
      };
    }),
  );

  return { customerProfileId, category, entries };
}

/**
 * The slot schedule and full log timeline for ONE Report_Card.
 *
 * Slot `editable` flags still honour the same-day edit window, but the report's
 * own lock takes precedence: when `reportCard.isEditable` is false every slot is
 * forced non-editable, so a permanently-locked older report can be read but
 * never written. Phase 3's write gate enforces the same rule server-side; this
 * is the display half of it.
 */
export async function getReportCardDetail(
  reportCardId: string,
  actorUserId: string | null = null,
): Promise<ReportCardDetail | null> {
  const today = getISTDateString();

  const card = await getReportCardById(reportCardId);
  if (!card) return null;

  const { dates, pausedDates } = await slotDatesForWindow(
    card.customerProfileId,
    card.category,
    card.windowStart,
    card.windowEnd,
    today,
  );

  const [{ loggedDates, editableLoggedDates }, timeline] = await Promise.all([
    getSlotLogStatuses(card.customerProfileId, dates, today, actorUserId),
    getHealthLogTimelineForWindow(
      card.customerProfileId,
      card.windowStart,
      card.windowEnd,
    ),
  ]);

  // Built from the SAME inputs that produced `dates`, so slot indices and dates
  // agree exactly with the workspace's schedule for this period. Passing an
  // empty pausedDates here would renumber every slot.
  const slots = buildLogSlots(
    {
      category: card.category,
      windowStart: card.windowStart,
      windowEnd: card.windowEnd,
      today,
      pausedDates,
    },
    { loggedDates, editableLoggedDates },
  ).map((slot) => (card.isEditable ? slot : { ...slot, editable: false }));

  const totalSlots = dates.length;
  const loggedSlots = dates.filter((date) => loggedDates.has(date)).length;

  return {
    reportCard: card,
    slots,
    timeline,
    totalSlots,
    loggedSlots,
    isComplete: totalSlots > 0 && loggedSlots === totalSlots,
  };
}

/** Outcome of {@link finaliseReport} / {@link reopenReport}. */
export type ReportCardMutationResult =
  | { ok: true; reportCard: ReportCardWithEditability }
  | { ok: false; error: string };

/** Maximum length of the report-level Closing_Comment, matching the DB CHECK. */
const MAX_REPORT_CLOSING_COMMENT = 4000;

/**
 * Finalise a Report_Card: close it with its report-level Closing_Comment, after
 * which its Log_Slots become read-only.
 *
 * Gate order — each rejection is returned, never thrown, so the action layer can
 * surface it as a form error:
 *   1. The report exists.
 *   2. It is ACTIVE. A closed report cannot be closed again.
 *   3. A non-empty Closing_Comment is supplied, within the DB's 4000-char bound.
 *   4. Its window schedules at least one slot, and EVERY slot is logged. This is
 *      the "all slots filled" precondition — finalising with gaps would produce
 *      a report that silently misrepresents the period.
 *
 * Gate 4 is WAIVED for a Retrospective_Report (Req 18), whose period ended
 * before the report existed. Those slots are unfillable by construction — the
 * write lock and the same-day edit window both refuse a log for a past date — so
 * requiring them would strand the report ACTIVE permanently. The waiver is
 * confined to gate 4; gates 1–3 and the guarded UPDATE are identical.
 *
 * The status flip itself is guarded on `status = 'ACTIVE'` inside the UPDATE, so
 * two admins finalising simultaneously cannot both succeed; the loser is told
 * the report is already closed rather than silently overwriting the winner's
 * comment.
 *
 * Closing this report also shifts the reopen window forward: it becomes the
 * customer's most-recently-closed report and the previous one locks permanently.
 * That follows automatically from `v_report_card_editability` — no extra write.
 */
export async function finaliseReport(
  reportCardId: string,
  closingComment: string,
  actorUserId: string | null,
): Promise<ReportCardMutationResult> {
  const card = await getReportCardById(reportCardId);
  if (!card) {
    return { ok: false, error: "Report not found." };
  }

  if (card.status === "CLOSED") {
    return { ok: false, error: REPORT_ALREADY_CLOSED };
  }

  const comment = typeof closingComment === "string" ? closingComment.trim() : "";
  if (comment.length === 0) {
    return { ok: false, error: REPORT_CLOSING_COMMENT_REQUIRED };
  }
  if (comment.length > MAX_REPORT_CLOSING_COMMENT) {
    return {
      ok: false,
      error: `The closing comment must be ${MAX_REPORT_CLOSING_COMMENT} characters or fewer.`,
    };
  }

  // A Retrospective_Report skips the slot preconditions entirely. Its period
  // ended before the report existed, so the write lock and the same-day edit
  // window make its slots permanently unfillable — enforcing "every slot logged"
  // would leave it ACTIVE forever. Nothing else is relaxed: the comment is still
  // required above, and the guarded UPDATE below is unchanged.
  if (!card.isRetrospective) {
    const today = getISTDateString();
    const { dates } = await slotDatesForWindow(
      card.customerProfileId,
      card.category,
      card.windowStart,
      card.windowEnd,
      today,
    );

    if (dates.length === 0) {
      return { ok: false, error: REPORT_HAS_NO_SLOTS };
    }

    const { loggedDates } = await getSlotLogStatuses(
      card.customerProfileId,
      dates,
      today,
      actorUserId,
    );
    const unlogged = dates.filter((date) => !loggedDates.has(date));
    if (unlogged.length > 0) {
      return { ok: false, error: REPORT_HAS_UNLOGGED_SLOTS };
    }
  }

  const closed = await finaliseReportCard(reportCardId, comment, actorUserId);
  if (!closed) {
    // The guarded UPDATE matched nothing — a concurrent finalisation won.
    return { ok: false, error: REPORT_ALREADY_CLOSED };
  }

  const refreshed = await getReportCardById(reportCardId);
  if (!refreshed) {
    return { ok: false, error: "Report not found." };
  }
  return { ok: true, reportCard: refreshed };
}

/**
 * Reopen a closed Report_Card so its logs can be amended and re-closed.
 *
 * Only the customer's MOST RECENTLY closed report may be reopened — every older
 * closed report is permanently locked for everyone. That decision is read from
 * `v_report_card_editability` (`isReopenable`), never re-derived here, so the
 * rule has exactly one definition shared with the UI and the write gate.
 *
 * There is no limit on how many times the reopenable report may be reopened; the
 * count is recorded on the row for audit. As soon as a NEWER report is closed,
 * this one stops being reopenable — the window moves rather than widening.
 */
export async function reopenReport(
  reportCardId: string,
  actorUserId: string | null,
): Promise<ReportCardMutationResult> {
  const card = await getReportCardById(reportCardId);
  if (!card) {
    return { ok: false, error: "Report not found." };
  }

  if (card.status !== "CLOSED") {
    return { ok: false, error: REPORT_NOT_CLOSED };
  }

  if (!card.isReopenable) {
    return { ok: false, error: ONLY_LATEST_REPORT_CAN_REOPEN };
  }

  const reopened = await reopenReportCard(
    reportCardId,
    actorUserId,
    card.reopenCount,
  );
  if (!reopened) {
    // The guarded UPDATE matched nothing — a concurrent reopen won.
    return { ok: false, error: REPORT_NOT_CLOSED };
  }

  const refreshed = await getReportCardById(reportCardId);
  if (!refreshed) {
    return { ok: false, error: "Report not found." };
  }
  return { ok: true, reportCard: refreshed };
}

/**
 * The Report_Card whose window contains `logDate`, with its lock flags — the
 * report a write to that date would land in.
 *
 * Used by the Health_Log write gate. Unlike {@link resolveReportCardForWrite},
 * this looks the report up by DATE rather than by the governing record, because
 * an edit may target a date inside an OLDER period whose report is closed. The
 * governing record would wrongly report the current period as writable.
 *
 * Returns `null` when no report card covers the date, which the caller treats as
 * "no report to lock against" rather than as a rejection — a log outside every
 * Logging_Window belongs to no report and keeps its existing behaviour.
 */
export async function findReportCardForDate(
  customerProfileId: string,
  logDate: string,
): Promise<ReportCardWithEditability | null> {
  const cards = await listReportCardsForCustomer(customerProfileId);

  const covering = cards.filter(
    (card) => card.windowStart <= logDate && logDate <= card.windowEnd,
  );
  if (covering.length === 0) return null;

  // Historical windows can overlap (backdated records — see
  // scripts/create-report-card-lifecycle.sql). When they do, the STRICTER
  // report wins: if any covering report is locked, the write is refused. That
  // fails closed rather than letting an overlap become a way to edit a locked
  // period.
  const locked = covering.find((card) => !card.isEditable);
  if (locked) return locked;

  // All covering reports are writable — prefer the ACTIVE one, else the first.
  return covering.find((card) => card.status === "ACTIVE") ?? covering[0];
}

/**
 * The Report_Card a NEW Dietitian_Log for the CURRENT period belongs to — the
 * report of the customer's governing record, created if absent.
 *
 * Attribution never uses date matching: the governing record is authoritative,
 * so there is exactly one candidate by construction. Returns `null` when the
 * customer has no governing record (no subscription, or an ACCOMMODATION
 * customer with no stay), which is the same "nothing to log against" state the
 * Cadence_Engine reports.
 */
export async function resolveReportCardForWrite(
  customerProfileId: string,
): Promise<ReportCardWithEditability | null> {
  const governingRecords = await getGoverningRecords([customerProfileId]);
  const governing: GoverningRecord | undefined =
    governingRecords.get(customerProfileId);

  if (!governing) return null;

  const card = await ensureReportCardForSubject({
    customerProfileId,
    subjectType: governing.subjectType,
    subscriptionId:
      governing.subjectType === "SUBSCRIPTION" ? governing.recordId : null,
    stayEntryId: governing.subjectType === "STAY" ? governing.recordId : null,
    category: governing.category,
    windowStart: governing.windowStart,
    windowEnd: governing.windowEnd,
  });

  // Re-read through the editability view so the caller gets the lock flags.
  return getReportCardById(card.id);
}
