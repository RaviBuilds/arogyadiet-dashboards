// src/test/shop/property10-missingOverlay.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 10
//
// Property 10: Missing overlay reads as zero and hidden.
//
// *For any* Core Clinic and Shop Product with no overlay record, every stock
// display, availability decision, and deduction resolves the effective stock as
// 0 and the effective visibility as hidden.
//
// The property is stated as a single invariant over the *absence* of a
// `clinic_product_settings` row, quantified over every consumer of that
// absence in the pure decision layer:
//
//   - the resolver itself (`resolveEffectiveOverlay`)
//   - the per-clinic figure a repository lookup miss produces, read through the
//     RPC-semantics model (`effectiveOverlay` over a world holding no row)
//   - the stock display in Clinic_Mode / on the Operations page — the resolved
//     figure and flag (Req 5.6, 9.5, 19.5)
//   - the availability decision (`isExposedInClinicShop`)
//   - the All Clinics aggregate (`computeAggregateStock`)
//   - the deduction (`evaluateSaleSubmission`) and the stock-in baseline
//     (`evaluateStockInSubmission`)
//
// The strongest form of the statement is *observational indistinguishability*:
// a missing overlay must be indistinguishable, at every one of those consumers,
// from a stored row of `stock_quantity = 0, is_visible = false`. Anything weaker
// would let one surface treat absence as "visible" or as "unknown".
//
// Expected values are written as literals (0 and hidden) transcribed from
// Requirement 1.13 rather than derived from the module under test, and the
// generators come from `src/test/shop/clinicStockArbitraries.ts`.
//
// **Validates: Requirements 1.13, 5.6, 9.5, 19.5**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  computeAggregateStock,
  evaluateSaleSubmission,
  evaluateStockInSubmission,
  isExposedInClinicShop,
  resolveEffectiveOverlay,
  STOCK_QUANTITY_MAXIMUM,
  type ClinicOverlayInput,
} from "@/lib/shop/clinicStock";
import {
  arbCoreClinicId,
  arbInventoryProductId,
  arbMissingOverlay,
  arbMovementQuantity,
  arbOverlayRowFor,
  arbOverlaySlot,
  arbProductId,
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
} from "@/test/shop/clinicStockArbitraries";
import {
  createWorld,
  effectiveOverlay,
  overlayKey,
} from "@/test/shop/clinicStockModel";

const NUM_RUNS = 200;

// ─── Reference expectation, transcribed from Requirement 1.13 ────────────────

/** Effective_Clinic_Stock when no Clinic_Shop_Stock record exists. */
const ABSENT_STOCK = 0;

/** Effective_Clinic_Visibility when no Clinic_Shop_Stock record exists: hidden. */
const ABSENT_VISIBILITY = false;

/**
 * The stored row a missing overlay must be indistinguishable from — stock 0 and
 * hidden, in the snake_case shape a repository returns.
 */
const ZERO_HIDDEN_ROW = { stock_quantity: ABSENT_STOCK, is_visible: false } as const;

/** A soft-delete stamp / active flag pair, so the exposure decision is exercised
 * across all four combinations rather than just the healthy one. */
const arbProductFlags = fc.record({
  deletedAt: fc.constantFrom<string | null>(null, "2025-02-01T00:00:00.000Z"),
  isActive: fc.boolean(),
});

