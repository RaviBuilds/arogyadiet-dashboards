// src/lib/franchise-inventory/fifo-depletion.ts
// Pure FIFO depletion logic for franchise inventory stock-out.
// Depletes lots in order (earliest expiry first, ties by earliest received date).
// The caller is responsible for providing lots pre-sorted by expiry_date ASC, received_at ASC.
//
// Requirements validated: 10.2, 12.5

/**
 * A lot available for depletion. Must be pre-sorted by the caller
 * in order: expiry_date ASC, received_at ASC.
 */
export interface DepletableLot {
  id: string;
  batchNumber: string;
  quantityRemaining: number;
  expiryDate: string;
  receivedAt: string;
}

/**
 * A single entry in the depletion plan describing how much was taken
 * from a specific lot and what remains after depletion.
 */
export interface DepletionEntry {
  lotId: string;
  batchNumber: string;
  quantityDepleted: number;
  expiryDate: string;
  remainingAfter: number;
}

/**
 * The result of a FIFO depletion computation.
 * - success: true  → the plan array describes how to deplete.
 * - success: false → insufficient stock; error describes the issue.
 */
export type DepletionResult =
  | { success: true; plan: DepletionEntry[]; totalDepleted: number }
  | { success: false; error: string; requested: number; available: number };

/**
 * Computes a FIFO depletion plan across the given lots.
 *
 * Lots MUST be provided sorted by expiry_date ASC, received_at ASC.
 * The function fully consumes each lot before moving to the next,
 * depleting the earliest-expiry batch first.
 *
 * @param lots - Active lots sorted by expiry_date ASC, received_at ASC
 * @param quantity - The positive quantity to deplete
 * @returns A DepletionResult with the plan or an error
 */
export function computeFifoDepletion(
  lots: DepletableLot[],
  quantity: number,
): DepletionResult {
  const available = lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);

  if (quantity > available) {
    return {
      success: false,
      error: `Insufficient stock: requested ${quantity} but only ${available} available`,
      requested: quantity,
      available,
    };
  }

  const plan: DepletionEntry[] = [];
  let remaining = quantity;

  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.quantityRemaining <= 0) continue;

    const depleteFromThis = Math.min(remaining, lot.quantityRemaining);

    plan.push({
      lotId: lot.id,
      batchNumber: lot.batchNumber,
      quantityDepleted: depleteFromThis,
      expiryDate: lot.expiryDate,
      remainingAfter: lot.quantityRemaining - depleteFromThis,
    });

    remaining -= depleteFromThis;
  }

  return {
    success: true,
    plan,
    totalDepleted: quantity,
  };
}
