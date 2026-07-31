// src/lib/shop/__tests__/clinicStock.unit.test.ts
// Focused example-based tests for the pure clinic shop stock decision layer
// (clinic-scoped-shop-inventory, Task 2.3). Input-space coverage is left to the
// numbered property tests (Tasks 2.5–2.10); these examples pin the concrete
// branches and the edge inputs the requirements call out by name.

import { describe, expect, it } from "vitest";

import {
  ALL_CLINICS_DESTINATION_VALUE,
  DESTINATION_LIST_LOAD_FAILED_NOTICE,
  DESTINATION_UNAVAILABLE_NOTICE,
  STOCK_QUANTITY_MAXIMUM,
  computeAggregateStock,
  evaluateSaleSubmission,
  evaluateStockInSubmission,
  isExposedInClinicShop,
  mergeStockInLine,
  planFifoDepletion,
  resolveDestination,
  resolveEffectiveOverlay,
  rowActionsForDestination,
  validateMovementQuantity,
  validateStockLevel,
  type Destination,
  type StockInProductContext,
} from "../clinicStock";

const CLINIC = "11111111-1111-4111-8111-111111111111";
const FRANCHISE = "22222222-2222-4222-8222-222222222222";
const clinicDestination: Destination = { kind: "clinic", clinicId: CLINIC };
const known = { clinicIds: [CLINIC], franchiseIds: [FRANCHISE] };

describe("resolveEffectiveOverlay", () => {
  it("reads a missing overlay as stock 0 and hidden", () => {
    expect(resolveEffectiveOverlay(undefined)).toEqual({
      stockQuantity: 0,
      isVisible: false,
    });
    expect(resolveEffectiveOverlay(null)).toEqual({
      stockQuantity: 0,
      isVisible: false,
    });
  });

  it("accepts both the camelCase shape and the database row shape", () => {
    expect(resolveEffectiveOverlay({ stockQuantity: 7, isVisible: true })).toEqual({
      stockQuantity: 7,
      isVisible: true,
    });
    expect(resolveEffectiveOverlay({ stock_quantity: 7, is_visible: true })).toEqual({
      stockQuantity: 7,
      isVisible: true,
    });
  });

  it("treats a negative or non-integral stored level as 0", () => {
    expect(resolveEffectiveOverlay({ stockQuantity: -4, isVisible: true })).toEqual({
      stockQuantity: 0,
      isVisible: true,
    });
    expect(resolveEffectiveOverlay({ stockQuantity: 2.5, isVisible: true })).toEqual({
      stockQuantity: 0,
      isVisible: true,
    });
  });
});

describe("computeAggregateStock", () => {
  it("sums effective stock, counting clinics with no record as 0", () => {
    expect(
      computeAggregateStock([
        { stockQuantity: 5, isVisible: true },
        null,
        { stock_quantity: 3, is_visible: false },
        undefined,
      ]),
    ).toBe(8);
  });

  it("aggregates an empty or missing clinic set to 0", () => {
    expect(computeAggregateStock([])).toBe(0);
    expect(computeAggregateStock(undefined)).toBe(0);
  });
});

describe("isExposedInClinicShop", () => {
  const exposed = {
    deletedAt: null,
    isActive: true,
    overlay: { stockQuantity: 1, isVisible: true },
  };

  it("exposes a product only when all four conditions hold", () => {
    expect(isExposedInClinicShop(exposed)).toBe(true);
    expect(isExposedInClinicShop({ ...exposed, deletedAt: "2024-01-01" })).toBe(false);
    expect(isExposedInClinicShop({ ...exposed, isActive: false })).toBe(false);
    expect(
      isExposedInClinicShop({
        ...exposed,
        overlay: { stockQuantity: 1, isVisible: false },
      }),
    ).toBe(false);
    expect(
      isExposedInClinicShop({
        ...exposed,
        overlay: { stockQuantity: 0, isVisible: true },
      }),
    ).toBe(false);
  });

  it("hides a product the clinic holds no record for", () => {
    expect(isExposedInClinicShop({ ...exposed, overlay: null })).toBe(false);
  });
});

