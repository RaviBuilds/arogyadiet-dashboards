// src/test/shop/property5-allOrNothingRejection.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 5 (Task 4.9)
//
// Property 5: A rejected submission changes nothing.
//
// For any stock-in submission containing at least one line that exceeds
// available warehouse stock, would raise clinic stock above 1,000,000, has an
// out-of-range quantity, names an unlinked product, targets a franchise
// destination, or hits a mid-transaction write failure, the submission is
// rejected in full: every clinic overlay, every warehouse lot, every ledger
// entry, and every warehouse transaction is left at its pre-submission value.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), the
// design's model-based-testing stand-in for `clinic_shop_stock_in`. Rather than
// splitting into one test per rejection cause, the cause and the failing line
// index are generated (`arbRejectionInjection`) and used to engineer a
// submission that fails for exactly that reason at exactly that line, while
// every other line in the submission stays independently valid — so the test
// also proves the failure is not masked by an unrelated, higher-priority
// rejection.
//
// Requirement 20.3 concerns the data-migration abort case
// (`migrate_shop_stock_to_clinics`), a different RPC not yet implemented as of
// this task (it is created in task 12.1). That coverage is deferred to task
// 12.2's property test (Property 20). This property covers only the Stock_In
// all-or-nothing guarantee — Requirements 7.10, 7.12, 7.14, 7.15 — which is
// fully testable now.
//
// **Validates: Requirements 7.10, 7.12, 7.14, 7.15, 20.3 (20.3's migration-abort
// coverage deferred to task 12.2)**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  clinicShopStockIn,
  cloneWorld,
  createWorld,
  type StockInLineInput,
  type StockInOptions,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  ACTOR_USER_IDS,
  arbRejectionInjection,
  CORE_CLINIC_IDS,
  FRANCHISE_IDS,
  PRODUCT_IDS,
  REFERENCE_STOCK_QUANTITY_MAXIMUM,
  type RejectionCause,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 150;

/** The stable exception prefix Property 5 expects for each rejection cause. */
const EXPECTED_PREFIX: Record<RejectionCause, string> = {
  WAREHOUSE_SHORTFALL: "CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:",
  EXCEEDS_MAXIMUM: "CLINIC_STOCK_EXCEEDS_MAXIMUM:",
  INVALID_QUANTITY: "CLINIC_STOCK_INVALID_QUANTITY:",
  UNLINKED_PRODUCT: "CLINIC_STOCK_UNLINKED_PRODUCT:",
  FRANCHISE_DESTINATION: "CLINIC_STOCK_FRANCHISE_DESTINATION:",
  INJECTED_WRITE_FAILURE: "CLINIC_STOCK_WRITE_FAILED:",
};

/** A representative out-of-range integer for the INVALID_QUANTITY cause. */
const arbInvalidQuantity: fc.Arbitrary<number> = fc.constantFrom(
  0,
  -1,
  -1_000,
  REFERENCE_STOCK_QUANTITY_MAXIMUM + 1,
  5_000_000,
);

/**
 * Every line gets its own, otherwise-independent Master Catalog Product so
 * pooled-availability logic (several Shop Products sharing one warehouse item)
 * never leaks a fault from one line into another. Each "safe" line is linked,
 * quantity 10, backed by ample warehouse stock, and starts from an empty
 * overlay — comfortably inside every bound.
 */
