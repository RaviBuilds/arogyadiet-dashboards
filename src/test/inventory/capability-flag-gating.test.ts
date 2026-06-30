// Feature: master-inventory-management, Property 3: The capability flag fully gates the product CRUD controls
//
// Validates: Requirements 5.2, 5.3, 5.6
//
// For any catalog of products, when the shared components render with
// productManagement enabled, all three product CRUD controls (register, edit,
// delete) are present; and when productManagement is disabled or omitted entirely,
// none of those three controls are present or interactable.
// Receive/Dispatch controls are ALWAYS present regardless of the flag.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveControlVisibility,
  type VisibilityResult,
} from "@/lib/inventory/capability-flag-visibility";
import {
  PRODUCT_TYPES,
  BASE_UOMS,
  type InventoryCatalogProduct,
  type ProductType,
  type BaseUom,
} from "@/lib/inventory/product-schema";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary product type. */
const arbProductType = fc.constantFrom<ProductType>(...PRODUCT_TYPES);

/** Arbitrary base UOM. */
const arbBaseUom = fc.constantFrom<BaseUom>(...BASE_UOMS);

/**
 * Bounded date generator that always produces valid ISO-stringifiable dates.
 * fast-check v4's fc.date() can produce Invalid Date on edge cases.
 */
const arbValidDate = fc
  .integer({ min: 0, max: 2_000_000_000_000 })
  .map((ms) => new Date(ms));

/** Generate a realistic catalog product. */
const arbCatalogProduct: fc.Arbitrary<InventoryCatalogProduct> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  imageUrl: fc.oneof(fc.constant(null), fc.webUrl()),
  category: fc.string({ minLength: 1, maxLength: 50 }),
  type: arbProductType,
  baseUom: arbBaseUom,
  minStockThreshold: fc.nat({ max: 1000 }),
  defaultDurabilityDays: fc.nat({ max: 365 }),
  createdAt: arbValidDate.map((d) => d.toISOString()),
  updatedAt: arbValidDate.map((d) => d.toISOString()),
  totalStock: fc.integer({ min: 0, max: 100000 }),
  activeLots: fc.array(
    fc.record({
      batchNumber: fc.string({ minLength: 1, maxLength: 20 }),
      quantityRemaining: fc.integer({ min: 0, max: 10000 }),
      expiryDate: fc.oneof(fc.constant(null), arbValidDate),
    }),
    { minLength: 0, maxLength: 5 },
  ),
});

/** Generate a randomized catalog (0 to 20 products). */
const arbCatalog = fc.array(arbCatalogProduct, { minLength: 0, maxLength: 20 });

/** The flag can be true, false, or omitted (undefined). */
const arbFlagEnabled = fc.constant(true);
const arbFlagDisabled = fc.constant(false);
const arbFlagOmitted = fc.constant(undefined as boolean | undefined);
const arbFlagDisabledOrOmitted = fc.oneof(arbFlagDisabled, arbFlagOmitted);

// ─── Property tests ──────────────────────────────────────────────────────────

describe("resolveControlVisibility — Property 3: The capability flag fully gates the product CRUD controls", () => {
  it("when productManagement is true, all three CRUD controls are present for any catalog", () => {
    fc.assert(
      fc.property(arbCatalog, arbFlagEnabled, (_catalog, flag) => {
        const result = resolveControlVisibility(flag);

        // Req 5.2: register, edit, delete are all rendered
        expect(result.register).toBe(true);
        expect(result.edit).toBe(true);
        expect(result.delete).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("when productManagement is false or omitted, no CRUD controls are present for any catalog", () => {
    fc.assert(
      fc.property(arbCatalog, arbFlagDisabledOrOmitted, (_catalog, flag) => {
        const result = resolveControlVisibility(flag);

        // Req 5.3, 5.6: none of register/edit/delete are rendered
        expect(result.register).toBe(false);
        expect(result.edit).toBe(false);
        expect(result.delete).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("receive/dispatch controls are ALWAYS present regardless of the flag value", () => {
    fc.assert(
      fc.property(
        arbCatalog,
        fc.oneof(arbFlagEnabled, arbFlagDisabled, arbFlagOmitted),
        (_catalog, flag) => {
          const result = resolveControlVisibility(flag);

          // Receive/Dispatch are unconditional — always rendered
          expect(result.receive).toBe(true);
          expect(result.dispatch).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the flag acts as a complete gate: all three CRUD controls share the same state", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbFlagEnabled, arbFlagDisabled, arbFlagOmitted),
        (flag) => {
          const result = resolveControlVisibility(flag);

          // All three CRUD controls are gated identically — never partially visible
          expect(result.register).toBe(result.edit);
          expect(result.edit).toBe(result.delete);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the visibility result is deterministic: same flag always produces same visibility", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbFlagEnabled, arbFlagDisabled, arbFlagOmitted),
        (flag) => {
          const result1 = resolveControlVisibility(flag);
          const result2 = resolveControlVisibility(flag);

          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("omitting the flag is equivalent to passing false (default behavior)", () => {
    fc.assert(
      fc.property(arbCatalog, (_catalog) => {
        const omittedResult = resolveControlVisibility(undefined);
        const falseResult = resolveControlVisibility(false);

        // Req 5.6: default is disabled
        expect(omittedResult).toEqual(falseResult);
      }),
      { numRuns: 100 },
    );
  });
});
