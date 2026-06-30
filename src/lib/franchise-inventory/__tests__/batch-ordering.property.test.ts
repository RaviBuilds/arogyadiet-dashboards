// src/lib/franchise-inventory/__tests__/batch-ordering.property.test.ts
// Property-based test for displayed batch ordering.
//
// **Property 22: Displayed batch breakdown is ordered by expiry then received date**
//
// For any set of ACTIVE lots, the batch breakdown for each product is ordered
// by expiry_date ASC, then received_at ASC.
//
// **Validates: Requirements 12.4**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeOnHand, type FranchiseLot } from "../on-hand-calculator";

// --- Arbitraries ---

/** Small set of product IDs to encourage grouping across lots. */
const PRODUCT_IDS = ["prod-A", "prod-B", "prod-C", "prod-D"];

const arbProductId: fc.Arbitrary<string> = fc.constantFrom(...PRODUCT_IDS);

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

/**
 * Generates a FranchiseLot that is always ACTIVE.
 * Only ACTIVE lots contribute to the batch breakdown, so we constrain the
 * generator to produce only ACTIVE lots for a focused ordering test.
 */
const arbActiveLot: fc.Arbitrary<FranchiseLot> = fc.record({
  productId: arbProductId,
  batchNumber: fc.string({ minLength: 1, maxLength: 20 }),
  quantityRemaining: fc.integer({ min: 1, max: 5000 }),
  expiryDate: arbIsoDate,
  receivedAt: arbIsoTimestamp,
  status: fc.constant("ACTIVE" as const),
});

/** Generates an array of 0–30 ACTIVE FranchiseLot objects. */
const arbActiveLots: fc.Arbitrary<FranchiseLot[]> = fc.array(arbActiveLot, {
  minLength: 0,
  maxLength: 30,
});

// --- Helper ---

/**
 * Returns true if two adjacent batches are in the correct order:
 * expiry_date ASC, then received_at ASC when expiry dates are equal.
 *
 * We compare by looking up the full lot data (including receivedAt) since
 * FranchiseBatch does not carry receivedAt. Instead, we verify the ordering
 * against the source lots directly.
 */
function isSortedByExpiryThenReceived(
  lots: FranchiseLot[],
  productId: string,
): boolean {
  // Get the ACTIVE lots for this product in the order the calculator should produce
  const productLots = lots.filter(
    (l) => l.productId === productId && l.status === "ACTIVE",
  );

  // Sort using the same criteria as the calculator
  const sorted = [...productLots].sort((a, b) => {
    const expiryCompare =
      new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    if (expiryCompare !== 0) return expiryCompare;
    return (
      new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
    );
  });

  // The batch breakdown should follow this exact order
  return sorted.every((lot, i) => {
    if (i === 0) return true;
    const prev = sorted[i - 1];
    const prevExpiry = new Date(prev.expiryDate).getTime();
    const currExpiry = new Date(lot.expiryDate).getTime();
    if (prevExpiry < currExpiry) return true;
    if (prevExpiry > currExpiry) return false;
    // Equal expiry — check receivedAt
    return (
      new Date(prev.receivedAt).getTime() <=
      new Date(lot.receivedAt).getTime()
    );
  });
}

// --- Property tests ---

describe("Property 22: Displayed batch breakdown is ordered by expiry then received date", () => {
  it("batches array for each product is sorted by expiryDate ASC, then receivedAt ASC", () => {
    fc.assert(
      fc.property(arbActiveLots, (lots) => {
        const result = computeOnHand(lots);

        for (const [productId, { batches }] of result) {
          // Verify expiry ordering between consecutive batches
          for (let i = 1; i < batches.length; i++) {
            const prevExpiry = new Date(batches[i - 1].expiryDate).getTime();
            const currExpiry = new Date(batches[i].expiryDate).getTime();
            expect(prevExpiry).toBeLessThanOrEqual(currExpiry);
          }

          // Verify receivedAt tie-breaking via the source lots
          // Group the ACTIVE lots for this product to verify full ordering
          const productLots = lots.filter(
            (l) => l.productId === productId && l.status === "ACTIVE",
          );
          const sortedLots = [...productLots].sort((a, b) => {
            const expiryCompare =
              new Date(a.expiryDate).getTime() -
              new Date(b.expiryDate).getTime();
            if (expiryCompare !== 0) return expiryCompare;
            return (
              new Date(a.receivedAt).getTime() -
              new Date(b.receivedAt).getTime()
            );
          });

          // The batch breakdown should match the expected sorted order
          expect(batches.length).toBe(sortedLots.length);
          for (let i = 0; i < batches.length; i++) {
            expect(batches[i].expiryDate).toBe(sortedLots[i].expiryDate);
            expect(batches[i].quantity).toBe(sortedLots[i].quantityRemaining);
            expect(batches[i].batchNumber).toBe(sortedLots[i].batchNumber);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("when lots share the same expiryDate, they are ordered by receivedAt ASC", () => {
    // Use a custom generator that forces lots to share expiry dates
    const sharedExpiryDate = "2025-06-15";
    const arbSameExpiryLot: fc.Arbitrary<FranchiseLot> = fc.record({
      productId: fc.constant("prod-shared"),
      batchNumber: fc.string({ minLength: 1, maxLength: 20 }),
      quantityRemaining: fc.integer({ min: 1, max: 5000 }),
      expiryDate: fc.constant(sharedExpiryDate),
      receivedAt: arbIsoTimestamp,
      status: fc.constant("ACTIVE" as const),
    });

    const arbSameExpiryLots: fc.Arbitrary<FranchiseLot[]> = fc.array(
      arbSameExpiryLot,
      { minLength: 2, maxLength: 20 },
    );

    fc.assert(
      fc.property(arbSameExpiryLots, (lots) => {
        const result = computeOnHand(lots);
        const entry = result.get("prod-shared");

        if (!entry) return; // No ACTIVE lots generated

        const { batches } = entry;

        // All expiry dates should be the same
        for (const batch of batches) {
          expect(batch.expiryDate).toBe(sharedExpiryDate);
        }

        // Verify receivedAt ordering by matching against the source lots
        const sortedLots = [...lots]
          .filter((l) => l.status === "ACTIVE")
          .sort(
            (a, b) =>
              new Date(a.receivedAt).getTime() -
              new Date(b.receivedAt).getTime(),
          );

        expect(batches.length).toBe(sortedLots.length);
        for (let i = 0; i < batches.length; i++) {
          expect(batches[i].batchNumber).toBe(sortedLots[i].batchNumber);
          expect(batches[i].quantity).toBe(sortedLots[i].quantityRemaining);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("single-batch products are trivially ordered", () => {
    fc.assert(
      fc.property(arbActiveLot, (lot) => {
        const result = computeOnHand([lot]);
        const entry = result.get(lot.productId);

        expect(entry).toBeDefined();
        expect(entry!.batches.length).toBe(1);
        expect(entry!.batches[0].expiryDate).toBe(lot.expiryDate);
        expect(entry!.batches[0].batchNumber).toBe(lot.batchNumber);
        expect(entry!.batches[0].quantity).toBe(lot.quantityRemaining);
      }),
      { numRuns: 100 },
    );
  });

  it("empty input produces no batches", () => {
    fc.assert(
      fc.property(fc.constant([]), (lots: FranchiseLot[]) => {
        const result = computeOnHand(lots);
        expect(result.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
