// src/test/shop/property3-oneLedgerEntryPerChange.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 3 (Task 4.7)
//
// Property 3: Every accepted stock change writes exactly one ledger entry.
//
// For any accepted movement of quantity Q against a clinic's stock, exactly one
// ledger entry is produced, its direction is `IN` when the change increases
// stock and `OUT` when it decreases stock, and its quantity equals the absolute
// size of the change.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), which is
// the design's own model-based-testing stand-in for the real RPCs — the same
// pattern Properties 1 and 2 use. Both stated forms from the task are checked:
// (a) per-operation — a single accepted Stock In or sale submission appends
//     exactly one ledger entry per line it applied, never one per submission
//     and never one per FIFO-depleted lot; and
// (b) per-sequence — across an arbitrary movement sequence, the ledger grows by
//     exactly the applied-line-count of every accepted stock-in/sale operation
//     and by zero for every rejected one and for every set-visibility op, since
//     visibility is not a stock change (Req 6.6) and is out of this property's
//     "every accepted stock CHANGE" scope.
//
// **Validates: Requirements 2.5, 2.8, 10.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopApplySale,
  clinicShopStockIn,
  createWorld,
  setClinicProductVisibility,
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

const NUM_RUNS = 200;

// ─── World factory ───────────────────────────────────────────────────────────

/**
 * A world with every fixture product linked to a Master Catalog Product and
 * seeded with warehouse lots, so Stock In submissions can be accepted and their
 * FIFO plans can genuinely span several lots. Sale submissions read only the
 * clinic overlay, so linking has no bearing on them.
 */
