// src/validations/__tests__/earlyCheckoutSchema.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 20: Early checkout input validation
//
// Property 20: For any booked total nights and any Early_Checkout submission,
// the submission is accepted exactly when Actual_Nights_Stayed is an integer in
// `[1, bookedTotalNights − 1]` and Recalculated_Stay_Amount is in
// `[1, 9,999,999]`; otherwise it is rejected with an error stating the value
// must be less than the currently booked total nights, and the Stay_Entry
// remains unchanged.
//
// The property is a two-sided equivalence against a reference predicate
// re-declared here from Requirements 12.3–12.5 and from the bounds in
// `paymentArbitraries.ts` (which declares them independently of
// `accommodationSchema.ts`). Nothing in the reference model consults the schema
// under test, so an off-by-one in `createEarlyCheckoutSchema` cannot hide behind
// a shared constant.
//
// Both fields arrive as `unknown` because a form or an action payload can carry
// anything. The schemas coerce with `Number(...)` before checking, which is the
// behaviour a numeric text input depends on, so the reference predicate applies
// the same numeric reading and then decides on the *numeric* value: a numeric
// string is accepted, `""`, `null`, `undefined`, `NaN`, either infinity and a
// fractional value are not.
//
// "The Stay_Entry SHALL remain unchanged" is asserted at this layer as
// "validation mutates nothing it was handed" — the submitted payload is deeply
// unchanged after a parse, accepted or rejected. Persistence is out of scope
// here; Properties 19 and 21 cover the write side.
//
// **Validates: Requirements 12.3, 12.4, 12.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  createEarlyCheckoutSchema,
  earlyCheckoutSchema,
  MAX_STAY_AMOUNT,
} from "@/validations/accommodationSchema";
import {
  arbEarlyCheckoutSubmission,
  arbTotalNights,
  arbTotalStayAmount,
  arbValidEarlyCheckoutSubmission,
  REFERENCE_MAX_STAY_AMOUNT,
  REFERENCE_MIN_STAY_AMOUNT,
  REFERENCE_MAX_TOTAL_NIGHTS,
} from "@/test/accommodation/paymentArbitraries";

/** The notes for this feature require at least 100 iterations per property. */
const NUM_RUNS = 300;

/**
 * Reference rule for Actual_Nights_Stayed, straight from Requirement 12.3: an
 * integer from 1 up to one less than the currently booked total nights. With
 * `bookedTotalNights === 1` the range is empty — a one-night stay has no night
 * count that is both at least 1 and below 1, so no Early_Checkout submission for
 * it can be valid.
 */
function isAcceptedNights(raw: unknown, bookedTotalNights: number): boolean {
  const nights = Number(raw);
  return (
    Number.isInteger(nights) &&
    nights >= 1 &&
    nights <= bookedTotalNights - 1
  );
}

/**
 * Reference rule for Recalculated_Stay_Amount, straight from Requirement 12.4:
 * a finite amount in `[1, 9,999,999]`. Independent of the night count, so an
 * out-of-range amount rejects a submission whose nights are perfectly valid.
 */
function isAcceptedAmount(raw: unknown): boolean {
  const amount = Number(raw);
  return (
    Number.isFinite(amount) &&
    amount >= REFERENCE_MIN_STAY_AMOUNT &&
    amount <= REFERENCE_MAX_STAY_AMOUNT
  );
}

/** The wording Requirement 12.5 asks the admin to be shown. */
function pinnedNightsMessage(bookedTotalNights: number): string {
  return `Actual nights stayed must be less than the currently booked ${bookedTotalNights} nights.`;
}

