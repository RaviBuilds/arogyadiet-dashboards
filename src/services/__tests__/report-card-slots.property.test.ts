// src/services/__tests__/report-card-slots.property.test.ts
// Feature: report-card-lifecycle — Phase 2/4, per-period slot schedules.
//
// Property 14 — a Report_Card's slot schedule is the Cadence_Engine's schedule
// for the same window and the same paused-day set. Same dates, same 1-based
// indices, same count.
//
// The risk this guards is specific and was hit once during implementation:
// `getReportCardDetail` needs BOTH the slot dates and the paused set, and it is
// tempting to compute the dates, then hand `buildLogSlots` an empty
// `pausedDates` and filter its output afterwards. That produces the right dates
// with the WRONG indices — every slot after the first pause is renumbered — so a
// Dietitian looking at "slot 7 of 10" on the report and "slot 8 of 10" in the
// workspace would be looking at the same day. Comparing indices, not just dates,
// is what makes this property worth having.
//
// The real `slotDates` / `buildLogSlots` are used on the expected side, so this
// asserts agreement between the two call sites rather than re-deriving cadence.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

const CUSTOMER = "cust-1";

// ─── Shared in-memory state (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const state: any = {
    card: null as any,
    pausedDates: [] as string[],
    logs: [] as Array<{
      log_date: string;
      submission_date_ist: string;
      author_user_id: string;
    }>,
  };

  function reset() {
    state.card = null;
    state.pausedDates = [];
    state.logs = [];
  }

  return { state, reset };
});

vi.mock("@/repositories/dietitian/reportCardRepository", () => ({
  getReportCardById: vi.fn(async () => H.state.card),
  listReportCardsForCustomer: vi.fn(async () =>
    H.state.card ? [H.state.card] : [],
  ),
  ensureReportCardForSubject: vi.fn(async () => H.state.card),
  finaliseReportCard: vi.fn(async () => null),
  reopenReportCard: vi.fn(async () => null),
}));

