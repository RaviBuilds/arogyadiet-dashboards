// src/services/__tests__/AccommodationService.visibility.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 10: Stay action visibility and mutual exclusivity
//
// **Validates: Requirements 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1, 12.10, 12.11, 12.12, 12.13, 14.1**
//
// For any Stay_Entry, derived balance, and final-invoice presence flag,
// `deriveStayActionVisibility` SHALL report:
// - `showRecordPayment` true exactly when the stay is billable, its status is
//   ACTIVE or FINISHED, and Remaining_Balance is greater than zero;
// - `showFullyPaidMessage` true exactly when the stay is billable and
//   Remaining_Balance is zero;
// - `showMarkCheckedOut` true exactly when the status is ACTIVE and the stay is
//   not a Backdated_Stay, with `markCheckedOutEnabled` true only when
//   Remaining_Balance is exactly zero AND todayIST >= stay.endDate;
// - `showGenerateFinalInvoice` true exactly when the stay is a billable
//   Backdated_Stay with Remaining_Balance zero and no existing
//   Final_Consolidated_Invoice;
// - `showRecalculateStay` true exactly when the status is ACTIVE and the stay
//   is billable — independent of `recalculationApplied` (repeatable);
// - `showMarkAsRefunded` true exactly when ACTIVE + billable + refundDue > 0.
// `showMarkCheckedOut` and `showGenerateFinalInvoice` SHALL never both be true.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { deriveStayActionVisibility } from "@/services/AccommodationService";
import type { StayBalanceSnapshot, StayEntry } from "@/types/accommodation";
import {
  arbStayEntryWith,
  arbTotalStayAmountOrZero,
  arbTotalStayAmount,
  shiftISODate,
  arbISTDate,
} from "@/test/accommodation/paymentArbitraries";
import type { StayStatus } from "@/types/accommodation";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** A balance with refundDue > 0 (overpaid). */
const arbRefundDueBalance: fc.Arbitrary<StayBalanceSnapshot> = fc
  .tuple(arbTotalStayAmount, arbTotalStayAmount)
  .filter(([total, paid]) => Math.round(paid * 100) > Math.round(total * 100))
  .map(([total, paid]): StayBalanceSnapshot => {
    const totalPaise = Math.round(total * 100);
    const paidPaise = Math.round(paid * 100);
    const remainingPaise = totalPaise - paidPaise;
    return {
      totalStayAmount: total,
      totalPaid: paid,
      remainingBalance: remainingPaise / 100,
      isFullyPaid: false,
      refundDue: Math.max(0, -remainingPaise) / 100,
    };
  });

/** A balance with no refund due. */
const arbNoRefundBalance: fc.Arbitrary<StayBalanceSnapshot> = fc
  .tuple(arbTotalStayAmount, arbTotalStayAmountOrZero)
  .filter(([total, paid]) => Math.round(total * 100) >= Math.round(paid * 100))
  .map(([total, paid]): StayBalanceSnapshot => {
    const totalPaise = Math.round(total * 100);
    const paidPaise = Math.round(paid * 100);
    const remainingPaise = totalPaise - paidPaise;
    return {
      totalStayAmount: total,
      totalPaid: paid,
      remainingBalance: remainingPaise / 100,
      isFullyPaid: remainingPaise === 0,
      refundDue: 0,
    };
  });

// ─── Reference date ──────────────────────────────────────────────────────────

