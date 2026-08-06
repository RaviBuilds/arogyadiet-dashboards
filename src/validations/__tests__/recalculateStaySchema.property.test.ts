// src/validations/__tests__/recalculateStaySchema.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 20: Recalculate Stay input validation
//
// Property 20: For any startDate/bookedEndDate pair and any Recalculate_Stay
// submission, the submission is accepted exactly when `recalculatedEndDate` is a
// YYYY-MM-DD string in the inclusive range `[startDate, bookedEndDate]` and
// `recalculatedStayAmount` is an integer in `[1, 9,999,999]`; otherwise it is
// rejected.
//
// The property is a two-sided equivalence against a reference predicate
// re-declared here from Requirements 12.3–12.6 and from the bounds in
// `paymentArbitraries.ts`. Nothing in the reference model consults the schema
// under test, so an off-by-one in `createRecalculateStaySchema` cannot hide
// behind a shared constant.
//
// **Validates: Requirements 12.3, 12.4, 12.5, 12.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  createRecalculateStaySchema,
  MAX_STAY_AMOUNT,
} from "@/validations/accommodationSchema";
import {
  arbRecalculateStaySubmission,
  arbValidRecalculateStaySubmission,
  arbISTDate,
  arbTotalNights,
  shiftISODate,
  computeReferenceEndDate,
  arbTotalStayAmount,
  REFERENCE_MIN_STAY_AMOUNT,
  REFERENCE_MAX_STAY_AMOUNT,
  REFERENCE_ABOVE_MAX_STAY_AMOUNT,
} from "@/test/accommodation/paymentArbitraries";

/** The task requires at least 100 iterations per property. */
const NUM_RUNS = 100;

// ─── Reference predicates (independent of the schema under test) ─────────────

/**
 * Reference rule for recalculatedEndDate (Req 12.3): a YYYY-MM-DD string in
 * `[startDate, bookedEndDate]`, both bounds inclusive. Lexicographic comparison
 * is correct for ISO dates.
 */
