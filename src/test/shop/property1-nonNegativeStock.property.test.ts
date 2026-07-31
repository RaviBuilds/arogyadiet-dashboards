// src/test/shop/property1-nonNegativeStock.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 1 (Task 4.5)
//
// Property 1: Clinic stock is never negative.
//
// For any clinic, product, starting stock, and arbitrary sequence of applied
// stock-in and sale movements, the resulting `clinic_product_settings.stock_quantity`
// is greater than or equal to 0, and no applied sale ever brings it below 0.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), which is
// the design's own model-based-testing stand-in for the real RPCs — the
// invariant is about transactional behaviour across an arbitrary movement
// sequence, not something a live database run adds anything to.
//
// A movement sequence interleaves Stock In, sale, and visibility commands
// against a small clinic x product grid. Stock-ins and sales are *expected* to
// sometimes be rejected by the model — an oversell attempt or a warehouse
// shortfall is not a test failure, it's the guard this property relies on.
// What must never happen, no matter how the sequence shakes out, is a negative
// stored stock quantity for any (clinic, product) pair the sequence touched —
// checked after every single step, not just at the end.
//
// **Validates: Requirements 1.5, 1.6, 11.2, 11.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopApplySale,
  clinicShopStockIn,
  createWorld,
  effectiveOverlay,
  setClinicProductVisibility,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  ADDON_ORDER_IDS,
  arbMovementSequence,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  PRODUCT_IDS,
  type MovementCommand,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 500;

/** `${clinicId}|${productId}` — matches the model's own overlay key shape. */
function pairKey(clinicId: string, productId: string): string {
  return `${clinicId}|${productId}`;
}

/**
 * A world with every fixture product linked to a Master Catalog Product, a
 * generous warehouse lot pool so most Stock In submissions are accepted rather
 * than immediately shortfalling, and a modest initial overlay stock per
 * (clinic, product) pair so sales have real room to draw down before the
 * oversell guard has to reject anything.
 */
function buildWorld(): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: PRODUCT_IDS.map((id, index) => ({
      id,
      inventoryProductId: INVENTORY_PRODUCT_IDS[index % INVENTORY_PRODUCT_IDS.length],
    })),
    overlays: CORE_CLINIC_IDS.flatMap((clinicId) =>
      PRODUCT_IDS.map((productId) => ({
        clinicId,
        productId,
        stockQuantity: 20,
        isVisible: true,
      })),
    ),
    lots: Object.fromEntries(
      INVENTORY_PRODUCT_IDS.map((inventoryProductId) => [
        inventoryProductId,
        [{ id: `${inventoryProductId}-lot`, quantityRemaining: 10_000_000 }],
      ]),
    ),
    addonOrderIds: [...ADDON_ORDER_IDS],
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

/**
 * Apply one movement command to the world. A rejection (oversell, warehouse
 * shortfall, etc.) is expected and intentionally ignored here — this property
 * only cares about the stored stock quantity after whatever the model decided
 * to accept or reject.
 */
function applyCommand(world: World, command: MovementCommand): void {
  switch (command.kind) {
    case "stock-in": {
      clinicShopStockIn(world, {
        clinicId: command.clinicId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        actorUserId: command.actorUserId,
      });
      return;
    }
    case "sale": {
      clinicShopApplySale(world, {
        clinicId: command.clinicId,
        addonOrderId: command.addonOrderId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        movementSource: command.channel,
        actorUserId: command.actorUserId,
      });
      return;
    }
    case "set-visibility": {
      setClinicProductVisibility(world, {
        clinicId: command.clinicId,
        productId: command.productId,
        isVisible: command.isVisible,
      });
      return;
    }
    default:
      return;
  }
}

describe("Property 1: Clinic stock is never negative", () => {
  it("stays non-negative for every (clinic, product) pair a movement sequence touches, after every step and at the end", () => {
    fc.assert(
      fc.property(
        arbMovementSequence({
          clinicIds: [...CORE_CLINIC_IDS],
          productIds: [...PRODUCT_IDS],
          maxLength: 30,
        }),
        (commands) => {
          const world = buildWorld();
          const touchedPairs = new Set<string>();

          for (const command of commands) {
            touchedPairs.add(pairKey(command.clinicId, command.productId));

            applyCommand(world, command);

            // After every single step, every pair touched so far must read a
            // non-negative stock quantity — not just the pair this step named.
            for (const key of touchedPairs) {
              const [clinicId, productId] = key.split("|");
              const overlay = effectiveOverlay(world, clinicId, productId);
              expect(overlay.stockQuantity).toBeGreaterThanOrEqual(0);
            }
          }

          // And after the full sequence completes.
          for (const key of touchedPairs) {
            const [clinicId, productId] = key.split("|");
            const overlay = effectiveOverlay(world, clinicId, productId);
            expect(overlay.stockQuantity).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
