// src/lib/franchise-inventory/stock-in-guard.ts
// Pure guard for stock-in operations on franchise inventory.
// Requires the transfer to be in state RECEIVED and quantity > 0.
// Requirements validated: 9.4, 9.5

import type { FranchiseTransferState } from '@/types/franchiseInventory';

export type StockInGuardResult =
  | { allowed: true }
  | { allowed: false; error: string };

/**
 * Guards a stock-in operation against a franchise inventory.
 *
 * A stock-in is allowed only when:
 * 1. The backing transfer is in state `RECEIVED` (central kitchen is the only authorized source).
 * 2. The quantity is greater than zero.
 */
export function guardStockIn(
  transferState: FranchiseTransferState,
  quantity: number,
): StockInGuardResult {
  if (transferState !== 'RECEIVED') {
    return {
      allowed: false,
      error: `Stock-in rejected: transfer is in state "${transferState}" but must be "RECEIVED". Only received central kitchen transfers are authorized sources.`,
    };
  }

  if (quantity <= 0) {
    return {
      allowed: false,
      error: `Stock-in rejected: quantity must be greater than zero, received ${quantity}.`,
    };
  }

  return { allowed: true };
}