describe("quantity validation", () => {
  it("accepts movement quantities in [1, 1,000,000] only", () => {
    expect(validateMovementQuantity(1)).toEqual({ ok: true, value: 1 });
    expect(validateMovementQuantity(STOCK_QUANTITY_MAXIMUM)).toEqual({
      ok: true,
      value: STOCK_QUANTITY_MAXIMUM,
    });
    expect(validateMovementQuantity(0)).toEqual({
      ok: false,
      reason: "BELOW_MINIMUM",
    });
    expect(validateMovementQuantity(STOCK_QUANTITY_MAXIMUM + 1)).toEqual({
      ok: false,
      reason: "ABOVE_MAXIMUM",
    });
  });

  it("reports non-integral input as NOT_INTEGER before any range check", () => {
    expect(validateMovementQuantity(2.5)).toEqual({
      ok: false,
      reason: "NOT_INTEGER",
    });
    expect(validateMovementQuantity(STOCK_QUANTITY_MAXIMUM + 0.5)).toEqual({
      ok: false,
      reason: "NOT_INTEGER",
    });
    expect(validateMovementQuantity(Number.NaN)).toEqual({
      ok: false,
      reason: "NOT_INTEGER",
    });
    expect(validateMovementQuantity("5")).toEqual({
      ok: false,
      reason: "NOT_INTEGER",
    });
    expect(validateMovementQuantity(null)).toEqual({
      ok: false,
      reason: "NOT_INTEGER",
    });
  });

  it("accepts 0 as a stock level but not as a movement", () => {
    expect(validateStockLevel(0)).toEqual({ ok: true, value: 0 });
    expect(validateStockLevel(-1)).toEqual({
      ok: false,
      reason: "BELOW_MINIMUM",
    });
  });
});

describe("mergeStockInLine", () => {
  it("replaces the quantity of an existing pair in place", () => {
    const first = mergeStockInLine([], {
      clinicId: CLINIC,
      productId: "p1",
      quantity: 2,
    });
    const second = mergeStockInLine(first, {
      clinicId: CLINIC,
      productId: "p2",
      quantity: 4,
    });
    const merged = mergeStockInLine(second, {
      clinicId: CLINIC,
      productId: "p1",
      quantity: 9,
    });

    expect(merged).toEqual([
      { clinicId: CLINIC, productId: "p1", quantity: 9 },
      { clinicId: CLINIC, productId: "p2", quantity: 4 },
    ]);
    // The input array is never mutated.
    expect(second).toEqual([
      { clinicId: CLINIC, productId: "p1", quantity: 2 },
      { clinicId: CLINIC, productId: "p2", quantity: 4 },
    ]);
  });

  it("keeps the same product separate per destination clinic", () => {
    const lines = mergeStockInLine(
      [{ clinicId: CLINIC, productId: "p1", quantity: 2 }],
      { clinicId: FRANCHISE, productId: "p1", quantity: 3 },
    );
    expect(lines).toHaveLength(2);
  });
});

describe("planFifoDepletion", () => {
  it("depletes oldest-first and sums to the requested quantity", () => {
    const result = planFifoDepletion(
      [
        { id: "lot-a", quantityRemaining: 4 },
        { id: "lot-b", quantityRemaining: 10 },
      ],
      6,
    );
    expect(result).toEqual({
      ok: true,
      plan: [
        { lotId: "lot-a", deduct: 4 },
        { lotId: "lot-b", deduct: 2 },
      ],
    });
  });

  it("skips empty lots and reports availability when short", () => {
    expect(
      planFifoDepletion([{ id: "lot-a", quantityRemaining: 0 }], 1),
    ).toEqual({ ok: false, available: 0 });
    expect(planFifoDepletion([], 1)).toEqual({ ok: false, available: 0 });
    expect(
      planFifoDepletion([{ id: "lot-a", quantityRemaining: 3 }], 5),
    ).toEqual({ ok: false, available: 3 });
  });

  it("refuses to plan an out-of-range quantity", () => {
    expect(
      planFifoDepletion([{ id: "lot-a", quantityRemaining: 100 }], 0),
    ).toEqual({ ok: false, available: 100 });
    expect(
      planFifoDepletion([{ id: "lot-a", quantityRemaining: 100 }], 1.5),
    ).toEqual({ ok: false, available: 100 });
  });
});

