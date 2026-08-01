// src/test/shop/property13-visibilityToggling.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 13 (Task 7.10)
//
// Property 13: Visibility toggling is an involution and concurrency-safe.
//
// This runs against the model (`src/test/shop/clinicStockModel.ts`), which
// models `set_clinic_product_visibility(p_clinic_id, p_product_id,
// p_is_visible)`: upsert-shaped, a missing overlay row is created at
// `stock_quantity = 0` with the submitted visibility, an existing row only has
// `is_visible` updated, it never touches `stock_quantity` on an existing row,
// and it never writes a ledger entry.
//
// Two parts, matching the task's own title:
//
// (a) Involution — toggling visibility to a value, then toggling it again to
//     the SAME value, is idempotent. Setting `true` twice leaves it `true`;
//     setting `false` twice leaves it `false`. No ledger entry is ever
//     written by either call, `stock_quantity` is never touched by either
//     call (even when the product already carries clinic stock), and the
//     second call never creates a duplicate overlay row — only the first
//     call creates the row if it was absent.
//
// (b) Concurrency-safe (serialised composition) — for any sequence of
//     `set_clinic_product_visibility` calls interleaved arbitrarily (varying
//     `is_visible` across calls, applied one at a time — mirroring "whichever
//     call's write commits last wins" per the design's own comment), the
//     final stored `is_visible` equals the last call's submitted value in the
//     sequence, `stock_quantity` never changes throughout the whole sequence
//     (mirroring Req 6.6's independence of visibility and stock), and the
//     overlay is created at most once — only ever by the first call in the
//     sequence to actually reach an absent row.
//
// **Validates: Requirements 6.5, 6.6**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  createWorld,
  overlayKey,
  setClinicProductVisibility,
  type World,
} from "@/test/shop/clinicStockModel";
import {
  arbStockQuantity,
  CORE_CLINIC_IDS,
  PRODUCT_IDS,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 200;

/** A world with one Core Clinic, one product, and no pre-existing overlay. */
function buildBareWorld(clinicId: string, productId: string): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: [{ id: productId }],
  });
}

/**
 * A world with one Core Clinic, one product, and a pre-existing overlay
 * seeded at `stockQuantity` and `isVisible` — used to prove the toggle leaves
 * stock untouched regardless of the stock value it started at.
 */
function buildSeededWorld(
  clinicId: string,
  productId: string,
  stockQuantity: number,
  isVisible: boolean,
): World {
  return createWorld({
    clinics: CORE_CLINIC_IDS.map((id) => ({ id, franchiseId: null })),
    products: [{ id: productId }],
    overlays: [{ clinicId, productId, stockQuantity, isVisible }],
  });
}

// ─── (a) Involution ───────────────────────────────────────────────────────────

describe("Property 13 (a): visibility toggling is an involution", () => {
  it("setting the SAME visibility value twice in a row is idempotent, never touches stock, never writes a ledger entry, and only the first call creates the overlay", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        arbStockQuantity,
        fc.boolean(),
        (clinicId, productId, seedStockQuantity, isVisible) => {
          // Seed the overlay at the OPPOSITE of the target value, so the
          // first toggle is a genuine change and the second is the repeat
          // that proves idempotence.
          const world = buildSeededWorld(
            clinicId,
            productId,
            seedStockQuantity,
            !isVisible,
          );

          expect(world.ledger).toEqual([]);

          const first = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible,
          });
          expect(first.ok).toBe(true);
          if (!first.ok) return;

          // The row already existed (seeded above), so the first call must
          // not report having created it.
          expect(first.value.overlayCreated).toBe(false);
          expect(first.value.isVisible).toBe(isVisible);

          const key = overlayKey(clinicId, productId);
          expect(world.overlays.get(key)?.isVisible).toBe(isVisible);
          expect(world.overlays.get(key)?.stockQuantity).toBe(seedStockQuantity);
          expect(world.ledger).toEqual([]);

          const second = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible,
          });
          expect(second.ok).toBe(true);
          if (!second.ok) return;

          // Setting the SAME value again is idempotent: still `isVisible`,
          // no duplicate overlay row created, stock still untouched, and
          // still no ledger entry.
          expect(second.value.overlayCreated).toBe(false);
          expect(second.value.isVisible).toBe(isVisible);
          expect(world.overlays.get(key)?.isVisible).toBe(isVisible);
          expect(world.overlays.get(key)?.stockQuantity).toBe(seedStockQuantity);
          expect(world.overlays.size).toBe(1);
          expect(world.ledger).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("setting the SAME visibility value twice in a row against an absent overlay creates the row exactly once, at stock 0, and never writes a ledger entry", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.boolean(),
        (clinicId, productId, isVisible) => {
          const world = buildBareWorld(clinicId, productId);
          expect(world.overlays.size).toBe(0);
          expect(world.ledger).toEqual([]);

          const first = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible,
          });
          expect(first.ok).toBe(true);
          if (!first.ok) return;

          // The row was absent, so the FIRST call creates it, at stock 0.
          expect(first.value.overlayCreated).toBe(true);
          const key = overlayKey(clinicId, productId);
          expect(world.overlays.get(key)?.stockQuantity).toBe(0);
          expect(world.overlays.get(key)?.isVisible).toBe(isVisible);
          expect(world.ledger).toEqual([]);

          const second = setClinicProductVisibility(world, {
            clinicId,
            productId,
            isVisible,
          });
          expect(second.ok).toBe(true);
          if (!second.ok) return;

          // The SECOND call, same value, must NOT create a duplicate row.
          expect(second.value.overlayCreated).toBe(false);
          expect(world.overlays.size).toBe(1);
          expect(world.overlays.get(key)?.stockQuantity).toBe(0);
          expect(world.overlays.get(key)?.isVisible).toBe(isVisible);
          expect(world.ledger).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── (b) Concurrency-safe (serialised composition) ───────────────────────────

