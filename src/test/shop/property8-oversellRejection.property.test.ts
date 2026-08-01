// src/test/shop/property8-oversellRejection.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 8 (Task 9.5)
//
// Property 8: Oversell is rejected.
//
// For any sale submission where at least one line requests more than the
// fulfilling clinic's current Effective_Clinic_Stock for that product, across
// any of the three selling channels (Movement_Sources), the entire sale is
// rejected with the `CLINIC_STOCK_INSUFFICIENT_CLINIC:` prefix, every
// shortfall product is named in the rejection (not just the first), and
// nothing is mutated — no overlay stock changes, no ledger entry is written,
// for any line in the submission, including lines that individually would
// have been fine.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), the
// design's model-based-testing stand-in for `clinic_shop_apply_sale`, which
// applies Requirements 10.8-10.11, 11.1-11.4 identically across all three
// selling channels (Req 11.3). Per the task's own instruction, the sale
// channel is generated (`arbSaleChannel`) rather than split into one test per
// channel — the same test body must pass regardless of which of
// CUSTOMER_APP_SALE, ASSISTED_SALE, or WALKIN_SALE was drawn.
//
// Three forms are checked, per the task:
// (a) generative — 2-4 products, each with an independently-generated overlay
//     stock level, and a sale submission where at least one line's requested
//     quantity exceeds that product's seeded stock while other lines may be
//     entirely valid; asserts full rejection, every shortfall product named
//     with the correct `available`, and zero mutation of any overlay or the
//     ledger, for any generated channel (Req 11.1, 11.3, 11.5, 11.6, 15.10).
// (b) focused — a sale against a product with no overlay record at all is
//     always rejected as insufficient (0 available), for any requested
//     quantity >= 1 and any channel (Req 11.1's "clinic holds no record").
// (c) focused, adjacent (Req 11.4 boundary) — when every line's quantity
//     exactly equals the available stock (not a shortfall), the sale
//     succeeds and leaves each product's stock at exactly 0, confirming the
//     "insufficient" boundary is strictly greater-than, not
//     greater-than-or-equal.
//
// **Validates: Requirements 10.11, 11.1, 11.3, 11.5, 11.6, 15.10**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopApplySale,
  cloneWorld,
  createWorld,
  overlayKey,
  type StockInLineInput,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  ADDON_ORDER_IDS,
  arbSaleChannel,
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 150;

const FULFILLING_CLINIC_ID = CORE_CLINIC_IDS[0];

/** A world with every fixture clinic, all fixture products (unlinked — this
 * property never touches the warehouse side), and the fixture actors/orders
 * declared as the known reference universes so any acceptance or rejection
 * observed is driven only by the clinic-stock check under test. */
function buildWorld(
  overlays: ReadonlyArray<{
    clinicId: string;
    productId: string;
    stockQuantity: number;
  }>,
): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: PRODUCT_IDS.map((id) => ({ id, inventoryProductId: null })),
    overlays,
    addonOrderIds: [...ADDON_ORDER_IDS],
    actorUserIds: [...ACTOR_USER_IDS],
  });
}

