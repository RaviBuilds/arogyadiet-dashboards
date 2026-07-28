// src/lib/dietitian/__tests__/cadence-reference-model.property.test.ts
// Feature: dietitian-management, Property 20: The Cadence_Engine agrees with a
// naive day-by-day reference model
//
// Property 20: For any Customer_Category, Logging_Window, current IST date, set
// of Paused_Days, Last_Dietitian_Log_Date (including none) and subscription
// status, `computeCadence` produces the same Cadence_Interval, Days_Not_Logged,
// Pending_Log_Count and Paused_Days_Count as a reference implementation that
// enumerates the window day by day; and the results satisfy: Days_Not_Logged is
// between 0 and the count of Eligible_Days in the window, Pending_Log_Count
// equals floor(Days_Not_Logged / Cadence_Interval) and is greater than 0 iff
// Days_Not_Logged is at least the Cadence_Interval, a non-`ACTIVE` status yields
// zeros, a log dated today yields zeros, and no Paused_Day contributes to
// Days_Not_Logged.
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9,
// 14.10, 14.12, 14.13, 19.9
// **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.12, 14.13, 19.9**
//
// The reference model below is written independently of `cadence.ts`: it filters
// an explicit day-by-day enumeration of the clamped Logging_Window and draws its
// Cadence_Intervals from `REFERENCE_CADENCE_INTERVALS` in the shared arbitraries
// (declared from the design, not imported from the module under test). The naive
// version is the specification; the shipped version is the optimised one.
//
// Reading of Req 14.9 used here: Paused_Days_Count counts Paused_Days that lie
// INSIDE the clamped Logging_Window and strictly after the
// Last_Dietitian_Log_Date. `Paused_Day` is defined against the governing
// subscription's daily preferences, so dates outside its window are not part of
// the count, and the window restriction is what makes the accounting exact —
// `daysNotLogged + pausedDaysCount` equals the number of window days strictly
// after `effectiveLastLogDate`. The shared arbitraries deliberately emit stray
// paused dates outside the window to exercise this.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ACTIVE_SUBSCRIPTION_STATUS,
  CADENCE_INTERVALS,
  cadenceIntervalFor,
  computeCadence,
  type CadenceInput,
  type CadenceSnapshot,
} from "@/lib/dietitian/cadence";
import {
  CUSTOMER_CATEGORIES,
  REFERENCE_CADENCE_INTERVALS,
  activeLoggingWindowArb,
  addDays,
  eligibleDaysOf,
  enumerateDates,
  loggingWindowArb,
  type LoggingWindowSample,
} from "@/test/dietitian/arbitraries";

const RUNS = 150;

/** Generous per-test budget: the shared window generators are chain-heavy. */
const TEST_TIMEOUT_MS = 60_000;

// ─── Naive day-by-day reference model (the specification) ────────────────────

/**
 * Enumerates the clamped Logging_Window one day at a time and classifies each
 * day, with no arithmetic shortcuts. Mirrors the requirement text literally:
 *
 * - the window is `windowStart … min(windowEnd, today)` (Logging_Window, Req 14.3)
 * - an Eligible_Day is a window day that is not a Paused_Day (Req 14.3, 14.8)
 * - `effectiveLastLogDate` is the Last_Dietitian_Log_Date, or `windowStart − 1`
 *   when the customer has no Dietitian_Log (Req 14.6)
 * - Days_Not_Logged counts Eligible_Days strictly after it (Req 14.4)
 * - Paused_Days_Count counts the window's Paused_Days strictly after it (Req 14.9)
 * - Pending_Log_Count is the integer quotient (Req 14.5)
 * - a non-`ACTIVE` status reports zeros (Req 14.7)
 */
function referenceCadence(sample: LoggingWindowSample): CadenceSnapshot {
  const cadenceInterval = REFERENCE_CADENCE_INTERVALS[sample.category];
  const effectiveLastLogDate =
    sample.lastDietitianLogDate === null
      ? addDays(sample.windowStart, -1)
      : sample.lastDietitianLogDate;

  if (sample.subscriptionStatus !== "ACTIVE") {
    return {
      cadenceInterval,
      effectiveLastLogDate,
      daysNotLogged: 0,
      pendingLogCount: 0,
      pausedDaysCount: 0,
      eligibleDaysInWindow: 0,
    };
  }

  const clampedEnd =
    sample.today < sample.windowEnd ? sample.today : sample.windowEnd;
  const pausedLookup = new Set(sample.pausedDates);

  let eligibleDaysInWindow = 0;
  let daysNotLogged = 0;
  let pausedDaysCount = 0;

  for (const day of enumerateDates(sample.windowStart, clampedEnd)) {
    const paused = pausedLookup.has(day);
    if (!paused) eligibleDaysInWindow += 1;
    if (day <= effectiveLastLogDate) continue;
    if (paused) pausedDaysCount += 1;
    else daysNotLogged += 1;
  }

  return {
    cadenceInterval,
    effectiveLastLogDate,
    daysNotLogged,
    pendingLogCount: Math.floor(daysNotLogged / cadenceInterval),
    pausedDaysCount,
    eligibleDaysInWindow,
  };
}

/** A sample is `CadenceInput` field-for-field. */
function toInput(sample: LoggingWindowSample): CadenceInput {
  return sample;
}