function issuesFor(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  field: string,
): string[] {
  return issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("Property 20: Early checkout input validation", () => {
  it("accepts an Early_Checkout submission exactly when the nights are an integer below the booked nights and the amount is in range", () => {
    /**
     * **Validates: Requirements 12.3, 12.4, 12.5**
     */

    // The reference predicate is only meaningful if the money cap it uses is the
    // cap the schema enforces, so pin it once before quantifying.
    expect(MAX_STAY_AMOUNT).toBe(REFERENCE_MAX_STAY_AMOUNT);

    fc.assert(
      fc.property(arbEarlyCheckoutSubmission, (submission) => {
        const { bookedTotalNights } = submission;
        const payload = {
          actualNightsStayed: submission.actualNightsStayed,
          recalculatedStayAmount: submission.recalculatedStayAmount,
        };
        const payloadBefore = structuredClone(payload);

        const nightsValid = isAcceptedNights(
          payload.actualNightsStayed,
          bookedTotalNights,
        );
        const amountValid = isAcceptedAmount(payload.recalculatedStayAmount);

        const parsed =
          createEarlyCheckoutSchema(bookedTotalNights).safeParse(payload);

        // ── The equivalence itself (Req 12.3, 12.4, 12.5) ──────────────────
        expect(parsed.success).toBe(nightsValid && amountValid);

        if (parsed.success) {
          // An accepted submission carries the numeric reading of both fields,
          // which is what the Early_Checkout math is applied to (Req 12.6).
          expect(parsed.data.actualNightsStayed).toBe(
            Number(payload.actualNightsStayed),
          );
          expect(parsed.data.recalculatedStayAmount).toBe(
            Number(payload.recalculatedStayAmount),
          );
        } else {
          const issues = parsed.error.issues;
          expect(issues.length).toBeGreaterThan(0);

          // Each field is reported exactly when that field is the one out of
          // range, so the admin is never pointed at a field that was fine.
          const nightsMessages = issuesFor(issues, "actualNightsStayed");
          const amountMessages = issuesFor(issues, "recalculatedStayAmount");
          expect(nightsMessages.length > 0).toBe(!nightsValid);
          expect(amountMessages.length > 0).toBe(!amountValid);

          for (const message of [...nightsMessages, ...amountMessages]) {
            expect(message.trim().length).toBeGreaterThan(0);
          }

          // Req 12.5: when the rejection is "the guest cannot have stayed that
          // many nights", the error names the currently booked total nights.
          const nights = Number(payload.actualNightsStayed);
          if (Number.isInteger(nights) && nights >= bookedTotalNights) {
            expect(nightsMessages).toContain(
              pinnedNightsMessage(bookedTotalNights),
            );
          }
        }

        // Nothing the submission was carrying is rewritten by validating it.
        expect(payload).toEqual(payloadBefore);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("bounds the nights only through the booked-nights factory, and the amount range regardless", () => {
    /**
     * **Validates: Requirements 12.3, 12.4**
     *
     * The base schema deliberately carries no upper bound on the night count —
     * that bound depends on the stay — while the `[1, 9,999,999]` amount range
     * is static and holds in both schemas. This is why the server must validate
     * through `createEarlyCheckoutSchema(bookedTotalNights)` and never through
     * the base schema alone.
     */
    fc.assert(
      fc.property(arbEarlyCheckoutSubmission, (submission) => {
        const payload = {
          actualNightsStayed: submission.actualNightsStayed,
          recalculatedStayAmount: submission.recalculatedStayAmount,
        };

        const nights = Number(payload.actualNightsStayed);
        const nightsIsPositiveInteger =
          Number.isInteger(nights) && nights >= 1;

        const base = earlyCheckoutSchema.safeParse(payload);
        expect(base.success).toBe(
          nightsIsPositiveInteger && isAcceptedAmount(payload.recalculatedStayAmount),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects every submission for a one-night stay, whose accepted range is empty", () => {
    /**
     * **Validates: Requirements 12.3, 12.5**
     *
     * The boundary the range `[1, bookedTotalNights − 1]` collapses at: with one
     * booked night there is no night count that is both at least 1 and less than
     * the booked nights, so *every* submission must be refused. The generic
     * generator reaches `bookedTotalNights === 1` only occasionally, and a
     * property quantified over "any booked total nights" has to hold there too,
     * so it is pinned deterministically.
     */
    fc.assert(
      fc.property(arbTotalNights, arbTotalStayAmount, (nights, amount) => {
        const parsed = createEarlyCheckoutSchema(1).safeParse({
          actualNightsStayed: nights,
          recalculatedStayAmount: amount,
        });

        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(issuesFor(parsed.error.issues, "actualNightsStayed")).toContain(
            pinnedNightsMessage(1),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts every in-range submission for a multi-night stay", () => {
    /**
     * **Validates: Requirements 12.3, 12.4**
     *
     * The positive half of the equivalence, drawn from the guaranteed-valid
     * generator so the accepted side is exercised densely rather than
     * incidentally.
     */
    fc.assert(
      fc.property(arbValidEarlyCheckoutSubmission, (submission) => {
        expect(submission.bookedTotalNights).toBeLessThanOrEqual(
          REFERENCE_MAX_TOTAL_NIGHTS,
        );

        const parsed = createEarlyCheckoutSchema(
          submission.bookedTotalNights,
        ).safeParse({
          actualNightsStayed: submission.actualNightsStayed,
          recalculatedStayAmount: submission.recalculatedStayAmount,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.actualNightsStayed).toBe(
            submission.actualNightsStayed,
          );
          expect(parsed.data.recalculatedStayAmount).toBe(
            submission.recalculatedStayAmount,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
