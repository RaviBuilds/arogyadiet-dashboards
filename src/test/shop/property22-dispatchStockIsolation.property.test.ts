// src/test/shop/property22-dispatchStockIsolation.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 22 (Task 9.7)
//
// Property 22: Dispatch Stock leaves clinic shop stock untouched.
//
// *For any* Dispatch Stock operation to any destination, including a Core
// Clinic destination, every `clinic_product_settings` stock quantity is
// unchanged, no clinic ledger entry is recorded, and the recorded warehouse
// transaction reason does not carry the `shop-clinic:` prefix.
//
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 7.9**
//
// WHY THIS IS A STRUCTURAL + MODEL-BOUNDARY PROPERTY, NOT A SHARED-MODEL ONE
// `src/test/shop/clinicStockModel.ts` deliberately does not implement
// `dispatchInventoryStock` / Dispatch Stock at all (see design.md's Non-goals:
// "Rewriting `dispatchInventoryStock` / `bulkDispatchAction`. Dispatch Stock
// keeps its current behaviour and its `clinic:`-derived reason snapshot
// untouched (Requirement 8.5). The new Stock In path is a parallel flow with
// its own `shop-clinic:` prefix."). There is therefore no single model to run
// one property against that covers both flows' state transitions together.
//
// Property 22 is instead verified from both directions, matching how the two
// flows are actually kept disjoint:
//
//   Property A (generative, >=100 runs): for any accepted Stock In submission
//   against the model, every `inventory_transactions` row the model creates
//   carries a `reason` that starts with `STOCK_IN_REASON_PREFIX`
//   (`shop-clinic:`) — Stock In's side of Requirement 7.9. If Dispatch Stock's
//   reason values never carry that prefix (checked structurally below, Req
//   8.4), the two flows are distinguishable purely by this prefix, exactly as
//   Requirement 8.4/8.5 require.
//
//   Property B (generative, >=100 runs): for any accepted Stock In submission
//   against the model, the FRANCHISE-side state
//   (`world.franchiseSettings`, `world.franchiseLots`, `world.franchiseLedger`)
//   is byte-for-byte unchanged before and after. Dispatch Stock's model
//   equivalent — the franchise dispatch/transfer flow — lives in that same
//   state; showing Stock In never touches it reinforces that the clinic
//   Stock In domain and the warehouse-dispatch-adjacent domain are disjoint
//   by construction (Req 8.1, 8.2, 8.3).
//
//   Structural check (example-based, not generative — there is nothing to
//   vary): reads the real `dispatchInventoryStock` implementation
//   (`src/services/inventoryEngine.ts`) as text and asserts it contains no
//   substring naming any clinic-shop-inventory table, RPC, or module (Req
//   8.1, 8.2, 8.3), and that its own dynamic reason values (the `clinic:`
//   prefix defined in `src/lib/inventory/product-schema.ts` and used by
//   `DispatchStockModal`) never carry the `shop-clinic:` prefix Stock In owns
//   (Req 8.4, 8.5, 7.9).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopStockIn,
  createWorld,
  STOCK_IN_REASON_PREFIX,
  type World,
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

// vitest runs with the project root as cwd (see vitest.config.ts).
const REPO_ROOT = process.cwd();
const INVENTORY_ENGINE_PATH = path.join(
  REPO_ROOT,
  "src",
  "services",
  "inventoryEngine.ts",
);
const PRODUCT_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "src",
  "lib",
  "inventory",
  "product-schema.ts",
);
const DISPATCH_MODAL_PATH = path.join(
  REPO_ROOT,
  "src",
  "shared",
  "components",
  "admin",
  "inventory",
  "modals",
  "DispatchStockModal.tsx",
);

/** Substrings that would indicate Dispatch Stock reaches into clinic-shop-inventory. */
const CLINIC_SHOP_INVENTORY_REFERENCES = [
  "clinic_product_settings",
  "clinic_product_ledger",
  "clinic_shop_stock_in",
  "clinic_shop_apply_sale",
  "clinicShopStockIn",
  "clinicShopApplySale",
  "clinicStockModel",
  "@/lib/shop/clinicStock",
  "@/types/clinicShop",
] as const;

function buildStockInWorld(): {
  world: World;
  clinicId: string;
  productId: string;
  inventoryProductId: string;
} {
  const clinicId = CORE_CLINIC_IDS[0];
  const productId = PRODUCT_IDS[0];
  const inventoryProductId = INVENTORY_PRODUCT_IDS[0];

  const world = createWorld({
    clinics: [{ id: clinicId, franchiseId: null }],
    products: [{ id: productId, inventoryProductId }],
    lots: {},
    franchiseIds: [],
    franchiseSettings: [],
    franchiseLots: {},
    actorUserIds: [...ACTOR_USER_IDS],
  });

  return { world, clinicId, productId, inventoryProductId };
}

