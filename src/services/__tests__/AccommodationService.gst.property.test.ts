// src/services/__tests__/AccommodationService.gst.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 7: GST breakup from Total_Stay_Amount
//
// **Validates: Requirements 4.8, 8.3, 11.3**
//
// For any Total_Stay_Amount in [1, 9,999,999], the GST_Breakup SHALL satisfy:
//   - baseAmount = round(total / 1.18, 2)
//   - taxAmount  = round(total − baseAmount, 2)
//   - taxPercentage = 18
//   - baseAmount + taxAmount = total within ±0.01
//
// The breakup uses the Stay_Entry's current Total_Stay_Amount as the input —
// including after a Stay_Extension, an Early_Checkout, or any number of
// Save_Stay_Details submissions replace that total (Req 12.10).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { gstFromTotal } from "@/services/AccommodationService";
import {
  arbTotalStayAmount,
  referenceGstBreakup,
  roundToPaise,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 7: GST breakup from Total_Stay_Amount", () => {
  it("baseAmount equals round(total / 1.18, 2)", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, (total) => {
        const result = gstFromTotal(total);
        const expectedBase = roundToPaise(total / 1.18);

        expect(result.baseAmount).toBe(expectedBase);
      }),
      { numRuns: 100 },
    );
  });

  it("taxAmount equals round(total - baseAmount, 2)", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, (total) => {
        const result = gstFromTotal(total);
        const expectedTax = roundToPaise(total - result.baseAmount);

        expect(result.taxAmount).toBe(expectedTax);
      }),
      { numRuns: 100 },
    );
  });

  it("taxPercentage is always 18", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, (total) => {
        const result = gstFromTotal(total);

        expect(result.taxPercentage).toBe(18);
      }),
      { numRuns: 100 },
    );
  });

  it("baseAmount + taxAmount equals total within ±0.01", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, (total) => {
        const result = gstFromTotal(total);
        const sum = result.baseAmount + result.taxAmount;

        expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.01);
      }),
      { numRuns: 100 },
    );
  });

  it("breakup matches the independently computed reference formula", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, (total) => {
        const result = gstFromTotal(total);
        const reference = referenceGstBreakup(total);

        expect(result.baseAmount).toBe(reference.baseAmount);
        expect(result.taxAmount).toBe(reference.taxAmount);
      }),
      { numRuns: 100 },
    );
  });

  it("GST breakup is correctly derived from the CURRENT total after repeated Save Stay Details submissions", () => {
    // Generates 1–5 Total_Stay_Amount values simulating repeated Save Stay Details
    // submissions (Req 12.10), each replacing the total. The GST breakup must ALWAYS
    // be derived from the CURRENT total — not accumulated across operations.
    fc.assert(
      fc.property(
        fc.array(arbTotalStayAmount, { minLength: 1, maxLength: 5 }),
        (totals) => {
          for (const total of totals) {
            const result = gstFromTotal(total);

            // base + tax === total in paise (exact integer arithmetic)
            const basePaise = Math.round(result.baseAmount * 100);
            const taxPaise = Math.round(result.taxAmount * 100);
            const totalPaise = Math.round(total * 100);

            expect(basePaise + taxPaise).toBe(totalPaise);

            // Each call independently produces the correct breakup
            expect(result.baseAmount).toBe(roundToPaise(total / 1.18));
            expect(result.taxAmount).toBe(
              roundToPaise(total - result.baseAmount),
            );
            expect(result.taxPercentage).toBe(18);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
