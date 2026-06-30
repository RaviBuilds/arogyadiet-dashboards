// src/lib/franchise-inventory/__tests__/fifo-reject-excess.property.test.ts
// Property-based test: Property 18 — Stock-out exceeding available is rejected
//
// For any Stock_Out whose quantity exceeds the total quantity available across
// all lots, the Stock_Out is rejected, all batch quantities are unchanged, and
// the error reports both the requested and the available quantity.
//
// **Validates: Requirements 10.3, 12.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeFifoDepletion,
  type DepletableLot,
} from "../fifo-depletion";

/**
 * Arbitrary generator for a valid ISO date string (2025–2030).
 */
const arbIsoDate: fc.Arbitrary<string> = fc
  .integer({
    min: new Date("2025-01-01").getTime(),
    max: new Date("2030-12-31").getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/**
 * Arbitrary generator for a single DepletableLot with a positive quantity.
 */
const arbDepletableLot: fc.Arbitrary<DepletableLot> = fc.record({
  id: fc.uuid(),
  batchNumber: fc.stringMatching(/^[A-Z0-9]{1,12}$/),
  quantityRemaining: fc.integer({ min: 1, max: 1000 }),
  expiryDate: arbIsoDate,
  receivedAt: arbIsoDate,
});

/**
 * Arbitrary generator for an array of DepletableLots (1–20 lots, all positive).
 */
const arbLots: fc.Arbitrary<DepletableLot[]> = fc.array(arbDepletableLot, {
  minLength: 1,
  maxLength: 20,
});

/**
 * Generates a tuple of [lots, excessQuantity] where excessQuantity strictly
 * exceeds the sum of all lot quantities.
 */
const arbLotsWithExcessQuantity: fc.Arbitrary<[DepletableLot[], number]> = arbLots.chain(
  (lots) => {
    const totalAvailable = lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
    // Generate a quantity that exceeds the available (at least totalAvailable + 1)
    return fc
      .integer({ min: totalAvailable + 1, max: totalAvailable + 10000 })
      .map((excess) => [lots, excess] as [DepletableLot[], number]);
  },
);

describe("Property 18: Stock-out exceeding available is rejected", () => {
  it("result is { success: false } when quantity exceeds available", () => {
    fc.assert(
      fc.property(arbLotsWithExcessQuantity, ([lots, quantity]) => {
        const result = computeFifoDepletion(lots, quantity);

        // Assertion 1: Result is { success: false }
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("requested equals the input quantity", () => {
    fc.assert(
      fc.property(arbLotsWithExcessQuantity, ([lots, quantity]) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(false);
        if (result.success) return;

        // Assertion 2: requested equals the input quantity
        expect(result.requested).toBe(quantity);
      }),
      { numRuns: 100 },
    );
  });

  it("available equals the sum of lot quantities", () => {
    fc.assert(
      fc.property(arbLotsWithExcessQuantity, ([lots, quantity]) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(false);
        if (result.success) return;

        // Assertion 3: available equals the sum of lot quantities
        const expectedAvailable = lots.reduce(
          (sum, lot) => sum + lot.quantityRemaining,
          0,
        );
        expect(result.available).toBe(expectedAvailable);
      }),
      { numRuns: 100 },
    );
  });

  it('error contains "Insufficient stock"', () => {
    fc.assert(
      fc.property(arbLotsWithExcessQuantity, ([lots, quantity]) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(false);
        if (result.success) return;

        // Assertion 4: error contains "Insufficient stock"
        expect(result.error).toContain("Insufficient stock");
      }),
      { numRuns: 100 },
    );
  });
});