function buildSubmission(
  clinicId: string,
  length: number,
  faultIndex: number,
  cause: RejectionCause,
  invalidQuantity: number,
): {
  world: World;
  lines: StockInLineInput[];
} {
  const productIds = PRODUCT_IDS.slice(0, length);
  const inventoryProductIdFor = (i: number) => `line-inv-${i}`;

  const products = productIds.map((id, i) => ({
    id,
    // UNLINKED_PRODUCT's fault line has no Product_Link at all.
    inventoryProductId:
      cause === "UNLINKED_PRODUCT" && i === faultIndex
        ? null
        : inventoryProductIdFor(i),
  }));

  const lots: Record<string, { id: string; quantityRemaining: number }[]> = {};
  const overlays: {
    clinicId: string;
    productId: string;
    stockQuantity: number;
    isVisible: boolean;
  }[] = [];
  const lines: StockInLineInput[] = [];

  for (let i = 0; i < length; i += 1) {
    const productId = productIds[i];
    const isFault = i === faultIndex;

    // Ample warehouse stock by default; the WAREHOUSE_SHORTFALL fault line
    // gets a deliberately small lot instead.
    if (cause !== "UNLINKED_PRODUCT" || i !== faultIndex) {
      const invId = inventoryProductIdFor(i);
      const quantityRemaining =
        isFault && cause === "WAREHOUSE_SHORTFALL" ? 3 : 1_000_000;
      lots[invId] = [{ id: `${invId}-lot`, quantityRemaining }];
    }

    // Every clinic starts with no overlay (stock 0), except the
    // EXCEEDS_MAXIMUM fault line, which starts one line-quantity below the cap
    // so adding the requested quantity pushes it over.
    if (isFault && cause === "EXCEEDS_MAXIMUM") {
      overlays.push({
        clinicId,
        productId,
        stockQuantity: REFERENCE_STOCK_QUANTITY_MAXIMUM - 5,
        isVisible: true,
      });
    }

    let quantity = 10;
    if (isFault) {
      switch (cause) {
        case "WAREHOUSE_SHORTFALL":
          quantity = 50; // exceeds the 3-unit lot above
          break;
        case "EXCEEDS_MAXIMUM":
          quantity = 10; // (max - 5) + 10 > max
          break;
        case "INVALID_QUANTITY":
          quantity = invalidQuantity;
          break;
        default:
          quantity = 10;
      }
    }

    lines.push({ productId, quantity });
  }

  const world = createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products,
    lots,
    overlays,
    franchiseIds: [...FRANCHISE_IDS],
    actorUserIds: [...ACTOR_USER_IDS],
  });

  return { world, lines };
}

describe("Property 5: A rejected submission changes nothing", () => {
  it("rejects the engineered cause at the engineered line and leaves every overlay, lot, ledger entry, and transaction unchanged", () => {
    fc.assert(
      fc.property(
        arbRejectionInjection,
        fc.integer({ min: 1, max: PRODUCT_IDS.length }),
        fc.integer({ min: 0, max: CORE_CLINIC_IDS.length - 1 }),
        fc.integer({ min: 0, max: FRANCHISE_IDS.length - 1 }),
        fc.constantFrom(...ACTOR_USER_IDS),
        arbInvalidQuantity,
        (
          injection,
          length,
          coreClinicIndex,
          franchiseIndex,
          actorUserId,
          invalidQuantity,
        ) => {
          const { cause } = injection;
          const faultIndex = injection.lineIndex % length;

          // FRANCHISE_DESTINATION is a whole-submission rejection: the
          // destination itself is invalid, independent of any line content.
          const destinationClinicId =
            cause === "FRANCHISE_DESTINATION"
              ? FRANCHISE_IDS[franchiseIndex]
              : CORE_CLINIC_IDS[coreClinicIndex];

          const { world, lines } = buildSubmission(
            destinationClinicId,
            length,
            faultIndex,
            cause,
            invalidQuantity,
          );

          const preSnapshot = cloneWorld(world);

          const options: StockInOptions =
            cause === "INJECTED_WRITE_FAILURE"
              ? { failAtLineIndex: faultIndex }
              : {};

          const result = clinicShopStockIn(
            world,
            { clinicId: destinationClinicId, lines, actorUserId },
            options,
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;

          // The engineered cause is the one that actually fired, not some
          // other, higher-priority rejection masking it.
          expect(result.error.prefix).toBe(EXPECTED_PREFIX[cause]);

          // Every clinic overlay's stock_quantity (and visibility) is
          // unchanged.
          expect(world.overlays.size).toBe(preSnapshot.overlays.size);
          for (const [key, overlay] of preSnapshot.overlays) {
            expect(world.overlays.get(key)).toEqual(overlay);
          }

          // Every warehouse lot's quantityRemaining is unchanged.
          expect(world.lots.size).toBe(preSnapshot.lots.size);
          for (const [invId, lotList] of preSnapshot.lots) {
            expect(world.lots.get(invId)).toEqual(lotList);
          }

          // No new ledger entries and no new warehouse transactions.
          expect(world.ledger).toEqual(preSnapshot.ledger);
          expect(world.transactions).toEqual(preSnapshot.transactions);

          // Belt and braces: the whole world is byte-for-byte unchanged.
          expect(world).toEqual(preSnapshot);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
