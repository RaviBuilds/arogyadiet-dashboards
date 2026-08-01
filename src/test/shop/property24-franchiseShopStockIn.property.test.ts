// src/test/shop/property24-franchiseShopStockIn.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 24 (Task 11.4)
//
// Property 24: Franchise shop stock-in mirrors the clinic guarantees.
//
// `franchiseShopStockIn` (the model of `franchise_shop_stock_in`) is the
// franchise-side twin of `clinicShopStockIn` (Property 4): it FIFO-depletes a
// warehouse (here, the franchise's own `franchise_inventory_lots`) and raises a
// settings row (here, `franchise_product_settings` rather than
// `clinic_product_settings`) by exactly the stocked-in quantity, writing one
// ledger entry per accepted call. This test mirrors Property 4's core
// assertion and rejection patterns almost exactly, with one deliberate
// exception the model's own header comment calls out: "Note the asymmetry the
// requirements specify: a newly created franchise settings row defaults to
// `is_visible = false`, whereas a clinic overlay defaults to visible
// (Req 18.3)." A copy-paste of the clinic property would wrongly assert
// `true` here — this test asserts `false` explicitly, and separately proves an
// *existing* settings row's visibility is left untouched by a stock-in either
// way.
//
// **Validates: Requirements 18.2, 18.3, 18.4, 18.5, 18.6, 18.8, 18.9, 18.10, 18.11**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  cloneWorld,
  createWorld,
  franchiseShopStockIn,
  franchiseWarehouseAvailable,
  overlayKey,
  FRANCHISE_SHOP_STOCK_IN_REASON,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  arbLotSet,
  arbMovementQuantity,
  FRANCHISE_IDS,
  INVENTORY_PRODUCT_IDS,
  lotSetTotal,
  PRODUCT_IDS,
  REFERENCE_STOCK_QUANTITY_MAXIMUM,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

// ─── Fixed pair under test ───────────────────────────────────────────────────

const FRANCHISE_ID = FRANCHISE_IDS[0];
const PRODUCT_ID = PRODUCT_IDS[0];
const INVENTORY_PRODUCT_ID = INVENTORY_PRODUCT_IDS[0];
const LOTS_KEY = overlayKey(FRANCHISE_ID, INVENTORY_PRODUCT_ID);
const SETTINGS_KEY = overlayKey(FRANCHISE_ID, PRODUCT_ID);