describe("Property 13 (b): concurrency-safe under serialised composition", () => {
  it("for any sequence of visibility-set calls applied one at a time, the final is_visible equals the last command's value, stock never changes, and the overlay is created at most once", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        arbStockQuantity,
        fc.boolean(),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (clinicId, productId, seedStockQuantity, seedIsVisible, commandValues) => {
          const world = buildSeededWorld(
            clinicId,
            productId,
            seedStockQuantity,
            seedIsVisible,
          );

          const key = overlayKey(clinicId, productId);
          let createdCount = 0;

          for (const isVisible of commandValues) {
            const result = setClinicProductVisibility(world, {
              clinicId,
              productId,
              isVisible,
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            if (result.value.overlayCreated) {
              createdCount += 1;
            }

            // stock_quantity must never change, at every step of the
            // sequence, not just at the end.
            expect(world.overlays.get(key)?.stockQuantity).toBe(
              seedStockQuantity,
            );
            // No call ever writes a ledger entry.
            expect(world.ledger).toEqual([]);
          }

          const lastValue = commandValues[commandValues.length - 1];
          expect(world.overlays.get(key)?.isVisible).toBe(lastValue);
          expect(world.overlays.get(key)?.stockQuantity).toBe(
            seedStockQuantity,
          );
          expect(world.ledger).toEqual([]);

          // The row was seeded (pre-existing), so the overlay must never be
          // reported as freshly created by any call in the sequence.
          expect(createdCount).toBe(0);
          expect(world.overlays.size).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("for any sequence of visibility-set calls against an INITIALLY ABSENT overlay, the overlay is created at most once (by the first call to reach it), the final is_visible equals the last command's value, and stock stays at 0 throughout", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_CLINIC_IDS),
        fc.constantFrom(...PRODUCT_IDS),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (clinicId, productId, commandValues) => {
          const world = buildBareWorld(clinicId, productId);
          const key = overlayKey(clinicId, productId);

          let createdCount = 0;

          commandValues.forEach((isVisible, index) => {
            const result = setClinicProductVisibility(world, {
              clinicId,
              productId,
              isVisible,
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            if (result.value.overlayCreated) {
              createdCount += 1;
              // Only the FIRST call in the sequence may create the row.
              expect(index).toBe(0);
            }

            // stock_quantity is created at 0 and never moves away from 0.
            expect(world.overlays.get(key)?.stockQuantity).toBe(0);
            expect(world.ledger).toEqual([]);
          });

          const lastValue = commandValues[commandValues.length - 1];
          expect(world.overlays.get(key)?.isVisible).toBe(lastValue);
          expect(world.overlays.get(key)?.stockQuantity).toBe(0);
          expect(world.ledger).toEqual([]);

          // The overlay was absent at the start, so exactly the first call
          // creates it — never zero, never more than one.
          expect(createdCount).toBe(1);
          expect(world.overlays.size).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
