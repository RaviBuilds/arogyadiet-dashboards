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
// including after a Stay_Extension or an Early_Checkout replaces that total.

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
});
