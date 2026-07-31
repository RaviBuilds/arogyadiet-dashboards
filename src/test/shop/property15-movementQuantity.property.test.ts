// src/test/shop/property15-movementQuantity.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 15
//
// Property 15: Movement quantity validation accepts exactly the valid range.
//
// For any submitted value, it is accepted as a movement quantity exactly when it
// is an integer in [1, 1,000,000], and every rejection identifies whether the
// value was non-integral, below the minimum, or above the maximum.
//
// The property is stated as a two-sided equivalence against a reference
// predicate re-declared here from the requirements — `isWholeNumberInRange` —
// using the bounds from `clinicStockArbitraries.ts`, which declares them
// independently of `src/lib/shop/clinicStock.ts`. Nothing in the reference model
// consults the module under test, so an off-by-one or a coercion in
// `validateMovementQuantity` cannot hide behind a shared constant.
//
// The same equivalence is asserted for the stored-stock-level rule, which
// differs from the movement rule only in its minimum (0 rather than 1, since a
// clinic legitimately holds nothing), and for the Zod schemas in
// `src/validations/clinicShopInventory.ts` that carry the user-facing wording.
// One property covers all of it because it is one rule — "a whole number inside
// an inclusive range" — applied at three layers and to nine acceptance criteria.
//
// **Validates: Requirements 1.7, 1.8, 2.2, 2.3, 7.13, 10.7, 17.4, 18.7, 18.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  MOVEMENT_QUANTITY_MINIMUM,
  STOCK_QUANTITY_MAXIMUM,
  STOCK_QUANTITY_MINIMUM,
  validateMovementQuantity,
  validateStockLevel,
  type QuantityRejection,
} from "@/lib/shop/clinicStock";
import {
  clinicStockQuantitySchema,
  movementQuantitySchema,
} from "@/validations/clinicShopInventory";
import {
  arbSubmittedQuantity,
  REFERENCE_MOVEMENT_QUANTITY_MINIMUM,
  REFERENCE_STOCK_QUANTITY_MAXIMUM,
  REFERENCE_STOCK_QUANTITY_MINIMUM,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 300;

/**
 * Reference rule, written straight from Requirements 2.2/2.3 and 1.5–1.8: a
 * quantity is valid exactly when it is a whole number at or above `minimum` and
 * at or below Stock_Quantity_Maximum. No coercion — a numeric string is not a
 * number, and neither `NaN` nor either infinity is a whole number.
 */
function isWholeNumberInRange(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= REFERENCE_STOCK_QUANTITY_MAXIMUM
  );
}

/**
 * Reference rejection cause. Integrality is decided before the bounds, so a
 * non-integral value above the cap reports `NOT_INTEGER` rather than
 * `ABOVE_MAXIMUM` — the requirements ask which rule was broken, and "not a whole
 * number" is the one the user has to fix first.
 */
function expectedRejection(value: unknown, minimum: number): QuantityRejection {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return "NOT_INTEGER";
  }
  return value < minimum ? "BELOW_MINIMUM" : "ABOVE_MAXIMUM";
}

describe("Property 15: Movement quantity validation accepts exactly the valid range", () => {
  it("accepts a submitted quantity exactly when it is a whole number in range, and otherwise names the rule that was broken", () => {
    /**
     * **Validates: Requirements 1.7, 1.8, 2.2, 2.3, 7.13, 10.7, 17.4, 18.7, 18.8**
     */

    // The reference predicate is only meaningful if the bounds it uses are the
    // bounds the code enforces, so pin them once before quantifying.
    expect(STOCK_QUANTITY_MAXIMUM).toBe(REFERENCE_STOCK_QUANTITY_MAXIMUM);
    expect(STOCK_QUANTITY_MINIMUM).toBe(REFERENCE_STOCK_QUANTITY_MINIMUM);
    expect(MOVEMENT_QUANTITY_MINIMUM).toBe(REFERENCE_MOVEMENT_QUANTITY_MINIMUM);

    fc.assert(
      fc.property(arbSubmittedQuantity, (submitted) => {
        const movementValid = isWholeNumberInRange(
          submitted,
          REFERENCE_MOVEMENT_QUANTITY_MINIMUM,
        );
        const levelValid = isWholeNumberInRange(
          submitted,
          REFERENCE_STOCK_QUANTITY_MINIMUM,
        );

        // ── Movement quantity: 1..1,000,000 (Req 2.2, 2.3, 7.13, 10.7, 17.4, 18.7)
        const movement = validateMovementQuantity(submitted);
        expect(movement.ok).toBe(movementValid);

        if (movement.ok) {
          // An accepted quantity is returned unchanged — validation never
          // rounds, clamps, or coerces its way to a verdict.
          expect(movement.value).toBe(submitted);
        } else {
          expect(movement.reason).toBe(
            expectedRejection(submitted, REFERENCE_MOVEMENT_QUANTITY_MINIMUM),
          );
        }

        // ── Stored stock level: 0..1,000,000 (Req 1.5, 1.6, 1.7, 1.8)
        const level = validateStockLevel(submitted);
        expect(level.ok).toBe(levelValid);

        if (level.ok) {
          expect(level.value).toBe(submitted);
        } else {
          expect(level.reason).toBe(
            expectedRejection(submitted, REFERENCE_STOCK_QUANTITY_MINIMUM),
          );
        }

        // The two rules differ in exactly one value: 0 is a legitimate stock
        // level and never a legitimate movement.
        expect(level.ok).toBe(movement.ok || submitted === 0);

        // ── The Zod layer agrees with the decision layer, so a submission can
        //    never be accepted by the schema that guards the action and refused
        //    by the logic the RPC mirrors, or the reverse.
        const movementParse = movementQuantitySchema.safeParse(submitted);
        expect(movementParse.success).toBe(movementValid);

        const levelParse = clinicStockQuantitySchema.safeParse(submitted);
        expect(levelParse.success).toBe(levelValid);

        // ── Every rejection carries wording that states the rule, which is what
        //    Requirements 2.3, 7.13, 10.7, 17.4 and 18.7 ask the user to be told
        //    for a movement, and 1.7 / 18.8 for the maximum stock quantity.
        //
        //    The range wording holds over the whole submission space, not just
        //    the numeric part of it: a string, `null`, a boolean, `NaN` or an
        //    infinity is refused at the type level, and the schema carries the
        //    same range wording there.
        if (!movementParse.success) {
          const messages = movementParse.error.issues.map(
            (issue) => issue.message,
          );
          expect(messages.length).toBeGreaterThan(0);
          for (const message of messages) {
            expect(message.trim().length).toBeGreaterThan(0);
            expect(message).toContain("whole number between 1 and 1,000,000");
          }
        }

        if (
          !levelParse.success &&
          expectedRejection(submitted, REFERENCE_STOCK_QUANTITY_MINIMUM) ===
            "ABOVE_MAXIMUM"
        ) {
          const messages = levelParse.error.issues.map(
            (issue) => issue.message,
          );
          expect(
            messages.some((message) =>
              message.includes("maximum stock quantity of 1,000,000"),
            ),
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