describe("resolveDestination", () => {
  it("defaults to All Clinics with no notice", () => {
    expect(resolveDestination(undefined, known)).toEqual({
      kind: "all-clinics",
      notice: null,
    });
    expect(resolveDestination(ALL_CLINICS_DESTINATION_VALUE, known)).toEqual({
      kind: "all-clinics",
      notice: null,
    });
  });

  it("resolves a known clinic and a known franchise", () => {
    expect(resolveDestination(`clinic:${CLINIC}`, known)).toEqual({
      kind: "clinic",
      clinicId: CLINIC,
    });
    expect(resolveDestination(`franchise:${FRANCHISE}`, known)).toEqual({
      kind: "franchise",
      franchiseId: FRANCHISE,
    });
  });

  it("falls back with a notice for an unknown or malformed value", () => {
    expect(
      resolveDestination("clinic:33333333-3333-4333-8333-333333333333", known),
    ).toEqual({ kind: "all-clinics", notice: DESTINATION_UNAVAILABLE_NOTICE });
    expect(resolveDestination("!!not-a-destination!!", known)).toEqual({
      kind: "all-clinics",
      notice: DESTINATION_UNAVAILABLE_NOTICE,
    });
  });

  it("falls back with the load-failure notice when the option list failed", () => {
    expect(
      resolveDestination(`clinic:${CLINIC}`, { ...known, loadFailed: true }),
    ).toEqual({
      kind: "all-clinics",
      notice: DESTINATION_LIST_LOAD_FAILED_NOTICE,
    });
  });

  it("offers exactly the row actions each mode allows", () => {
    expect(rowActionsForDestination(clinicDestination)).toEqual([
      "clinic-visibility",
      "stock-in",
    ]);
    expect(
      rowActionsForDestination({ kind: "franchise", franchiseId: FRANCHISE }),
    ).toEqual(["franchise-visibility"]);
    expect(
      rowActionsForDestination({ kind: "all-clinics", notice: null }),
    ).not.toContain("stock-in");
  });
});

