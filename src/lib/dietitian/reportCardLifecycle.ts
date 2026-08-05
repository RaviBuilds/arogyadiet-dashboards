// src/lib/dietitian/reportCardLifecycle.ts
// Feature: report-card-lifecycle — Phase 5 (Retrospective_Report).
//
// Pure classification of a Report_Card as RETROSPECTIVE: one whose
// Logging_Window had already ended before the Report_Card itself existed.
//
// WHY THIS CLASS EXISTS
// Finalising a report normally requires every Log_Slot in its window to carry a
// Dietitian_Log (Req 5.3). That is right for a period being worked through, and
// impossible for a period that ended before log collection began — the write
// lock and the same-day edit window both refuse a log for a past date, so those
// slots can never be filled. Without a relaxation, every report the Phase 1
// backfill created for an elapsed period would stay ACTIVE forever and the
// Dietitian's history list would be permanently full of work nobody can do.
//
// WHY `window_end < created_at` RATHER THAN A MIGRATION DATE
// A hard-coded cutoff would need maintaining, would be wrong on any environment
// where the migration ran on a different day, and would say nothing about why
// the period is exempt. This test is self-describing instead: if the period had
// already finished by the time its report row came into existence, no Dietitian
// could ever have logged against it on its deadline dates.
//
// It is also self-limiting, which is the property that matters most. A report
// created for a live or future period necessarily has
// `window_end >= created_at`, so the relaxation is unreachable for anything
// still being worked on — see Property 17. That containment is why this can be
// a derived predicate rather than an operator-set flag.
//
// A fully-backdated subscription created after its own period ended also
// classifies here, and correctly so: its slots were equally unloggable.
//
// LAYERING: pure functions over plain strings. No database, no client, no
// session — safe to import from a repository, a service, or a client component.

/** The Report_Card fields the classification needs. */
export interface RetrospectiveInput {
  /** Logging_Window end, `YYYY-MM-DD`. */
  windowEnd: string;
  /** The Report_Card row's own creation timestamp (ISO 8601, any offset). */
  createdAt: string;
}

/**
 * The IST calendar date of a timestamp, as `YYYY-MM-DD`.
 *
 * Uses the same `en-CA` / `Asia/Kolkata` formatting as
 * `getISTDateString`, so a date produced here is directly comparable with one
 * produced there. `getISTDateString` only ever formats "now", which is why this
 * cannot simply call it.
 */
export function istDateFromTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

/**
 * True when the Report_Card's Logging_Window had already ended before the
 * Report_Card existed.
 *
 * Strict inequality is deliberate. A report created on the very last day of its
 * own window is NOT retrospective: that day was still loggable, so the ordinary
 * all-slots precondition should apply.
 *
 * Both sides are `YYYY-MM-DD`, so lexicographic comparison is calendar
 * comparison — no `Date` arithmetic and therefore no timezone drift.
 */
export function isRetrospectiveReport(input: RetrospectiveInput): boolean {
  return input.windowEnd < istDateFromTimestamp(input.createdAt);
}
