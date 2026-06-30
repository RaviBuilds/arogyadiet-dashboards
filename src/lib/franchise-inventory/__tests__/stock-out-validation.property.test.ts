// src/lib/franchise-inventory/__tests__/stock-out-validation.property.test.ts
// Property-based test for stock-out input validation.
//
// **Property 16: Stock-out input validation**
//
// For any Stock_Out request, it is accepted only when the reason is in the
// allowed set, the quantity is a positive whole number, and — when the reason
// is OTHER — the comment length is between 1 and 500 characters; otherwise
// it is rejected.
//
// **Validates: Requirements 10.1, 10.4, 10.5, 10.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateStockOutInput,
  type StockOutValidationInput,
} from "../stock-out-validation";
import type { StockOutReason } from "@/types/franchiseInventory";

// --- Constants ---

const VALID_REASONS: StockOutReason[] = [
  "MEAL_SUBSCRIPTION_SALE",
  "KIT_SUBSCRIPTION_SALE",
  "ONE_TIME_PURCHASE_SALE",
  "SPOILED",
  "DAMAGED",
  "OTHER",
];

const NON_OTHER_REASONS: StockOutReason[] = VALID_REASONS.filter(
  (r) => r !== "OTHER",
);

// --- Arbitraries ---

/** A valid reason from the allowed set. */
const arbValidReason: fc.Arbitrary<StockOutReason> = fc.constantFrom(
  ...VALID_REASONS,
);

/** A non-OTHER valid reason. */
const arbNonOtherReason: fc.Arbitrary<StockOutReason> = fc.constantFrom(
  ...NON_OTHER_REASONS,
);

/** An invalid reason string — anything not in the allowed set. */
const arbInvalidReason: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 50 })
  .filter((s) => !VALID_REASONS.includes(s as StockOutReason));

/** A positive whole number (valid quantity). */
const arbValidQuantity: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10000 });

/** An invalid quantity: negative, zero, float, NaN, or Infinity. */
const arbInvalidQuantity: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -10000, max: -1 }),
  // Floats that are not integers
  fc.double({ min: 0.01, max: 9999.99, noNaN: true }).filter(
    (n) => !Number.isInteger(n) && Number.isFinite(n),
  ),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
);

/** A valid comment for OTHER reason: length 1–500. */
const arbValidComment: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 500,
});

/** An invalid comment for OTHER: null, empty, or too long (>500 chars). */
const arbInvalidComment: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null as string | null),
  fc.constant("" as string | null),
  // Too long: 501–600 characters
  fc.string({ minLength: 501, maxLength: 600 }) as fc.Arbitrary<string | null>,
);

/**
 * Available quantity always sufficient — set high enough to never trigger
 * INSUFFICIENT_STOCK so we only test input validation.
 */
const SUFFICIENT_AVAILABLE = 99999;

// --- Helper ---

function buildInput(
  reason: string,
  quantity: number,
  comment: string | null,
): StockOutValidationInput {
  return {
    reason,
    quantity,
    comment,
    availableQuantity: SUFFICIENT_AVAILABLE,
  };
}

// --- Property tests ---

describe("Property 16: Stock-out input validation", () => {
  it("valid inputs with non-OTHER reason return { valid: true }", () => {
    fc.assert(
      fc.property(arbNonOtherReason, arbValidQuantity, (reason, quantity) => {
        const input = buildInput(reason, quantity, null);
        const result = validateStockOutInput(input);

        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("valid inputs with OTHER reason and valid comment return { valid: true }", () => {
    fc.assert(
      fc.property(arbValidQuantity, arbValidComment, (quantity, comment) => {
        const input = buildInput("OTHER", quantity, comment);
        const result = validateStockOutInput(input);

        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("invalid reason returns { valid: false, code: 'INVALID_REASON' }", () => {
    fc.assert(
      fc.property(
        arbInvalidReason,
        arbValidQuantity,
        arbValidComment,
        (reason, quantity, comment) => {
          const input = buildInput(reason, quantity, comment);
          const result = validateStockOutInput(input);

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.code).toBe("INVALID_REASON");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-positive or non-integer quantity returns { valid: false, code: 'INVALID_QUANTITY' }", () => {
    fc.assert(
      fc.property(
        arbValidReason,
        arbInvalidQuantity,
        arbValidComment,
        (reason, quantity, comment) => {
          // Use a valid reason so we isolate the quantity validation
          const input = buildInput(reason, quantity, comment);
          const result = validateStockOutInput(input);

          // Reason validation runs first, so only test with valid reasons
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.code).toBe("INVALID_QUANTITY");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("OTHER with missing/empty/too-long comment returns { valid: false, code: 'COMMENT_REQUIRED' }", () => {
    fc.assert(
      fc.property(arbValidQuantity, arbInvalidComment, (quantity, comment) => {
        const input = buildInput("OTHER", quantity, comment);
        const result = validateStockOutInput(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.code).toBe("COMMENT_REQUIRED");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("validation priority: invalid reason is caught before invalid quantity", () => {
    fc.assert(
      fc.property(
        arbInvalidReason,
        arbInvalidQuantity,
        arbInvalidComment,
        (reason, quantity, comment) => {
          const input = buildInput(reason, quantity, comment);
          const result = validateStockOutInput(input);

          expect(result.valid).toBe(false);
          if (!result.valid) {
            // Reason is checked first per the implementation order
            expect(result.code).toBe("INVALID_REASON");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validation priority: invalid quantity is caught before missing comment", () => {
    fc.assert(
      fc.property(arbInvalidQuantity, arbInvalidComment, (quantity, comment) => {
        const input = buildInput("OTHER", quantity, comment);
        const result = validateStockOutInput(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          // Quantity is checked before comment per the implementation order
          expect(result.code).toBe("INVALID_QUANTITY");
        }
      }),
      { numRuns: 100 },
    );
  });
});