describe("evaluateStockInSubmission", () => {
  const linked: StockInProductContext = {
    productId: "p1",
    productName: "Ashwagandha",
    inventoryProductId: "inv-1",
    warehouseAvailable: 50,
    overlay: { stockQuantity: 10, isVisible: true },
  };

  it("accepts every line and reports the resulting levels", () => {
    const verdict = evaluateStockInSubmission({
      destination: clinicDestination,
      lines: [{ productId: "p1", quantity: 5 }],
      products: [linked],
    });

    expect(verdict).toEqual({
      ok: true,
      clinicId: CLINIC,
      totalQuantity: 5,
      applied: [
        {
          productId: "p1",
          quantity: 5,
          stockBefore: 10,
          stockAfter: 15,
          warehouseAvailableBefore: 50,
          warehouseAvailableAfter: 45,
        },
      ],
    });
  });

  it("rejects a non-clinic destination and an empty cart", () => {
    expect(
      evaluateStockInSubmission({
        destination: { kind: "franchise", franchiseId: FRANCHISE },
        lines: [{ productId: "p1", quantity: 5 }],
        products: [linked],
      }),
    ).toEqual({ ok: false, code: "INVALID_DESTINATION", rejections: [] });

    expect(
      evaluateStockInSubmission({
        destination: clinicDestination,
        lines: [],
        products: [linked],
      }),
    ).toEqual({ ok: false, code: "NO_LINES", rejections: [] });
  });

  it("rejects the whole submission for an unlinked product", () => {
    const verdict = evaluateStockInSubmission({
      destination: clinicDestination,
      lines: [
        { productId: "p1", quantity: 5 },
        { productId: "p2", quantity: 1 },
      ],
      products: [
        linked,
        { productId: "p2", inventoryProductId: null, warehouseAvailable: 99 },
      ],
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("UNLINKED_PRODUCT");
    expect(verdict.rejections.map((r) => r.productId)).toEqual(["p2"]);
  });

  it("names every product short on warehouse stock, pooling a shared link", () => {
    const verdict = evaluateStockInSubmission({
      destination: clinicDestination,
      lines: [
        { productId: "p1", quantity: 30 },
        { productId: "p2", quantity: 30 },
      ],
      products: [
        { ...linked, warehouseAvailable: 50 },
        {
          productId: "p2",
          inventoryProductId: "inv-1",
          warehouseAvailable: 50,
        },
      ],
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("INSUFFICIENT_WAREHOUSE");
    expect(verdict.rejections.map((r) => r.productId)).toEqual(["p1", "p2"]);
    expect(verdict.rejections[0].available).toBe(50);
  });

  it("rejects a line that would raise the clinic above the maximum", () => {
    const verdict = evaluateStockInSubmission({
      destination: clinicDestination,
      lines: [{ productId: "p1", quantity: 10 }],
      products: [
        {
          ...linked,
          warehouseAvailable: 100,
          overlay: {
            stockQuantity: STOCK_QUANTITY_MAXIMUM - 5,
            isVisible: true,
          },
        },
      ],
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("EXCEEDS_MAXIMUM");
    expect(verdict.rejections[0].resultingStock).toBe(
      STOCK_QUANTITY_MAXIMUM + 5,
    );
  });
});

describe("evaluateSaleSubmission", () => {
  it("accepts a sale within the clinic's effective stock", () => {
    const verdict = evaluateSaleSubmission({
      clinicId: CLINIC,
      lines: [{ productId: "p1", quantity: 2 }],
      products: [{ productId: "p1", overlay: { stockQuantity: 3, isVisible: true } }],
    });

    expect(verdict).toEqual({
      ok: true,
      clinicId: CLINIC,
      totalQuantity: 2,
      applied: [
        { productId: "p1", quantity: 2, stockBefore: 3, stockAfter: 1 },
      ],
    });
  });

  it("requires a fulfilling clinic", () => {
    expect(
      evaluateSaleSubmission({
        clinicId: null,
        lines: [{ productId: "p1", quantity: 1 }],
        products: [{ productId: "p1", overlay: { stockQuantity: 5, isVisible: true } }],
      }),
    ).toEqual({ ok: false, code: "NO_FULFILLING_CLINIC", rejections: [] });
  });

  it("rejects the whole order and names each shortfall with its availability", () => {
    const verdict = evaluateSaleSubmission({
      clinicId: CLINIC,
      lines: [
        { productId: "p1", quantity: 2 },
        { productId: "p2", quantity: 4 },
      ],
      products: [
        { productId: "p1", overlay: { stockQuantity: 9, isVisible: true } },
        { productId: "p2", productName: "Triphala", overlay: null },
      ],
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("INSUFFICIENT_CLINIC_STOCK");
    expect(verdict.rejections).toEqual([
      {
        productId: "p2",
        productName: "Triphala",
        code: "INSUFFICIENT_CLINIC_STOCK",
        requested: 4,
        available: 0,
      },
    ]);
  });

  it("rejects an out-of-range ordered quantity", () => {
    const verdict = evaluateSaleSubmission({
      clinicId: CLINIC,
      lines: [{ productId: "p1", quantity: 0 }],
      products: [{ productId: "p1", overlay: { stockQuantity: 5, isVisible: true } }],
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("INVALID_QUANTITY");
    expect(verdict.rejections[0].reason).toBe("BELOW_MINIMUM");
  });
});
