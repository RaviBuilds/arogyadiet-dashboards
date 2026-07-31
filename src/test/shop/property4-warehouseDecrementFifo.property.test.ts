// src/test/shop/property4-warehouseDecrementFifo.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 4 (Task 4.8)
//
// Property 4: Stock In of Q decrements warehouse stock by exactly Q.
//
// For any linked Shop Product whose Master Catalog Product holds warehouse
// stock S across any arrangement of active lots, and any quantity Q with
// 1 <= Q <= S, a completed Stock In of Q leaves the warehouse holding exactly
// S - Q, depletes lots oldest-first, and records warehouse transactions whose
// quantities sum to -Q.
//
// **Validates: Requirements 3.6, 7.6, 7.8, 7.16**
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), the same
// model-based-testing stand-in Properties 1-3 use. Four sub-assertions are
// checked, matching the task's four checkpoints:
//
//   (a) `warehouseAvailable` after equals `warehouseAvailable` before minus Q,
//       exactly (Req 7.16, 3.6).
//   (b) the warehouse transactions recorded for this Stock In (the ids on
//       `applied[0].transactionIds`) sum, in absolute value, to exactly Q
//       (Req 7.6).
//   (c) depletion is oldest-first: walking the input lot list in order (the
//       contract `arbLotSet` already guarantees), every lot is either fully
//       exhausted, partially consumed as the *last* lot touched, or left
//       completely untouched, and no lot later in the list is touched while an
//       earlier lot with remaining stock is left non-empty (Req 7.8).
//   (d) the clinic overlay's `stockAfter - stockBefore` on `applied[0]` equals
//       Q exactly, mirroring the warehouse decrease (Req 7.16).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopStockIn,
  createWorld,
  warehouseAvailable,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  arbLotSet,
  arbMovementQuantity,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  lotSetTotal,
  PRODUCT_IDS,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

describe("Property 4: Stock In of Q decrements warehouse stock by exactly Q", () => {
  it("leaves warehouse stock at S - Q, depletes oldest-first, and mirrors the decrease onto the clinic overlay", () => {
    fc.assert(
      fc.property(
        arbLotSet,
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        (lots, quantity, actorUserId) => {
          const available = lotSetTotal(lots);
          // Constrain Q to [1, S] so the Stock In is always accepted — this
          // property is about what a *completed* Stock In does, not rejection.
          fc.pre(available >= quantity);

          const clinicId = CORE_CLINIC_IDS[0];
          const productId = PRODUCT_IDS[0];
          const inventoryProductId = INVENTORY_PRODUCT_IDS[0];

          const world = createWorld({
            clinics: [{ id: clinicId, franchiseId: null }],
            products: [{ id: productId, inventoryProductId }],
            lots: { [inventoryProductId]: lots },
            actorUserIds: [...ACTOR_USER_IDS],
          });

          // Snapshot the input lot list (already oldest-first per arbLotSet's
          // contract) before the operation mutates the world's lot records.
          const beforeLots = lots.map((lot) => ({ ...lot }));
          const warehouseBefore = warehouseAvailable(world, inventoryProductId);
          expect(warehouseBefore).toBe(available);

          const result = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const applied = result.value.applied[0];

          // (a) Warehouse available after equals before minus Q, exactly.
          const warehouseAfter = warehouseAvailable(world, inventoryProductId);
          expect(warehouseAfter).toBe(warehouseBefore - quantity);

          // (b) The warehouse transactions recorded for this line sum, in
          // absolute value, to exactly Q.
          const linesTransactions = world.transactions.filter((tx) =>
            applied.transactionIds.includes(tx.id),
          );
          expect(linesTransactions).toHaveLength(applied.transactionIds.length);
          const deductedTotal = linesTransactions.reduce(
            (sum, tx) => sum + -tx.quantityChanged,
            0,
          );
          expect(deductedTotal).toBe(quantity);
          // Every recorded transaction for a Stock In is an OUT with a negative
          // quantityChanged (Req 7.6).
          for (const tx of linesTransactions) {
            expect(tx.transactionType).toBe("OUT");
            expect(tx.quantityChanged).toBeLessThan(0);
          }

          // (c) Depletion is oldest-first: walk the input lot list in order and
          // verify each lot is fully exhausted, partially consumed as the last
          // lot touched, or left completely untouched — never a later lot
          // touched while an earlier one with remaining stock is left partial.
          const afterLotsById = new Map(
            (world.lots.get(inventoryProductId) ?? []).map((lot) => [lot.id, lot]),
          );

          let cumulativeBefore = 0;
          for (const lot of beforeLots) {
            const activeQuantity = lot.quantityRemaining > 0 ? lot.quantityRemaining : 0;
            const afterLot = afterLotsById.get(lot.id);
            expect(afterLot).toBeDefined();
            const afterQuantity = afterLot!.quantityRemaining;

            if (activeQuantity === 0) {
              // Already-exhausted lots (the mixed-with-exhausted-lots shape)
              // must stay untouched — there is nothing to deplete.
              expect(afterQuantity).toBe(lot.quantityRemaining);
            } else {
              const cumulativeAfterInclusive = cumulativeBefore + activeQuantity;
              if (cumulativeAfterInclusive <= quantity) {
                // Entirely within the depleted range: fully exhausted.
                expect(afterQuantity).toBe(0);
              } else if (cumulativeBefore < quantity) {
                // The lot straddles the depletion boundary: partially consumed,
                // and it is the last lot touched — remaining balance is exact.
                expect(afterQuantity).toBe(cumulativeAfterInclusive - quantity);
              } else {
                // Entirely beyond what Q required: left untouched.
                expect(afterQuantity).toBe(activeQuantity);
              }
            }
            cumulativeBefore += activeQuantity;
          }

          // (d) The clinic overlay's increase mirrors the warehouse decrease
          // exactly (Req 7.16).
          expect(applied.stockAfter - applied.stockBefore).toBe(quantity);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
