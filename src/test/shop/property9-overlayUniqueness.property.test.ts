// src/test/shop/property9-overlayUniqueness.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 9 (Task 4.10)
//
// Property 9: One overlay record per (clinic, product) pair.
//
// For any sequence of overlay-touching operations — visibility setting and
// stock-in, in any order and with any repeats — the number of
// `clinic_product_settings` records for a given (clinic_id, product_id) pair
// never exceeds one, and a duplicate creation attempt (a repeat stock-in or a
// repeat visibility-set on a pair that already holds a record) leaves the
// existing record in place rather than creating a second one.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), mirroring
// Property 3's model-based-testing approach. `world.overlays` is a `Map` keyed
// by `overlayKey(clinicId, productId)`, so it cannot *structurally* hold two
// entries for the same key — but that only proves the property if the RPCs'
// upsert behaviour actually reuses the existing key instead of, say, deriving a
// different key or otherwise routing around the map's own uniqueness. This test
// proves the property through the RPCs' observable behaviour: `world.overlays`
// grows by exactly one for a newly-touched pair and by exactly zero for a pair
// that was already touched, which is the only way a size-vs-touched-set
// equality can hold across an arbitrary sequence.
//
// Two forms are checked, per the task:
// (a) sequence-level — folding an arbitrary interleaving of `clinicShopStockIn`
//     and `setClinicProductVisibility` calls against a small (clinic, product)
//     grid, after every step `world.overlays.size` equals the size of a
//     `touchedPairs` set built by adding every pair an *accepted* call named,
//     exactly (not just "at most") — since every touched pair gets exactly one
//     row and no untouched pair gets one; and
// (b) focused — calling `clinicShopStockIn` or `setClinicProductVisibility`
//     twice in a row for the exact same (clinic, product) pair leaves
//     `world.overlays.size` unchanged after the second call, the most direct
//     statement of "a duplicate creation attempt does not create a second row".
//
// **Validates: Requirements 1.3, 1.4, 1.10, 1.11, 6.4, 7.7, 20.9**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopStockIn,
  createWorld,
  overlayKey,
  setClinicProductVisibility,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  arbMovementSequence,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  PRODUCT_IDS,
  type MovementCommand,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

// ─── World factory ───────────────────────────────────────────────────────────

/**
 * A world with every fixture product linked to a Master Catalog Product and
 * seeded with abundant warehouse lots, so a Stock In within the small quantity
 * ranges this test uses is always accepted on warehouse-availability grounds —
 * any rejection observed is therefore never a false signal about a missing lot,
 * and every accepted/rejected split in this test is driven only by the property
 * under test (repeat vs. first touch of a pair), not by starvation.
 */
