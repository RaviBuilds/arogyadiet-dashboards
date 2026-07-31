// src/test/shop/property16-concurrentMovementComposition.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 16 (Task 4.11)
//
// Property 16: Concurrent movements compose additively.
//
// For any clinic, product, starting stock, and any interleaving of concurrent
// stock-in quantities and sale quantities that are all individually accepted,
// the final stored stock equals the starting stock plus the sum of accepted
// increases minus the sum of accepted decreases, independent of interleaving
// order.
//
// **Validates: Requirements 7.11, 10.10, 18.5**
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), whose own
// header comment explains why: "Operations are serial by construction.
// Requirement 7.11 / 10.10 / 18.5 concurrency is therefore modelled as 'some
// serialisation of the submitted movements', which is precisely what
// `SELECT ... FOR UPDATE` guarantees and what Property 16 asserts." So this
// test does not attempt real concurrency — it applies the same multiset of
// movements in two different, individually-valid serial orders and asserts
// both land on the same final stock, equal to the closed-form total.
//
// GENERATION STRATEGY
// A starting stock S, a list of increase quantities, and a list of decrease
// quantities are generated for one fixed (clinic, product) pair. The warehouse
// is seeded with a huge lot so availability never limits a stock-in. Decreases
// are constructed — not merely filtered — so that their sum never exceeds
// B = S + sum(increases): this is the balance reached once every increase has
// landed, and it is also the highest balance any interleaving can ever reach
// (decreases only ever remove stock, so no order can exceed the total of
// starting stock plus every increase). Bounding decreases by B is therefore
// both necessary and sufficient for every individual sale in the multiset to
// be satisfiable by *some* ordering — exactly the "all individually accepted"
// precondition the property states.
//
// TWO ORDERINGS
// - Order A ("increases first"): every increase, in generated order, then
//   every decrease, in generated order. Provably safe: once every increase is
//   applied the balance is B, and because the decreases' total is <= B, every
//   prefix sum of the decreases is also <= B, so the running balance never
//   goes negative regardless of the decreases' relative order.
// - Order B ("greedy interleave"): a genuinely mixed order, not merely a
//   permutation of one group. At each step, apply the smallest
//   not-yet-applied decrease if the current balance covers it; otherwise
//   apply the next not-yet-applied increase. This is provably always able to
//   make progress: once every increase has been applied, the current balance
//   equals B minus the decreases already applied, which by construction is
//   >= the sum of the remaining decreases, and therefore >= the smallest of
//   them (the smallest of a set of positive numbers is at most their total).
//   So the smallest remaining decrease always eventually fits, and the walk
//   never gets stuck. Because some decreases routinely fit before every
//   increase has landed, this order actually interleaves stock-ins and sales,
//   unlike Order A.
//
// Both orders are applied to fresh, identically-seeded worlds, and the test
// asserts both reach the same final stock, equal to the closed form
// S + sum(increases) - sum(decreases).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopApplySale,
  clinicShopStockIn,
  createWorld,
  effectiveOverlay,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  ADDON_ORDER_IDS,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  PRODUCT_IDS,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 500;

// ─── Fixed pair under test ───────────────────────────────────────────────────

const CLINIC_ID = CORE_CLINIC_IDS[0];
const PRODUCT_ID = PRODUCT_IDS[0];
const INVENTORY_PRODUCT_ID = INVENTORY_PRODUCT_IDS[0];
const ACTOR_USER_ID = ACTOR_USER_IDS[0];
const ADDON_ORDER_ID = ADDON_ORDER_IDS[0];

/** A world seeded with the starting stock and a warehouse lot large enough
 * that no generated stock-in is ever limited by warehouse availability. */
function buildWorld(startingStock: number): World {
  return createWorld({
    clinics: [{ id: CLINIC_ID, franchiseId: null }],
    products: [{ id: PRODUCT_ID, inventoryProductId: INVENTORY_PRODUCT_ID }],
    overlays: [
      {
        clinicId: CLINIC_ID,
        productId: PRODUCT_ID,
        stockQuantity: startingStock,
        isVisible: true,
      },
    ],
    lots: {
      [INVENTORY_PRODUCT_ID]: [{ id: "seed-lot", quantityRemaining: 50_000_000 }],
    },
    addonOrderIds: [ADDON_ORDER_ID],
    actorUserIds: [ACTOR_USER_ID],
  });
}

type MovementStep = { kind: "inc" | "dec"; quantity: number };

/** Apply one movement step, failing the test loudly if the model rejects it —
 * every step here is expected, by construction, to be individually accepted. */
function applyStep(world: World, step: MovementStep): void {
  if (step.kind === "inc") {
    const result = clinicShopStockIn(world, {
      clinicId: CLINIC_ID,
      lines: [{ productId: PRODUCT_ID, quantity: step.quantity }],
      actorUserId: ACTOR_USER_ID,
    });
    if (!result.ok) {
      throw new Error(
        `expected stock-in of ${step.quantity} to be accepted: ${result.error.message}`,
      );
    }
  } else {
    const result = clinicShopApplySale(world, {
      clinicId: CLINIC_ID,
      addonOrderId: ADDON_ORDER_ID,
      lines: [{ productId: PRODUCT_ID, quantity: step.quantity }],
      movementSource: "WALKIN_SALE",
      actorUserId: ACTOR_USER_ID,
    });
    if (!result.ok) {
      throw new Error(
        `expected sale of ${step.quantity} to be accepted: ${result.error.message}`,
      );
    }
  }
}

