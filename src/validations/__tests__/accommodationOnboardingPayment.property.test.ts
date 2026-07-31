// src/validations/__tests__/accommodationOnboardingPayment.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 5: Onboarding payment
// field validation (Task 1.5)
//
// Property 5: *For any* pair of total stay amount and advance amount paid
// submitted with shared payment disabled, the onboarding schema SHALL accept the
// pair exactly when the total is in `[1, 9,999,999]` and the advance is in
// `[0, total]`, and SHALL otherwise reject it with a field-level error on the
// offending field, independently of whether the field was visible in the form.
//
// **Validates: Requirements 4.2, 4.3, 4.4**
//
// Notes on the input space and the clock:
//
// - The pair is drawn from the shared `arbMoney` arbitrary (Task 1.4), which is
//   already biased to 0, 1, 9,999,999, 10,000,000 and paise-bearing values —
//   exactly the bound checks Requirements 4.2/4.3 turn on. It is decorated here
//   with negatives and with `undefined`; `undefined` is the payload shape that
//   arrives when the field was never rendered (shared payment toggled on and
//   back off, or a hand-built request), which is the "independently of whether
//   the field was visible" half of the property.
// - The schema reads the real IST "today" through `getISTDateString(0)`. Rather
//   than mock that module, every payload starts *tomorrow* (IST), which sits
//   inside the accepted forward window `[today, today + 365]` no matter when the
//   suite runs — and stays valid even if the IST day rolls over mid-run. That
//   keeps the start-date branch of the `superRefine` quiet so the only issues
//   this test can observe are the payment-field ones it is about.
// - The reported-field assertion is `reported ⊆ offending`: Zod skips an
//   object-level `superRefine` when a field-level check already failed, so a
//   payload that offends on both fields may legitimately surface only the
//   field-level one. What must never happen is an error on a field that is
//   within range.

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  accommodationOnboardingSchema,
  MAX_STAY_AMOUNT,
} from "@/validations/accommodationSchema";
import { addDaysToISODate, getISTDateString } from "@/lib/dates/ist";
import {
  arbMoney,
  REFERENCE_ABOVE_MAX_STAY_AMOUNT,
  REFERENCE_MAX_STAY_AMOUNT,
  REFERENCE_MIN_STAY_AMOUNT,
} from "@/test/accommodation/paymentArbitraries";

/** The two fields Property 5 quantifies over. */
const PAYMENT_FIELDS = ["totalStayAmount", "advanceAmountPaid"] as const;
type PaymentField = (typeof PAYMENT_FIELDS)[number];

/**
 * A submitted money value: any amount `arbMoney` produces, its negation (below
 * the accepted floor), or absent — the shape of a field that was hidden.
 */
const arbSubmittedAmount: fc.Arbitrary<number | undefined> = fc.oneof(
  { arbitrary: arbMoney as fc.Arbitrary<number | undefined>, weight: 7 },
  { arbitrary: arbMoney.map((value) => -value), weight: 2 },
  { arbitrary: fc.constant<number | undefined>(undefined), weight: 2 },
);

/**
 * A non-shared-payment accommodation onboarding payload that is valid in every
 * respect except the payment pair under test.
 */
function buildPayload(
  totalStayAmount: number | undefined,
  advanceAmountPaid: number | undefined,
): Record<string, unknown> {
  return {
    fullName: "Property Five Guest",
    mobile: "9876543210",
    gender: "Male",
    dietaryPreference: "Veg",
    // Tomorrow (IST): inside `[today, today + 365]` whenever the suite runs.
    startDate: addDaysToISODate(getISTDateString(0), 1),
    totalNights: 3,
    stayType: "AC Villa",
    occupancyType: "Single",
    mealPreference: "VEG",
    backdatedStayEnabled: false,
    isSharedPayment: false,
    tempPin: "123456",
    ...(totalStayAmount === undefined ? {} : { totalStayAmount }),
    ...(advanceAmountPaid === undefined ? {} : { advanceAmountPaid }),
  };
}

