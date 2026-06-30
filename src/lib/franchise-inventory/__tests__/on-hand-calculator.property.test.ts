// src/lib/franchise-inventory/__tests__/on-hand-calculator.property.test.ts
// Property-based test for the on-hand calculator.
//
// **Property 4: On-hand counts only received, active stock**
//
// For any franchise inventory and any set of lots with mixed statuses
// (ACTIVE, DEPLETED, EXPIRED), the On_Hand_Quantity of each finished product
// equals the sum of quantity_remaining over its ACTIVE lots only, and is
// unaffected by non-ACTIVE lots.
//
// **Validates: Requirements 6.5, 8.1, 9.2**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeOnHand, type FranchiseLot } from "../on-hand-calculator";

// --- Arbitraries ---

const LOT_STATUSES: Array<"ACTIVE" | "DEPLETED" | "EXPIRED"> = [
  "ACTIVE",
  "DEPLETED",
  "EXPIRED",
];

/** Small set of product IDs to encourage grouping across lots. */
const PRODUCT_IDS = ["prod-A", "prod-B", "prod-C", "prod-D"];

const arbProductId: fc.Arbitrary<string> = fc.constantFrom(...PRODUCT_IDS);

const arbStatus: fc.Arbitrary<"ACTIVE" | "DEPLETED" | "EXPIRED"> =
  fc.constantFrom(...LOT_STATUSES);

/** Generates an ISO date string like "2025-03-15" */
const arbIsoDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );

/** Generates an ISO timestamp string like "2025-03-15T10:30:00Z" */
const arbIsoTimestamp: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map(
    ({ year, month, day, hour, minute }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );

/** Generates a FranchiseLot with random but valid fields. */
const arbLot: fc.Arbitrary<FranchiseLot> = fc.record({
  productId: arbProductId,
  batchNumber: fc.string({ minLength: 1, maxLength: 20 }),
  quantityRemaining: fc.integer({ min: 1, max: 5000 }),
  expiryDate: arbIsoDate,
  receivedAt: arbIsoTimestamp,
  status: arbStatus,
});

/** Generates an array of 0–30 FranchiseLot objects with mixed statuses. */
const arbLots: fc.Arbitrary<FranchiseLot[]> = fc.array(arbLot, {
  minLength: 0,
  maxLength: 30,
});

// --- Helper ---

/** Manually compute expected on-hand per product from ACTIVE lots only. */
function expectedOnHand(lots: FranchiseLot[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const lot of lots) {
    if (lot.status === "ACTIVE") {
      map.set(lot.productId, (map.get(lot.productId) ?? 0) + lot.quantityRemaining);
    }
  }
  return map;
}

// --- Property tests ---

describe("Property 4: On-hand counts only received, active stock", () => {
  it("onHandQuantity equals sum of quantityRemaining of ACTIVE lots for each product", () => {
    fc.assert(
      fc.property(arbLots, (lots) => {
        const result = computeOnHand(lots);
        const expected = expectedOnHand(lots);

        // Every product in expected should be in result with matching quantity
        for (const [productId, expectedQty] of expected) {
          const entry = result.get(productId);
          expect(entry).toBeDefined();
          expect(entry!.onHandQuantity).toBe(expectedQty);
        }

        // Every product in result should be in expected
        for (const [productId] of result) {
          expect(expected.has(productId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("non-ACTIVE lots do not contribute to onHandQuantity", () => {
    fc.assert(
      fc.property(arbLots, (lots) => {
        const result = computeOnHand(lots);

        // Compute what the on-hand would be if we included ALL lots regardless of status
        const allLotsSum = new Map<string, number>();
        for (const lot of lots) {
          allLotsSum.set(
            lot.productId,
            (allLotsSum.get(lot.productId) ?? 0) + lot.quantityRemaining,
          );
        }

        // Compute ACTIVE-only sum
        const activeOnlySum = expectedOnHand(lots);

        // For products that have non-ACTIVE lots, verify the result uses only ACTIVE
        for (const [productId, totalQty] of allLotsSum) {
          const activeQty = activeOnlySum.get(productId) ?? 0;
          const entry = result.get(productId);

          if (activeQty === 0) {
            // Product should NOT appear in result
            expect(entry).toBeUndefined();
          } else {
            // On-hand should be the ACTIVE-only sum, potentially less than total
            expect(entry).toBeDefined();
            expect(entry!.onHandQuantity).toBe(activeQty);
            expect(entry!.onHandQuantity).toBeLessThanOrEqual(totalQty);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("products with zero ACTIVE lots do not appear in the result", () => {
    fc.assert(
      fc.property(arbLots, (lots) => {
        const result = computeOnHand(lots);

        // Identify products that have lots but none are ACTIVE
        const productStatuses = new Map<string, Set<string>>();
        for (const lot of lots) {
          if (!productStatuses.has(lot.productId)) {
            productStatuses.set(lot.productId, new Set());
          }
          productStatuses.get(lot.productId)!.add(lot.status);
        }

        for (const [productId, statuses] of productStatuses) {
          if (!statuses.has("ACTIVE")) {
            // This product has no ACTIVE lots — must not appear in result
            expect(result.has(productId)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("empty input produces an empty map", () => {
    fc.assert(
      fc.property(fc.constant([]), (lots: FranchiseLot[]) => {
        const result = computeOnHand(lots);
        expect(result.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
