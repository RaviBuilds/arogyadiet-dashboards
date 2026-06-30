// src/lib/franchise-inventory/__tests__/finished-product-guard.property.test.ts
// Property 7: Non-finished products are rejected everywhere
//
// For any product whose type is not FINISHED_GOOD, the guard rejects it,
// and for any product whose type IS FINISHED_GOOD, the guard allows it.
//
// **Validates: Requirements 3.2, 3.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  guardFinishedProduct,
  type ProductForGuard,
  type FinishedProductGuardResult,
} from "../finished-product-guard";

/**
 * Arbitrary generator for a product with type exactly 'FINISHED_GOOD'.
 */
const finishedProductArb: fc.Arbitrary<ProductForGuard> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  type: fc.constant("FINISHED_GOOD"),
});

/**
 * Arbitrary generator for a product whose type is NOT 'FINISHED_GOOD'.
 * Generates from a mix of known non-finished types and random strings,
 * filtering out 'FINISHED_GOOD' to guarantee the constraint.
 */
const nonFinishedProductArb: fc.Arbitrary<ProductForGuard> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  type: fc
    .oneof(
      fc.constantFrom(
        "RAW_MATERIAL",
        "WORK_IN_PROGRESS",
        "PACKAGING",
        "SEMI_FINISHED",
        "CONSUMABLE",
        "INGREDIENT",
      ),
      fc.string({ minLength: 1, maxLength: 50 }),
    )
    .filter((t) => t !== "FINISHED_GOOD"),
});

describe("Property 7: Non-finished products are rejected everywhere", () => {
  it("products with type === 'FINISHED_GOOD' return { allowed: true }", () => {
    fc.assert(
      fc.property(finishedProductArb, (product) => {
        const result = guardFinishedProduct(product);

        expect(result.allowed).toBe(true);
        expect(result).toEqual({ allowed: true });
      }),
      { numRuns: 100 },
    );
  });

  it("products with any other type return { allowed: false } with error identifying the product", () => {
    fc.assert(
      fc.property(nonFinishedProductArb, (product) => {
        const result = guardFinishedProduct(product);

        expect(result.allowed).toBe(false);

        // Type narrowing: when allowed is false, the result carries error details
        if (!result.allowed) {
          expect(result.productId).toBe(product.id);
          expect(result.productName).toBe(product.name);
          expect(result.productType).toBe(product.type);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe("string");
          expect(result.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("the error message contains the offending product's name and id", () => {
    fc.assert(
      fc.property(nonFinishedProductArb, (product) => {
        const result = guardFinishedProduct(product);

        expect(result.allowed).toBe(false);

        if (!result.allowed) {
          // The error message must reference the product's name and id
          expect(result.error).toContain(product.name);
          expect(result.error).toContain(product.id);
        }
      }),
      { numRuns: 100 },
    );
  });
});
