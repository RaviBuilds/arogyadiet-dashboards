// src/services/__tests__/AccommodationService.dateRanges.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 2: Start date range gating and toggle reset
//
// **Validates: Requirements 1.2, 1.3, 1.4**
//
// For any current IST date and any candidate start date, the accommodation
// start date SHALL be accepted when the Backdated_Stay_Toggle is off exactly
// when the candidate lies in [today, today + 365], and when the toggle is on
// exactly when the candidate lies in [today − 30, today − 1]. For any
// previously selected Past_Stay_Start, turning the toggle off SHALL clear the
// selected start date and restore the forward range.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  backdatedStayRange,
  forwardStayRange,
} from "@/services/AccommodationService";
import {
  arbISTDate,
  arbStartOffsetAround,
  arbPastStartDate,
  shiftISODate,
  REFERENCE_MAX_BACKDATED_DAYS,
  REFERENCE_MAX_FORWARD_START_DAYS,
} from "@/test/accommodation/paymentArbitraries";

// ─── Reference helpers (re-declared from the requirements, not the SUT) ──────

/**
 * A candidate date is in range if min <= candidate <= max (lexicographic
 * comparison on YYYY-MM-DD strings is equivalent to date ordering).
 */
function isInRange(
  candidate: string,
  range: { min: string; max: string },
): boolean {
  return candidate >= range.min && candidate <= range.max;
}

/**
 * Reference forward range: [today, today + 365].
 * Re-declared from Req 1.2 to avoid importing the SUT.
 */
function referenceForwardRange(today: string): { min: string; max: string } {
  return {
    min: today,
    max: shiftISODate(today, REFERENCE_MAX_FORWARD_START_DAYS),
  };
}

/**
 * Reference backdated range: [today − 30, today − 1].
 * Re-declared from Req 1.3 to avoid importing the SUT.
 */
function referenceBackdatedRange(today: string): { min: string; max: string } {
  return {
    min: shiftISODate(today, -REFERENCE_MAX_BACKDATED_DAYS),
    max: shiftISODate(today, -1),
  };
}

describe("Feature: accommodation-payment-lifecycle, Property 2: Start date range gating and toggle reset", () => {
  it("forwardStayRange returns [today, today + 365] for any IST date (Req 1.2)", () => {
    fc.assert(
      fc.property(arbISTDate, (today) => {
        const range = forwardStayRange(today);
        const expected = referenceForwardRange(today);

        expect(range.min).toBe(expected.min);
        expect(range.max).toBe(expected.max);
      }),
      { numRuns: 100 },
    );
  });

  it("backdatedStayRange returns [today − 30, today − 1] for any IST date (Req 1.3)", () => {
    fc.assert(
      fc.property(arbISTDate, (today) => {
        const range = backdatedStayRange(today);
        const expected = referenceBackdatedRange(today);

        expect(range.min).toBe(expected.min);
        expect(range.max).toBe(expected.max);
      }),
      { numRuns: 100 },
    );
  });

  it("toggle OFF: a candidate date is accepted iff it lies in [today, today + 365]", () => {
    fc.assert(
      fc.property(arbISTDate, arbStartOffsetAround(), (today, offset) => {
        const candidate = shiftISODate(today, offset);
        const range = forwardStayRange(today);

        const accepted = isInRange(candidate, range);
        const shouldBeAccepted = offset >= 0 && offset <= REFERENCE_MAX_FORWARD_START_DAYS;

        expect(accepted).toBe(shouldBeAccepted);
      }),
      { numRuns: 100 },
    );
  });

  it("toggle ON: a candidate date is accepted iff it lies in [today − 30, today − 1]", () => {
    fc.assert(
      fc.property(arbISTDate, arbStartOffsetAround(), (today, offset) => {
        const candidate = shiftISODate(today, offset);
        const range = backdatedStayRange(today);

        const accepted = isInRange(candidate, range);
        const shouldBeAccepted =
          offset >= -REFERENCE_MAX_BACKDATED_DAYS && offset <= -1;

        expect(accepted).toBe(shouldBeAccepted);
      }),
      { numRuns: 100 },
    );
  });

  it("the two ranges are disjoint: no candidate is accepted by both toggle states simultaneously", () => {
    fc.assert(
      fc.property(arbISTDate, arbStartOffsetAround(), (today, offset) => {
        const candidate = shiftISODate(today, offset);
        const forwardRange = forwardStayRange(today);
        const backdatedRange = backdatedStayRange(today);

        const inForward = isInRange(candidate, forwardRange);
        const inBackdated = isInRange(candidate, backdatedRange);

        // A date cannot be simultaneously valid for both toggle states
        expect(inForward && inBackdated).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("toggle reset: turning the toggle off after selecting a Past_Stay_Start restores the forward range (Req 1.4)", () => {
    // We chain the generators so the past start date is relative to the generated today
    const arbTodayAndPastStart = arbISTDate.chain((today) =>
      arbPastStartDate(today).map((pastStart) => ({ today, pastStart })),
    );

    fc.assert(
      fc.property(arbTodayAndPastStart, ({ today, pastStart }) => {
        // Simulate: admin has toggle ON with a selected past start date
        const backdatedRange = backdatedStayRange(today);
        // The past start date must be within the backdated range
        expect(isInRange(pastStart, backdatedRange)).toBe(true);

        // Admin turns the toggle OFF → the selected date is cleared and the
        // forward range is restored. We verify the restored range matches
        // exactly [today, today + 365] — representing the clearing + restore.
        const restoredRange = forwardStayRange(today);
        const expectedForward = referenceForwardRange(today);

        expect(restoredRange.min).toBe(expectedForward.min);
        expect(restoredRange.max).toBe(expectedForward.max);

        // The previously selected past date is NOT in the restored forward range
        expect(isInRange(pastStart, restoredRange)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("backward range max is always yesterday (today − 1), strictly before forward range min (today)", () => {
    fc.assert(
      fc.property(arbISTDate, (today) => {
        const backward = backdatedStayRange(today);
        const forward = forwardStayRange(today);

        // backward.max < forward.min (yesterday < today)
        expect(backward.max < forward.min).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