describe("Property 20: Cadence_Engine vs naive day-by-day reference model", () => {
  it("agrees with the reference model on every snapshot field", () => {
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        expect(computeCadence(toInput(sample))).toEqual(
          referenceCadence(sample),
        );
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("assigns Cadence_Interval 1 to ACCOMMODATION and 3 to MEAL and KIT", () => {
    // Req 14.1, 14.2
    fc.assert(
      fc.property(fc.constantFrom(...CUSTOMER_CATEGORIES), (category) => {
        expect(cadenceIntervalFor(category)).toBe(
          REFERENCE_CADENCE_INTERVALS[category],
        );
        expect(CADENCE_INTERVALS[category]).toBe(
          REFERENCE_CADENCE_INTERVALS[category],
        );
      }),
      { numRuns: RUNS },
    );
    expect(cadenceIntervalFor("ACCOMMODATION")).toBe(1);
    expect(cadenceIntervalFor("MEAL")).toBe(3);
    expect(cadenceIntervalFor("KIT")).toBe(3);
  });

  it("treats a missing Dietitian_Log as the day before the window start", () => {
    // Req 14.6
    fc.assert(
      fc.property(
        loggingWindowArb().map((sample) => ({
          ...sample,
          lastDietitianLogDate: null,
        })),
        (sample) => {
          expect(computeCadence(toInput(sample)).effectiveLastLogDate).toBe(
            addDays(sample.windowStart, -1),
          );
        },
      ),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("keeps Days_Not_Logged within 0 and the window's Eligible_Day count", () => {
    // Req 14.13, and Req 19.9's cadence-level accounting bound
    fc.assert(
      fc.property(activeLoggingWindowArb, (sample) => {
        const snapshot = computeCadence(toInput(sample));
        expect(snapshot.eligibleDaysInWindow).toBe(eligibleDaysOf(sample).length);
        expect(snapshot.daysNotLogged).toBeGreaterThanOrEqual(0);
        expect(snapshot.daysNotLogged).toBeLessThanOrEqual(
          snapshot.eligibleDaysInWindow,
        );
        expect(snapshot.pendingLogCount).toBeLessThanOrEqual(
          Math.floor(
            snapshot.eligibleDaysInWindow / snapshot.cadenceInterval,
          ),
        );
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("derives Pending_Log_Count as the integer quotient, positive iff overdue", () => {
    // Req 14.5, 14.12
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        const snapshot = computeCadence(toInput(sample));
        expect(snapshot.pendingLogCount).toBe(
          Math.floor(snapshot.daysNotLogged / snapshot.cadenceInterval),
        );
        expect(snapshot.pendingLogCount > 0).toBe(
          snapshot.daysNotLogged >= snapshot.cadenceInterval,
        );
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("reports zeros while the governing subscription is not ACTIVE", () => {
    // Req 14.7
    fc.assert(
      fc.property(
        loggingWindowArb(),
        fc.constantFrom("PAUSED", "CANCELLED", "COMPLETED", "EXPIRED", "PENDING"),
        (sample, status) => {
          const snapshot = computeCadence(toInput({ ...sample, subscriptionStatus: status }));
          expect(status).not.toBe(ACTIVE_SUBSCRIPTION_STATUS);
          expect(snapshot.daysNotLogged).toBe(0);
          expect(snapshot.pendingLogCount).toBe(0);
          expect(snapshot.pausedDaysCount).toBe(0);
          expect(snapshot.eligibleDaysInWindow).toBe(0);
        },
      ),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("reports zeros when a Dietitian_Log is dated the current IST date", () => {
    // Req 14.10
    fc.assert(
      fc.property(
        activeLoggingWindowArb.map((sample) => ({
          ...sample,
          lastDietitianLogDate: sample.today,
        })),
        (sample) => {
          const snapshot = computeCadence(toInput(sample));
          expect(snapshot.daysNotLogged).toBe(0);
          expect(snapshot.pendingLogCount).toBe(0);
        },
      ),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("never counts a Paused_Day towards Days_Not_Logged", () => {
    // Req 14.3, 14.8, 14.9 — the counted interval splits exactly into
    // Days_Not_Logged and Paused_Days_Count, and an all-paused window yields 0.
    fc.assert(
      fc.property(activeLoggingWindowArb, (sample) => {
        const snapshot = computeCadence(toInput(sample));
        const clampedEnd =
          sample.today < sample.windowEnd ? sample.today : sample.windowEnd;
        const countedDays = enumerateDates(sample.windowStart, clampedEnd).filter(
          (day) => day > snapshot.effectiveLastLogDate,
        );
        expect(snapshot.daysNotLogged + snapshot.pausedDaysCount).toBe(
          countedDays.length,
        );

        const pausedLookup = new Set(sample.pausedDates);
        const notLoggedDays = countedDays.filter((day) => !pausedLookup.has(day));
        expect(snapshot.daysNotLogged).toBe(notLoggedDays.length);
        expect(notLoggedDays.some((day) => pausedLookup.has(day))).toBe(false);

        const allPaused = computeCadence(
          toInput({
            ...sample,
            pausedDates: enumerateDates(sample.windowStart, clampedEnd),
          }),
        );
        expect(allPaused.daysNotLogged).toBe(0);
        expect(allPaused.eligibleDaysInWindow).toBe(0);
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);
});
