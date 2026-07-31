// src/test/shop/property12-aggregateStock.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 12 (Task 2.8)
//
// Property 12: Aggregate stock equals the sum of clinic stocks.
//
// For any Shop Product and any set of Core Clinics with arbitrary overlay
// records — including clinics that hold no record at all — the Aggregate_Stock
// shown in All_Clinics_Mode equals the sum of every Core Clinic's
// Effective_Clinic_Stock for that product (Req 3.10, 5.3). The sum is taken
// over the *clinic set*, not over the records that happen to exist, which is
// what makes the migration's guarantee hold: one clinic receives the whole
// pre-migration `products.stock_quantity` and every other Core Clinic receives
// 0, so the aggregate after the run equals the pre-migration value (Req 20.8).
//
// The expectation is a reference fold written below directly from Requirement
// 1.13 ("no record reads as 0") and Requirement 3.10 ("sum across every Core
// Clinic"), not from `computeAggregateStock`, so the model cannot inherit a bug
// from the code it exercises.
//
// **Validates: Requirements 3.10, 5.3, 20.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { computeAggregateStock } from "@/lib/shop/clinicStock";
import type { ClinicProductOverlayRow } from "@/types/clinicShop";
import {
  CORE_CLINIC_IDS,
  FRANCHISE_CLINIC_ID,
  PRODUCT_IDS,
  REFERENCE_STOCK_QUANTITY_MAXIMUM,
  arbOverlaySlotsPerClinic,
  arbStockQuantity,
} from "@/test/shop/clinicStockArbitraries";
import {
  aggregateStock,
  coreClinics,
  createWorld,
} from "@/test/shop/clinicStockModel";

const NUM_RUNS = 200;

/** One per-clinic lookup result: a record, or its absence. */
type OverlaySlot = ClinicProductOverlayRow | null | undefined;

// ─── Reference model: Requirements 1.13 and 3.10 transcribed ─────────────────

/**
 * Effective_Clinic_Stock of one slot: the stored quantity when a record exists
 * and carries a usable non-negative whole number, and 0 when the clinic holds
 * no record (Req 1.13).
 */
function referenceEffectiveStock(slot: OverlaySlot): number {
  if (slot === null || slot === undefined) return 0;
  const stored = slot.stock_quantity;
  return Number.isInteger(stored) && stored >= 0 ? stored : 0;
}

/**
 * Aggregate_Stock: the sum over every Core Clinic in the set, one term per
 * clinic regardless of whether that clinic holds a record (Req 3.10).
 */
function referenceAggregate(slots: readonly OverlaySlot[]): number {
  return slots.reduce((total, slot) => total + referenceEffectiveStock(slot), 0);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * A Core Clinic set of arbitrary size, including the empty set (a deployment
 * with no Core Clinic configured, which must aggregate to 0 rather than fail)
 * and the full fixture set.
 */
const arbCoreClinicSet: fc.Arbitrary<string[]> = fc.subarray([
  ...CORE_CLINIC_IDS,
]);

/**
 * A clinic set together with one overlay slot per clinic — the honest shape of
 * an All_Clinics_Mode read, where a lookup either finds a record or does not.
 */
const arbClinicSetWithSlots: fc.Arbitrary<{
  clinicIds: string[];
  slots: OverlaySlot[];
}> = arbCoreClinicSet.chain((clinicIds) =>
  arbOverlaySlotsPerClinic(clinicIds).map((slots) => ({ clinicIds, slots })),
);

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 12: Aggregate stock equals the sum of clinic stocks", () => {
  it("equals the sum of every Core Clinic's effective stock, records or not", () => {
    fc.assert(
      fc.property(arbClinicSetWithSlots, ({ clinicIds, slots }) => {
        // One term per clinic in the set (Req 3.10).
        expect(slots.length).toBe(clinicIds.length);

        expect(computeAggregateStock(slots)).toBe(referenceAggregate(slots));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is summed over the clinic set, so clinics holding no record add nothing", () => {
    fc.assert(
      fc.property(
        arbClinicSetWithSlots,
        fc.array(fc.constantFrom<null | undefined>(null, undefined), {
          maxLength: 4,
        }),
        ({ slots }, clinicsWithoutRecords) => {
          const base = computeAggregateStock(slots);

          // Extending the clinic set with clinics that hold no overlay record
          // leaves the aggregate unchanged — the sum is over clinics, and a
          // clinic without a record contributes 0 (Req 1.13, 3.10).
          expect(computeAggregateStock([...slots, ...clinicsWithoutRecords])).toBe(
            base,
          );
          expect(computeAggregateStock([...clinicsWithoutRecords, ...slots])).toBe(
            base,
          );

          // And the aggregate never reflects a record the clinic set does not
          // include: dropping a clinic removes exactly that clinic's stock.
          if (slots.length > 0) {
            const dropped = slots[slots.length - 1];
            expect(computeAggregateStock(slots.slice(0, -1))).toBe(
              base - referenceEffectiveStock(dropped),
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("equals the pre-migration quantity when one clinic holds it all and the rest hold 0", () => {
    fc.assert(
      fc.property(
        arbCoreClinicSet.filter((clinicIds) => clinicIds.length > 0),
        fc.nat(),
        arbStockQuantity,
        (clinicIds, targetSeed, legacyStock) => {
          const productId = PRODUCT_IDS[0];
          const targetClinicId = clinicIds[targetSeed % clinicIds.length];

          // The post-migration shape of Requirement 20.8: the Migration_Target
          // Clinic receives the whole pre-migration `products.stock_quantity`
          // and every other Core Clinic receives 0. A Clinic with a non-null
          // `franchise_id` is not a Core Clinic, so a record against it must
          // never enter the aggregate (Req 1.9, 3.10).
          const world = createWorld({
            clinics: [
              ...clinicIds.map((id) => ({ id })),
              { id: FRANCHISE_CLINIC_ID, franchiseId: "franchise-1" },
            ],
            products: [{ id: productId }],
            overlays: [
              ...clinicIds.map((id) => ({
                clinicId: id,
                productId,
                stockQuantity: id === targetClinicId ? legacyStock : 0,
              })),
              {
                clinicId: FRANCHISE_CLINIC_ID,
                productId,
                stockQuantity: REFERENCE_STOCK_QUANTITY_MAXIMUM,
              },
            ],
          });

          expect(aggregateStock(world, productId)).toBe(legacyStock);

          // The same total, read through the pure function over one slot per
          // Core Clinic, so the page-level and model-level statements agree.
          const slots: OverlaySlot[] = coreClinics(world).map((clinic) =>
            clinic.id === targetClinicId
              ? ({ stock_quantity: legacyStock } as ClinicProductOverlayRow)
              : ({ stock_quantity: 0 } as ClinicProductOverlayRow),
          );
          expect(computeAggregateStock(slots)).toBe(legacyStock);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
