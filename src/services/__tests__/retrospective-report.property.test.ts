// src/services/__tests__/retrospective-report.property.test.ts
// Feature: report-card-lifecycle — Phase 5, the Retrospective_Report waiver.
//
// Two properties, and the pairing is the point of the suite:
//
//   Property 16 — the waiver is EXACT. Two Report_Cards with the identical
//     window and identical (zero) logged slots finalise differently based on
//     nothing but when the report row came into existence. The retrospective one
//     closes on its comment alone; the other is refused for unlogged slots.
//     Asserting only the success half would pass against a build that had simply
//     dropped the all-slots precondition altogether.
//
//   Property 17 — the waiver is CONTAINED. No window that is still running, or
//     has yet to start, can ever classify as retrospective. This is what makes
//     the relaxation safe to derive rather than have an operator set: it cannot
//     be reached for a period anyone is still working on.
//
// `finaliseReport` runs for REAL, including the real `slotDates`, so the slot
// schedule under test is the one the Cadence_Engine actually produces. Only the
// repositories and the admin client are faked.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const state: any = {
    card: null as any,
    /** Rows `getSlotLogStatuses` will see. Empty = no slot logged. */
    logs: [] as any[],
    /** Captured argument of the last finaliseReportCard call, or null. */
    finalised: null as any,
  };

  function reset() {
    state.card = null;
    state.logs = [];
    state.finalised = null;
  }

  return { state, reset };
});

vi.mock("@/repositories/dietitian/reportCardRepository", () => ({
  getReportCardById: vi.fn(async () => H.state.card),
  finaliseReportCard: vi.fn(
    async (id: string, comment: string, actor: string | null) => {
      H.state.finalised = { id, comment, actor };
      // Mirror the guarded UPDATE: only an ACTIVE row matches.
      if (H.state.card?.status !== "ACTIVE") return null;
      H.state.card = {
        ...H.state.card,
        status: "CLOSED",
        reportClosingComment: comment,
        finalisedAt: new Date().toISOString(),
      };
      return H.state.card;
    },
  ),
  reopenReportCard: vi.fn(async () => null),
  ensureReportCardForSubject: vi.fn(async () => H.state.card),
  listReportCardsForCustomer: vi.fn(async () =>
    H.state.card ? [H.state.card] : [],
  ),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  // No Paused_Days — this suite isolates the retrospective waiver, and a paused
  // day would change the slot count for reasons unrelated to it.
  getNonEligibleDatesSince: vi.fn(async () => new Map()),
  getGoverningRecords: vi.fn(async () => new Map()),
  listLoggingWindowsForCustomer: vi.fn(async () => []),
}));

