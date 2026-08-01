// src/services/__tests__/AccommodationService.visibility.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 10: Stay action visibility and mutual exclusivity
//
// **Validates: Requirements 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1**
//
// For any Stay_Entry, derived balance, and final-invoice presence flag,
// `deriveStayActionVisibility` SHALL report:
// - `showRecordPayment` true exactly when the stay is billable, its status is
//   ACTIVE or FINISHED, and Remaining_Balance is greater than zero;
// - `showFullyPaidMessage` true exactly when the stay is billable and
//   Remaining_Balance is zero;
// - `showMarkCheckedOut` true exactly when the status is ACTIVE and the stay is
//   not a Backdated_Stay, with `markCheckedOutEnabled` true only when
//   Remaining_Balance is exactly zero;
// - `showGenerateFinalInvoice` true exactly when the stay is a billable
//   Backdated_Stay with Remaining_Balance zero and no existing
//   Final_Consolidated_Invoice;
// - `showEarlyCheckout` true exactly when the status is ACTIVE, no Early_Checkout
//   has been applied, and elapsed nights are fewer than the booked total nights.
// `showMarkCheckedOut` and `showGenerateFinalInvoice` SHALL never both be true.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { deriveStayActionVisibility } from "@/services/AccommodationService";
import type { StayBalanceSnapshot, StayEntry } from "@/types/accommodation";
import {
  arbStayEntryWith,
  arbTotalStayAmountOrZero,
  arbLedger,
  REFERENCE_TODAY_IST,
  PAYMENT_HOST_PROFILE_ID,
  arbActiveBillableStayEntry,
  arbBackdatedStayEntry,
  arbNonActiveStayEntry,
  arbTotalStayAmount,
  referenceTotalPaid,
  roundToPaise,
} from "@/test/accommodation/paymentArbitraries";
import type { StayStatus } from "@/types/accommodation";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derives a StayBalanceSnapshot from a total and a ledger, independently of the
 * implementation under test, using the reference formula from the spec.
 */
function referenceBalance(
  totalStayAmount: number | null,
  transactions: Parameters<typeof referenceTotalPaid>[0],
): StayBalanceSnapshot {
  const total = totalStayAmount ?? 0;
  const totalPaid = referenceTotalPaid(transactions);
  const totalPaise = Math.round(total * 100);
  const paidPaise = Math.round(totalPaid * 100);
  const remainingPaise = totalPaise - paidPaise;
  return {
    totalStayAmount: total,
    totalPaid,
    remainingBalance: remainingPaise / 100,
    isFullyPaid: remainingPaise === 0,
    refundDue: Math.max(0, -remainingPaise) / 100,
  };
}

/** Whether a stay is "billable" — not shared-payment AND positive total. */
function isBillable(stay: StayEntry): boolean {
  return (
    stay.paymentHostProfileId === null &&
    stay.paymentAmount !== null &&
    stay.paymentAmount > 0
  );
}

/**
 * Whether payment collection is eligible: billable AND (ACTIVE, or FINISHED+backdated).
 * Matches Req 5.1, 9.1.
 */