const REFERENCE_TODAY_IST = "2025-01-15";

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
          expect(result.showRecalculateStay).toBe(false);
          expect(result.showMarkAsRefunded).toBe(false);
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
          expect(result.showRecalculateStay).toBe(false);
          expect(result.showMarkAsRefunded).toBe(false);
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

  it("markCheckedOutEnabled is true only when showMarkCheckedOut is true AND balance is exactly zero AND the stay has reached its end date", () => {
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
            balance.isFullyPaid &&
            REFERENCE_TODAY_IST >= stay.endDate;

          expect(result.markCheckedOutEnabled).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("markCheckedOutBlockedReason names the blocker exactly when the button is shown but disabled, with balance taking precedence over the date", () => {
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

          if (!result.showMarkCheckedOut || result.markCheckedOutEnabled) {
            // Enabled, or not shown at all — nothing to explain.
            expect(result.markCheckedOutBlockedReason).toBeNull();
            return;
          }

          expect(result.markCheckedOutBlockedReason).toBe(
            balance.isFullyPaid ? "BEFORE_END_DATE" : "BALANCE_OUTSTANDING",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a fully-paid ACTIVE stay is blocked before its end date and enabled on or after it", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
          status: fc.constant<StayStatus>("ACTIVE"),
          isBackdated: fc.constant(false),
        }),
        arbFullyPaidBalance,
        (stay, balance) => {
          // One day before the end date: always blocked on the date.
          const dayBefore = shiftISODate(stay.endDate, -1);
          const before = deriveStayActionVisibility(
            stay,
            balance,
            false,
            dayBefore,
          );
          expect(before.markCheckedOutEnabled).toBe(false);
          expect(before.markCheckedOutBlockedReason).toBe("BEFORE_END_DATE");

          // On the end date itself, and a day after: enabled both times.
          for (const day of [stay.endDate, shiftISODate(stay.endDate, 1)]) {
            const on = deriveStayActionVisibility(stay, balance, false, day);
            expect(on.markCheckedOutEnabled).toBe(true);
            expect(on.markCheckedOutBlockedReason).toBeNull();
          }
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

  it("showRecalculateStay is true exactly when ACTIVE and billable (Req 12.1, 12.10)", () => {
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

          const expected = stay.status === "ACTIVE";

          expect(result.showRecalculateStay).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showRecalculateStay is independent of recalculationApplied — true for ACTIVE billable stays regardless (Req 12.1, 12.10)", () => {
    // For a stay with recalculationApplied = true
    fc.assert(
      fc.property(
        arbStayEntryWith({
          status: fc.constant<StayStatus>("ACTIVE"),
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
          recalculationApplied: fc.constant(true),
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
          expect(result.showRecalculateStay).toBe(true);
        },
      ),
      { numRuns: 100 },
    );

    // For a stay with recalculationApplied = false
    fc.assert(
      fc.property(
        arbStayEntryWith({
          status: fc.constant<StayStatus>("ACTIVE"),
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
          recalculationApplied: fc.constant(false),
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
          expect(result.showRecalculateStay).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showMarkAsRefunded is true iff ACTIVE + billable + refundDue > 0 (Req 14.1)", () => {
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
            isBillable(stay) &&
            balance.refundDue > 0;

          expect(result.showMarkAsRefunded).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showMarkAsRefunded is true when ACTIVE billable with overpaid balance", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          status: fc.constant<StayStatus>("ACTIVE"),
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbRefundDueBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );
          expect(result.showMarkAsRefunded).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("showMarkAsRefunded is false when no refund is due", () => {
    fc.assert(
      fc.property(
        arbStayEntryWith({
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
        }),
        arbNoRefundBalance,
        fc.boolean(),
        (stay, balance, hasFinalInvoice) => {
          const result = deriveStayActionVisibility(
            stay,
            balance,
            hasFinalInvoice,
            REFERENCE_TODAY_IST,
          );
          expect(result.showMarkAsRefunded).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("enablement date moves with shortened stay — markCheckedOutEnabled reflects the recalculated endDate (Req 12.13)", () => {
    // Generate an ACTIVE billable stay, then test with todayIST positioned
    // before/on/after the stay's endDate (which reflects recalculated nights).
    fc.assert(
      fc.property(
        arbStayEntryWith({
          status: fc.constant<StayStatus>("ACTIVE"),
          sharedPayment: fc.constant(false),
          totalStayAmount: arbTotalStayAmount,
          isBackdated: fc.constant(false),
          recalculationApplied: fc.constant(true),
        }),
        arbFullyPaidBalance,
        (stay, balance) => {
          // The stay's endDate is already computed from (possibly recalculated)
          // totalNights. The gate must follow it exactly.

          // Day before the (recalculated) end date → disabled
          const dayBefore = shiftISODate(stay.endDate, -1);
          const beforeResult = deriveStayActionVisibility(
            stay,
            balance,
            false,
            dayBefore,
          );
          expect(beforeResult.markCheckedOutEnabled).toBe(false);
          expect(beforeResult.markCheckedOutBlockedReason).toBe("BEFORE_END_DATE");

          // On the end date → enabled
          const onResult = deriveStayActionVisibility(
            stay,
            balance,
            false,
            stay.endDate,
          );
          expect(onResult.markCheckedOutEnabled).toBe(true);
          expect(onResult.markCheckedOutBlockedReason).toBeNull();

          // Day after the end date → enabled
          const dayAfter = shiftISODate(stay.endDate, 1);
          const afterResult = deriveStayActionVisibility(
            stay,
            balance,
            false,
            dayAfter,
          );
          expect(afterResult.markCheckedOutEnabled).toBe(true);
          expect(afterResult.markCheckedOutBlockedReason).toBeNull();
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
