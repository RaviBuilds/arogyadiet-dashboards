// src/services/__tests__/AccommodationService.balance.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 1: Balance derivation from the ledger
//
// **Validates: Requirements 6.3, 6.4, 6.7**
//
// For any Total_Stay_Amount and any list of Payment_Transaction records,
// `deriveStayBalance` SHALL produce:
//   - `totalPaid` equal to the sum of ADVANCE and PARTIAL_BALANCE_PAYMENT amounts
//     minus the sum of REFUND amounts (computed in integer paise)
//   - `remainingBalance` equal to `totalStayAmount − totalPaid` (may be negative)
//   - `isFullyPaid` true exactly when `remainingBalance` is zero to the paise
//   - `refundDue` equal to `max(0, −remainingBalance)`
//
// The result SHALL be independent of the order of the transactions, and an empty
// transaction list SHALL yield `totalPaid = 0` and `remainingBalance = totalStayAmount`.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { deriveStayBalance } from "@/services/AccommodationService";
import {
  arbLedger,
  arbShuffledLedger,
  arbTotalStayAmountOrZero,
  referenceTotalPaid,
  roundToPaise,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 1: Balance derivation from the ledger", () => {
  it("totalPaid equals ADVANCE + PARTIAL minus REFUND amounts (in paise arithmetic)", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, arbLedger, (totalStayAmount, transactions) => {
        const result = deriveStayBalance(totalStayAmount, transactions);

        // Reference Total_Paid computed independently from the same spec definition
        const expectedTotalPaid = referenceTotalPaid(transactions);

        // Compare in paise to avoid floating-point drift
        expect(Math.round(result.totalPaid * 100)).toBe(Math.round(expectedTotalPaid * 100));
      }),
      { numRuns: 100 },
    );
  });

  it("remainingBalance equals totalStayAmount minus totalPaid", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, arbLedger, (totalStayAmount, transactions) => {
        const result = deriveStayBalance(totalStayAmount, transactions);

        // Remaining balance in paise: totalStayAmount(paise) - totalPaid(paise)
        const expectedRemainingPaise =
          Math.round(totalStayAmount * 100) - Math.round(result.totalPaid * 100);

        expect(Math.round(result.remainingBalance * 100)).toBe(expectedRemainingPaise);
      }),
      { numRuns: 100 },
    );
  });

  it("isFullyPaid is true exactly when remainingBalance is zero to the paise", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, arbLedger, (totalStayAmount, transactions) => {
        const result = deriveStayBalance(totalStayAmount, transactions);

        const remainingPaise = Math.round(result.remainingBalance * 100);
        expect(result.isFullyPaid).toBe(remainingPaise === 0);
      }),
      { numRuns: 100 },
    );
  });

  it("refundDue equals max(0, −remainingBalance)", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, arbLedger, (totalStayAmount, transactions) => {
        const result = deriveStayBalance(totalStayAmount, transactions);

        const expectedRefundDuePaise = Math.max(0, -Math.round(result.remainingBalance * 100));
        expect(Math.round(result.refundDue * 100)).toBe(expectedRefundDuePaise);
      }),
      { numRuns: 100 },
    );
  });

  it("result is independent of transaction order", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, arbShuffledLedger, (totalStayAmount, shuffled) => {
        // arbShuffledLedger gives us transactions in an arbitrary order but with
        // the same content as the insertion-ordered ledger. deriveStayBalance must
        // produce the same snapshot regardless of order.
        const result = deriveStayBalance(totalStayAmount, shuffled);

        // Sort the same transactions by createdAt (the insertion order) and derive again
        const sorted = [...shuffled].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const resultSorted = deriveStayBalance(totalStayAmount, sorted);

        expect(Math.round(result.totalPaid * 100)).toBe(Math.round(resultSorted.totalPaid * 100));
        expect(Math.round(result.remainingBalance * 100)).toBe(
          Math.round(resultSorted.remainingBalance * 100),
        );
        expect(result.isFullyPaid).toBe(resultSorted.isFullyPaid);
        expect(Math.round(result.refundDue * 100)).toBe(Math.round(resultSorted.refundDue * 100));
      }),
      { numRuns: 100 },
    );
  });

  it("empty transaction list yields totalPaid = 0 and remainingBalance = totalStayAmount", () => {
    fc.assert(
      fc.property(arbTotalStayAmountOrZero, (totalStayAmount) => {
        const result = deriveStayBalance(totalStayAmount, []);

        expect(result.totalPaid).toBe(0);
        expect(Math.round(result.remainingBalance * 100)).toBe(
          Math.round(totalStayAmount * 100),
        );
        // isFullyPaid only when the total itself is zero
        expect(result.isFullyPaid).toBe(totalStayAmount === 0);
        expect(result.refundDue).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
