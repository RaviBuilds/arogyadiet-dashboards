// src/test/shop/property21-productLinkGating.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 21 (Task 7.9)
//
// Property 21: Product link changes are gated on zero aggregate stock.
//
// A Shop_Product's Product_Link (`products.inventory_product_id`) may be
// changed if and only if its Aggregate_Stock — the sum of Effective_Clinic_Stock
// across every Core Clinic — is exactly 0. `setProductInventoryLinkAction` and
// `adminUpsertProduct` (both in `src/actions/admin-actions/*.ts`) implement this
// with the identical inline guard:
//
//   if (computeAggregateStock(overlays) > 0) { reject }
//
// This test exercises that decision rule directly through
// `computeAggregateStock`, the pure function both actions call, rather than
// invoking the "use server" actions themselves — doing so would require
// mocking Supabase, which is inconsistent with this suite's I/O-free
// convention (see property12-aggregateStock.property.test.ts for the same
// approach against the same function).
//
// **Validates: Requirements 3.1, 3.7, 3.8, 3.9, 3.11, 3.12**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { computeAggregateStock } from "@/lib/shop/clinicStock";
import type { ClinicProductOverlayRow } from "@/types/clinicShop";
import {
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
  arbOverlayRowFor,
  arbOverlaySlotsPerClinic,
  arbStockQuantity,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

/** One per-clinic lookup result: a record, or its absence. */
type OverlaySlot = ClinicProductOverlayRow | null | undefined;

/**
 * The gating decision itself, transcribed from the shared inline guard in
 * `setProductInventoryLinkAction` and `adminUpsertProduct`:
 * `if (computeAggregateStock(overlays) > 0) { reject }`. Kept as a tiny
 * reference wrapper so every assertion below reads as "the change is allowed"
 * rather than repeating the inequality.
 */
function isProductLinkChangeAllowed(overlays: readonly OverlaySlot[]): boolean {
  return computeAggregateStock(overlays) === 0;
}

/** An overlay slot that always resolves to Effective_Clinic_Stock 0: either a
 * missing overlay or a real row explicitly stocked at 0. */
function arbZeroStockSlot(clinicId: string): fc.Arbitrary<OverlaySlot> {
  return fc.oneof(
    { arbitrary: fc.constantFrom<OverlaySlot>(null, undefined), weight: 1 },
    {
      arbitrary: arbOverlayRowFor(clinicId, PRODUCT_IDS[0]).map((row) => ({
        ...row,
        stock_quantity: 0,
      })),
      weight: 1,
    },
  );
}

/** A positive stock quantity, drawn from the shared arbitrary and filtered. */
const arbPositiveStockQuantity: fc.Arbitrary<number> = arbStockQuantity.filter(
  (quantity) => quantity > 0,
);

describe("Property 21: Product link changes are gated on zero aggregate stock", () => {
  it("allows the change iff aggregate stock is exactly 0, blocks it otherwise", () => {
    fc.assert(
      fc.property(arbOverlaySlotsPerClinic(), (slots) => {
        const aggregate = computeAggregateStock(slots);
        const allowed = isProductLinkChangeAllowed(slots);

        // The gate opens exactly when the aggregate is 0 — never for a
        // negative aggregate (impossible) and never merely because it is
        // "low" (Req 3.11).
        expect(allowed).toBe(aggregate === 0);

        if (aggregate === 0) {
          expect(allowed).toBe(true);
        } else {
          expect(aggregate).toBeGreaterThan(0);
          expect(allowed).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks the whole change when any single clinic holds positive stock, regardless of which one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: CORE_CLINIC_IDS.length - 1 }),
        arbPositiveStockQuantity,
        (targetIndex, positiveStock) => {
          // Every Core Clinic is at 0 (represented as a missing overlay)
          // except exactly one, which holds a positive quantity. Which clinic
          // that is varies across runs via `targetIndex`.
          const slots: OverlaySlot[] = CORE_CLINIC_IDS.map((clinicId, index) =>
            index === targetIndex
              ? ({
                  id: `overlay-${index}`,
                  clinic_id: clinicId,
                  product_id: PRODUCT_IDS[0],
                  stock_quantity: positiveStock,
                  is_visible: true,
                  created_at: "2025-01-15T06:00:00.000Z",
                  updated_at: "2025-01-15T06:00:00.000Z",
                } satisfies ClinicProductOverlayRow)
              : null,
          );

          const aggregate = computeAggregateStock(slots);

          // The aggregate equals exactly that one clinic's stock — no other
          // clinic contributes, and no clinic's stock is double-counted
          // (Req 3.10, 3.11).
          expect(aggregate).toBe(positiveStock);
          expect(aggregate).toBeGreaterThan(0);

          // The gate blocks regardless of which clinic holds the stock.
          expect(isProductLinkChangeAllowed(slots)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("always allows the change when every clinic is at 0, across every absence/presence combination", () => {
    const arbAllZeroSlots: fc.Arbitrary<OverlaySlot[]> = fc.tuple(
      ...CORE_CLINIC_IDS.map((clinicId) => arbZeroStockSlot(clinicId)),
    );

    fc.assert(
      fc.property(arbAllZeroSlots, (slots) => {
        // Every slot is either absent or a real row explicitly at 0 — no
        // slot contributes a positive amount.
        for (const slot of slots) {
          if (slot !== null && slot !== undefined) {
            expect(slot.stock_quantity).toBe(0);
          }
        }

        expect(computeAggregateStock(slots)).toBe(0);
        expect(isProductLinkChangeAllowed(slots)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
