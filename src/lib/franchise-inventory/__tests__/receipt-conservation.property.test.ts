// src/lib/franchise-inventory/__tests__/receipt-conservation.property.test.ts
// Property-based test: Property 13 — Receipt is a conserving, traceable stock-in
//
// For any transfer received from state ACCEPTED, the franchise lots created have
// per-batch quantities and expiry dates equal to the transfer's lines, the total
// created quantity equals the transfer quantity, and the destination On_Hand_Quantity
// increases by exactly that quantity.
//
// **Validates: Requirements 8.4, 9.1, 9.3, 11.1, 12.1**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduceTransferState } from "../transfer-state-reducer";
import type { FranchiseBatch } from "@/types/franchiseInventory";

/**
 * Arbitrary generator for a valid ISO date string in the future (2025–2030).
 * Uses integer-based generation to avoid invalid Date issues.
 */
const arbExpiryDate: fc.Arbitrary<string> = fc
  .integer({
    min: new Date("2025-01-01").getTime(),
    max: new Date("2030-12-31").getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/**
 * Arbitrary generator for a single FranchiseBatch with:
 * - batchNumber: non-empty alphanumeric string
 * - quantity: positive integer (1–1000)
 * - expiryDate: valid ISO date string in the future
 */
const arbFranchiseBatch: fc.Arbitrary<FranchiseBatch> = fc.record({
  batchNumber: fc.stringMatching(/^[A-Z0-9]{1,12}$/),
  quantity: fc.integer({ min: 1, max: 1000 }),
  expiryDate: arbExpiryDate,
});

/**
 * Arbitrary generator for transfer lines: a non-empty array of FranchiseBatch.
 */
const arbTransferLines: fc.Arbitrary<FranchiseBatch[]> = fc.array(arbFranchiseBatch, {
  minLength: 1,
  maxLength: 20,
});

describe("Property 13: Receipt is a conserving, traceable stock-in", () => {
  it("produces success=true with newState=RECEIVED for any ACCEPTED transfer", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        // Assertion 1: Result is success=true with newState='RECEIVED'
        expect(result.success).toBe(true);
        expect(result.newState).toBe("RECEIVED");
      }),
      { numRuns: 100 },
    );
  });

  it("lotsDelta has the same length as the input transfer lines", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        expect(result.success).toBe(true);

        // Assertion 2: lotsDelta has the same length as input transfer lines
        expect(result.lotsDelta).toBeDefined();
        expect(result.lotsDelta!.length).toBe(lines.length);
      }),
      { numRuns: 100 },
    );
  });

  it("each lotsDelta entry matches the corresponding input line (batchNumber, quantity, expiryDate)", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        expect(result.success).toBe(true);
        expect(result.lotsDelta).toBeDefined();

        // Assertion 3: Each lotsDelta entry has the same batchNumber, quantity, and expiryDate
        for (let i = 0; i < lines.length; i++) {
          expect(result.lotsDelta![i].batchNumber).toBe(lines[i].batchNumber);
          expect(result.lotsDelta![i].quantity).toBe(lines[i].quantity);
          expect(result.lotsDelta![i].expiryDate).toBe(lines[i].expiryDate);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("onHandDelta equals the sum of all line quantities (conservation)", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        expect(result.success).toBe(true);

        // Assertion 4: onHandDelta equals the sum of all line quantities
        const expectedSum = lines.reduce((sum, line) => sum + line.quantity, 0);
        expect(result.onHandDelta).toBe(expectedSum);
      }),
      { numRuns: 100 },
    );
  });

  it("onHandDelta > 0 for any non-empty transfer", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("ACCEPTED", "RECEIVE", lines);

        expect(result.success).toBe(true);

        // Assertion 5: onHandDelta > 0 for any non-empty transfer
        // Since lines is non-empty and each quantity is positive (min: 1),
        // onHandDelta must always be > 0
        expect(result.onHandDelta).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
