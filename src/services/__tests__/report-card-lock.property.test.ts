// src/services/__tests__/report-card-lock.property.test.ts
// Feature: report-card-lifecycle — Phase 3, the Report_Card write lock.
//
// Property: for ANY Report_Card state, `submitHealthLog` accepts a write iff the
// covering report is writable, and the same-day edit window is relaxed EXACTLY
// when the report has been reopened.
//
//   report state                        | write outcome
//   ------------------------------------|--------------------------------------
//   no covering report                  | allowed (pre-feature behaviour)
//   ACTIVE, never reopened              | allowed; same-day window ENFORCED
//   ACTIVE, reopened (reopenCount > 0)  | allowed; same-day window RELAXED
//   CLOSED + reopenable                 | rejected, REOPEN_REPORT_TO_EDIT
//   CLOSED + locked                     | rejected, REPORT_IS_LOCKED
//
// `submitHealthLog` runs for REAL. `findReportCardForDate` is the seam under
// test, so it is mocked per-case; the repositories and the admin client are
// faked in memory, mirroring `health-log-write-gate.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const db: any = { health_logs: [] as any[], audit_entries: [] as any[] };
  /** The report card `findReportCardForDate` should return for the next call. */
  const state: any = { coveringReport: null as any };

  function reset() {
    db.health_logs = [];
    db.audit_entries = [];
    state.coveringReport = null;
  }

  return { db, state, reset };
});

vi.mock("@/services/ReportCardService", () => ({
  findReportCardForDate: vi.fn(async () => H.state.coveringReport),
}));

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  upsertHealthLog: vi.fn(async (input: any) => {
    const existing = H.db.health_logs.find(
      (r: any) =>
        r.customer_profile_id === input.customer_profile_id &&
        r.log_date === input.log_date &&
        r.author_type === "DIETITIAN",
    );

    if (existing) {
      Object.assign(existing, input, { author_type: "DIETITIAN" });
      return existing;
    }

    const row = {
      id: `log-${H.db.health_logs.length + 1}`,
      author_type: "DIETITIAN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...input,
    };
    H.db.health_logs.push(row);
    return row;
  }),
}));

