// src/lib/franchise-inventory/__tests__/receipt-idempotency.property.test.ts
// Property-based test: Property 14 — Receipt is idempotent
//
// For any transfer already in state RECEIVED, requesting Received again leaves
// the transfer in RECEIVED, creates no additional lots, and does not increase
// On_Hand_Quantity.
//
// **Validates: Requirements 8.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { reduceTransferState } from "../transfer-state-reducer";
import type { FranchiseBatch } from "@/types/franchiseInventory";

/**
 * Arbitrary generator for transfer lines (FranchiseBatch[]).
 * Generates 1–10 batch lines with realistic batch numbers, positive quantities,
 * and ISO date strings for expiry.
 */
const arbBatchLine: fc.Arbitrary<FranchiseBatch> = fc.record({
  batchNumber: fc.stringMatching(/^[A-Z0-9]{3,10}$/),
  quantity: fc.integer({ min: 1, max: 1000 }),
  expiryDate: fc.date({ min: new Date("2024-01-01"), max: new Date("2030-12-31") })
    .map((d) => d.toISOString()),
});

const arbTransferLines: fc.Arbitrary<FranchiseBatch[]> = fc.array(arbBatchLine, {
  minLength: 1,
  maxLength: 10,
});

describe("Property 14: Receipt is idempotent", () => {
  it("requesting RECEIVE on an already-RECEIVED transfer is a no-op", () => {
    fc.assert(
      fc.property(arbTransferLines, (lines) => {
        const result = reduceTransferState("RECEIVED", "RECEIVE", lines);

        // 1. Returns success=true
        expect(result.success).toBe(true);

        // 2. newState remains 'RECEIVED'
        expect(result.newState).toBe("RECEIVED");

        // 3. idempotent is true
        expect(result.idempotent).toBe(true);

        // 4. onHandDelta is 0 (no increase)
        expect(result.onHandDelta).toBe(0);

        // 5. lotsDelta is undefined (no new lots created)
        expect(result.lotsDelta).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
