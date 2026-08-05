// src/services/__tests__/period-report.property.test.ts
// Feature: report-card-lifecycle — Phase 4, per-period report figures.
//
// Property 13 — a finished period's report is STABLE. Adding Health_Logs, paused
// days or skipped self-logs to a LATER period must not move a single figure on an
// EARLIER period's report.
//
// This is the property that justifies `computePeriodAdherence` existing at all.
// The obvious implementation would have reused `CadenceService`, which answers
// "how overdue is this customer right now" — a question with no meaning for a
// period that closed in May, and one whose answer changes every time the
// customer's current period does. A report handed to a customer must not restate
// itself later.
//
// The fake admin client HONOURS its filters rather than returning everything,
// because the windowing is precisely what is under test. A fake that ignored
// `.gte` / `.lte` would make this suite pass against an unwindowed
// implementation, which is the exact bug it exists to catch.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

const CUSTOMER = "cust-1";

/** A Dietitian_Log row as the fakes store it. */
interface LogRow {
  log_date: string;
}

// ─── Shared in-memory state (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const state: any = {
    card: null as any,
    /** Every Dietitian_Log row, across all periods. */
    logs: [] as LogRow[],
    /** Paused dates from `windowStart` onward, unbounded above — as the real repo returns. */
    pausedDates: [] as string[],
    /** KIT skipped dates, likewise unbounded above. */
    skippedDates: [] as string[],
  };

  function reset() {
    state.card = null;
    state.logs = [];
    state.pausedDates = [];
    state.skippedDates = [];
  }

  return { state, reset };
});

