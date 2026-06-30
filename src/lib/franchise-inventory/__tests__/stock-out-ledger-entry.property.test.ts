// src/lib/franchise-inventory/__tests__/stock-out-ledger-entry.property.test.ts
// Property-based test: Property 19 — Stock-out records a complete outgoing ledger entry
//
// For any successful Stock_Out, exactly one OUT ledger entry is recorded capturing
// the product, the quantity, the reason, the per-batch depleted quantities, a comment
// (when applicable), and a UTC timestamp.
//
// Since the actual ledger write is in the RPC (DB layer), this property test validates
// the preconditions at the pure logic layer: when a stock-out passes validation and
// FIFO depletion succeeds, the depletion plan provides all data needed for a complete
// ledger entry.
//
// **Validates: Requirements 10.7, 11.2**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateStockOutInput,
  type StockOutValidationInput,
} from "../stock-out-validation";
import {
  computeFifoDepletion,
  type DepletableLot,
} from "../fifo-depletion";
import type { StockOutReason } from "@/types/franchiseInventory";

// ─────────────────────────────────────────────────────────────────────────────
// Arbitrary generators
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_REASONS: StockOutReason[] = [
  "MEAL_SUBSCRIPTION_SALE",
  "KIT_SUBSCRIPTION_SALE",
  "ONE_TIME_PURCHASE_SALE",
  "SPOILED",
  "DAMAGED",
  "OTHER",
];

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
 * Arbitrary generator for a valid stock-out reason.
 */
const arbReason: fc.Arbitrary<StockOutReason> = fc.constantFrom(...ALLOWED_REASONS);

/**
 * Arbitrary generator for a valid comment (1–500 characters).
 */
const arbComment: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 500 });

/**
 * Arbitrary generator for a single DepletableLot with a positive quantity.
 */
const arbDepletableLot: fc.Arbitrary<DepletableLot> = fc.record({
  id: fc.uuid(),
  batchNumber: fc.stringMatching(/^[A-Z0-9]{1,12}$/),
  quantityRemaining: fc.integer({ min: 1, max: 500 }),
  expiryDate: arbIsoDate,
  receivedAt: arbIsoDate,
});

/**
 * Generates a valid stock-out scenario: lots with sufficient total quantity,
 * a valid reason, a valid quantity, and an appropriate comment (for OTHER).
 *
 * Returns [lots, quantity, reason, comment] where:
 * - lots have total >= quantity
 * - reason is from the allowed set
 * - comment is non-null when reason is OTHER, null otherwise
 */
const arbValidStockOut: fc.Arbitrary<{
  lots: DepletableLot[];
  quantity: number;
  reason: StockOutReason;
  comment: string | null;
}> = fc
  .array(arbDepletableLot, { minLength: 1, maxLength: 10 })
  .chain((lots) => {
    const totalAvailable = lots.reduce(
      (sum, lot) => sum + lot.quantityRemaining,
      0,
    );
    // Generate quantity in [1, totalAvailable]
    return fc
      .integer({ min: 1, max: totalAvailable })
      .chain((quantity) =>
        arbReason.chain((reason) => {
          if (reason === "OTHER") {
            return arbComment.map((comment) => ({
              lots,
              quantity,
              reason,
              comment,
            }));
          }
          return fc.constant({ lots, quantity, reason, comment: null });
        }),
      );
  });

// ─────────────────────────────────────────────────────────────────────────────
// Property 19 Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Property 19: Stock-out records a complete outgoing ledger entry", () => {
  it("validateStockOutInput returns { valid: true } for the generated input", () => {
    fc.assert(
      fc.property(arbValidStockOut, ({ lots, quantity, reason, comment }) => {
        const availableQuantity = lots.reduce(
          (sum, lot) => sum + lot.quantityRemaining,
          0,
        );

        const input: StockOutValidationInput = {
          reason,
          quantity,
          comment,
          availableQuantity,
        };

        const result = validateStockOutInput(input);

        // Assertion 1: Validation passes
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("computeFifoDepletion returns { success: true } with a plan", () => {
    fc.assert(
      fc.property(arbValidStockOut, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        // Assertion 2: Depletion succeeds
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("the plan's totalDepleted equals the requested quantity", () => {
    fc.assert(
      fc.property(arbValidStockOut, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        // Assertion 3: totalDepleted equals requested quantity
        expect(result.totalDepleted).toBe(quantity);
      }),
      { numRuns: 100 },
    );
  });

  it("each plan entry has a non-empty batchNumber and expiryDate", () => {
    fc.assert(
      fc.property(arbValidStockOut, ({ lots, quantity }) => {
        const result = computeFifoDepletion(lots, quantity);

        expect(result.success).toBe(true);
        if (!result.success) return;

        // Assertion 4: Each plan entry has non-empty batchNumber and expiryDate
        for (const entry of result.plan) {
          expect(entry.batchNumber).toBeTruthy();
          expect(entry.batchNumber.length).toBeGreaterThan(0);
          expect(entry.expiryDate).toBeTruthy();
          expect(entry.expiryDate.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("the plan provides all information needed for a ledger entry: per-batch breakdown with batch_number, quantity, and expiry_date", () => {
    fc.assert(
      fc.property(arbValidStockOut, ({ lots, quantity, reason, comment }) => {
        const availableQuantity = lots.reduce(
          (sum, lot) => sum + lot.quantityRemaining,
          0,
        );

        // Validate input passes
        const validationResult = validateStockOutInput({
          reason,
          quantity,
          comment,
          availableQuantity,
        });
        expect(validationResult.valid).toBe(true);

        // Compute depletion
        const depletionResult = computeFifoDepletion(lots, quantity);
        expect(depletionResult.success).toBe(true);
        if (!depletionResult.success) return;

        // Assertion 5: The plan provides complete batch_breakdown data
        // Each entry has: batchNumber (batch_number), quantityDepleted (quantity), expiryDate (expiry_date)
        const batchBreakdown = depletionResult.plan.map((entry) => ({
          batch_number: entry.batchNumber,
          quantity: entry.quantityDepleted,
          expiry_date: entry.expiryDate,
        }));

        // Every entry has non-empty batch_number
        for (const b of batchBreakdown) {
          expect(b.batch_number).toBeTruthy();
          expect(b.batch_number.length).toBeGreaterThan(0);
        }

        // Every entry has a positive quantity
        for (const b of batchBreakdown) {
          expect(b.quantity).toBeGreaterThan(0);
        }

        // Every entry has a non-empty expiry_date
        for (const b of batchBreakdown) {
          expect(b.expiry_date).toBeTruthy();
          expect(b.expiry_date.length).toBeGreaterThan(0);
        }

        // The sum of batch breakdown quantities equals the requested quantity
        const totalBatchQuantity = batchBreakdown.reduce(
          (sum, b) => sum + b.quantity,
          0,
        );
        expect(totalBatchQuantity).toBe(quantity);

        // When reason is OTHER, comment must exist (ledger needs it)
        if (reason === "OTHER") {
          expect(comment).not.toBeNull();
          expect(comment!.length).toBeGreaterThanOrEqual(1);
          expect(comment!.length).toBeLessThanOrEqual(500);
        }
      }),
      { numRuns: 100 },
    );
  });
});