/** A world with the fixed pair linked, no pre-existing lots or settings. */
function buildBaseWorld(
  overrides: {
    franchiseLots?: Record<string, { id: string; quantityRemaining: number }[]>;
    franchiseSettings?: Array<{
      franchiseId: string;
      productId: string;
      stockQuantity: number;
      isVisible: boolean;
    }>;
  } = {},
): World {
  return createWorld({
    clinics: [],
    products: [{ id: PRODUCT_ID, inventoryProductId: INVENTORY_PRODUCT_ID }],
    franchiseIds: [...FRANCHISE_IDS],
    franchiseLots: overrides.franchiseLots ?? {},
    franchiseSettings: overrides.franchiseSettings ?? [],
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

describe("Property 24: Franchise shop stock-in mirrors the clinic guarantees", () => {
  it("leaves franchise warehouse stock at S - Q, depletes oldest-first, and raises franchise settings stock by exactly Q", () => {
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

          const world = buildBaseWorld({ franchiseLots: { [LOTS_KEY]: lots } });

          // Snapshot the input lot list (already oldest-first per arbLotSet's
          // contract) before the operation mutates the world's lot records.
          const beforeLots = lots.map((lot) => ({ ...lot }));
          const warehouseBefore = franchiseWarehouseAvailable(
            world,
            FRANCHISE_ID,
            INVENTORY_PRODUCT_ID,
          );
          expect(warehouseBefore).toBe(available);

          const result = franchiseShopStockIn(world, {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            quantity,
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const report = result.value;

          // (a) Franchise warehouse available after equals before minus Q,
          // exactly (Req 18.4, 18.5).
          const warehouseAfter = franchiseWarehouseAvailable(
            world,
            FRANCHISE_ID,
            INVENTORY_PRODUCT_ID,
          );
          expect(warehouseAfter).toBe(warehouseBefore - quantity);

          // (b) Depletion is oldest-first: walk the input lot list in order and
          // verify each lot is fully exhausted, partially consumed as the last
          // lot touched, or left completely untouched — never a later lot
          // touched while an earlier one with remaining stock is left partial
          // (Req 18.4). `transactionLotIds` must name exactly the touched lots,
          // in that same oldest-first order.
          const afterLots = world.franchiseLots.get(LOTS_KEY) ?? [];
          const afterLotsById = new Map(
            afterLots.map((lot) => [lot.id, lot]),
          );

          let cumulativeBefore = 0;
          const expectedTouchedIds: string[] = [];
          for (const lot of beforeLots) {
            const activeQuantity = lot.quantityRemaining > 0 ? lot.quantityRemaining : 0;
            const afterLot = afterLotsById.get(lot.id);
            expect(afterLot).toBeDefined();
            const afterQuantity = afterLot!.quantityRemaining;

            if (activeQuantity === 0) {
              // Already-exhausted lots must stay untouched.
              expect(afterQuantity).toBe(lot.quantityRemaining);
            } else {
              const cumulativeAfterInclusive = cumulativeBefore + activeQuantity;
              if (cumulativeAfterInclusive <= quantity) {
                // Entirely within the depleted range: fully exhausted.
                expect(afterQuantity).toBe(0);
                expectedTouchedIds.push(lot.id);
              } else if (cumulativeBefore < quantity) {
                // The lot straddles the depletion boundary: partially
                // consumed, and it is the last lot touched.
                expect(afterQuantity).toBe(cumulativeAfterInclusive - quantity);
                expectedTouchedIds.push(lot.id);
              } else {
                // Entirely beyond what Q required: left untouched.
                expect(afterQuantity).toBe(activeQuantity);
              }
            }
            cumulativeBefore += activeQuantity;
          }
          expect(report.transactionLotIds).toEqual(expectedTouchedIds);

          // (c) The franchise settings' stockQuantity increases by exactly Q
          // (Req 18.4).
          const setting = world.franchiseSettings.get(SETTINGS_KEY);
          expect(setting).toBeDefined();
          expect(report.stockAfter - report.stockBefore).toBe(quantity);
          expect(setting!.stockQuantity).toBe(report.stockAfter);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("creates a new franchise settings row with isVisible false — the asymmetry with the clinic default — and leaves an existing row's isVisible untouched", () => {
    fc.assert(
      fc.property(
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        fc.option(fc.boolean(), { nil: undefined }),
        (quantity, actorUserId, seededIsVisible) => {
          const hasExistingSettings = seededIsVisible !== undefined;

          const world = buildBaseWorld({
            franchiseLots: {
              [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
            },
            franchiseSettings: hasExistingSettings
              ? [
                  {
                    franchiseId: FRANCHISE_ID,
                    productId: PRODUCT_ID,
                    stockQuantity: 0,
                    isVisible: seededIsVisible!,
                  },
                ]
              : [],
          });

          const result = franchiseShopStockIn(world, {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            quantity,
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const setting = world.franchiseSettings.get(SETTINGS_KEY);
          expect(setting).toBeDefined();

          if (hasExistingSettings) {
            // No settingsCreated, and the stock-in must not touch isVisible at
            // all — it stays exactly at whatever value it was seeded with
            // (Req 18.3).
            expect(result.value.settingsCreated).toBe(false);
            expect(setting!.isVisible).toBe(seededIsVisible);
          } else {
            // THE ASYMMETRY (Req 18.3): a newly created franchise settings row
            // defaults to isVisible = false, NOT true as a newly created
            // clinic overlay does. A copy-paste of the clinic property would
            // wrongly assert `true` here.
            expect(result.value.settingsCreated).toBe(true);
            expect(setting!.isVisible).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("writes exactly one new franchise ledger entry per accepted stock-in, with direction OUT, the franchise stock-in reason, and quantity Q", () => {
    fc.assert(
      fc.property(
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        (quantity, actorUserId) => {
          const world = buildBaseWorld({
            franchiseLots: {
              [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
            },
          });

          const ledgerCountBefore = world.franchiseLedger.length;

          const result = franchiseShopStockIn(world, {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            quantity,
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // Exactly one new ledger entry (Req 18.6, 18.10).
          expect(world.franchiseLedger.length).toBe(ledgerCountBefore + 1);
          const entry = world.franchiseLedger[world.franchiseLedger.length - 1];
          expect(entry.id).toBe(result.value.ledgerEntryId);
          expect(entry.franchiseId).toBe(FRANCHISE_ID);
          expect(entry.productId).toBe(PRODUCT_ID);
          expect(entry.direction).toBe("OUT");
          // Imported directly from the model rather than hardcoded, so a
          // rename doesn't silently desync the test.
          expect(entry.stockOutReason).toBe(FRANCHISE_SHOP_STOCK_IN_REASON);
          expect(entry.quantity).toBe(quantity);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects an unlinked product with CLINIC_STOCK_UNLINKED_PRODUCT regardless of quantity, and leaves the world completely unchanged", () => {
    fc.assert(
      fc.property(
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        (quantity, actorUserId) => {
          const world = createWorld({
            clinics: [],
            products: [{ id: PRODUCT_ID, inventoryProductId: null }],
            franchiseIds: [...FRANCHISE_IDS],
            actorUserIds: [...ACTOR_USER_IDS],
          });

          const preSnapshot = cloneWorld(world);

          const result = franchiseShopStockIn(world, {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            quantity,
            actorUserId,
          });

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.prefix).toBe("CLINIC_STOCK_UNLINKED_PRODUCT:");

          // franchiseSettings, franchiseLots, and franchiseLedger — and, for
          // good measure, the whole world — are byte-for-byte unchanged
          // (Req 18.9).
          expect(world.franchiseSettings).toEqual(preSnapshot.franchiseSettings);
          expect(world.franchiseLots).toEqual(preSnapshot.franchiseLots);
          expect(world.franchiseLedger).toEqual(preSnapshot.franchiseLedger);
          expect(world).toEqual(preSnapshot);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a quantity that would push franchise stock over the maximum with CLINIC_STOCK_EXCEEDS_MAXIMUM, and leaves the world completely unchanged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }), // how close to the cap the seed starts
        fc.integer({ min: 1, max: 100 }), // extra pushed past the cap
        fc.constantFrom(...ACTOR_USER_IDS),
        (closeness, overshoot, actorUserId) => {
          const seededStock = REFERENCE_STOCK_QUANTITY_MAXIMUM - closeness;
          // seededStock + quantity = max + overshoot > max, always.
          const quantity = closeness + overshoot;

          const world = buildBaseWorld({
            franchiseLots: {
              [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
            },
            franchiseSettings: [
              {
                franchiseId: FRANCHISE_ID,
                productId: PRODUCT_ID,
                stockQuantity: seededStock,
                isVisible: true,
              },
            ],
          });

          const preSnapshot = cloneWorld(world);

          const result = franchiseShopStockIn(world, {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            quantity,
            actorUserId,
          });

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.prefix).toBe("CLINIC_STOCK_EXCEEDS_MAXIMUM:");

          expect(world).toEqual(preSnapshot);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts a quantity of exactly 1,000,000 from empty franchise stock, and rejects anything that would push past it", () => {
    // A quantity of exactly the cap, starting from 0, is accepted and results
    // in exactly the cap (Req 18.7 boundary).
    {
      const world = buildBaseWorld({
        franchiseLots: {
          [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
        },
      });
      const result = franchiseShopStockIn(world, {
        franchiseId: FRANCHISE_ID,
        productId: PRODUCT_ID,
        quantity: REFERENCE_STOCK_QUANTITY_MAXIMUM,
        actorUserId: ACTOR_USER_IDS[0],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stockAfter).toBe(REFERENCE_STOCK_QUANTITY_MAXIMUM);
      }
    }

    // A quantity of one past the cap, starting from 0, is rejected outright
    // (the quantity itself falls outside the valid movement-quantity range).
    {
      const world = buildBaseWorld({
        franchiseLots: {
          [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
        },
      });
      const result = franchiseShopStockIn(world, {
        franchiseId: FRANCHISE_ID,
        productId: PRODUCT_ID,
        quantity: REFERENCE_STOCK_QUANTITY_MAXIMUM + 1,
        actorUserId: ACTOR_USER_IDS[0],
      });
      expect(result.ok).toBe(false);
    }

    // A valid-range quantity that would push existing stock past the cap is
    // rejected specifically with CLINIC_STOCK_EXCEEDS_MAXIMUM.
    {
      const world = buildBaseWorld({
        franchiseLots: {
          [LOTS_KEY]: [{ id: "seed-lot", quantityRemaining: 2_000_000 }],
        },
        franchiseSettings: [
          {
            franchiseId: FRANCHISE_ID,
            productId: PRODUCT_ID,
            stockQuantity: REFERENCE_STOCK_QUANTITY_MAXIMUM,
            isVisible: true,
          },
        ],
      });
      const result = franchiseShopStockIn(world, {
        franchiseId: FRANCHISE_ID,
        productId: PRODUCT_ID,
        quantity: 1,
        actorUserId: ACTOR_USER_IDS[0],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.prefix).toBe("CLINIC_STOCK_EXCEEDS_MAXIMUM:");
      }
    }
  });
});