describe("Property 10: missing overlay reads as zero and hidden", () => {
  it("resolves an absent overlay record as stock 0 and hidden, in every encoding of absence", () => {
    /**
     * The base statement of Requirement 1.13. `null` (a repository that found
     * nothing) and `undefined` (a `Map.get` miss) are both legitimate encodings
     * of "this clinic holds no record", and neither may read as visible.
     *
     * **Validates: Requirements 1.13**
     */
    fc.assert(
      fc.property(
        arbCoreClinicId,
        arbProductId,
        arbMissingOverlay,
        (clinicId, productId, missing) => {
          const resolved = resolveEffectiveOverlay(missing);

          expect(
            resolved.stockQuantity,
            `clinic ${clinicId} / product ${productId} with no overlay (${String(missing)}) must read as stock ${ABSENT_STOCK}`,
          ).toBe(ABSENT_STOCK);
          expect(
            resolved.isVisible,
            `clinic ${clinicId} / product ${productId} with no overlay (${String(missing)}) must read as hidden`,
          ).toBe(ABSENT_VISIBILITY);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reads a pair with no stored row as 0 and hidden even while other pairs hold rows", () => {
    /**
     * The same statement one level up, at the lookup a page actually performs:
     * a world that holds overlay rows for *other* (clinic, product) pairs still
     * reads the uncovered pair as 0 and hidden. This is the Clinic_Mode and
     * Operations-page display rule — a product the selected clinic holds no
     * record for is shown at 0 and hidden, not omitted and not inherited from a
     * sibling clinic.
     *
     * **Validates: Requirements 1.13, 5.6, 9.5**
     */
    fc.assert(
      fc.property(
        arbCoreClinicId,
        arbProductId,
        fc.array(
          fc.record({
            clinicId: arbCoreClinicId,
            productId: arbProductId,
            stockQuantity: fc.integer({ min: 0, max: 5_000 }),
            isVisible: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        (clinicId, productId, otherOverlays) => {
          // Every generated row except one for the pair under test, so the pair
          // is genuinely uncovered while its neighbours are not.
          const overlays = otherOverlays.filter(
            (overlay) =>
              overlayKey(overlay.clinicId, overlay.productId) !==
              overlayKey(clinicId, productId),
          );

          const world = createWorld({
            clinics: CORE_CLINIC_IDS.map((id) => ({ id })),
            products: PRODUCT_IDS.map((id) => ({ id })),
            overlays,
          });

          const resolved = effectiveOverlay(world, clinicId, productId);

          expect(
            resolved.stockQuantity,
            `uncovered pair (${clinicId}, ${productId}) must read as stock ${ABSENT_STOCK} alongside ${overlays.length} other rows`,
          ).toBe(ABSENT_STOCK);
          expect(
            resolved.isVisible,
            `uncovered pair (${clinicId}, ${productId}) must read as hidden alongside ${overlays.length} other rows`,
          ).toBe(ABSENT_VISIBILITY);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("never exposes a product in a clinic that holds no overlay record, whatever the product flags", () => {
    /**
     * The availability decision. Absence is hidden, and hidden removes the
     * product from the customer-facing shop — so no combination of
     * `deleted_at` / `is_active` can expose a product at a clinic holding no
     * record for it.
     *
     * **Validates: Requirements 1.13, 9.5**
     */
    fc.assert(
      fc.property(
        arbMissingOverlay,
        arbProductFlags,
        (missing, flags) => {
          expect(
            isExposedInClinicShop({ ...flags, overlay: missing }),
            `a clinic holding no overlay must never expose the product (deletedAt=${String(flags.deletedAt)}, isActive=${flags.isActive})`,
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("contributes 0 to the All Clinics aggregate for every clinic holding no record", () => {
    /**
     * The aggregate display. Aggregate_Stock is summed over the *clinic set*,
     * not over the rows that happen to exist, so dropping the absent clinics
     * from the list must not change the total — which is exactly "an absent
     * clinic contributes 0".
     *
     * **Validates: Requirements 1.13, 5.6**
     */
    fc.assert(
      fc.property(
        fc.array(arbOverlaySlot, { maxLength: 12 }),
        (slots) => {
          const present = slots.filter(
            (slot) => slot !== null && slot !== undefined,
          );

          const withAbsent = computeAggregateStock(slots);
          const withoutAbsent = computeAggregateStock(present);

          expect(
            withAbsent,
            `absent clinics must contribute 0: ${slots.length - present.length} of ${slots.length} slots held no record`,
          ).toBe(withoutAbsent);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves a deduction against a clinic holding no record as 0 available, rejecting the sale", () => {
    /**
     * The deduction. A sale of any valid quantity against a clinic that holds no
     * record for the product is rejected for insufficient clinic stock, and the
     * quantity reported as available is 0 — never "unknown" and never the
     * requested amount.
     *
     * **Validates: Requirements 1.13, 9.5**
     */
    fc.assert(
      fc.property(
        arbCoreClinicId,
        arbProductId,
        arbMovementQuantity,
        arbMissingOverlay,
        (clinicId, productId, quantity, missing) => {
          const verdict = evaluateSaleSubmission({
            clinicId,
            lines: [{ productId, quantity }],
            products: [{ productId, overlay: missing }],
          });

          expect(
            verdict.ok,
            `selling ${quantity} from a clinic holding no record must be rejected`,
          ).toBe(false);
          if (verdict.ok) return;

          expect(verdict.code).toBe("INSUFFICIENT_CLINIC_STOCK");
          expect(verdict.rejections).toHaveLength(1);
          expect(
            verdict.rejections[0].available,
            "the available quantity reported for a clinic holding no record must be 0",
          ).toBe(ABSENT_STOCK);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("treats a clinic holding no record as starting from 0 on a stock-in", () => {
    /**
     * The stock-in baseline. Absence is a real starting level of 0, so a
     * stock-in of Q into a clinic holding no record lands the clinic at exactly
     * Q — it neither fails for a missing row nor starts from anything else.
     *
     * **Validates: Requirements 1.13, 5.6**
     */
    fc.assert(
      fc.property(
        arbCoreClinicId,
        arbProductId,
        arbInventoryProductId,
        arbMovementQuantity,
        arbMissingOverlay,
        (clinicId, productId, inventoryProductId, quantity, missing) => {
          const verdict = evaluateStockInSubmission({
            destination: { kind: "clinic", clinicId },
            lines: [{ productId, quantity }],
            products: [
              {
                productId,
                inventoryProductId,
                // Enough warehouse stock that availability is not what decides
                // the verdict; the missing overlay is the variable under test.
                warehouseAvailable: quantity,
                overlay: missing,
              },
            ],
          });

          expect(
            verdict.ok,
            `a stock-in of ${quantity} into a clinic holding no record must be accepted`,
          ).toBe(true);
          if (!verdict.ok) return;

          expect(verdict.applied).toHaveLength(1);
          expect(
            verdict.applied[0].stockBefore,
            "the starting level of a clinic holding no record must be 0",
          ).toBe(ABSENT_STOCK);
          expect(verdict.applied[0].stockAfter).toBe(quantity);
          expect(quantity).toBeLessThanOrEqual(STOCK_QUANTITY_MAXIMUM);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is indistinguishable from a stored row of stock 0 and hidden at every consumer", () => {
    /**
     * The invariant in its strongest form. For any product flags, any sale
     * quantity, and any surrounding clinics, replacing "no record" with a stored
     * row of `stock_quantity = 0, is_visible = false` changes nothing anywhere:
     * the resolved figures, the exposure decision, the aggregate, and the sale
     * verdict are all identical. That is what makes absence unambiguous rather
     * than merely defaulted in one place.
     *
     * **Validates: Requirements 1.13, 5.6, 9.5, 19.5**
     */
    fc.assert(
      fc.property(
        arbMissingOverlay,
        arbProductFlags,
        arbMovementQuantity,
        arbProductId,
        arbCoreClinicId,
        fc.array(arbOverlaySlot, { maxLength: 6 }),
        (missing, flags, quantity, productId, clinicId, neighbours) => {
          const compare = (overlay: ClinicOverlayInput) => ({
            resolved: resolveEffectiveOverlay(overlay),
            exposed: isExposedInClinicShop({ ...flags, overlay }),
            aggregate: computeAggregateStock([...neighbours, overlay]),
            sale: evaluateSaleSubmission({
              clinicId,
              lines: [{ productId, quantity }],
              products: [{ productId, overlay }],
            }),
          });

          expect(
            compare(missing),
            "a missing overlay must behave exactly like a stored row of stock 0 and hidden",
          ).toEqual(compare(ZERO_HIDDEN_ROW));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is distinguishable from a stored row whenever that row would read as visible with stock", () => {
    /**
     * The counterweight that stops the property above being vacuous: absence is
     * only equivalent to a *zero and hidden* row. Any stored row that resolves
     * to visible with stock above 0 must read differently from absence at the
     * resolver and at the exposure decision — otherwise "reads as hidden" would
     * be untestable.
     *
     * **Validates: Requirements 1.13**
     */
    fc.assert(
      fc.property(
        arbMissingOverlay,
        arbOverlayRowFor(CORE_CLINIC_IDS[0], PRODUCT_IDS[0]).filter(
          (row) => row.is_visible && row.stock_quantity > 0,
        ),
        (missing, stockedVisibleRow) => {
          const absent = resolveEffectiveOverlay(missing);
          const stored = resolveEffectiveOverlay(stockedVisibleRow);

          expect(absent).not.toEqual(stored);
          expect(
            isExposedInClinicShop({
              deletedAt: null,
              isActive: true,
              overlay: missing,
            }),
          ).toBe(false);
          expect(
            isExposedInClinicShop({
              deletedAt: null,
              isActive: true,
              overlay: stockedVisibleRow,
            }),
          ).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