vi.mock("@/repositories/dietitian/auditRepository", () => ({
  insertAuditEntry: vi.fn(async (input: any) => {
    const entry = { id: `audit-${H.db.audit_entries.length + 1}`, ...input };
    H.db.audit_entries.push(entry);
    return entry;
  }),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  // No Paused_Days — this suite isolates the report lock.
  getPausedDatesSince: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "health_logs") {
        throw new Error(`unexpected table access in test fake: ${table}`);
      }
      const filters: Array<{ col: string; val: unknown }> = [];
      const builder: any = {
        select: () => builder,
        delete: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle: async () => {
          const row = H.db.health_logs.find((r: any) =>
            filters.every((f) => r[f.col] === f.val),
          );
          return { data: row ?? null, error: null };
        },
      };
      return builder;
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { submitHealthLog } from "@/services/HealthLogService";
import {
  CAN_ONLY_EDIT_OWN_LOGS,
  LOG_NO_LONGER_EDITABLE,
  REOPEN_REPORT_TO_EDIT,
  REPORT_IS_LOCKED,
} from "@/lib/dietitian/messages";
import { getISTDateString } from "@/lib/dates/ist";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const DIETITIAN_ID = "00000000-0000-4000-8000-000000000011";

const ACTOR = { userId: DIETITIAN_ID, clinicId: null, franchiseId: null };

/** A MEAL payload that always passes schema validation. */
function payload(logDate: string) {
  return {
    customerProfileId: CUSTOMER_ID,
    logDate,
    category: "MEAL" as const,
    parameters: { weight: { value: 70, unit: "kg" } },
    customParameters: [],
    closingComment: "Reviewed.",
  };
}

/** A report card covering `logDate`, in the requested lifecycle state. */
function reportCard(
  logDate: string,
  overrides: {
    status: "ACTIVE" | "CLOSED";
    isEditable: boolean;
    isReopenable: boolean;
    reopenCount?: number;
  },
) {
  return {
    id: "report-1",
    customerProfileId: CUSTOMER_ID,
    subjectType: "SUBSCRIPTION" as const,
    subscriptionId: "sub-1",
    stayEntryId: null,
    category: "MEAL" as const,
    windowStart: logDate,
    windowEnd: logDate,
    reportClosingComment: null,
    finalisedAt: overrides.status === "CLOSED" ? new Date().toISOString() : null,
    finalisedBy: null,
    reopenCount: overrides.reopenCount ?? 0,
    lastReopenedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  H.reset();
});

describe("Feature: report-card-lifecycle — the Report_Card write lock", () => {
  it("rejects every write into a permanently locked report, with REPORT_IS_LOCKED", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 60 }), async (daysAgo) => {
        H.reset();
        const logDate = shift(getISTDateString(), -daysAgo);
        H.state.coveringReport = reportCard(logDate, {
          status: "CLOSED",
          isEditable: false,
          isReopenable: false,
        });

        const result = await submitHealthLog(payload(logDate), ACTOR);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe(REPORT_IS_LOCKED);
        // Nothing persisted, but the attempt is still audited (Req 18.6).
        expect(H.db.health_logs).toHaveLength(0);
        expect(H.db.audit_entries).toHaveLength(1);
        expect(H.db.audit_entries[0].outcome).toBe("REJECTED");
      }),
      { numRuns: 30 },
    );
  });

  it("rejects a write into the closed-but-reopenable report, naming the remedy", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 60 }), async (daysAgo) => {
        H.reset();
        const logDate = shift(getISTDateString(), -daysAgo);
        H.state.coveringReport = reportCard(logDate, {
          status: "CLOSED",
          isEditable: false,
          isReopenable: true,
        });

        const result = await submitHealthLog(payload(logDate), ACTOR);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe(REOPEN_REPORT_TO_EDIT);
        expect(H.db.health_logs).toHaveLength(0);
      }),
      { numRuns: 30 },
    );
  });

  it("allows a write when no report covers the date (pre-feature behaviour)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 60 }), async (daysAgo) => {
        H.reset();
        H.state.coveringReport = null;
        const logDate = shift(getISTDateString(), -daysAgo);

        const result = await submitHealthLog(payload(logDate), ACTOR);

        expect(result.ok).toBe(true);
        expect(H.db.health_logs).toHaveLength(1);
        expect(H.db.health_logs[0].report_card_id).toBeNull();
      }),
      { numRuns: 30 },
    );
  });

  it("stamps report_card_id on a write into an ACTIVE report", async () => {
    const logDate = getISTDateString();
    H.state.coveringReport = reportCard(logDate, {
      status: "ACTIVE",
      isEditable: true,
      isReopenable: false,
    });

    const result = await submitHealthLog(payload(logDate), ACTOR);

    expect(result.ok).toBe(true);
    expect(H.db.health_logs[0].report_card_id).toBe("report-1");
  });

  it("ENFORCES the same-day edit window on an ACTIVE report that was never reopened", async () => {
    const logDate = getISTDateString();
    H.state.coveringReport = reportCard(logDate, {
      status: "ACTIVE",
      isEditable: true,
      isReopenable: false,
      reopenCount: 0,
    });

    // A log this Dietitian submitted on an EARLIER day — its edit window closed.
    H.db.health_logs.push({
      id: "log-1",
      customer_profile_id: CUSTOMER_ID,
      log_date: logDate,
      author_type: "DIETITIAN",
      author_user_id: DIETITIAN_ID,
      submission_date_ist: shift(getISTDateString(), -3),
      parameters: {},
      custom_parameters: [],
      closing_comment: "Earlier note.",
      clinic_id: null,
      franchise_id: null,
    });

    const result = await submitHealthLog(payload(logDate), ACTOR);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(LOG_NO_LONGER_EDITABLE);
  });

  it("RELAXES the same-day edit window once the report has been reopened", async () => {
    const logDate = getISTDateString();
    H.state.coveringReport = reportCard(logDate, {
      status: "ACTIVE",
      isEditable: true,
      isReopenable: false,
      // The distinguishing signal: closed once, then reopened.
      reopenCount: 1,
    });

    H.db.health_logs.push({
      id: "log-1",
      customer_profile_id: CUSTOMER_ID,
      log_date: logDate,
      author_type: "DIETITIAN",
      author_user_id: DIETITIAN_ID,
      submission_date_ist: shift(getISTDateString(), -3),
      parameters: {},
      custom_parameters: [],
      closing_comment: "Earlier note.",
      clinic_id: null,
      franchise_id: null,
    });

    const result = await submitHealthLog(payload(logDate), ACTOR);

    // The same write that was refused above now succeeds — that is the whole
    // point of reopening a report.
    expect(result.ok).toBe(true);
    expect(H.db.health_logs[0].closing_comment).toBe("Reviewed.");
  });

  it("still refuses another Dietitian's log even in amendment mode (Req 18.3 is not relaxed)", async () => {
    const logDate = getISTDateString();
    H.state.coveringReport = reportCard(logDate, {
      status: "ACTIVE",
      isEditable: true,
      isReopenable: false,
      reopenCount: 2,
    });

    H.db.health_logs.push({
      id: "log-1",
      customer_profile_id: CUSTOMER_ID,
      log_date: logDate,
      author_type: "DIETITIAN",
      // Authored by somebody else.
      author_user_id: "00000000-0000-4000-8000-000000000012",
      submission_date_ist: logDate,
      parameters: {},
      custom_parameters: [],
      closing_comment: "Not mine.",
      clinic_id: null,
      franchise_id: null,
    });

    const result = await submitHealthLog(payload(logDate), ACTOR);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(CAN_ONLY_EDIT_OWN_LOGS);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Property 10: Authorship is never relaxed
//
// The case above proves it for one reopened report. This generalises it across
// EVERY report state, including the states where the report lock refuses the
// write for its own reasons.
//
// Authorship sits BEFORE the edit window in the gate order, deliberately: a
// Dietitian editing a colleague's log must be told it is not theirs, not that
// its edit window has closed. And because Amendment_Mode relaxes only the
// window, no report state may ever open somebody else's log — the one property
// that keeps "reopen to amend" from becoming "reopen to overwrite".
// ───────────────────────────────────────────────────────────────────────────
describe("Property 10: Authorship is never relaxed", () => {
  const OTHER_DIETITIAN = "00000000-0000-4000-8000-000000000012";

  /** Every report state a write can land in, including "no report". */
  const anyReportState = fc.constantFrom(
    null,
    { status: "ACTIVE" as const, isEditable: true, isReopenable: false, reopenCount: 0 },
    { status: "ACTIVE" as const, isEditable: true, isReopenable: false, reopenCount: 1 },
    { status: "ACTIVE" as const, isEditable: true, isReopenable: false, reopenCount: 7 },
    { status: "CLOSED" as const, isEditable: false, isReopenable: true, reopenCount: 0 },
    { status: "CLOSED" as const, isEditable: false, isReopenable: false, reopenCount: 0 },
  );

  it("refuses an edit to another Dietitian's log in every report state", async () => {
    await fc.assert(
      fc.asyncProperty(
        anyReportState,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 30 }),
        async (state, daysAgo, submittedDaysAgo) => {
          H.reset();
          const logDate = shift(getISTDateString(), -daysAgo);
          H.state.coveringReport =
            state === null ? null : reportCard(logDate, state);

          // Somebody else's log, submitted at an arbitrary time — so the case
          // spans both inside and outside the same-day window.
          H.db.health_logs.push({
            id: "log-1",
            customer_profile_id: CUSTOMER_ID,
            log_date: logDate,
            author_type: "DIETITIAN",
            author_user_id: OTHER_DIETITIAN,
            submission_date_ist: shift(getISTDateString(), -submittedDaysAgo),
            parameters: {},
            custom_parameters: [],
            closing_comment: "Not mine.",
            clinic_id: null,
            franchise_id: null,
          });

          const result = await submitHealthLog(payload(logDate), ACTOR);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            // Where the report lock also refuses, it wins — it is checked first
            // and is the more fundamental refusal. Either way the write is
            // refused, which is what the property claims.
            const acceptable: string[] = [
              CAN_ONLY_EDIT_OWN_LOGS,
              REPORT_IS_LOCKED,
              REOPEN_REPORT_TO_EDIT,
            ];
            expect(acceptable).toContain(result.error);
          }

          // The decisive part: the other Dietitian's content is untouched.
          expect(H.db.health_logs).toHaveLength(1);
          expect(H.db.health_logs[0].author_user_id).toBe(OTHER_DIETITIAN);
          expect(H.db.health_logs[0].closing_comment).toBe("Not mine.");
        },
      ),
      { numRuns: 150 },
    );
  });

  it("names authorship as the reason whenever the report itself permits the write", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Only the writable states, so the report lock cannot pre-empt the
        // authorship message.
        fc.constantFrom(
          { status: "ACTIVE" as const, isEditable: true, isReopenable: false, reopenCount: 0 },
          { status: "ACTIVE" as const, isEditable: true, isReopenable: false, reopenCount: 3 },
        ),
        fc.integer({ min: 0, max: 60 }),
        async (state, daysAgo) => {
          H.reset();
          const logDate = shift(getISTDateString(), -daysAgo);
          H.state.coveringReport = reportCard(logDate, state);

          H.db.health_logs.push({
            id: "log-1",
            customer_profile_id: CUSTOMER_ID,
            log_date: logDate,
            author_type: "DIETITIAN",
            author_user_id: OTHER_DIETITIAN,
            // Submitted TODAY, so the same-day window is wide open and cannot be
            // the reason for the refusal.
            submission_date_ist: getISTDateString(),
            parameters: {},
            custom_parameters: [],
            closing_comment: "Not mine.",
            clinic_id: null,
            franchise_id: null,
          });

          const result = await submitHealthLog(payload(logDate), ACTOR);

          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error).toBe(CAN_ONLY_EDIT_OWN_LOGS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("lets the original author edit the same log the other Dietitian could not", async () => {
    // The positive half. Without it, a build that refused every update would
    // satisfy the property above.
    const logDate = getISTDateString();
    H.state.coveringReport = reportCard(logDate, {
      status: "ACTIVE",
      isEditable: true,
      isReopenable: false,
      reopenCount: 0,
    });

    H.db.health_logs.push({
      id: "log-1",
      customer_profile_id: CUSTOMER_ID,
      log_date: logDate,
      author_type: "DIETITIAN",
      author_user_id: DIETITIAN_ID,
      submission_date_ist: getISTDateString(),
      parameters: {},
      custom_parameters: [],
      closing_comment: "Mine, first draft.",
      clinic_id: null,
      franchise_id: null,
    });

    const result = await submitHealthLog(payload(logDate), ACTOR);

    expect(result.ok).toBe(true);
    expect(H.db.health_logs[0].closing_comment).toBe("Reviewed.");
  });
});

/** Shift a `YYYY-MM-DD` string by whole days, UTC-safe. */
function shift(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
