// src/services/__tests__/AccommodationService.earlyCheckoutMath.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 21: Early checkout recalculation and branch selection
//
// **Validates: Requirements 12.6, 12.7, 12.8, 12.12, 12.15**
//
// For any ACTIVE Stay_Entry with a Total_Paid and any valid Early_Checkout
// submission, applying the Early_Checkout SHALL:
//   - set total nights to Actual_Nights_Stayed (Req 12.6)
//   - replace Total_Stay_Amount with Recalculated_Stay_Amount (Req 12.6)
//   - retain the original booked total nights and original Total_Stay_Amount
//     unchanged as audit values (Req 12.15)
//   - select exactly one follow-up branch (Req 12.7, 12.8, 12.12):
//     * COLLECT_BALANCE when Recalculated_Stay_Amount > Total_Paid (Req 12.7)
//     * RECORD_REFUND with refundDue = Total_Paid − Recalculated_Stay_Amount
//       when Total_Paid > Recalculated_Stay_Amount (Req 12.8)
//     * CHECKED_OUT when Total_Paid === Recalculated_Stay_Amount (Req 12.12)

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  applyEarlyCheckoutMath,
  deriveStayBalance,
  toPaise,
} from "@/services/AccommodationService";
import {
  arbActiveBillableStayEntry,
  arbLedgerWith,
  arbRecalculatedAmountAround,
  arbValidEarlyCheckoutSubmission,
  arbTotalStayAmount,
  referenceTotalPaid,
  roundToPaise,
  REFERENCE_TODAY_IST,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 21: Early checkout recalculation and branch selection", () => {
  // Generate stay + ledger + valid early checkout submission together
  const arbEarlyCheckoutScenario = arbActiveBillableStayEntry.chain((stay) =>
    arbLedgerWith({ stayEntryId: stay.id, customerProfileId: stay.customerProfileId }).chain(
      (transactions) => {
        const totalPaid = referenceTotalPaid(transactions);
        return arbRecalculatedAmountAround(totalPaid).chain(
          (recalculatedStayAmount) =>
            fc
              .integer({ min: 1, max: Math.max(1, stay.totalNights - 1) })
              .map((actualNightsStayed) => ({
                stay,
                transactions,
                actualNightsStayed,
                recalculatedStayAmount,
                totalPaid,
              })),
        );
      },
    ),
  );

  it("balance.totalStayAmount equals the Recalculated_Stay_Amount (Req 12.6)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        // The balance snapshot must use the recalculated amount as the new total
        expect(Math.round(result.balance.totalStayAmount * 100)).toBe(
          Math.round(recalculatedStayAmount * 100),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("balance.totalPaid equals the reference Total_Paid from the existing ledger (Req 12.6)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        // Total_Paid remains unchanged — existing transactions are not modified
        expect(Math.round(result.balance.totalPaid * 100)).toBe(
          Math.round(totalPaid * 100),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("balance.remainingBalance equals Recalculated_Stay_Amount minus Total_Paid (Req 12.6)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        const expectedRemainingPaise =
          Math.round(recalculatedStayAmount * 100) - Math.round(totalPaid * 100);
        expect(Math.round(result.balance.remainingBalance * 100)).toBe(expectedRemainingPaise);
      }),
      { numRuns: 100 },
    );
  });

  it("selects COLLECT_BALANCE when Recalculated_Stay_Amount > Total_Paid (Req 12.7)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        const recalcPaise = Math.round(recalculatedStayAmount * 100);
        const paidPaise = Math.round(totalPaid * 100);

        if (recalcPaise > paidPaise) {
          expect(result.nextStep).toBe("COLLECT_BALANCE");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("selects RECORD_REFUND with correct refundDue when Total_Paid > Recalculated_Stay_Amount (Req 12.8)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        const recalcPaise = Math.round(recalculatedStayAmount * 100);
        const paidPaise = Math.round(totalPaid * 100);

        if (paidPaise > recalcPaise) {
          expect(result.nextStep).toBe("RECORD_REFUND");
          // refundDue = Total_Paid − Recalculated_Stay_Amount
          const expectedRefundPaise = paidPaise - recalcPaise;
          expect(Math.round(result.refundDue * 100)).toBe(expectedRefundPaise);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("selects CHECKED_OUT when Total_Paid === Recalculated_Stay_Amount (Req 12.12)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        const recalcPaise = Math.round(recalculatedStayAmount * 100);
        const paidPaise = Math.round(totalPaid * 100);

        if (paidPaise === recalcPaise) {
          expect(result.nextStep).toBe("CHECKED_OUT");
          expect(result.balance.isFullyPaid).toBe(true);
          expect(result.refundDue).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("nextStep is exactly one of the three branches — exhaustive and mutually exclusive (Req 12.7, 12.8, 12.12)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount, totalPaid }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        const validSteps = ["COLLECT_BALANCE", "RECORD_REFUND", "CHECKED_OUT"] as const;
        expect(validSteps).toContain(result.nextStep);

        // Verify mutual exclusivity: the branch matches the balance relationship
        const recalcPaise = Math.round(recalculatedStayAmount * 100);
        const paidPaise = Math.round(totalPaid * 100);

        if (recalcPaise > paidPaise) {
          expect(result.nextStep).toBe("COLLECT_BALANCE");
        } else if (paidPaise > recalcPaise) {
          expect(result.nextStep).toBe("RECORD_REFUND");
        } else {
          expect(result.nextStep).toBe("CHECKED_OUT");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("refundDue is zero when nextStep is not RECORD_REFUND (Req 12.8, 12.15)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount }) => {
        const result = applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        if (result.nextStep !== "RECORD_REFUND") {
          expect(result.refundDue).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("the original stay's totalNights and paymentAmount are not mutated (Req 12.15 — audit values)", () => {
    fc.assert(
      fc.property(arbEarlyCheckoutScenario, ({ stay, transactions, actualNightsStayed, recalculatedStayAmount }) => {
        // Capture original values before calling the function
        const originalTotalNights = stay.totalNights;
        const originalPaymentAmount = stay.paymentAmount;

        applyEarlyCheckoutMath(stay, actualNightsStayed, recalculatedStayAmount, transactions);

        // The pure function must NOT mutate the input stay object — originals are preserved
        expect(stay.totalNights).toBe(originalTotalNights);
        expect(stay.paymentAmount).toBe(originalPaymentAmount);
      }),
      { numRuns: 100 },
    );
  });
});