describe("Property 22: Dispatch Stock leaves clinic shop stock untouched", () => {
  describe("Property A — every Stock In transaction reason carries the shop-clinic: prefix", () => {
    it("never writes an inventory_transactions reason outside the Stock_In_Reason_Prefix (Req 7.9)", () => {
      fc.assert(
        fc.property(
          arbLotSet,
          arbMovementQuantity,
          fc.constantFrom(...ACTOR_USER_IDS),
          (lots, quantity, actorUserId) => {
            const available = lotSetTotal(lots);
            // Constrain to accepted submissions — this property is about what
            // a *completed* Stock In writes, not rejection (rejections write
            // nothing at all, which trivially satisfies the property).
            fc.pre(available >= quantity);
            fc.pre(quantity > 0);

            const { world, clinicId, productId, inventoryProductId } =
              buildStockInWorld();
            world.lots.set(
              inventoryProductId,
              lots.map((lot) => ({ ...lot })),
            );

            const result = clinicShopStockIn(world, {
              clinicId,
              lines: [{ productId, quantity }],
              actorUserId,
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            // Every transaction the model has ever recorded — not just this
            // line's — must carry the prefix. There is no other writer in this
            // model, so this also documents that nothing else could sneak a
            // differently-prefixed reason in.
            expect(world.transactions.length).toBeGreaterThan(0);
            for (const tx of world.transactions) {
              expect(tx.reason.startsWith(STOCK_IN_REASON_PREFIX)).toBe(true);
              expect(tx.reason).toBe(`${STOCK_IN_REASON_PREFIX}${clinicId}`);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe("Property B — Stock In never touches franchise-side state", () => {
    it("leaves franchiseSettings, franchiseLots, and franchiseLedger byte-for-byte unchanged (Req 8.1, 8.2, 8.3)", () => {
      fc.assert(
        fc.property(
          arbLotSet,
          arbMovementQuantity,
          fc.constantFrom(...ACTOR_USER_IDS),
          (lots, quantity, actorUserId) => {
            const available = lotSetTotal(lots);
            fc.pre(available >= quantity);
            fc.pre(quantity > 0);

            const { world, clinicId, productId, inventoryProductId } =
              buildStockInWorld();
            world.lots.set(
              inventoryProductId,
              lots.map((lot) => ({ ...lot })),
            );

            const franchiseSettingsBefore = JSON.stringify(
              [...world.franchiseSettings.entries()].sort(),
            );
            const franchiseLotsBefore = JSON.stringify(
              [...world.franchiseLots.entries()].sort(),
            );
            const franchiseLedgerBefore = JSON.stringify(world.franchiseLedger);

            const result = clinicShopStockIn(world, {
              clinicId,
              lines: [{ productId, quantity }],
              actorUserId,
            });

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const franchiseSettingsAfter = JSON.stringify(
              [...world.franchiseSettings.entries()].sort(),
            );
            const franchiseLotsAfter = JSON.stringify(
              [...world.franchiseLots.entries()].sort(),
            );
            const franchiseLedgerAfter = JSON.stringify(world.franchiseLedger);

            expect(franchiseSettingsAfter).toBe(franchiseSettingsBefore);
            expect(franchiseLotsAfter).toBe(franchiseLotsBefore);
            expect(franchiseLedgerAfter).toBe(franchiseLedgerBefore);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe("Structural check — the real Dispatch Stock code path never reaches into clinic-shop-inventory", () => {
    const inventoryEngineSource = readFileSync(INVENTORY_ENGINE_PATH, "utf8");
    const productSchemaSource = readFileSync(PRODUCT_SCHEMA_PATH, "utf8");
    const dispatchModalSource = readFileSync(DISPATCH_MODAL_PATH, "utf8");

    it("dispatchInventoryStock in src/services/inventoryEngine.ts exists and is a Non-goal per design.md (Req 8.5)", () => {
      // Confirms the function this property is about actually exists at the
      // path the design document names, rather than asserting against a
      // stale or renamed reference.
      expect(inventoryEngineSource).toContain(
        "export async function dispatchInventoryStock(",
      );
    });

    it("dispatchInventoryStock never references any clinic-shop-inventory table, RPC, or module (Req 8.1, 8.2, 8.3)", () => {
      for (const reference of CLINIC_SHOP_INVENTORY_REFERENCES) {
        expect(inventoryEngineSource).not.toContain(reference);
      }
    });

    it("Dispatch Stock's dynamic reason prefix (`clinic:`) is distinct from the Stock_In_Reason_Prefix (`shop-clinic:`) (Req 8.4, 7.9)", () => {
      // The literal the Select component and dispatchStockAction use to tag a
      // clinic-destination dispatch, re-read from the source of truth rather
      // than re-declared, so a rename of either constant would fail this test
      // instead of silently drifting.
      expect(productSchemaSource).toContain(
        'export const CLINIC_DISPATCH_PREFIX = "clinic:";',
      );
      expect(`${STOCK_IN_REASON_PREFIX}`).not.toBe("clinic:");
      expect(STOCK_IN_REASON_PREFIX.startsWith("clinic:")).toBe(false);
      expect("clinic:".startsWith(STOCK_IN_REASON_PREFIX)).toBe(false);

      // Dispatch Stock's own modal never writes a `shop-clinic:`-prefixed
      // reason — the two flows' reason namespaces are disjoint by construction.
      expect(dispatchModalSource).not.toContain(STOCK_IN_REASON_PREFIX);
    });

    it("DispatchStockModal never references any clinic-shop-inventory table, RPC, or module (Req 8.1, 8.2, 8.3)", () => {
      for (const reference of CLINIC_SHOP_INVENTORY_REFERENCES) {
        expect(dispatchModalSource).not.toContain(reference);
      }
    });
  });
});
