import { describe, it, expect } from "vitest";
import {
  evaluateFranchiseStockOutcome,
  UNFULFILLABLE_STOCK_STATUS,
  type ItemDecrementResult,
} from "./franchiseStockFailsafe";

describe("evaluateFranchiseStockOutcome", () => {
  it("treats an all-decremented order as fulfillable", () => {
    const results: ItemDecrementResult[] = [
      { product_id: "p1", quantity: 2, decremented: true },
      { product_id: "p2", quantity: 1, decremented: true },
    ];
    expect(evaluateFranchiseStockOutcome(results)).toEqual({
      fulfillable: true,
      unfulfillableProductIds: [],
    });
  });

  it("treats an order with any failed decrement as unfulfillable and lists offenders", () => {
    const results: ItemDecrementResult[] = [
      { product_id: "p1", quantity: 2, decremented: true },
      { product_id: "p2", quantity: 5, decremented: false },
      { product_id: "p3", quantity: 1, decremented: false },
    ];
    expect(evaluateFranchiseStockOutcome(results)).toEqual({
      fulfillable: false,
      unfulfillableProductIds: ["p2", "p3"],
    });
  });

  it("treats an empty item list as fulfillable (nothing to decrement)", () => {
    expect(evaluateFranchiseStockOutcome([])).toEqual({
      fulfillable: true,
      unfulfillableProductIds: [],
    });
  });

  it("exposes a stable sentinel status for flagging orders", () => {
    expect(UNFULFILLABLE_STOCK_STATUS).toBe("UNFULFILLABLE_STOCK");
  });
});
