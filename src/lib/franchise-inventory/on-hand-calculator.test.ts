// src/lib/franchise-inventory/on-hand-calculator.test.ts
import { describe, it, expect } from "vitest";
import {
  computeOnHand,
  type FranchiseLot,
} from "./on-hand-calculator";

describe("computeOnHand", () => {
  it("returns an empty map when given no lots", () => {
    const result = computeOnHand([]);
    expect(result.size).toBe(0);
  });

  it("excludes DEPLETED and EXPIRED lots from on-hand", () => {
    const lots: FranchiseLot[] = [
      {
        productId: "p1",
        batchNumber: "B001",
        quantityRemaining: 10,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-01T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p1",
        batchNumber: "B002",
        quantityRemaining: 5,
        expiryDate: "2025-07-01",
        receivedAt: "2025-01-02T10:00:00Z",
        status: "DEPLETED",
      },
      {
        productId: "p1",
        batchNumber: "B003",
        quantityRemaining: 3,
        expiryDate: "2025-03-01",
        receivedAt: "2025-01-03T10:00:00Z",
        status: "EXPIRED",
      },
    ];

    const result = computeOnHand(lots);
    const p1 = result.get("p1");
    expect(p1).toBeDefined();
    expect(p1!.onHandQuantity).toBe(10);
    expect(p1!.batches).toHaveLength(1);
    expect(p1!.batches[0].batchNumber).toBe("B001");
  });

  it("sums quantity_remaining across ACTIVE lots per product", () => {
    const lots: FranchiseLot[] = [
      {
        productId: "p1",
        batchNumber: "B001",
        quantityRemaining: 10,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-01T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p1",
        batchNumber: "B002",
        quantityRemaining: 7,
        expiryDate: "2025-07-01",
        receivedAt: "2025-01-05T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p2",
        batchNumber: "B003",
        quantityRemaining: 20,
        expiryDate: "2025-08-01",
        receivedAt: "2025-01-02T10:00:00Z",
        status: "ACTIVE",
      },
    ];

    const result = computeOnHand(lots);
    expect(result.get("p1")!.onHandQuantity).toBe(17);
    expect(result.get("p2")!.onHandQuantity).toBe(20);
  });

  it("orders batches by expiryDate ASC then receivedAt ASC", () => {
    const lots: FranchiseLot[] = [
      {
        productId: "p1",
        batchNumber: "B-LATER-EXPIRY",
        quantityRemaining: 5,
        expiryDate: "2025-09-01",
        receivedAt: "2025-01-01T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p1",
        batchNumber: "B-EARLIER-EXPIRY",
        quantityRemaining: 3,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-02T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p1",
        batchNumber: "B-SAME-EXPIRY-EARLIER-RECEIVED",
        quantityRemaining: 2,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-01T08:00:00Z",
        status: "ACTIVE",
      },
    ];

    const result = computeOnHand(lots);
    const p1 = result.get("p1")!;
    expect(p1.batches).toHaveLength(3);
    // Earliest expiry first, then earliest received for ties
    expect(p1.batches[0].batchNumber).toBe("B-SAME-EXPIRY-EARLIER-RECEIVED");
    expect(p1.batches[1].batchNumber).toBe("B-EARLIER-EXPIRY");
    expect(p1.batches[2].batchNumber).toBe("B-LATER-EXPIRY");
  });

  it("does not include products that have no ACTIVE lots", () => {
    const lots: FranchiseLot[] = [
      {
        productId: "p1",
        batchNumber: "B001",
        quantityRemaining: 10,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-01T10:00:00Z",
        status: "DEPLETED",
      },
      {
        productId: "p1",
        batchNumber: "B002",
        quantityRemaining: 5,
        expiryDate: "2025-07-01",
        receivedAt: "2025-01-02T10:00:00Z",
        status: "EXPIRED",
      },
    ];

    const result = computeOnHand(lots);
    expect(result.has("p1")).toBe(false);
  });

  it("handles multiple products independently", () => {
    const lots: FranchiseLot[] = [
      {
        productId: "p1",
        batchNumber: "B001",
        quantityRemaining: 10,
        expiryDate: "2025-06-01",
        receivedAt: "2025-01-01T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p2",
        batchNumber: "B002",
        quantityRemaining: 20,
        expiryDate: "2025-05-01",
        receivedAt: "2025-01-03T10:00:00Z",
        status: "ACTIVE",
      },
      {
        productId: "p3",
        batchNumber: "B003",
        quantityRemaining: 15,
        expiryDate: "2025-07-01",
        receivedAt: "2025-01-02T10:00:00Z",
        status: "DEPLETED",
      },
    ];

    const result = computeOnHand(lots);
    expect(result.size).toBe(2);
    expect(result.get("p1")!.onHandQuantity).toBe(10);
    expect(result.get("p2")!.onHandQuantity).toBe(20);
    expect(result.has("p3")).toBe(false);
  });
});
