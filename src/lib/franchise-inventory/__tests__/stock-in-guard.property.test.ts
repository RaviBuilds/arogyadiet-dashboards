// src/lib/franchise-inventory/__tests__/stock-in-guard.property.test.ts
// Property-based test for the stock-in guard.
//
// **Property 15: Stock-in requires an authorized received transfer and a positive quantity**
//
// For any stock-in request that is not backed by a transfer in state RECEIVED,
// or whose quantity is <= 0, the stock-in is rejected, and an error indicating
// the unauthorized source or invalid quantity is returned.
//
// **Validates: Requirements 9.4, 9.5, 13.5**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { guardStockIn } from "../stock-in-guard";
import type { FranchiseTransferState } from "@/types/franchiseInventory";

// --- Arbitraries ---

const ALL_STATES: FranchiseTransferState[] = [
  "DISPATCHED",
  "ACCEPTED",
  "RECEIVED",
  "REJECTED",
];

const NON_RECEIVED_STATES: FranchiseTransferState[] = [
  "DISPATCHED",
  "ACCEPTED",
  "REJECTED",
];

const arbState: fc.Arbitrary<FranchiseTransferState> = fc.constantFrom(
  ...ALL_STATES,
);

const arbNonReceivedState: fc.Arbitrary<FranchiseTransferState> =
  fc.constantFrom(...NON_RECEIVED_STATES);

/** Positive quantity (> 0) */
const arbPositiveQuantity: fc.Arbitrary<number> = fc.integer({
  min: 1,
  max: 100_000,
});

/** Zero or negative quantity (<= 0) */
const arbZeroOrNegativeQuantity: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -100_000, max: -1 }),
);

/** Any quantity (positive, zero, or negative) */
const arbAnyQuantity: fc.Arbitrary<number> = fc.oneof(
  arbPositiveQuantity,
  arbZeroOrNegativeQuantity,
);

// --- Property tests ---

describe("Property 15: Stock-in requires an authorized received transfer and a positive quantity", () => {
  it("guardStockIn('RECEIVED', positiveQuantity) returns { allowed: true }", () => {
    fc.assert(
      fc.property(arbPositiveQuantity, (quantity) => {
        const result = guardStockIn("RECEIVED", quantity);

        expect(result.allowed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("guardStockIn(nonReceivedState, anyQuantity) returns { allowed: false } with error about state", () => {
    fc.assert(
      fc.property(arbNonReceivedState, arbAnyQuantity, (state, quantity) => {
        const result = guardStockIn(state, quantity);

        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.error).toBeDefined();
          expect(result.error.length).toBeGreaterThan(0);
          // Error message should mention the state issue
          expect(result.error.toLowerCase()).toContain("state");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("guardStockIn('RECEIVED', zeroOrNegative) returns { allowed: false } with error about quantity", () => {
    fc.assert(
      fc.property(arbZeroOrNegativeQuantity, (quantity) => {
        const result = guardStockIn("RECEIVED", quantity);

        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.error).toBeDefined();
          expect(result.error.length).toBeGreaterThan(0);
          // Error message should mention quantity
          expect(result.error.toLowerCase()).toContain("quantity");
        }
      }),
      { numRuns: 100 },
    );
  });
});