function applyOrder(world: World, order: readonly MovementStep[]): void {
  for (const step of order) applyStep(world, step);
}

/** Order A: every increase (generated order), then every decrease (generated
 * order). Safe because by the time decreases start the balance is already
 * B = S + sum(increases), and the decreases' total never exceeds B. */
function increasesFirstOrder(
  increases: readonly number[],
  decreases: readonly number[],
): MovementStep[] {
  return [
    ...increases.map((quantity): MovementStep => ({ kind: "inc", quantity })),
    ...decreases.map((quantity): MovementStep => ({ kind: "dec", quantity })),
  ];
}

/** Order B: a genuine interleave. At each step, apply the smallest remaining
 * decrease if the running balance covers it; otherwise apply the next
 * remaining increase. Always able to make progress (see file header). */
function greedyInterleavedOrder(
  startingStock: number,
  increases: readonly number[],
  decreases: readonly number[],
): MovementStep[] {
  const remainingIncreases = [...increases];
  const remainingDecreases = [...decreases].sort((a, b) => a - b);
  let balance = startingStock;
  const order: MovementStep[] = [];

  while (remainingIncreases.length > 0 || remainingDecreases.length > 0) {
    if (remainingDecreases.length > 0 && remainingDecreases[0] <= balance) {
      const quantity = remainingDecreases.shift()!;
      order.push({ kind: "dec", quantity });
      balance -= quantity;
    } else if (remainingIncreases.length > 0) {
      const quantity = remainingIncreases.shift()!;
      order.push({ kind: "inc", quantity });
      balance += quantity;
    } else {
      // Unreachable given the generation strategy's construction (see file
      // header proof) — surfaced loudly rather than silently mis-testing.
      throw new Error(
        "greedyInterleavedOrder: no safe next move — generator invariant violated",
      );
    }
  }
  return order;
}

// ─── Generator: starting stock, increases, and sum-bounded decreases ────────

/**
 * Starting stock plus a list of increase quantities plus a list of decrease
 * quantities, with the decreases' sum constructed to never exceed
 * B = startingStock + sum(increases) — the necessary-and-sufficient bound for
 * every decrease to be satisfiable by some ordering of the whole multiset.
 * Bounds are kept well under Stock_Quantity_Maximum so the cap is never the
 * limiting factor for this property.
 */
const arbCase: fc.Arbitrary<{
  startingStock: number;
  increases: number[];
  decreases: number[];
}> = fc
  .tuple(
    fc.integer({ min: 0, max: 3_000 }),
    fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 0, maxLength: 6 }),
  )
  .chain(([startingStock, increases]) => {
    const balanceAfterIncreases =
      startingStock + increases.reduce((sum, quantity) => sum + quantity, 0);
    return fc
      .array(fc.integer({ min: 1, max: Math.max(1, balanceAfterIncreases) }), {
        minLength: 0,
        maxLength: 6,
      })
      .map((rawDecreases) => {
        // Keep only as many of the raw decreases as fit within the balance
        // reached once every increase has landed — the construction the file
        // header describes, not a post-hoc filter of independently-valid values.
        const decreases: number[] = [];
        let used = 0;
        for (const quantity of rawDecreases) {
          if (used + quantity <= balanceAfterIncreases) {
            decreases.push(quantity);
            used += quantity;
          }
        }
        return { startingStock, increases, decreases };
      });
  });

// ─── The property ────────────────────────────────────────────────────────────

describe("Property 16: Concurrent movements compose additively", () => {
  it("reaches the same final stock under two different valid orderings, equal to starting stock plus increases minus decreases", () => {
    fc.assert(
      fc.property(arbCase, ({ startingStock, increases, decreases }) => {
        const increaseTotal = increases.reduce((sum, q) => sum + q, 0);
        const decreaseTotal = decreases.reduce((sum, q) => sum + q, 0);
        const expected = startingStock + increaseTotal - decreaseTotal;

        const orderA = increasesFirstOrder(increases, decreases);
        const worldA = buildWorld(startingStock);
        applyOrder(worldA, orderA);
        const finalA = effectiveOverlay(worldA, CLINIC_ID, PRODUCT_ID).stockQuantity;

        const orderB = greedyInterleavedOrder(startingStock, increases, decreases);
        const worldB = buildWorld(startingStock);
        applyOrder(worldB, orderB);
        const finalB = effectiveOverlay(worldB, CLINIC_ID, PRODUCT_ID).stockQuantity;

        expect(finalA).toBe(expected);
        expect(finalB).toBe(expected);
        expect(finalA).toBe(finalB);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