function isPaymentEligible(stay: StayEntry): boolean {
  return (
    isBillable(stay) &&
    (stay.status === "ACTIVE" || (stay.status === "FINISHED" && stay.isBackdated))
  );
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A balance snapshot for a stay, positioned to make all branches reachable. */
const arbBalance: fc.Arbitrary<StayBalanceSnapshot> = fc
  .record({
    totalStayAmount: arbTotalStayAmountOrZero,
    totalPaid: arbTotalStayAmountOrZero,
  })
  .map(({ totalStayAmount, totalPaid }): StayBalanceSnapshot => {
    const totalPaise = Math.round(totalStayAmount * 100);
    const paidPaise = Math.round(totalPaid * 100);
    const remainingPaise = totalPaise - paidPaise;
    return {
      totalStayAmount,
      totalPaid,
      remainingBalance: remainingPaise / 100,
      isFullyPaid: remainingPaise === 0,
      refundDue: Math.max(0, -remainingPaise) / 100,
    };
  });

/** A balance specifically at zero remaining. */
const arbFullyPaidBalance: fc.Arbitrary<StayBalanceSnapshot> =
  arbTotalStayAmount.map((amount): StayBalanceSnapshot => ({
    totalStayAmount: amount,
    totalPaid: amount,
    remainingBalance: 0,
    isFullyPaid: true,
    refundDue: 0,
  }));

/** A balance with positive remaining (not fully paid). */
const arbPositiveRemainingBalance: fc.Arbitrary<StayBalanceSnapshot> = fc
  .tuple(arbTotalStayAmount, arbTotalStayAmount)
  .filter(([total, paid]) => Math.round(total * 100) > Math.round(paid * 100))
  .map(([total, paid]): StayBalanceSnapshot => {
    const totalPaise = Math.round(total * 100);
    const paidPaise = Math.round(paid * 100);
    const remainingPaise = totalPaise - paidPaise;
    return {
      totalStayAmount: total,
      totalPaid: paid,
      remainingBalance: remainingPaise / 100,
      isFullyPaid: false,
      refundDue: 0,
    };
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 10: Stay action visibility and mutual exclusivity", () => {
  it("non-billable stays (shared payment or zero/null total) yield all-false visibility", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(true),
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          expect(result.showRecordPayment).toBe(false);
          expect(result.showFullyPaidMessage).toBe(false);
          expect(result.showMarkCheckedOut).toBe(false);
          expect(result.markCheckedOutEnabled).toBe(false);
          expect(result.showGenerateFinalInvoice).toBe(false);
          expect(result.showEarlyCheckout).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-billable stays with zero total yield all-false visibility", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: fc.constant(0),
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          expect(result.showRecordPayment).toBe(false);
          expect(result.showFullyPaidMessage).toBe(false);
          expect(result.showMarkCheckedOut).toBe(false);
          expect(result.markCheckedOutEnabled).toBe(false);
          expect(result.showGenerateFinalInvoice).toBe(false);
          expect(result.showEarlyCheckout).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showRecordPayment is true exactly when billable, (ACTIVE or FINISHED+backdated), and balance > 0", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected =
            isPaymentEligible(stay) && !balance.isFullyPaid;

          expect(result.showRecordPayment).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showFullyPaidMessage is true exactly when billable, (ACTIVE or FINISHED+backdated), and balance is zero", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected = isPaymentEligible(stay) && balance.isFullyPaid;

          expect(result.showFullyPaidMessage).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showMarkCheckedOut is true exactly when ACTIVE, non-backdated, and billable", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected =
            stay.status === "ACTIVE" && !stay.isBackdated;

          expect(result.showMarkCheckedOut).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("markCheckedOutEnabled is true only when showMarkCheckedOut is true AND balance is exactly zero", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected =
            stay.status === "ACTIVE" &&
            !stay.isBackdated &&
            balance.isFullyPaid;

          expect(result.markCheckedOutEnabled).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showGenerateFinalInvoice is true exactly when billable, backdated, FINISHED, fully paid, and no final invoice exists", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected =
            stay.status === "FINISHED" &&
            stay.isBackdated &&
            balance.isFullyPaid &&
            !hasFinalInvoice;

          expect(result.showGenerateFinalInvoice).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showEarlyCheckout is true exactly when ACTIVE and no early checkout has been applied", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          const expected =
            stay.status === "ACTIVE" && !stay.earlyCheckoutApplied;

          expect(result.showEarlyCheckout).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showMarkCheckedOut and showGenerateFinalInvoice are never both true (mutual exclusivity)", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith(),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          // They SHALL never both be true
          expect(
            result.showMarkCheckedOut && result.showGenerateFinalInvoice,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("markCheckedOutEnabled implies showMarkCheckedOut (enabled requires visible)", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith(),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          if (result.markCheckedOutEnabled) {
            expect(result.showMarkCheckedOut).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showRecordPayment and showFullyPaidMessage are never both true (mutually exclusive for the same stay)", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith(),
        arbBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );

          expect(
            result.showRecordPayment && result.showFullyPaidMessage,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
