// src/lib/franchise-inventory/__tests__/fifo-depletion.property.test.ts
// Property-based test for FIFO depletion order.
//
// **Property 17: Stock-out depletes FIFO by earliest expiry**
//
// For any set of non-expired batches and any valid quantity not exceeding their
// total, recording a Stock_Out depletes the earliest-expiry batch first (ties
// broken by earliest received date), fully consuming each batch before moving to
// the next, until the requested quantity is met, with the total depleted equal
// to the requested quantity.
//
// **Validates: Requirements 10.2, 12.5**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeFifoDepletion,
  type DepletableLot,
} from "../fifo-depletion";

// --- Arbitraries ---

/** Generates an ISO date string in the future (non-expired). */
const arbFutureDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2025, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );

/** Generates an ISO timestamp string for received date. */
const arbReceivedAt: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2024, max: 2025 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map(
    ({ year, month, day, hour, minute }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );

/** Generates a single DepletableLot with positive quantity. */
const arbLot: fc.Arbitrary<DepletableLot> = fc
  .record({
    id: fc.uuid(),
    batchNumber: fc.string({ minLength: 1, maxLength: 10 }),
    quantityRemaining: fc.integer({ min: 1, max: 500 }),
    expiryDate: arbFutureDate,
    receivedAt: arbReceivedAt,
  })
  .map((r) => ({
    id: r.id,
    batchNumber: r.batchNumber,
    quantityRemaining: r.quantityRemaining,
    expiryDate: r.expiryDate,
    receivedAt: r.receivedAt,
  }));

/**
 * Generates an array of 1–15 DepletableLots sorted by expiryDate ASC,
 * then receivedAt ASC (as required by the function contract).
 */
const arbSortedLots: fc.Arbitrary<DepletableLot[]> = fc
  .array(arbLot, { minLength: 1, maxLength: 15 })
  .map((lots) =>
    [...lots].sort((a, b) => {
      const expCmp = a.expiryDate.localeCompare(b.expiryDate);
      if (expCmp !== 0) return expCmp;
      return a.receivedAt.localeCompare(b.receivedAt);
    }),
  );

/**
 * Generates a tuple of sorted lots and a valid quantity (1 <= qty <= total available).
 */
const arbLotsAndQuantity: fc.Arbitrary<{
  lots: DepletableLot[];
  quantity: number;
}> = arbSortedLots.chain((lots) => {
  const total = lots.reduce((sum, l) => sum + l.quantityRemaining, 0);
  return fc.integer({ min: 1, max: total }).map((quantity) => ({ lots, quantity }));
});

// --- Property tests ---

describe("Property 17: Stock-out depletes FIFO by earliest expiry", () => {
  it("result is success with totalDepleted equal to requested quantity", () => {
    fc.assert(
      fc.property(arbLotsAndQuantity, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.totalDepleted).toBe(quantity);
      }),
      { numRuns: 100 },
    );
  });

  it("plan entries appear in the same order as the input lots (FIFO)", () => {
    fc.assert(
      fc.property(arbLotsAndQuantity, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        // The plan should reference lots in the same order they appear in the input.
        // Find the index of each plan entry's lotId in the input array.
        const planLotIds = result.plan.map((e) => e.lotId);
        const inputIndices = planLotIds.map((id) =>
          lots.findIndex((l) => l.id === id),
        );

        // Indices must be strictly increasing (FIFO order preserved)
        for (let i = 1; i < inputIndices.length; i++) {
          expect(inputIndices[i]).toBeGreaterThan(inputIndices[i - 1]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("each lot is fully consumed before the next is touched (except the last which may be partial)", () => {
    fc.assert(
      fc.property(arbLotsAndQuantity, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        const { plan } = result;

        for (let i = 0; i < plan.length; i++) {
          const entry = plan[i];
          // Find the corresponding input lot
          const inputLot = lots.find((l) => l.id === entry.lotId);
          expect(inputLot).toBeDefined();

          if (i < plan.length - 1) {
            // All lots except the last must be fully consumed
            expect(entry.quantityDepleted).toBe(inputLot!.quantityRemaining);
            expect(entry.remainingAfter).toBe(0);
          } else {
            // The last lot may be partially consumed
            expect(entry.quantityDepleted).toBeGreaterThan(0);
            expect(entry.quantityDepleted).toBeLessThanOrEqual(
              inputLot!.quantityRemaining,
            );
            expect(entry.remainingAfter).toBe(
              inputLot!.quantityRemaining - entry.quantityDepleted,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("sum of quantityDepleted across the plan equals the requested quantity", () => {
    fc.assert(
      fc.property(arbLotsAndQuantity, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        const totalFromPlan = result.plan.reduce(
          (sum, entry) => sum + entry.quantityDepleted,
          0,
        );
        expect(totalFromPlan).toBe(quantity);
      }),
      { numRuns: 100 },
    );
  });
});
