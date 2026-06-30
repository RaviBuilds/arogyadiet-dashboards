// src/lib/franchise-inventory/__tests__/catalog-finished-products.property.test.ts
// Property 6: Catalog reflects lots and contains only finished products
//
// For any set of ACTIVE franchise lots, the derived catalog shows each product's
// On_Hand_Quantity equal to the sum of its lot quantities together with its batch
// breakdown. Since the on-hand calculator only processes lots (which are only ever
// created for FINISHED_GOOD products in the real system), every product appearing
// in the result has lots.
//
// **Validates: Requirements 2.4, 3.1**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeOnHand, type FranchiseLot } from "../on-hand-calculator";

/**
 * Helper: generates a valid ISO date string (YYYY-MM-DD) from year/month/day integers.
 */
const isoDateArb = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }), // avoid invalid day-of-month
  })
  .map(({ year, month, day }) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );

/**
 * Helper: generates a valid ISO timestamp string from year/month/day/hour/min.
 */
const isoTimestampArb = fc
  .record({
    year: fc.integer({ min: 2023, max: 2025 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ year, month, day, hour, minute }) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );

/**
 * Arbitrary generator for a FranchiseLot with ACTIVE status.
 * Generates realistic product IDs (from a small pool to ensure grouping),
 * unique-ish batch numbers, positive quantities, and valid ISO dates.
 */
const activeLotArb: fc.Arbitrary<FranchiseLot> = fc.record({
  productId: fc.stringMatching(/^p[0-9a-f]{1,4}$/),
  batchNumber: fc.stringMatching(/^B[0-9A-Z]{3,6}$/),
  quantityRemaining: fc.integer({ min: 1, max: 10000 }),
  expiryDate: isoDateArb,
  receivedAt: isoTimestampArb,
  status: fc.constant("ACTIVE" as const),
});

/**
 * Arbitrary generator for a FranchiseLot with non-ACTIVE status (DEPLETED or EXPIRED).
 */
const inactiveLotArb: fc.Arbitrary<FranchiseLot> = fc.record({
  productId: fc.stringMatching(/^p[0-9a-f]{1,4}$/),
  batchNumber: fc.stringMatching(/^B[0-9A-Z]{3,6}$/),
  quantityRemaining: fc.integer({ min: 0, max: 10000 }),
  expiryDate: isoDateArb,
  receivedAt: isoTimestampArb,
  status: fc.constantFrom("DEPLETED" as const, "EXPIRED" as const),
});

describe("Property 6: Catalog reflects lots and contains only finished products", () => {
  it("every product in the result has onHandQuantity = sum of its ACTIVE lot quantities", () => {
    fc.assert(
      fc.property(
        fc.array(activeLotArb, { minLength: 1, maxLength: 50 }),
        (lots) => {
          const result = computeOnHand(lots);

          // Group input lots by productId and compute expected sums
          const expectedSums = new Map<string, number>();
          for (const lot of lots) {
            expectedSums.set(
              lot.productId,
              (expectedSums.get(lot.productId) ?? 0) + lot.quantityRemaining,
            );
          }

          // Every product in result must have the correct sum
          for (const [productId, onHandResult] of result) {
            expect(onHandResult.onHandQuantity).toBe(expectedSums.get(productId));
          }

          // Every expected product must be in the result
          for (const [productId, expectedSum] of expectedSums) {
            expect(result.has(productId)).toBe(true);
            expect(result.get(productId)!.onHandQuantity).toBe(expectedSum);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("every product's batches array has one entry per lot for that product", () => {
    fc.assert(
      fc.property(
        fc.array(activeLotArb, { minLength: 1, maxLength: 50 }),
        (lots) => {
          const result = computeOnHand(lots);

          // Count expected lots per product
          const lotCountByProduct = new Map<string, number>();
          for (const lot of lots) {
            lotCountByProduct.set(
              lot.productId,
              (lotCountByProduct.get(lot.productId) ?? 0) + 1,
            );
          }

          for (const [productId, onHandResult] of result) {
            expect(onHandResult.batches.length).toBe(
              lotCountByProduct.get(productId),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the batch quantities sum to onHandQuantity for each product", () => {
    fc.assert(
      fc.property(
        fc.array(activeLotArb, { minLength: 1, maxLength: 50 }),
        (lots) => {
          const result = computeOnHand(lots);

          for (const [, onHandResult] of result) {
            const batchSum = onHandResult.batches.reduce(
              (sum, batch) => sum + batch.quantity,
              0,
            );
            expect(batchSum).toBe(onHandResult.onHandQuantity);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("products with no ACTIVE lots do not appear in the result", () => {
    fc.assert(
      fc.property(
        fc.array(inactiveLotArb, { minLength: 1, maxLength: 30 }),
        fc.array(activeLotArb, { minLength: 0, maxLength: 30 }),
        (inactiveLots, activeLots) => {
          const allLots = [...inactiveLots, ...activeLots];
          const result = computeOnHand(allLots);

          // Identify products that only have inactive lots
          const activeProductIds = new Set(
            activeLots.map((lot) => lot.productId),
          );

          for (const inactiveLot of inactiveLots) {
            if (!activeProductIds.has(inactiveLot.productId)) {
              // This product has no ACTIVE lots — should NOT be in the result
              expect(result.has(inactiveLot.productId)).toBe(false);
            }
          }

          // Every product in the result must have at least one ACTIVE lot
          for (const [productId] of result) {
            expect(activeProductIds.has(productId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