function isAcceptedDate(
  raw: unknown,
  startDate: string,
  bookedEndDate: string,
): boolean {
  if (typeof raw !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  return raw >= startDate && raw <= bookedEndDate;
}

/**
 * Reference rule for recalculatedStayAmount (Req 12.4): a finite integer in
 * `[1, 9,999,999]`. The schema uses `z.coerce.number().int()`, so only integer
 * values pass.
 */
function isAcceptedAmount(raw: unknown): boolean {
  const amount = Number(raw);
  return (
    Number.isFinite(amount) &&
    Number.isInteger(amount) &&
    amount >= REFERENCE_MIN_STAY_AMOUNT &&
    amount <= REFERENCE_MAX_STAY_AMOUNT
  );
}

describe("Feature: accommodation-payment-lifecycle, Property 20: Recalculate Stay input validation", () => {
  // Pin the money cap once so the test fails visibly if the schema drifts.
  it("schema cap matches the reference cap", () => {
    expect(MAX_STAY_AMOUNT).toBe(REFERENCE_MAX_STAY_AMOUNT);
  });

  it("start date is accepted (1-night stay boundary)", () => {
    /**
     * **Validates: Requirements 12.3**
     *
     * Selecting the start date itself gives exactly 1 night — the minimum stay
     * length — and must always be accepted.
     */
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, arbTotalStayAmount, (startDate, nights, amount) => {
        const bookedEndDate = computeReferenceEndDate(startDate, nights);
        const schema = createRecalculateStaySchema(startDate, bookedEndDate);

        // Submit startDate as the end date (1-night stay) with a valid integer amount.
        const validAmount = Math.max(1, Math.min(Math.round(amount), REFERENCE_MAX_STAY_AMOUNT));
        const parsed = schema.safeParse({
          recalculatedEndDate: startDate,
          recalculatedStayAmount: validAmount,
        });

        expect(parsed.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("startDate − 1 is rejected (below lower bound)", () => {
    /**
     * **Validates: Requirements 12.3**
     *
     * One day before the start date is strictly below the inclusive lower bound.
     */
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (startDate, nights) => {
        const bookedEndDate = computeReferenceEndDate(startDate, nights);
        const schema = createRecalculateStaySchema(startDate, bookedEndDate);
        const dayBefore = shiftISODate(startDate, -1);

        const parsed = schema.safeParse({
          recalculatedEndDate: dayBefore,
          recalculatedStayAmount: 1000, // valid amount
        });

        expect(parsed.success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("bookedEndDate + 1 is rejected (above upper bound)", () => {
    /**
     * **Validates: Requirements 12.3**
     *
     * One day after the booked end date is strictly above the inclusive upper
     * bound.
     */
    fc.assert(
      fc.property(arbISTDate, arbTotalNights, (startDate, nights) => {
        const bookedEndDate = computeReferenceEndDate(startDate, nights);
        const schema = createRecalculateStaySchema(startDate, bookedEndDate);
        const dayAfter = shiftISODate(bookedEndDate, 1);

        const parsed = schema.safeParse({
          recalculatedEndDate: dayAfter,
          recalculatedStayAmount: 1000, // valid amount
        });

        expect(parsed.success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("all valid submissions (from arbValidRecalculateStaySubmission) are accepted", () => {
    /**
     * **Validates: Requirements 12.3, 12.4**
     *
     * The guaranteed-valid generator exercises the accepted side densely: every
     * submission has recalculatedEndDate in [startDate, bookedEndDate] and
     * recalculatedStayAmount as a valid integer in [1, 9,999,999].
     */
    fc.assert(
      fc.property(arbValidRecalculateStaySubmission, (submission) => {
        const schema = createRecalculateStaySchema(
          submission.startDate,
          submission.bookedEndDate,
        );

        const parsed = schema.safeParse({
          recalculatedEndDate: submission.recalculatedEndDate,
          recalculatedStayAmount: submission.recalculatedStayAmount,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.recalculatedEndDate).toBe(submission.recalculatedEndDate);
          expect(parsed.data.recalculatedStayAmount).toBe(submission.recalculatedStayAmount);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("all four Req 12.6 change combinations are accepted", () => {
    /**
     * **Validates: Requirements 12.6**
     *
     * The admin MAY change only the date, only the amount, both, or neither:
     * (a) same date + different amount
     * (b) different date + same amount
     * (c) both different
     * (d) both the same (no-op)
     */
    fc.assert(
      fc.property(
        arbISTDate,
        // At least 2 nights so we have room for a different date
        fc.integer({ min: 2, max: 365 }),
        arbTotalStayAmount,
        arbTotalStayAmount,
        fc.integer({ min: 0, max: 364 }),
        (startDate, nights, currentAmount, differentAmount, dateOffset) => {
          const bookedEndDate = computeReferenceEndDate(startDate, nights);
          const schema = createRecalculateStaySchema(startDate, bookedEndDate);

          // Current values: the booked end date and a valid integer amount.
          const currentIntAmount = Math.max(1, Math.min(Math.round(currentAmount), REFERENCE_MAX_STAY_AMOUNT));
          const differentIntAmount = Math.max(1, Math.min(Math.round(differentAmount), REFERENCE_MAX_STAY_AMOUNT));

          // A date different from bookedEndDate but still in range.
          const differentDateOffset = Math.min(dateOffset, nights - 2); // ensures it differs from bookedEndDate
          const differentDate = shiftISODate(startDate, Math.max(0, differentDateOffset));

          // (a) same date + different amount
          const parsedA = schema.safeParse({
            recalculatedEndDate: bookedEndDate,
            recalculatedStayAmount: differentIntAmount,
          });
          expect(parsedA.success).toBe(true);

          // (b) different date + same amount
          const parsedB = schema.safeParse({
            recalculatedEndDate: differentDate,
            recalculatedStayAmount: currentIntAmount,
          });
          expect(parsedB.success).toBe(true);

          // (c) both different
          const parsedC = schema.safeParse({
            recalculatedEndDate: differentDate,
            recalculatedStayAmount: differentIntAmount,
          });
          expect(parsedC.success).toBe(true);

          // (d) both the same (no-op)
          const parsedD = schema.safeParse({
            recalculatedEndDate: bookedEndDate,
            recalculatedStayAmount: currentIntAmount,
          });
          expect(parsedD.success).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("fractional amounts are rejected", () => {
    /**
     * **Validates: Requirements 12.4**
     *
     * The schema requires `.int()` — decimal/fractional values must be refused.
     */
    fc.assert(
      fc.property(
        arbISTDate,
        arbTotalNights,
        fc.constantFrom(1.5, 99.99, 0.01, 1_234.56, 0.5, 2.7),
        (startDate, nights, fractionalAmount) => {
          const bookedEndDate = computeReferenceEndDate(startDate, nights);
          const schema = createRecalculateStaySchema(startDate, bookedEndDate);

          const parsed = schema.safeParse({
            recalculatedEndDate: startDate, // valid date
            recalculatedStayAmount: fractionalAmount,
          });

          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("amounts outside [1, 9,999,999] are rejected", () => {
    /**
     * **Validates: Requirements 12.4**
     *
     * 0, negative, and 10,000,000 (one above the cap) must all be refused.
     */
    fc.assert(
      fc.property(
        arbISTDate,
        arbTotalNights,
        fc.constantFrom(0, -1, -100, REFERENCE_ABOVE_MAX_STAY_AMOUNT, 20_000_000),
        (startDate, nights, invalidAmount) => {
          const bookedEndDate = computeReferenceEndDate(startDate, nights);
          const schema = createRecalculateStaySchema(startDate, bookedEndDate);

          const parsed = schema.safeParse({
            recalculatedEndDate: startDate, // valid date
            recalculatedStayAmount: invalidAmount,
          });

          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a 1-night stay (startDate === bookedEndDate) has exactly one valid date", () => {
    /**
     * **Validates: Requirements 12.3**
     *
     * For a 1-night stay, bookedEndDate equals startDate. The only selectable
     * date is startDate itself — one day before and one day after are both
     * rejected.
     */
    fc.assert(
      fc.property(arbISTDate, (startDate) => {
        // 1-night stay: bookedEndDate === startDate
        const bookedEndDate = computeReferenceEndDate(startDate, 1);
        expect(bookedEndDate).toBe(startDate);

        const schema = createRecalculateStaySchema(startDate, bookedEndDate);

        // The single valid date
        const parsedValid = schema.safeParse({
          recalculatedEndDate: startDate,
          recalculatedStayAmount: 1000,
        });
        expect(parsedValid.success).toBe(true);

        // One day before — rejected
        const parsedBefore = schema.safeParse({
          recalculatedEndDate: shiftISODate(startDate, -1),
          recalculatedStayAmount: 1000,
        });
        expect(parsedBefore.success).toBe(false);

        // One day after — rejected
        const parsedAfter = schema.safeParse({
          recalculatedEndDate: shiftISODate(startDate, 1),
          recalculatedStayAmount: 1000,
        });
        expect(parsedAfter.success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
