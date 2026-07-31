// src/test/shop/property2-stockLedgerParity.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 2 (Task 4.6)
//
// Property 2: Stock equals ledger IN minus ledger OUT.
//
// For any clinic, product, and arbitrary sequence of accepted movements applied
// through the stock-in and sale paths, the resulting `stock_quantity` for that
// `(clinic_id, product_id)` pair equals the sum of all `IN` entry quantities
// minus the sum of all `OUT` entry quantities for that pair.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), which is
// the design's own model-based-testing stand-in for the real RPCs — the same
// pattern Properties 1 and 3 use. `verifyLedgerParity` is the model's detector
// for exactly this invariant (it mirrors `verify_clinic_stock_ledger_parity()`);
// an empty array is the invariant holding for every `(clinic_id, product_id)`
// pair the world has ever touched, not just the pair a single assertion names.
//
// Both stated forms are checked:
// (a) per-operation — a single accepted Stock In or sale leaves the parity
//     detector empty immediately afterwards; and
// (b) per-sequence — across an arbitrary interleaving of stock-ins, sales, and
//     visibility changes (rejections from oversell/overdraw are expected and
//     fine — they must simply change nothing), the parity detector reports
//     empty after *every* step, not only after the full sequence, which is the
//     stronger form the task calls for.
//
// **Validates: Requirements 2.5, 2.7, 10.10**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopApplySale,
  clinicShopStockIn,
  createWorld,
  setClinicProductVisibility,
  verifyLedgerParity,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  ADDON_ORDER_IDS,
  arbLotSet,
  arbMovementQuantity,
  arbMovementSequence,
  CORE_CLINIC_IDS,
  INVENTORY_PRODUCT_IDS,
  lotSetTotal,
  PRODUCT_IDS,
  type MovementCommand,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 500;

// ─── World factory ───────────────────────────────────────────────────────────

/**
 * A world with every fixture product linked to a Master Catalog Product, so
 * Stock In submissions can be genuinely accepted. Sale submissions read only
 * the clinic overlay, so linking has no bearing on them.
 */
function buildWorld(
  lotsByInventoryProduct: Record<string, { id: string; quantityRemaining: number }[]>,
): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: PRODUCT_IDS.map((id, index) => ({
      id,
      inventoryProductId: INVENTORY_PRODUCT_IDS[index % INVENTORY_PRODUCT_IDS.length],
    })),
    lots: lotsByInventoryProduct,
    addonOrderIds: [...ADDON_ORDER_IDS],
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

// ─── (a) Per-operation: parity holds immediately after a single movement ────

describe("Property 2: Stock equals ledger IN minus ledger OUT", () => {
  it("parity holds after a single accepted Stock In, however many lots the FIFO plan spans", () => {
    fc.assert(
      fc.property(
        arbLotSet,
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        (lots, quantity, actorUserId) => {
          const available = lotSetTotal(lots);
          fc.pre(available >= quantity);

          const clinicId = CORE_CLINIC_IDS[0];
          const productId = PRODUCT_IDS[0];
          const inventoryProductId = INVENTORY_PRODUCT_IDS[0];
          const world = buildWorld({ [inventoryProductId]: lots });

          const result = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });

          expect(result.ok).toBe(true);
          expect(verifyLedgerParity(world)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("parity holds after a single accepted sale", () => {
    fc.assert(
      fc.property(
        arbMovementQuantity,
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        fc.constantFrom(...ADDON_ORDER_IDS),
        (seedQuantity, saleQuantity, actorUserId, addonOrderId) => {
          fc.pre(saleQuantity <= seedQuantity);

          const clinicId = CORE_CLINIC_IDS[0];
          const productId = PRODUCT_IDS[0];
          const inventoryProductId = INVENTORY_PRODUCT_IDS[0];
          const world = buildWorld({
            [inventoryProductId]: [{ id: "seed-lot", quantityRemaining: 10_000_000 }],
          });

          // Seed enough clinic stock via an accepted Stock In so the sale itself
          // is guaranteed to be accepted.
          const seed = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity: seedQuantity }],
            actorUserId,
          });
          expect(seed.ok).toBe(true);
          expect(verifyLedgerParity(world)).toEqual([]);

          const result = clinicShopApplySale(world, {
            clinicId,
            addonOrderId,
            lines: [{ productId, quantity: saleQuantity }],
            movementSource: "WALKIN_SALE",
            actorUserId,
          });

          expect(result.ok).toBe(true);
          expect(verifyLedgerParity(world)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("parity is unaffected by a rejected Stock In or sale (nothing is mutated)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...ACTOR_USER_IDS),
        fc.constantFrom(...ADDON_ORDER_IDS),
        (clinicId, productId, quantity, actorUserId, addonOrderId) => {
          // Empty lots ⇒ zero warehouse availability ⇒ Stock In must be rejected.
          const world = buildWorld({});

          const stockInResult = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });
          expect(stockInResult.ok).toBe(false);
          expect(verifyLedgerParity(world)).toEqual([]);

          // Empty clinic overlay ⇒ zero effective stock ⇒ sale must be rejected.
          const saleResult = clinicShopApplySale(world, {
            clinicId,
            addonOrderId,
            lines: [{ productId, quantity }],
            movementSource: "WALKIN_SALE",
            actorUserId,
          });
          expect(saleResult.ok).toBe(false);
          expect(verifyLedgerParity(world)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── (b) Per-sequence: parity holds after every step, not only at the end ───

/** Apply one movement command against the world. Rejections are expected and fine. */
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

describe("Property 2 (sequence form): parity holds after every step of an arbitrary movement sequence", () => {
  it("verifyLedgerParity reports no divergence after each step, and after the full sequence", () => {
    fc.assert(
      fc.property(
        arbMovementSequence({
          clinicIds: [CORE_CLINIC_IDS[0], CORE_CLINIC_IDS[1]],
          productIds: [PRODUCT_IDS[0], PRODUCT_IDS[1]],
          maxLength: 20,
        }),
        (commands) => {
          // Ample warehouse lots so a healthy mix of Stock In lines are accepted
          // rather than every one being rejected for lack of warehouse supply.
          // Sale rejections from insufficient clinic stock remain possible and
          // are exactly the "expected and fine" case the task calls out.
          const world = buildWorld({
            [INVENTORY_PRODUCT_IDS[0]]: [{ id: "seed-lot-0", quantityRemaining: 10_000_000 }],
            [INVENTORY_PRODUCT_IDS[1]]: [{ id: "seed-lot-1", quantityRemaining: 10_000_000 }],
          });

          for (const command of commands) {
            applyCommand(world, command);
            // Stronger than checking only at the end: parity must hold after
            // every single step, whether that step was accepted or rejected.
            expect(verifyLedgerParity(world)).toEqual([]);
          }

          // Redundant with the loop's last iteration when the sequence is
          // non-empty, but also covers the empty-sequence case explicitly.
          expect(verifyLedgerParity(world)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