function buildWorld(): World {
  const lots: Record<string, { id: string; quantityRemaining: number }[]> = {};
  for (const inventoryProductId of INVENTORY_PRODUCT_IDS) {
    lots[inventoryProductId] = [
      { id: `${inventoryProductId}-lot`, quantityRemaining: 10_000_000 },
    ];
  }
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: PRODUCT_IDS.map((id, index) => ({
      id,
      inventoryProductId: INVENTORY_PRODUCT_IDS[index % INVENTORY_PRODUCT_IDS.length],
    })),
    lots,
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

// ─── (a) Sequence-level: overlays.size equals the count of ever-touched pairs ─

describe("Property 9: One overlay record per (clinic, product) pair", () => {
  it("world.overlays.size equals the number of distinct (clinic, product) pairs touched by an accepted stock-in or visibility-set, at every step", () => {
    fc.assert(
      fc.property(
        arbMovementSequence({
          clinicIds: [CORE_CLINIC_IDS[0], CORE_CLINIC_IDS[1]],
          productIds: [PRODUCT_IDS[0], PRODUCT_IDS[1]],
          // Small quantities relative to the abundant lots and the 1,000,000
          // cap, so the sequence explores repeats rather than stalling on the
          // first cap breach (mirrors Property 3's rationale).
          maxQuantity: 50,
          maxLength: 20,
        }),
        (commands) => {
          // Property 9 is stated over the two overlay-creating RPCs the task
          // names — a stock-in and a visibility-set — so sale commands (which
          // never create a missing overlay: a sale against an untouched pair
          // reads effective stock 0 and is rejected outright) are dropped from
          // the sequence rather than folded.
          const overlayTouchingCommands = commands.filter(
            (command): command is Extract<MovementCommand, { kind: "stock-in" | "set-visibility" }> =>
              command.kind === "stock-in" || command.kind === "set-visibility",
          );

          const world = buildWorld();
          const touchedPairs = new Set<string>();

          for (const command of overlayTouchingCommands) {
            const pairKey = overlayKey(command.clinicId, command.productId);

            let accepted: boolean;
            if (command.kind === "stock-in") {
              const result = clinicShopStockIn(world, {
                clinicId: command.clinicId,
                lines: [{ productId: command.productId, quantity: command.quantity }],
                actorUserId: command.actorUserId,
              });
              accepted = result.ok;
            } else {
              const result = setClinicProductVisibility(world, {
                clinicId: command.clinicId,
                productId: command.productId,
                isVisible: command.isVisible,
              });
              accepted = result.ok;
            }

            if (accepted) {
              touchedPairs.add(pairKey);
            }

            // Exact equality after every step: every touched pair holds exactly
            // one record, and no untouched pair holds any.
            expect(world.overlays.size).toBe(touchedPairs.size);
          }

          expect(world.overlays.size).toBe(touchedPairs.size);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── (b) Focused: a repeat call on the same pair does not add a second row ───

describe("Property 9 (focused): a duplicate creation attempt does not create a second overlay row", () => {
  it("calling clinicShopStockIn twice in a row for the same (clinic, product) pair leaves world.overlays.size unchanged after the second call", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...ACTOR_USER_IDS),
        (clinicId, productId, firstQuantity, secondQuantity, actorUserId) => {
          const world = buildWorld();
          const before = world.overlays.size;

          const first = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity: firstQuantity }],
            actorUserId,
          });
          expect(first.ok).toBe(true);
          const afterFirst = world.overlays.size;
          // The pair was untouched before, so the first call creates exactly
          // one row.
          expect(afterFirst).toBe(before + 1);

          const sizeBeforeSecond = world.overlays.size;
          const second = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity: secondQuantity }],
            actorUserId,
          });
          expect(second.ok).toBe(true);

          // The repeat stock-in upserts the SAME row — it does not add a
          // second one.
          expect(world.overlays.size).toBe(sizeBeforeSecond);
          expect(world.overlays.size).toBe(before + 1);

          // And it is genuinely the same record, now holding the sum — not a
          // second record shadowing the first.
          const key = overlayKey(clinicId, productId);
          expect(world.overlays.get(key)?.stockQuantity).toBe(
            firstQuantity + secondQuantity,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("calling setClinicProductVisibility twice in a row for the same (clinic, product) pair leaves world.overlays.size unchanged after the second call", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.boolean(),
        fc.boolean(),
        (clinicId, productId, firstVisible, secondVisible) => {
          const world = buildWorld();
          const before = world.overlays.size;

          const first = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible: firstVisible,
          });
          expect(first.ok).toBe(true);
          const afterFirst = world.overlays.size;
          // The pair was untouched before, so the first call creates exactly
          // one row.
          expect(afterFirst).toBe(before + 1);

          const sizeBeforeSecond = world.overlays.size;
          const second = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible: secondVisible,
          });
          expect(second.ok).toBe(true);

          // The repeat visibility-set upserts the SAME row — it does not add a
          // second one, whether or not the visibility value actually changed.
          expect(world.overlays.size).toBe(sizeBeforeSecond);
          expect(world.overlays.size).toBe(before + 1);

          const key = overlayKey(clinicId, productId);
          expect(world.overlays.get(key)?.isVisible).toBe(secondVisible);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a stock-in followed by a visibility-set on the same pair also leaves world.overlays.size at exactly one for that pair", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.integer({ min: 1, max: 100 }),
        fc.boolean(),
        fc.constantFrom(...ACTOR_USER_IDS),
        (clinicId, productId, quantity, isVisible, actorUserId) => {
          const world = buildWorld();
          const before = world.overlays.size;

          const stockInResult = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });
          expect(stockInResult.ok).toBe(true);
          expect(world.overlays.size).toBe(before + 1);

          const visibilityResult = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible,
          });
          expect(visibilityResult.ok).toBe(true);

          // The two different overlay-touching operations, on the same pair,
          // still resolve to a single record.
          expect(world.overlays.size).toBe(before + 1);

          const key = overlayKey(clinicId, productId);
          const record = world.overlays.get(key);
          expect(record?.stockQuantity).toBe(quantity);
          expect(record?.isVisible).toBe(isVisible);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
