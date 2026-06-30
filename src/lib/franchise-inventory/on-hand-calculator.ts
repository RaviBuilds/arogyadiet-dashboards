// src/lib/franchise-inventory/on-hand-calculator.ts
// Pure computation of on-hand quantities from franchise inventory lots.
// No DB access — operates entirely on in-memory data.
//
// Requirements validated: 2.4, 6.5, 8.1, 9.2

import type { FranchiseBatch } from "@/types/franchiseInventory";

/**
 * A franchise inventory lot as stored in the database.
 * Only ACTIVE lots contribute to on-hand quantity.
 */
export interface FranchiseLot {
  productId: string;
  batchNumber: string;
  quantityRemaining: number;
  expiryDate: string; // ISO date string
  receivedAt: string; // ISO timestamp string
  status: "ACTIVE" | "DEPLETED" | "EXPIRED";
}

/**
 * Per-product on-hand result containing the total quantity and batch breakdown.
 */
export interface OnHandResult {
  onHandQuantity: number;
  batches: FranchiseBatch[];
}

/**
 * Computes the on-hand quantity and batch breakdown for each product
 * from a set of franchise inventory lots.
 *
 * - Only ACTIVE lots are counted (excludes DEPLETED, EXPIRED, and any
 *   in-transit stock which never creates lots until RECEIVED).
 * - Batches are ordered by expiry_date ASC, then received_at ASC (FIFO order).
 * - The on-hand quantity is the sum of quantity_remaining across ACTIVE lots
 *   for each product.
 *
 * @param lots - Array of franchise inventory lots (may include non-ACTIVE)
 * @returns Map keyed by productId with on-hand quantity and ordered batch list
 */
export function computeOnHand(
  lots: FranchiseLot[]
): Map<string, OnHandResult> {
  const result = new Map<string, OnHandResult>();

  // Filter to only ACTIVE lots
  const activeLots = lots.filter((lot) => lot.status === "ACTIVE");

  // Group by productId
  const grouped = new Map<string, FranchiseLot[]>();
  for (const lot of activeLots) {
    const existing = grouped.get(lot.productId);
    if (existing) {
      existing.push(lot);
    } else {
      grouped.set(lot.productId, [lot]);
    }
  }

  // Build result for each product
  for (const [productId, productLots] of grouped) {
    // Sort by expiry_date ASC, then received_at ASC (FIFO order)
    const sorted = [...productLots].sort((a, b) => {
      const expiryCompare =
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      if (expiryCompare !== 0) return expiryCompare;
      return (
        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
      );
    });

    // Sum on-hand quantity
    const onHandQuantity = sorted.reduce(
      (sum, lot) => sum + lot.quantityRemaining,
      0
    );

    // Build batch breakdown
    const batches: FranchiseBatch[] = sorted.map((lot) => ({
      batchNumber: lot.batchNumber,
      quantity: lot.quantityRemaining,
      expiryDate: lot.expiryDate,
    }));

    result.set(productId, { onHandQuantity, batches });
  }

  return result;
}