describe("Property 8: Oversell is rejected", () => {
  it("rejects the whole sale with CLINIC_STOCK_INSUFFICIENT_CLINIC:, names every shortfall product with its correct available stock, and mutates nothing, for any sale channel", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        arbSaleChannel,
        fc.constantFrom(...ADDON_ORDER_IDS),
        fc.constantFrom(...ACTOR_USER_IDS),
        // One seeded stock level per line's product (bounded small range —
        // readable, and comfortably clear of the 1,000,000 cap).
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 4, maxLength: 4 }),
        // One requested quantity per line, and one "is this line a
        // deliberate shortfall" flag per line — at least one must be true,
        // enforced below.
        fc.array(fc.integer({ min: 1, max: 25 }), { minLength: 4, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        (
          length,
          movementSource,
          addonOrderId,
          actorUserId,
          stockLevels,
          rawQuantities,
          shortfallFlags,
        ) => {
          const productIds = PRODUCT_IDS.slice(0, length);
          const stocks = stockLevels.slice(0, length);
          let flags = shortfallFlags.slice(0, length);

          // Ensure at least one line is a genuine shortfall (per the task:
          // "at least one line requests more than ... stock").
          if (!flags.some(Boolean)) {
            flags = flags.map((_, i) => i === 0);
          }

          const overlays = productIds.map((productId, i) => ({
            clinicId: FULFILLING_CLINIC_ID,
            productId,
            stockQuantity: stocks[i],
          }));

          const lines: StockInLineInput[] = productIds.map((productId, i) => {
            const stock = stocks[i];
            if (flags[i]) {
              // Deliberate shortfall: strictly more than the seeded stock.
              return { productId, quantity: stock + rawQuantities[i] };
            }
            // A valid, individually-fine line: at most the seeded stock (0 is
            // rejected as INVALID_QUANTITY, which would confound the
            // property, so bottom out at 1 when stock is 0 by re-using it as
            // a shortfall of exactly 1 over — still <= 0 is impossible, so
            // when stock is 0 the only "valid" request would be 0, which
            // isn't allowed; treat that case as a shortfall instead so every
            // line stays a well-defined case).
            if (stock === 0) {
              return { productId, quantity: rawQuantities[i] };
            }
            return { productId, quantity: Math.min(rawQuantities[i], stock) };
          });

          // Recompute which lines are actually shortfalls against the final
          // quantities (a stock-0 "valid" line becomes a shortfall too).
          const actualShortfalls = new Set(
            lines
              .filter((line, i) => line.quantity > stocks[i])
              .map((line) => line.productId),
          );
          expect(actualShortfalls.size).toBeGreaterThan(0);

          const world = buildWorld(overlays);
          const before = cloneWorld(world);

          const result = clinicShopApplySale(world, {
            clinicId: FULFILLING_CLINIC_ID,
            addonOrderId,
            lines,
            movementSource,
            actorUserId,
          });

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.prefix).toBe("CLINIC_STOCK_INSUFFICIENT_CLINIC:");

          // Every shortfall product is named — not just the first.
          const namedProductIds = new Set(
            result.error.products.map((p) => p.productId),
          );
          expect(namedProductIds).toEqual(actualShortfalls);

          // Each named product's `available` matches its own pre-sale
          // Effective_Clinic_Stock, not some other product's.
          for (const product of result.error.products) {
            const index = productIds.indexOf(product.productId);
            expect(product.available).toBe(stocks[index]);
          }

          // Nothing mutated: every overlay (including the individually-valid
          // lines' overlays) is byte-for-byte unchanged, and no new ledger
          // entries exist anywhere.
          expect(world.overlays.size).toBe(before.overlays.size);
          for (const [key, overlay] of before.overlays) {
            expect(world.overlays.get(key)).toEqual(overlay);
          }
          expect(world.ledger).toEqual(before.ledger);
          expect(world).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 8 (focused): a product with no overlay record is always insufficient", () => {
  it("rejects a sale against a never-touched product (0 available) for any requested quantity >= 1 and any channel, and mutates nothing", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRODUCT_IDS),
        fc.integer({ min: 1, max: 1_000_000 }),
        arbSaleChannel,
        fc.constantFrom(...ADDON_ORDER_IDS),
        fc.constantFrom(...ACTOR_USER_IDS),
        (productId, quantity, movementSource, addonOrderId, actorUserId) => {
          // No overlays at all — the product has never been touched at this
          // clinic (Req 11.1's "clinic holds no record" scenario).
          const world = buildWorld([]);
          const before = cloneWorld(world);

          const result = clinicShopApplySale(world, {
            clinicId: FULFILLING_CLINIC_ID,
            addonOrderId,
            lines: [{ productId, quantity }],
            movementSource,
            actorUserId,
          });

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.prefix).toBe("CLINIC_STOCK_INSUFFICIENT_CLINIC:");
          expect(result.error.products).toEqual([
            expect.objectContaining({ productId, available: 0 }),
          ]);

          // No overlay was created, and nothing else mutated.
          expect(world.overlays.has(overlayKey(FULFILLING_CLINIC_ID, productId))).toBe(
            false,
          );
          expect(world).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 8 (focused, Req 11.4 boundary): requesting exactly the available stock succeeds and leaves 0", () => {
  it("when every line's quantity exactly equals its product's available stock, the sale succeeds and each product's stock ends at exactly 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        arbSaleChannel,
        fc.constantFrom(...ADDON_ORDER_IDS),
        fc.constantFrom(...ACTOR_USER_IDS),
        // Available stock strictly > 0, so the request is a real quantity
        // (movement quantity minimum is 1), and the boundary — request ==
        // available, not request > available — is genuinely exercised.
        fc.array(fc.integer({ min: 1, max: 25 }), { minLength: 4, maxLength: 4 }),
        (length, movementSource, addonOrderId, actorUserId, stockLevels) => {
          const productIds = PRODUCT_IDS.slice(0, length);
          const stocks = stockLevels.slice(0, length);

          const overlays = productIds.map((productId, i) => ({
            clinicId: FULFILLING_CLINIC_ID,
            productId,
            stockQuantity: stocks[i],
          }));

          const lines: StockInLineInput[] = productIds.map((productId, i) => ({
            productId,
            quantity: stocks[i],
          }));

          const world = buildWorld(overlays);

          const result = clinicShopApplySale(world, {
            clinicId: FULFILLING_CLINIC_ID,
            addonOrderId,
            lines,
            movementSource,
            actorUserId,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          for (const productId of productIds) {
            const overlay = world.overlays.get(
              overlayKey(FULFILLING_CLINIC_ID, productId),
            );
            expect(overlay?.stockQuantity).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
