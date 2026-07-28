// src/lib/dietitian/__tests__/cadence-pause-monotonicity.property.test.ts
// Feature: dietitian-management, Property 21: Pausing an Eligible_Day never
// increases Days_Not_Logged
//
// Property 21: For any cadence input and any Eligible_Day within its window,
// converting that day into a Paused_Day yields a Days_Not_Logged value less than
// or equal to the original.
//
// **Validates: Requirements 14.11**
//
// The three tests below cover the two structurally different positions a newly
// paused Eligible_Day can occupy, plus the general many-days case:
//
// - the day lies INSIDE the counted interval (strictly after
//   `effectiveLastLogDate`), where Days_Not_Logged must drop by exactly one and
//   the day moves into Paused_Days_Count;
// - the day lies BEFORE the counted interval (at or before
//   `effectiveLastLogDate`), where Days_Not_Logged must be unchanged;
// - any subset of Eligible_Days paused at once, where Days_Not_Logged must not
//   increase.
//
// Every sample uses an ACTIVE governing subscription: a non-ACTIVE status zeroes
// the counts (Req 14.7), which makes the monotonicity claim vacuous.

import { describe, it, expect } from "vitest";
import { computeCadence, type CadenceInput } from "@/lib/dietitian/cadence";
import * as fc from "fast-check";
import {
  activeLoggingWindowArb,
  addDays,
  eligibleDaysOf,
  loggingWindowArb,
  type LoggingWindowSample,
} from "@/test/dietitian/arbitraries";

const RUNS = 150;

/** Generous per-test budget: the shared window generators are chain-heavy. */
const TEST_TIMEOUT_MS = 60_000;

/** A sample is `CadenceInput` field-for-field. */
function toInput(sample: LoggingWindowSample): CadenceInput {
  return sample;
}

/** Req 14.6 — the Last_Dietitian_Log_Date, or the day before the window start. */
function effectiveLastLogDateOf(sample: LoggingWindowSample): string {
  return sample.lastDietitianLogDate ?? addDays(sample.windowStart, -1);
}

/** Returns the sample with `days` added to its Paused_Days. */
function withPaused(
  sample: LoggingWindowSample,
  days: readonly string[],
): LoggingWindowSample {
  return {
    ...sample,
    pausedDates: Array.from(new Set([...sample.pausedDates, ...days])).sort(),
  };
}

/** The Eligible_Days that fall inside the counted interval (Req 14.4). */
function countedEligibleDaysOf(sample: LoggingWindowSample): string[] {
  const effectiveLastLogDate = effectiveLastLogDateOf(sample);
  return eligibleDaysOf(sample).filter((day) => day > effectiveLastLogDate);
}

/** A sample plus one Eligible_Day strictly after `effectiveLastLogDate`. */
const pausedDayInsideIntervalArb: fc.Arbitrary<{
  sample: LoggingWindowSample;
  day: string;
}> = activeLoggingWindowArb
  .filter((sample) => countedEligibleDaysOf(sample).length > 0)
  .chain((sample) =>
    fc
      .constantFrom(...countedEligibleDaysOf(sample))
      .map((day) => ({ sample, day })),
  );

/**
 * A sample plus one Eligible_Day at or before `effectiveLastLogDate`. Built by
 * moving the Last_Dietitian_Log_Date onto a later Eligible_Day, so an earlier
 * Eligible_Day is guaranteed to exist outside the counted interval.
 */
const pausedDayBeforeIntervalArb: fc.Arbitrary<{
  sample: LoggingWindowSample;
  day: string;
}> = activeLoggingWindowArb
  .filter((sample) => eligibleDaysOf(sample).length >= 2)
  .chain((sample) => {
    const eligible = eligibleDaysOf(sample);
    return fc
      .integer({ min: 1, max: eligible.length - 1 })
      .chain((logIndex) =>
        fc.integer({ min: 0, max: logIndex - 1 }).map((pauseIndex) => ({
          sample: { ...sample, lastDietitianLogDate: eligible[logIndex] },
          day: eligible[pauseIndex],
        })),
      );
  });

describe("Property 21: pausing an Eligible_Day never increases Days_Not_Logged", () => {
  it("never increases Days_Not_Logged when any subset of Eligible_Days is paused", () => {
    fc.assert(
      fc.property(
        loggingWindowArb({ statuses: ["ACTIVE"] }).chain((sample) => {
          const eligible = eligibleDaysOf(sample);
          return (
            eligible.length === 0
              ? fc.constant<string[]>([])
              : fc.subarray(eligible)
          ).map((days) => ({ sample, days }));
        }),
        ({ sample, days }) => {
          const before = computeCadence(toInput(sample));
          const after = computeCadence(toInput(withPaused(sample, days)));
          expect(after.daysNotLogged).toBeLessThanOrEqual(before.daysNotLogged);
        },
      ),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("drops Days_Not_Logged by exactly one when the paused day is inside the counted interval", () => {
    fc.assert(
      fc.property(pausedDayInsideIntervalArb, ({ sample, day }) => {
        const before = computeCadence(toInput(sample));
        const after = computeCadence(toInput(withPaused(sample, [day])));

        expect(day > before.effectiveLastLogDate).toBe(true);
        expect(after.daysNotLogged).toBeLessThanOrEqual(before.daysNotLogged);
        expect(after.daysNotLogged).toBe(before.daysNotLogged - 1);
        // The day is not lost: it becomes a Paused_Day of the same interval.
        expect(after.pausedDaysCount).toBe(before.pausedDaysCount + 1);
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("leaves Days_Not_Logged unchanged when the paused day is before the counted interval", () => {
    fc.assert(
      fc.property(pausedDayBeforeIntervalArb, ({ sample, day }) => {
        const before = computeCadence(toInput(sample));
        const after = computeCadence(toInput(withPaused(sample, [day])));

        expect(day <= before.effectiveLastLogDate).toBe(true);
        expect(after.daysNotLogged).toBeLessThanOrEqual(before.daysNotLogged);
        expect(after.daysNotLogged).toBe(before.daysNotLogged);
      }),
      { numRuns: RUNS },
    );
  }, TEST_TIMEOUT_MS);
});