vi.mock("@/repositories/dietitian/cadenceRepository", () => ({
  getNonEligibleDatesSince: vi.fn(async (_ids: string[], since: string) => {
    const map = new Map<string, string[]>();
    map.set(
      CUSTOMER,
      H.state.pausedDates.filter((date: string) => date >= since),
    );
    return map;
  }),
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
      let dates: string[] | null = null;
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: (_col: string, vals: string[]) => {
          dates = vals;
          return builder;
        },
        then: (resolve: any) =>
          resolve({
            data: H.state.logs.filter(
              (row: any) => dates === null || dates.includes(row.log_date),
            ),
            error: null,
          }),
      };
      return builder;
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { getReportCardDetail } from "@/services/ReportCardService";
import { buildLogSlots, slotDates } from "@/lib/dietitian/logSlots";
import { getISTDateString } from "@/lib/dates/ist";
import type { CustomerCategory } from "@/types/dietitian";

// ─── Helpers ───────────────────────────────────────────────────────────────

function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildCard(
  category: CustomerCategory,
  windowStart: string,
  windowEnd: string,
) {
  return {
    id: "rc-1",
    customerProfileId: CUSTOMER,
    subjectType: category === "ACCOMMODATION" ? ("STAY" as const) : ("SUBSCRIPTION" as const),
    subscriptionId: category === "ACCOMMODATION" ? null : "sub-1",
    stayEntryId: category === "ACCOMMODATION" ? "stay-1" : null,
    category,
    windowStart,
    windowEnd,
    status: "ACTIVE" as const,
    reportClosingComment: null,
    finalisedAt: null,
    finalisedBy: null,
    reopenCount: 0,
    lastReopenedAt: null,
    createdAt: `${windowStart}T00:00:00.000Z`,
    updatedAt: `${windowStart}T00:00:00.000Z`,
    isEditable: true,
    isReopenable: false,
    isRetrospective: false,
  };
}

/** An elapsed window plus an arbitrary subset of its days marked paused. */
const windowWithPauses = fc
  .record({
    category: fc.constantFrom<CustomerCategory>("MEAL", "KIT", "ACCOMMODATION"),
    offset: fc.integer({ min: 0, max: 200 }),
    length: fc.integer({ min: 0, max: 60 }),
    pausePicks: fc.array(fc.nat(), { maxLength: 20 }),
  })
  .map(({ category, offset, length, pausePicks }) => {
    const windowStart = addDays("2020-01-01", offset);
    const windowEnd = addDays(windowStart, length);
    const pausedDates = Array.from(
      new Set(pausePicks.map((pick) => addDays(windowStart, pick % (length + 1)))),
    );
    return { category, windowStart, windowEnd, pausedDates };
  });

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe("Property 14: Slot schedules agree with the Cadence_Engine", () => {
  it("produces the Cadence_Engine's dates AND indices for the same window", async () => {
    await fc.assert(
      fc.asyncProperty(windowWithPauses, async (scenario) => {
        const { category, windowStart, windowEnd, pausedDates } = scenario;
        H.reset();
        H.state.card = buildCard(category, windowStart, windowEnd);
        H.state.pausedDates = pausedDates;

        const detail = await getReportCardDetail("rc-1", "u-1");
        expect(detail).not.toBeNull();
        if (!detail) return;

        const expected = buildLogSlots(
          {
            category,
            windowStart,
            windowEnd,
            today: getISTDateString(),
            pausedDates,
          },
          { loggedDates: new Set(), editableLoggedDates: new Set() },
        );

        // Indices compared alongside dates: a schedule built with an empty
        // paused set and filtered afterwards would match on dates and diverge
        // here.
        expect(detail.slots.map((slot) => slot.date)).toEqual(
          expected.map((slot) => slot.date),
        );
        expect(detail.slots.map((slot) => slot.index)).toEqual(
          expected.map((slot) => slot.index),
        );
        expect(detail.totalSlots).toBe(expected.length);
      }),
      { numRuns: 100 },
    );
  });

  it("counts a slot as logged exactly when a Dietitian_Log exists for its date", async () => {
    await fc.assert(
      fc.asyncProperty(
        windowWithPauses,
        fc.array(fc.nat(), { maxLength: 15 }),
        async (scenario, logPicks) => {
          const { category, windowStart, windowEnd, pausedDates } = scenario;
          H.reset();
          H.state.card = buildCard(category, windowStart, windowEnd);
          H.state.pausedDates = pausedDates;

          const scheduled = slotDates({
            category,
            windowStart,
            windowEnd,
            today: getISTDateString(),
            pausedDates,
          });
          if (scheduled.length === 0) return;

          // Log a subset of the SCHEDULED dates, so `loggedSlots` is predictable.
          const loggedDates = Array.from(
            new Set(logPicks.map((pick) => scheduled[pick % scheduled.length])),
          );
          H.state.logs = loggedDates.map((log_date) => ({
            log_date,
            submission_date_ist: log_date,
            author_user_id: "u-other",
          }));

          const detail = await getReportCardDetail("rc-1", "u-1");
          expect(detail).not.toBeNull();
          if (!detail) return;

          expect(detail.loggedSlots).toBe(loggedDates.length);
          expect(detail.isComplete).toBe(
            scheduled.length > 0 && loggedDates.length === scheduled.length,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("forces every slot read-only when the report is not editable", async () => {
    await fc.assert(
      fc.asyncProperty(windowWithPauses, async (scenario) => {
        const { category, windowStart, windowEnd, pausedDates } = scenario;
        H.reset();
        // A permanently locked report: readable, never writable.
        H.state.card = {
          ...buildCard(category, windowStart, windowEnd),
          status: "CLOSED" as const,
          reportClosingComment: "Closed.",
          finalisedAt: "2020-06-01T00:00:00.000Z",
          isEditable: false,
          isReopenable: false,
        };
        H.state.pausedDates = pausedDates;

        const detail = await getReportCardDetail("rc-1", "u-1");
        expect(detail).not.toBeNull();
        if (!detail) return;

        // The display half of the write gate: no slot may offer an edit the
        // server would refuse.
        expect(detail.slots.every((slot) => slot.editable === false)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("treats a zero-slot window as incomplete rather than finished", async () => {
    H.reset();
    // A single-day MEAL window: cadence 3 schedules nothing.
    H.state.card = buildCard("MEAL", "2020-03-01", "2020-03-01");

    const detail = await getReportCardDetail("rc-1", "u-1");
    expect(detail).not.toBeNull();
    if (!detail) return;

    // Nothing to report on, so "complete" would be a false claim.
    expect(detail.totalSlots).toBe(0);
    expect(detail.isComplete).toBe(false);
  });
});