function buildWorld(lotsByInventoryProduct: Record<string, { id: string; quantityRemaining: number }[]>): World {
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

// ─── (a) Per-operation: one ledger entry per applied line ────────────────────

describe("Property 3: Every accepted stock change writes exactly one ledger entry", () => {
  it("a single accepted Stock In appends exactly one IN entry per line, regardless of how many lots each line spans", () => {
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

          const before = world.ledger.length;
          const result = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // Exactly one new ledger entry total, no matter how many lots the
          // FIFO plan touched (a many-small-lots shape can span several steps).
          expect(world.ledger.length).toBe(before + 1);
          expect(result.value.applied).toHaveLength(1);

          const newEntry = world.ledger[world.ledger.length - 1];
          expect(newEntry.direction).toBe("IN");
          expect(newEntry.quantity).toBe(quantity);
          expect(newEntry.clinicId).toBe(clinicId);
          expect(newEntry.productId).toBe(productId);
          expect(newEntry.id).toBe(result.value.applied[0].ledgerEntryId);

          // The FIFO plan may have spanned multiple lots (and therefore multiple
          // inventory_transactions rows), but that never inflates the ledger.
          if (result.value.applied[0].transactionIds.length > 1) {
            expect(world.ledger.length).toBe(before + 1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a single accepted Stock In submission of N lines appends exactly N IN entries, one per line, not one per submission", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...PRODUCT_IDS), { minLength: 1, maxLength: PRODUCT_IDS.length }),
        fc.constantFrom(...ACTOR_USER_IDS),
        (productIds, actorUserId) => {
          const clinicId = CORE_CLINIC_IDS[0];
          const lotsSpec: Record<string, { id: string; quantityRemaining: number }[]> = {};
          for (const inventoryProductId of INVENTORY_PRODUCT_IDS) {
            lotsSpec[inventoryProductId] = [{ id: `${inventoryProductId}-lot`, quantityRemaining: 10_000 }];
          }
          const world = buildWorld(lotsSpec);

          const lines = productIds.map((productId) => ({ productId, quantity: 5 }));
          const before = world.ledger.length;
          const result = clinicShopStockIn(world, { clinicId, lines, actorUserId });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // One entry per submitted line — not one per submission (which would
          // be a single entry regardless of line count).
          expect(world.ledger.length).toBe(before + lines.length);
          expect(result.value.applied).toHaveLength(lines.length);

          const newEntries = world.ledger.slice(before);
          expect(newEntries).toHaveLength(lines.length);
          for (const entry of newEntries) {
            expect(entry.direction).toBe("IN");
            expect(entry.quantity).toBe(5);
          }
          // Every ledger entry id created corresponds 1:1 to an applied line.
          expect(new Set(newEntries.map((entry) => entry.id))).toEqual(
            new Set(result.value.applied.map((line) => line.ledgerEntryId)),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a single accepted sale appends exactly one OUT entry per line", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...PRODUCT_IDS), { minLength: 1, maxLength: PRODUCT_IDS.length }),
        arbMovementQuantity,
        fc.constantFrom(...ACTOR_USER_IDS),
        fc.constantFrom(...ADDON_ORDER_IDS),
        (productIds, quantity, actorUserId, addonOrderId) => {
          const clinicId = CORE_CLINIC_IDS[0];
          const world = buildWorld({});

          // Seed each product's overlay with at least the sale quantity via an
          // accepted Stock In, so the sale itself is guaranteed to be accepted.
          for (const inventoryProductId of INVENTORY_PRODUCT_IDS) {
            world.lots.set(inventoryProductId, [
              { id: `${inventoryProductId}-lot`, quantityRemaining: 10_000_000 },
            ]);
          }
          const seed = clinicShopStockIn(world, {
            clinicId,
            lines: productIds.map((productId) => ({ productId, quantity })),
            actorUserId,
          });
          expect(seed.ok).toBe(true);

          const before = world.ledger.length;
          const lines = productIds.map((productId) => ({ productId, quantity }));
          const result = clinicShopApplySale(world, {
            clinicId,
            addonOrderId,
            lines,
            movementSource: "CUSTOMER_APP_SALE",
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(world.ledger.length).toBe(before + lines.length);
          expect(result.value.applied).toHaveLength(lines.length);

          const newEntries = world.ledger.slice(before);
          for (const entry of newEntries) {
            expect(entry.direction).toBe("OUT");
            expect(entry.quantity).toBe(quantity);
            expect(entry.addonOrderId).toBe(addonOrderId);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("set-visibility never appends a ledger entry, even when it creates the overlay row (Req 6.6 — not a stock change)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.boolean(),
        fc.boolean(),
        (clinicId, productId, first, second) => {
          const world = buildWorld({});
          const before = world.ledger.length;

          const r1 = setClinicProductVisibility(world, { clinicId, productId, isVisible: first });
          expect(r1.ok).toBe(true);
          expect(world.ledger.length).toBe(before);

          const r2 = setClinicProductVisibility(world, { clinicId, productId, isVisible: second });
          expect(r2.ok).toBe(true);
          expect(world.ledger.length).toBe(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a rejected Stock In or sale appends no ledger entry at all", () => {
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
          const before = world.ledger.length;

          const stockInResult = clinicShopStockIn(world, {
            clinicId,
            lines: [{ productId, quantity }],
            actorUserId,
          });
          expect(stockInResult.ok).toBe(false);
          expect(world.ledger.length).toBe(before);

          // Empty clinic overlay ⇒ zero effective stock ⇒ sale must be rejected.
          const saleResult = clinicShopApplySale(world, {
            clinicId,
            addonOrderId,
            lines: [{ productId, quantity }],
            movementSource: "WALKIN_SALE",
            actorUserId,
          });
          expect(saleResult.ok).toBe(false);
          expect(world.ledger.length).toBe(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── (b) Per-sequence: ledger growth equals sum of applied-line-counts ───────

/** Apply one movement command, returning the number of applied lines, or null on rejection. */
function applyCommand(world: World, command: MovementCommand): number | null {
  switch (command.kind) {
    case "stock-in": {
      const result = clinicShopStockIn(world, {
        clinicId: command.clinicId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        actorUserId: command.actorUserId,
      });
      return result.ok ? result.value.applied.length : null;
    }
    case "sale": {
      const result = clinicShopApplySale(world, {
        clinicId: command.clinicId,
        addonOrderId: command.addonOrderId,
        lines: [{ productId: command.productId, quantity: command.quantity }],
        movementSource: command.channel,
        actorUserId: command.actorUserId,
      });
      return result.ok ? result.value.applied.length : null;
    }
    case "set-visibility": {
      const result = setClinicProductVisibility(world, {
        clinicId: command.clinicId,
        productId: command.productId,
        isVisible: command.isVisible,
      });
      // Visibility is never a stock change: even on success it contributes 0
      // ledger entries (Req 6.6).
      return result.ok ? 0 : 0;
    }
    default:
      return 0;
  }
}

describe("Property 3 (sequence form): ledger growth equals the sum of every accepted operation's applied-line-count", () => {
  it("grows the ledger by exactly the applied-line-count of each accepted stock-in/sale, and by zero for rejections and visibility changes", () => {
    fc.assert(
      fc.property(
        arbMovementSequence({
          clinicIds: [CORE_CLINIC_IDS[0], CORE_CLINIC_IDS[1]],
          productIds: [PRODUCT_IDS[0], PRODUCT_IDS[1]],
          maxLength: 20,
        }),
        (commands) => {
          const world = buildWorld({
            [INVENTORY_PRODUCT_IDS[0]]: [{ id: "seed-lot-0", quantityRemaining: 10_000_000 }],
            [INVENTORY_PRODUCT_IDS[1]]: [{ id: "seed-lot-1", quantityRemaining: 10_000_000 }],
          });

          let expectedGrowth = 0;
          for (const command of commands) {
            const before = world.ledger.length;
            const appliedCount = applyCommand(world, command);
            const after = world.ledger.length;

            if (command.kind === "set-visibility") {
              // Never a ledger write, whether it creates the overlay or not.
              expect(after).toBe(before);
              continue;
            }

            if (appliedCount === null) {
              // Rejected: contributes zero to ledger growth.
              expect(after).toBe(before);
            } else {
              // Accepted: exactly one entry per applied line, no more, no less.
              expect(after).toBe(before + appliedCount);
              expectedGrowth += appliedCount;
            }
          }

          expect(world.ledger.length).toBe(expectedGrowth);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