vi.mock("@/repositories/dietitian/healthLogRepository", () => ({
  getHealthLogTimelineForWindow: vi.fn(async () => []),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "health_logs") {
        throw new Error(`unexpected table access in test fake: ${table}`);
      }
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        // `getSlotLogStatuses` awaits the builder directly.
        then: (resolve: any) => resolve({ data: H.state.logs, error: null }),
      };
      return builder;
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { finaliseReport } from "@/services/ReportCardService";
import { isRetrospectiveReport } from "@/lib/dietitian/reportCardLifecycle";
import { REPORT_HAS_UNLOGGED_SLOTS } from "@/lib/dietitian/messages";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` for `base` plus `days`, using UTC to avoid local-zone drift. */
function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A Report_Card whose `isRetrospective` is computed by the REAL classifier from
 * the generated window and creation timestamp — not hand-set. Otherwise the
 * suite would only prove that a boolean it wrote itself is honoured, and would
 * pass even if the classification rule were inverted.
 */
function buildCard(windowStart: string, windowEnd: string, createdAt: string) {
  return {
    id: "rc-1",
    customerProfileId: "cust-1",
    subjectType: "SUBSCRIPTION" as const,
    subscriptionId: "sub-1",
    stayEntryId: null,
    category: "MEAL" as const,
    windowStart,
    windowEnd,
    status: "ACTIVE" as const,
    reportClosingComment: null,
    finalisedAt: null,
    finalisedBy: null,
    reopenCount: 0,
    lastReopenedAt: null,
    createdAt,
    updatedAt: createdAt,
    isEditable: true,
    isReopenable: false,
    isRetrospective: isRetrospectiveReport({ windowEnd, createdAt }),
  };
}

/** A long-elapsed window, so every slot falls before today and none is logged. */
const elapsedWindow = fc
  .integer({ min: 0, max: 300 })
  .chain((offset) =>
    fc.integer({ min: 9, max: 60 }).map((length) => {
      const windowStart = addDays("2020-01-01", offset);
      return { windowStart, windowEnd: addDays(windowStart, length) };
    }),
  );

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe("Property 16: Retrospective relaxation is exact", () => {
  it("closes a retrospective report on its comment alone", async () => {
    await fc.assert(
      fc.asyncProperty(elapsedWindow, async ({ windowStart, windowEnd }) => {
        H.reset();
        // Created a year after the period ended — nobody could have logged it.
        H.state.card = buildCard(
          windowStart,
          windowEnd,
          `${addDays(windowEnd, 365)}T06:00:00.000Z`,
        );
        expect(H.state.card.isRetrospective).toBe(true);

        const result = await finaliseReport("rc-1", "Historical close.", "u-1");

        expect(result.ok).toBe(true);
        expect(H.state.finalised?.comment).toBe("Historical close.");
      }),
      { numRuns: 100 },
    );
  });

  it("refuses the same window when the report is not retrospective", async () => {
    await fc.assert(
      fc.asyncProperty(elapsedWindow, async ({ windowStart, windowEnd }) => {
        H.reset();
        // Created on the window's first day: the period was loggable at the time,
        // so the ordinary all-slots precondition applies. Same window, same zero
        // logged slots as the case above — only `createdAt` differs.
        H.state.card = buildCard(
          windowStart,
          windowEnd,
          `${windowStart}T06:00:00.000Z`,
        );
        expect(H.state.card.isRetrospective).toBe(false);

        const result = await finaliseReport("rc-1", "Premature close.", "u-1");

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe(REPORT_HAS_UNLOGGED_SLOTS);
        }
        // The waiver must not have leaked into a write.
        expect(H.state.finalised).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("still requires a closing comment on a retrospective report", async () => {
    await fc.assert(
      fc.asyncProperty(
        elapsedWindow,
        fc.constantFrom("", "   ", "\n\t "),
        async ({ windowStart, windowEnd }, blankComment) => {
          H.reset();
          H.state.card = buildCard(
            windowStart,
            windowEnd,
            `${addDays(windowEnd, 365)}T06:00:00.000Z`,
          );

          const result = await finaliseReport("rc-1", blankComment, "u-1");

          // The waiver covers the slot gates only. A retrospective report is
          // still a deliberate close with a stated summary.
          expect(result.ok).toBe(false);
          expect(H.state.finalised).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("refuses to close an already-closed retrospective report", async () => {
    await fc.assert(
      fc.asyncProperty(elapsedWindow, async ({ windowStart, windowEnd }) => {
        H.reset();
        H.state.card = {
          ...buildCard(
            windowStart,
            windowEnd,
            `${addDays(windowEnd, 365)}T06:00:00.000Z`,
          ),
          status: "CLOSED" as const,
          reportClosingComment: "Already done.",
          finalisedAt: new Date().toISOString(),
        };

        const result = await finaliseReport("rc-1", "Second close.", "u-1");

        // Being retrospective does not exempt a report from the lifecycle.
        expect(result.ok).toBe(false);
        expect(H.state.finalised).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Property 17: Retrospective classification cannot capture a live period", () => {
  it("never classifies a window that has not yet ended", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3650, max: 3650 }),
        fc.integer({ min: 0, max: 400 }),
        fc.nat(),
        // Capped at 17 so the UTC and IST calendar dates coincide. IST is
        // UTC+5:30, so from 18:30 UTC onward the IST date is already tomorrow —
        // and a report created at 19:00 UTC on a window's last day genuinely IS
        // retrospective, because in IST it came into existence the day after the
        // period closed. Generating those hours here would be generating cases
        // the property does not describe; they are asserted explicitly below.
        fc.integer({ min: 0, max: 17 }),
        (startOffset, length, createdDayPick, hour) => {
          const windowStart = addDays("2026-01-01", startOffset);
          const windowEnd = addDays(windowStart, length);
          // Any day from the window's first to its last — i.e. while the period
          // was still live.
          const createdOn = addDays(windowStart, createdDayPick % (length + 1));
          const createdAt = `${createdOn}T${String(hour).padStart(2, "0")}:00:00.000Z`;

          expect(isRetrospectiveReport({ windowEnd, createdAt })).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("classifies exactly when the window ended before the report existed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3650, max: 3650 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 1, max: 1000 }),
        (startOffset, length, gap) => {
          const windowStart = addDays("2026-01-01", startOffset);
          const windowEnd = addDays(windowStart, length);

          // Strictly after the window closed → retrospective.
          expect(
            isRetrospectiveReport({
              windowEnd,
              createdAt: `${addDays(windowEnd, gap)}T00:30:00.000Z`,
            }),
          ).toBe(true);

          // On the last day itself → NOT retrospective. That day was loggable,
          // so the boundary belongs to the strict side. 06:00 UTC is 11:30 IST,
          // safely the same calendar day in both zones.
          expect(
            isRetrospectiveReport({
              windowEnd,
              createdAt: `${windowEnd}T06:00:00.000Z`,
            }),
          ).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("uses the IST calendar date, not UTC, for the creation timestamp", () => {
    // 2026-03-10T19:00:00Z is 2026-03-11 00:30 IST. A window ending on the 10th
    // is therefore retrospective in IST even though UTC still reads the 10th.
    expect(
      isRetrospectiveReport({
        windowEnd: "2026-03-10",
        createdAt: "2026-03-10T19:00:00.000Z",
      }),
    ).toBe(true);

    // An hour earlier is still 2026-03-10 IST, so it is not.
    expect(
      isRetrospectiveReport({
        windowEnd: "2026-03-10",
        createdAt: "2026-03-10T17:00:00.000Z",
      }),
    ).toBe(false);
  });
});
