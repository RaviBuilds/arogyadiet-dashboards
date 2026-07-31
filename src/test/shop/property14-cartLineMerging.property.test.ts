// src/test/shop/property14-cartLineMerging.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 14 (Task 2.9)
//
// Property 14: Cart lines are unique per destination and product.
//
// For any sequence of stock-in line additions, the cart holds at most one
// pending line per (destination Core Clinic, Shop Product) pair, and that
// line's quantity equals the most recently entered quantity for that pair
// (Req 7.4), while lines for other pairs stay pending so several products can
// be held at once (Req 7.3).
//
// The expectation is derived from a reference fold written below directly from
// Requirement 7.3/7.4 — a plain "last write wins per key" map — rather than
// from `mergeStockInLine`, so the model cannot inherit a bug from the code it
// exercises.
//
// **Validates: Requirements 7.3, 7.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  mergeStockInLine,
  type StockInLineKey,
} from "@/lib/shop/clinicStock";
import {
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
  arbMovementQuantity,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

// ─── The cart line shape ─────────────────────────────────────────────────────

/**
 * The `useInventoryStore` slice carries display fields alongside the key, so the
 * property runs over that richer shape to pin the generic contract too.
 */
interface CartLine extends StockInLineKey {
  id: string;
  name: string;
  quantity: number;
}

/** The pair that identifies a pending line (Req 7.4). */
function pairKeyOf(line: StockInLineKey): string {
  return `${line.clinicId}\u0000${line.productId}`;
}

// ─── Reference model: Requirement 7.3, 7.4 transcribed ───────────────────────

/**
 * The cart the requirements describe: one entry per (destination clinic,
 * product) pair, holding the most recently entered quantity for that pair.
 * A `Map` keyed on the pair gives exactly that, with no reference to the module
 * under test.
 */
function referenceFold(additions: readonly CartLine[]): Map<string, CartLine> {
  const cart = new Map<string, CartLine>();
  for (const addition of additions) {
    cart.set(pairKeyOf(addition), addition);
  }
  return cart;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * One Stock In entry. Clinics and products are drawn from the small fixture
 * pools, so repeat entries for the same pair — the case Requirement 7.4 turns
 * on — occur in most sequences rather than needing a special generator.
 */
const arbAddition: fc.Arbitrary<CartLine> = fc
  .tuple(
    fc.constantFrom(...CORE_CLINIC_IDS),
    fc.constantFrom(...PRODUCT_IDS),
    arbMovementQuantity,
  )
  .map(([clinicId, productId, quantity]) => ({
    id: `${clinicId}:${productId}`,
    clinicId,
    productId,
    name: `Product ${PRODUCT_IDS.indexOf(productId) + 1}`,
    quantity,
  }));

/**
 * An arbitrary sequence of additions. The empty sequence is in range: a cart
 * that has seen no entry must also satisfy the invariant (Req 7.5's empty
 * state is the same cart, holding nothing).
 */
const arbAdditionSequence: fc.Arbitrary<CartLine[]> = fc.array(arbAddition, {
  minLength: 0,
  maxLength: 24,
});

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 14: Cart lines are unique per destination and product", () => {
  it("holds exactly one line per (clinic, product) pair carrying the newest quantity", () => {
    fc.assert(
      fc.property(arbAdditionSequence, (additions) => {
        let cart: CartLine[] = [];

        for (const addition of additions) {
          const before = cart;
          const beforeSnapshot = [...before];

          cart = mergeStockInLine(before, addition);

          // The caller's array is never mutated — the store replaces state
          // rather than editing it in place.
          expect(before).toEqual(beforeSnapshot);
        }

        const expected = referenceFold(additions);

        // At most one pending line per pair (Req 7.4).
        const pairKeys = cart.map(pairKeyOf);
        expect(new Set(pairKeys).size).toBe(pairKeys.length);

        // The set of pending pairs is exactly the set of distinct pairs added,
        // so unrelated products stay pending alongside each other (Req 7.3).
        expect(new Set(pairKeys)).toEqual(new Set(expected.keys()));

        // Each pending line is the most recent entry for its pair (Req 7.4).
        for (const line of cart) {
          const newest = expected.get(pairKeyOf(line));
          expect(newest).toBeDefined();
          expect(line.quantity).toBe(newest!.quantity);
          expect(line).toEqual(newest);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
