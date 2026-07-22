/**
 * Shop product delivery linking fix — Defect #6 (Property 6 / Req 2.7).
 *
 * A franchise `addon_order`'s stock is decremented, item-by-item, via the
 * atomic `decrement_franchise_product_stock` RPC AFTER the order has already
 * been marked PAID in `verifyAddonPayment`. The RPC is the source of atomicity:
 * it returns `false` (and does NOT decrement) when franchise stock is
 * insufficient — e.g. a concurrent sale raced ahead.
 *
 * The original flow only `console.error`-logged that `false`/error result and
 * still completed the order as a plain PAID order, leaving it silently
 * unfulfillable (oversold from the customer's perspective — charged with no
 * stock reserved).
 *
 * This helper isolates the PURE decision — "given each item's decrement result,
 * is the order fully fulfillable, and which items are unfulfillable?" — so it
 * can be unit/property tested without a live database. The `verifyAddonPayment`
 * flow uses it to decide whether to flag the order unfulfillable for ops review
 * / refund and alert admins, instead of honoring the RPC `false` result
 * silently.
 */

/** The sentinel status stamped on `addon_orders.fulfillment_status` when a
 * franchise stock decrement could not be honored for one or more items. */
export const UNFULFILLABLE_STOCK_STATUS = "UNFULFILLABLE_STOCK" as const;

/** The outcome of a single franchise stock decrement attempt for one item. */
export type ItemDecrementResult = {
  product_id: string;
  quantity: number;
  /** true when the RPC atomically decremented; false when it declined
   * (insufficient stock / concurrent sale) or errored. */
  decremented: boolean;
};

export type FranchiseStockOutcome = {
  /** true when every item's stock was successfully decremented. */
  fulfillable: boolean;
  /** the items whose stock could NOT be decremented (empty when fulfillable). */
  unfulfillableProductIds: string[];
};

/**
 * PURE: fold per-item decrement results into an order-level fulfillment
 * decision. An order is fulfillable only when EVERY item was decremented; any
 * single failed/declined decrement makes the order unfulfillable and lists the
 * offending product ids.
 */
export function evaluateFranchiseStockOutcome(
  results: ItemDecrementResult[],
): FranchiseStockOutcome {
  const unfulfillableProductIds = results
    .filter((r) => !r.decremented)
    .map((r) => r.product_id);

  return {
    fulfillable: unfulfillableProductIds.length === 0,
    unfulfillableProductIds,
  };
}
