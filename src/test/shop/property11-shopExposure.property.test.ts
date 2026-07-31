// src/test/shop/property11-shopExposure.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 11
//
// Property 11: Customer-shop exposure requires all four conditions.
//
// For any Shop Product and Core Clinic, the product is exposed in that clinic's
// customer-facing shop exactly when its `deleted_at` is null, its
// Global_Visibility is shown, that clinic's Effective_Clinic_Visibility is
// shown, and that clinic's Effective_Clinic_Stock is greater than 0 — negating
// any single condition removes it from the shop.
//
// The expected truth is a four-way conjunction re-derived here from the text of
// Requirement 6.3 (and the missing-overlay rule of Requirement 1.13) over the
// *raw* `clinic_product_settings` fields, rather than by calling
// `resolveEffectiveOverlay`. Both sides of the comparison therefore cannot
// inherit the same resolution bug. Overlay rows and stock levels are drawn from
// the shared generators in `clinicStockArbitraries`, so the values the bounds
// turn on (0, 1, 999,999, 1,000,000) and the absence of an overlay record are
// part of the input space rather than separate examples.
//
// **Validates: Requirements 6.1, 6.2, 6.3, 15.1**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { isExposedInClinicShop } from "@/lib/shop/clinicStock";
import type { ClinicProductOverlayRow } from "@/types/clinicShop";
import {
  arbMissingOverlay,
  arbOverlayRow,
  arbOverlaySlot,
  arbStockQuantity,
  fixtureTimestamp,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

// ─── Input space ─────────────────────────────────────────────────────────────

type OverlaySlot = ClinicProductOverlayRow | null | undefined;

/**
 * `products.deleted_at`. `null` is a live product; `undefined` is the same fact
 * as read back from a projection that omits the column; a timestamp is a
 * Soft_Deleted_Product, which Requirement 6.3 excludes unconditionally.
 */
const arbDeletedAt: fc.Arbitrary<string | null | undefined> = fc.oneof(
  { arbitrary: fc.constantFrom<string | null | undefined>(null, undefined), weight: 3 },
  {
    arbitrary: fc
      .integer({ min: -100_000, max: 0 })
      .map((offsetSeconds) => fixtureTimestamp(offsetSeconds)) as fc.Arbitrary<
      string | null | undefined
    >,
    weight: 2,
  },
);

/** Global_Visibility — `products.is_active`. */
const arbGlobalVisibility: fc.Arbitrary<boolean> = fc.boolean();

// ─── Reference model (transcribed from Requirements 6.3 and 1.13) ────────────

interface ReferenceEffective {
  stock: number;
  visible: boolean;
}

/**
 * Effective_Clinic_Stock and Effective_Clinic_Visibility as the requirements
 * define them: a clinic holding no Clinic_Shop_Stock record reads as stock 0 and
 * hidden (Req 1.13), and a stored level that is not a whole non-negative number
 * is not a stock level, so it too reads as 0 (Req 20.5).
 */
function referenceEffective(slot: OverlaySlot): ReferenceEffective {
  if (slot === null || slot === undefined) return { stock: 0, visible: false };
  const raw: unknown = slot.stock_quantity;
  const stock =
    typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  return { stock, visible: slot.is_visible === true };
}

/** The four conditions of Requirement 6.3, evaluated independently. */
function referenceConditions(
  deletedAt: string | null | undefined,
  isActive: boolean,
  slot: OverlaySlot,
): readonly boolean[] {
  const effective = referenceEffective(slot);
  return [
    deletedAt === null || deletedAt === undefined,
    isActive === true,
    effective.visible,
    effective.stock > 0,
  ];
}

function referenceExposed(
  deletedAt: string | null | undefined,
  isActive: boolean,
  slot: OverlaySlot,
): boolean {
  return referenceConditions(deletedAt, isActive, slot).every(Boolean);
}

// ─── Property 11 ─────────────────────────────────────────────────────────────

describe("Property 11: Customer-shop exposure requires all four conditions", () => {
  it("is exposed exactly when all four conditions hold", () => {
    fc.assert(
      fc.property(
        arbDeletedAt,
        arbGlobalVisibility,
        arbOverlaySlot,
        (deletedAt, isActive, overlay) => {
          const expected = referenceExposed(deletedAt, isActive, overlay);

          expect(isExposedInClinicShop({ deletedAt, isActive, overlay })).toBe(
            expected,
          );

          // Both directions, stated separately so a failure says which one
          // broke: exposure implies every condition, and every condition
          // implies exposure.
          const conditions = referenceConditions(deletedAt, isActive, overlay);
          if (expected) {
            expect(conditions.every(Boolean)).toBe(true);
          } else {
            expect(conditions.some((condition) => !condition)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("negating any single condition removes the product from the shop", () => {
    fc.assert(
      fc.property(
        arbOverlayRow,
        arbStockQuantity,
        fc.integer({ min: -100_000, max: 0 }),
        (row, stockSeed, deletionOffsetSeconds) => {
          // An exposed baseline: live product, Global_Visibility shown, the
          // clinic's record visible with at least one unit. The stock level is
          // still drawn from the shared generator, so 1 and the cap both occur.
          const stockQuantity = Math.max(1, stockSeed);
          const overlay: ClinicProductOverlayRow = {
            ...row,
            is_visible: true,
            stock_quantity: stockQuantity,
          };
          const baseline = { deletedAt: null, isActive: true, overlay };

          expect(isExposedInClinicShop(baseline)).toBe(true);

          // Each variant negates exactly one of the four conditions and leaves
          // the other three untouched.
          const variants = [
            {
              condition: "deleted_at is null",
              input: {
                ...baseline,
                deletedAt: fixtureTimestamp(deletionOffsetSeconds),
              },
            },
            {
              condition: "global visibility is shown",
              input: { ...baseline, isActive: false },
            },
            {
              condition: "effective clinic visibility is shown",
              input: { ...baseline, overlay: { ...overlay, is_visible: false } },
            },
            {
              condition: "effective clinic stock is greater than 0",
              input: { ...baseline, overlay: { ...overlay, stock_quantity: 0 } },
            },
          ];

          for (const variant of variants) {
            expect(
              isExposedInClinicShop(variant.input),
              `negating "${variant.condition}" must remove the product from the shop`,
            ).toBe(false);
          }

          // Dropping the clinic's record entirely negates two conditions at
          // once (Req 1.13), and must likewise remove the product.
          expect(
            isExposedInClinicShop({ ...baseline, overlay: null }),
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is never exposed at a clinic holding no stock record, whatever the product's flags", () => {
    fc.assert(
      fc.property(
        arbDeletedAt,
        arbGlobalVisibility,
        arbMissingOverlay,
        (deletedAt, isActive, overlay) => {
          expect(isExposedInClinicShop({ deletedAt, isActive, overlay })).toBe(
            false,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