/** The property's own acceptance predicate, stated from Requirements 4.2–4.4. */
function shouldAccept(
  total: number | undefined,
  advance: number | undefined,
): boolean {
  if (total === undefined || advance === undefined) return false;
  const totalInRange =
    total >= REFERENCE_MIN_STAY_AMOUNT && total <= REFERENCE_MAX_STAY_AMOUNT;
  const advanceInRange = advance >= 0 && advance <= total;
  return totalInRange && advanceInRange;
}

/** Every field the pair genuinely offends against. */
function offendingFields(
  total: number | undefined,
  advance: number | undefined,
): Set<PaymentField> {
  const fields = new Set<PaymentField>();

  if (
    total === undefined ||
    total < REFERENCE_MIN_STAY_AMOUNT ||
    total > REFERENCE_MAX_STAY_AMOUNT
  ) {
    fields.add("totalStayAmount");
  }
  if (
    advance === undefined ||
    advance < 0 ||
    advance > REFERENCE_MAX_STAY_AMOUNT ||
    (total !== undefined && advance > total)
  ) {
    fields.add("advanceAmountPaid");
  }

  return fields;
}

/** The distinct top-level field paths carried by a failed parse. */
function reportedFields(issues: readonly { path: readonly unknown[] }[]): string[] {
  return [...new Set(issues.map((issue) => String(issue.path[0])))];
}

describe("Property 5: Onboarding payment field validation", () => {
  it("accepts a total/advance pair exactly when total ∈ [1, 9,999,999] and advance ∈ [0, total]", () => {
    fc.assert(
      fc.property(
        arbSubmittedAmount,
        arbSubmittedAmount,
        (total, advance) => {
          const result = accommodationOnboardingSchema.safeParse(
            buildPayload(total, advance),
          );

          expect(result.success).toBe(shouldAccept(total, advance));

          if (result.success) {
            // An accepted pair is preserved verbatim for the service layer.
            expect(result.data.totalStayAmount).toBe(total);
            expect(result.data.advanceAmountPaid).toBe(advance);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects an invalid pair with field-level errors only on the offending payment field", () => {
    fc.assert(
      fc.property(
        arbSubmittedAmount,
        arbSubmittedAmount,
        (total, advance) => {
          fc.pre(!shouldAccept(total, advance));

          const result = accommodationOnboardingSchema.safeParse(
            buildPayload(total, advance),
          );
          expect(result.success).toBe(false);
          if (result.success) return;

          const reported = reportedFields(result.error.issues);
          const offending = offendingFields(total, advance);

          // At least one error, every error on a payment field, and every
          // reported payment field genuinely out of range.
          expect(reported.length).toBeGreaterThan(0);
          for (const field of reported) {
            expect(PAYMENT_FIELDS).toContain(field as PaymentField);
            expect(offending.has(field as PaymentField)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("pins the boundary pairs the requirements call out", () => {
    const parse = (total: number | undefined, advance: number | undefined) =>
      accommodationOnboardingSchema.safeParse(buildPayload(total, advance));

    // Accepted boundaries.
    expect(parse(REFERENCE_MIN_STAY_AMOUNT, 0).success).toBe(true);
    expect(parse(MAX_STAY_AMOUNT, MAX_STAY_AMOUNT).success).toBe(true);
    expect(parse(1000, 1000).success).toBe(true);

    // Rejected boundaries, each on its offending field.
    expect(reportedFields(parse(0, 0).error!.issues)).toEqual([
      "totalStayAmount",
    ]);
    expect(
      reportedFields(parse(REFERENCE_ABOVE_MAX_STAY_AMOUNT, 0).error!.issues),
    ).toEqual(["totalStayAmount"]);
    expect(reportedFields(parse(1000, 1000.01).error!.issues)).toEqual([
      "advanceAmountPaid",
    ]);
    expect(reportedFields(parse(1000, -1).error!.issues)).toEqual([
      "advanceAmountPaid",
    ]);

    // A field that was never rendered is still enforced (Req 4.2, 4.3).
    expect(reportedFields(parse(undefined, undefined).error!.issues).sort()).toEqual(
      ["advanceAmountPaid", "totalStayAmount"],
    );
    expect(reportedFields(parse(1000, undefined).error!.issues)).toEqual([
      "advanceAmountPaid",
    ]);
    expect(reportedFields(parse(undefined, 500).error!.issues)).toEqual([
      "totalStayAmount",
    ]);
  });
});
