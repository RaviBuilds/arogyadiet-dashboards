// src/test/dietitian/log-dates.property.test.ts
// Feature: dietitian-management, Property 24
//
// Property 24: Selectable log dates are the Eligible_Days of the trailing
// 7 days.
//
// For any Logging_Window, set of Paused_Days and current IST date, the set of
// log dates the form offers equals the Eligible_Days that fall within the
// trailing 7 days up to and including the current IST date.
//
// The expected truth is derived independently by enumeration: the trailing
// calendar days are listed from `today` backwards with `addDays`, and each is
// kept only when the *reference* Eligible_Day rule (in the Logging_Window, not
// after `today`, not paused — re-declared in `arbitraries.eligibleDaysOf` from
// the design, not imported from `cadence`) accepts it. Nothing in the reference
// model consults `logDates.ts`.
//
// **Validates: Requirements 15.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  SELECTABLE_LOG_DATE_WINDOW_DAYS,
  defaultLogDate,
  isEligibleLogDate,
  selectableLogDates,
  type SelectableLogDatesInput,
} from "@/lib/dietitian/logDates";
import {
  activeLoggingWindowArb,
  addDays,
  enumerateDates,
  istDateArb,
  loggingWindowArb,
  eligibleDaysOf,
  type LoggingWindowSample,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 150;

/** The window generators chain several arbitraries, so give each test room. */
const TEST_TIMEOUT_MS = 60_000;

/** Projects a generated Logging_Window onto the picker's input. */
function toInput(sample: LoggingWindowSample): SelectableLogDatesInput {
  return {
    windowStart: sample.windowStart,
    windowEnd: sample.windowEnd,
    today: sample.today,
    pausedDates: sample.pausedDates,
  };
}

/**
 * The trailing 7 calendar days up to and including `today`, ascending —
 * enumerated from the constant rather than hard-coded, so the window length and
 * the reference model cannot drift apart.
 */
function trailingDays(today: string): string[] {
  return enumerateDates(
    addDays(today, -(SELECTABLE_LOG_DATE_WINDOW_DAYS - 1)),
    today,
  );
}

/** Reference model: Eligible_Days ∩ trailing 7 days, ascending. */
function expectedSelectableDates(sample: LoggingWindowSample): string[] {
  const eligible = new Set(eligibleDaysOf(sample));
  return trailingDays(sample.today).filter((date) => eligible.has(date));
}

describe("Property 24: Selectable log dates are the Eligible_Days of the trailing 7 days", () => {
  it("offers exactly the trailing-7-day Eligible_Days, ascending and duplicate-free", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        const actual = selectableLogDates(toInput(sample));

        expect(actual).toEqual(expectedSelectableDates(sample));
        expect(actual.length).toBeLessThanOrEqual(
          SELECTABLE_LOG_DATE_WINDOW_DAYS,
        );

        // Ascending, strictly: sorted and free of duplicates.
        expect(actual).toEqual([...actual].sort());
        expect(new Set(actual).size).toBe(actual.length);
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("never offers a future, paused or out-of-window date", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(activeLoggingWindowArb, (sample) => {
        const input = toInput(sample);
        const paused = new Set(sample.pausedDates);
        const earliest = addDays(
          sample.today,
          -(SELECTABLE_LOG_DATE_WINDOW_DAYS - 1),
        );

        for (const date of selectableLogDates(input)) {
          expect(date <= sample.today).toBe(true);
          expect(date >= earliest).toBe(true);
          expect(date >= sample.windowStart).toBe(true);
          expect(date <= sample.windowEnd).toBe(true);
          expect(paused.has(date)).toBe(false);
          expect(isEligibleLogDate(date, input)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("isEligibleLogDate accepts a trailing date exactly when the picker offers it", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        const input = toInput(sample);
        const offered = new Set(selectableLogDates(input));
        const eligible = new Set(eligibleDaysOf(sample));

        for (const date of trailingDays(sample.today)) {
          expect(isEligibleLogDate(date, input)).toBe(eligible.has(date));
          expect(offered.has(date)).toBe(eligible.has(date));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("offers nothing when the Logging_Window starts after today", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(
        istDateArb,
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 45 }),
        (today, startOffset, windowLength) => {
          const windowStart = addDays(today, startOffset);
          const input: SelectableLogDatesInput = {
            windowStart,
            windowEnd: addDays(windowStart, windowLength),
            today,
            pausedDates: [],
          };

          expect(selectableLogDates(input)).toEqual([]);
          expect(defaultLogDate(input)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("offers nothing when every trailing day is paused", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        const input: SelectableLogDatesInput = {
          ...toInput(sample),
          pausedDates: Array.from(
            new Set([...sample.pausedDates, ...trailingDays(sample.today)]),
          ),
        };

        expect(selectableLogDates(input)).toEqual([]);
        expect(defaultLogDate(input)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("defaults to today when selectable, otherwise the latest selectable date, otherwise null", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    fc.assert(
      fc.property(loggingWindowArb(), (sample) => {
        const input = toInput(sample);
        const offered = expectedSelectableDates(sample);
        const actual = defaultLogDate(input);

        if (offered.length === 0) {
          expect(actual).toBeNull();
          return;
        }

        if (offered.includes(sample.today)) {
          expect(actual).toBe(sample.today);
        } else {
          expect(actual).toBe(offered[offered.length - 1]);
          expect(actual).not.toBe(sample.today);
        }

        // The default is always one of the offered dates (Req 15.5 stays
        // inside the offered set).
        expect(offered).toContain(actual as string);
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);

  it("pins the trailing selection window at 7 calendar days", () => {
    /**
     * **Validates: Requirements 15.6**
     */
    expect(SELECTABLE_LOG_DATE_WINDOW_DAYS).toBe(7);
    fc.assert(
      fc.property(istDateArb, (today) => {
        const days = trailingDays(today);
        expect(days.length).toBe(7);
        expect(days[days.length - 1]).toBe(today);
        expect(days[0]).toBe(addDays(today, -6));
      }),
      { numRuns: NUM_RUNS },
    );
  }, TEST_TIMEOUT_MS);
});