vi.mock("@/repositories/dietitian/reportCardRepository", () => ({
  getReportCardById: vi.fn(async () => H.state.card),
}));

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  // Windowed, exactly like the real `getHealthLogTimelineForWindow`.
  getHealthLogTimelineForWindow: vi.fn(
    async (_customerId: string, windowStart: string, windowEnd: string) =>
      (H.state.logs as LogRow[])
        .filter(
          (row: LogRow) =>
            row.log_date >= windowStart && row.log_date <= windowEnd,
        )
        .map((row: LogRow) => ({
          log_date: row.log_date,
          author_type: "DIETITIAN",
          author_user_id: "u-1",
          parameters: { Weight: { value: 70, unit: "kg" } },
          custom_parameters: null,
          closing_comment: "note",
        })),
  ),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  // Both repos are "since `windowStart`" and therefore return dates BEYOND the
  // window too. Reproducing that is essential: the service is responsible for
  // clipping to the window, and a fake that pre-clipped would hide a missing
  // clip in the code.
  getNonEligibleDatesSince: vi.fn(async (_ids: string[], since: string) => {
    const map = new Map<string, string[]>();
    map.set(
      CUSTOMER,
      H.state.pausedDates.filter((date: string) => date >= since),
    );
    return map;
  }),
  getKitSkippedDatesSince: vi.fn(async (_ids: string[], since: string) => {
    const map = new Map<string, string[]>();
    map.set(
      CUSTOMER,
      H.state.skippedDates.filter((date: string) => date >= since),
    );
    return map;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      let gte: string | null = null;
      let lte: string | null = null;

      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs[col] = val;
          return builder;
        },
        in: () => builder,
        gte: (_col: string, val: string) => {
          gte = val;
          return builder;
        },
        lte: (_col: string, val: string) => {
          lte = val;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return {
              data: {
                id: CUSTOMER,
                customer_code: "AD-001",
                dietitian_id: null,
                users: { full_name: "Test Customer" },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve: any) => {
          if (table === "health_logs") {
            // The filters are applied for real — this is the windowing under test.
            const rows = (H.state.logs as LogRow[]).filter(
              (row: LogRow) =>
                (gte === null || row.log_date >= gte) &&
                (lte === null || row.log_date <= lte),
            );
            return resolve({ data: rows, error: null });
          }
          if (table === "users") {
            return resolve({
              data: [{ id: "u-1", full_name: "Dr Test" }],
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { getPeriodReport } from "@/services/DietitianReportService";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` for `base` plus `days`, in UTC to avoid local-zone drift. */
function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

function buildCard(windowStart: string, windowEnd: string) {
  return {
    id: "rc-early",
    customerProfileId: CUSTOMER,
    subjectType: "SUBSCRIPTION" as const,
    subscriptionId: "sub-early",
    stayEntryId: null,
    category: "MEAL" as const,
    windowStart,
    windowEnd,
    status: "CLOSED" as const,
    reportClosingComment: "Done.",
    finalisedAt: "2020-06-01T00:00:00.000Z",
    finalisedBy: "u-1",
    reopenCount: 0,
    lastReopenedAt: null,
    createdAt: `${windowStart}T00:00:00.000Z`,
    updatedAt: `${windowStart}T00:00:00.000Z`,
    isEditable: false,
    isReopenable: false,
    isRetrospective: false,
  };
}

/**
 * Two non-overlapping periods, the second strictly after the first, with a gap
 * so no boundary date is shared.
 */
const twoPeriods = fc
  .integer({ min: 0, max: 200 })
  .chain((offset) =>
    fc
      .tuple(
        fc.integer({ min: 9, max: 45 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 9, max: 45 }),
      )
      .map(([earlyLength, gap, lateLength]) => {
        const earlyStart = addDays("2020-01-01", offset);
        const earlyEnd = addDays(earlyStart, earlyLength);
        const lateStart = addDays(earlyEnd, gap + 1);
        return {
          earlyStart,
          earlyEnd,
          lateStart,
          lateEnd: addDays(lateStart, lateLength),
        };
      }),
  );

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe("Property 13: A finished period's figures are stable", () => {
  it("does not change an earlier period's report when a later period gains logs", async () => {
    await fc.assert(
      fc.asyncProperty(
        twoPeriods,
        fc.integer({ min: 1, max: 12 }),
        async (periods, lateLogCount) => {
          const { earlyStart, earlyEnd, lateStart, lateEnd } = periods;
          H.reset();
          H.state.card = buildCard(earlyStart, earlyEnd);

          // A partly-logged early period: every third day carries a log.
          const earlyDays = eachDay(earlyStart, earlyEnd);
          H.state.logs = earlyDays
            .filter((_day, index) => index % 3 === 0)
            .map((log_date) => ({ log_date }));
          H.state.pausedDates = [earlyDays[1]];
          H.state.skippedDates = [earlyDays[2]];

          const before = await getPeriodReport("rc-early");
          expect(before.ok).toBe(true);
          if (!before.ok) return;

          // The later period fills up: logs, paused days and skips, all after
          // the early window closed.
          const lateDays = eachDay(lateStart, lateEnd);
          for (let i = 0; i < lateLogCount && i < lateDays.length; i++) {
            H.state.logs.push({ log_date: lateDays[i] });
          }
          H.state.pausedDates.push(...lateDays.slice(0, 5));
          H.state.skippedDates.push(...lateDays.slice(0, 4));

          const after = await getPeriodReport("rc-early");
          expect(after.ok).toBe(true);
          if (!after.ok) return;

          // Every figure, and the whole dated table, must be untouched.
          expect(after.report.adherence).toEqual(before.report.adherence);
          expect(after.report.parameterTable).toEqual(
            before.report.parameterTable,
          );
          expect(after.report.closingComments).toEqual(
            before.report.closingComments,
          );
          expect(after.report.trends).toEqual(before.report.trends);
          expect(after.report.hasHealthLogs).toBe(before.report.hasHealthLogs);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("counts only paused and skipped days that fall inside the window", async () => {
    await fc.assert(
      fc.asyncProperty(twoPeriods, async (periods) => {
        const { earlyStart, earlyEnd, lateStart, lateEnd } = periods;
        H.reset();
        H.state.card = buildCard(earlyStart, earlyEnd);

        const earlyDays = eachDay(earlyStart, earlyEnd);
        const lateDays = eachDay(lateStart, lateEnd);

        // Two paused days inside, five outside; one skip inside, four outside.
        H.state.pausedDates = [
          earlyDays[1],
          earlyDays[3],
          ...lateDays.slice(0, 5),
        ];
        H.state.skippedDates = [earlyDays[2], ...lateDays.slice(0, 4)];

        const result = await getPeriodReport("rc-early");
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // The repos return everything from `windowStart` onward, so these
        // numbers only come out right if the service clips to `windowEnd`.
        expect(result.report.adherence.pausedDaysCount).toBe(2);
        expect(result.report.adherence.skippedSelfLogCount).toBe(1);
      }),
      { numRuns: 60 },
    );
  });

  it("reports no logs for a period whose logs all belong to another period", async () => {
    await fc.assert(
      fc.asyncProperty(twoPeriods, async (periods) => {
        const { earlyStart, earlyEnd, lateStart, lateEnd } = periods;
        H.reset();
        H.state.card = buildCard(earlyStart, earlyEnd);

        // Every log sits in the LATER period.
        H.state.logs = eachDay(lateStart, lateEnd).map((log_date) => ({
          log_date,
        }));

        const result = await getPeriodReport("rc-early");
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.report.hasHealthLogs).toBe(false);
        expect(result.report.parameterTable).toEqual([]);
        expect(result.report.adherence.dietitianLogCount).toBe(0);
        // Nothing logged in-window, so every slot the period scheduled is pending.
        expect(result.report.adherence.pendingLogCount).toBeGreaterThan(0);
      }),
      { numRuns: 60 },
    );
  });

  it("labels the report with the period's own category, not the customer's current one", async () => {
    H.reset();
    // The customer_profiles fake carries no category; the card says KIT. A report
    // for an old KIT subscription must not relabel itself because the customer is
    // on a different plan today.
    H.state.card = { ...buildCard("2020-01-01", "2020-02-01"), category: "KIT" as const };
    H.state.logs = [{ log_date: "2020-01-10" }];

    const result = await getPeriodReport("rc-early");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.category).toBe("KIT");
  });
});
