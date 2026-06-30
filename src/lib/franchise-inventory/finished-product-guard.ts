// src/lib/franchise-inventory/finished-product-guard.ts
// Pure guard function that ensures only FINISHED_GOOD products are allowed
// in franchise inventory operations.
//
// Requirements validated: 2.6, 3.1, 3.2, 3.4, 11.3, 11.6

/**
 * Minimal product shape required by the guard.
 */
export interface ProductForGuard {
  id: string;
  name: string;
  type: string; // e.g., 'FINISHED_GOOD', 'RAW_MATERIAL', etc.
}

/**
 * Discriminated union result returned by the guard.
 * - `allowed: true` when the product is a FINISHED_GOOD.
 * - `allowed: false` with error details when it is not.
 */
export type FinishedProductGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      error: string;
      productId: string;
      productName: string;
      productType: string;
    };

const ALLOWED_TYPE = "FINISHED_GOOD" as const;

/**
 * Validates that a product is a FINISHED_GOOD. Rejects any other product type
 * and returns an error identifying the offending product (id, name, type).
 *
 * This is a pure, synchronous function suitable for use at every franchise
 * inventory boundary: dispatch, receive, stock-in, and catalog building.
 */
export function guardFinishedProduct(
  product: ProductForGuard
): FinishedProductGuardResult {
  if (product.type === ALLOWED_TYPE) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: `Product "${product.name}" (${product.id}) is of type "${product.type}" and cannot be added to a franchise inventory. Only FINISHED_GOOD products are permitted.`,
    productId: product.id,
    productName: product.name,
    productType: product.type,
  };
}
