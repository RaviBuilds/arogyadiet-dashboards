// src/test/inventory/action-revalidation-integration.test.ts
//
// Integration test: action → service → revalidation
// Verifies that valid mutations from each portal call the shared service and
// revalidate ONLY the initiating portal's routes; failed mutations revalidate
// nothing.
//
// Requirements: 6.2, 7.3, 7.5

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// 1. `server-only` throws outside RSC; stub it.
vi.mock("server-only", () => ({}));

// 2. Mock `next/headers` — controllable `host` header
let mockHost: string = "admin.arogyadiet.com";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => {
      if (key === "host") return mockHost;
      return null;
    },
  })),
}));

// 3. Mock `next/cache` — track revalidatePath calls
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

// 4. Mock `@/lib/auth/adminAccess` — always authorize
vi.mock("@/lib/auth/adminAccess", () => ({
  checkWarehouseAccess: vi.fn(async () => ({ ok: true })),
  assertWarehouseAccess: vi.fn(async () => undefined),
  WarehouseAccessDeniedError: class extends Error {
    capability: string;
    constructor(cap: string) {
      super("denied");
      this.capability = cap;
    }
  },
}));

// 5. Mock `@/services/inventoryEngine` — all mutation functions
const deleteInventoryProductMock = vi.fn();
const receiveInventoryStockMock = vi.fn();
const dispatchInventoryStockMock = vi.fn();
const sendToManufacturingMock = vi.fn();
const createInventoryProductMock = vi.fn();
const updateInventoryProductMock = vi.fn();
const uploadInventoryProductImageMock = vi.fn();

vi.mock("@/services/inventoryEngine", () => ({
  deleteInventoryProduct: (...args: unknown[]) =>
    deleteInventoryProductMock(...args),
  receiveInventoryStock: (...args: unknown[]) =>
    receiveInventoryStockMock(...args),
  dispatchInventoryStock: (...args: unknown[]) =>
    dispatchInventoryStockMock(...args),
  sendToManufacturing: (...args: unknown[]) =>
    sendToManufacturingMock(...args),
  createInventoryProduct: (...args: unknown[]) =>
    createInventoryProductMock(...args),
  updateInventoryProduct: (...args: unknown[]) =>
    updateInventoryProductMock(...args),
  uploadInventoryProductImage: (...args: unknown[]) =>
    uploadInventoryProductImageMock(...args),
  uploadPurchaseOrderFile: vi.fn(),
  processBulkInbound: vi.fn(),
  processBulkOutbound: vi.fn(),
  sendMultiToManufacturing: vi.fn(),
  processManufacturingOutput: vi.fn(),
  processBatchOutput: vi.fn(),
  revertPendingManufacturing: vi.fn(),
  createManufacturingMapping: vi.fn(),
  updateManufacturingMapping: vi.fn(),
  deleteManufacturingMapping: vi.fn(),
  BulkInventoryError: class extends Error {
    processed: number;
    constructor(msg: string, processed: number) {
      super(msg);
      this.processed = processed;
    }
  },
}));

// Mock next/navigation (some server modules may import redirect)
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// ─── Import actions under test (after mocks) ─────────────────────────────────

import {
  deleteProductAction,
  receiveStockAction,
  dispatchToManufacturingAction,
} from "@/actions/inventory-actions/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Valid UUIDs for test data (actions use Zod UUID validation)
const VALID_PRODUCT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_LOT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

function setHost(host: string) {
  mockHost = host;
}

function createReceiveStockFormData(): FormData {
  const fd = new FormData();
  fd.set("productId", VALID_PRODUCT_ID);
  fd.set("quantity", "10");
  fd.set("totalCost", "500");
  fd.set("sourceType", "VENDOR");
  fd.set("sourceName", "Test Vendor");
  return fd;
}

function createDispatchToManufacturingFormData(): FormData {
  const fd = new FormData();
  fd.set("lotId", VALID_LOT_ID);
  fd.set("quantityToSend", "5");
  return fd;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockHost = "admin.arogyadiet.com";
});

describe("Action → Service → Revalidation Integration", () => {
  describe("deleteProductAction (catalog area)", () => {
    it("from admin portal — revalidates /admin/inventory only", async () => {
      setHost("admin.arogyadiet.com");
      deleteInventoryProductMock.mockResolvedValue(undefined);

      const result = await deleteProductAction(VALID_PRODUCT_ID);

      expect(result).toEqual({ success: true });
      expect(deleteInventoryProductMock).toHaveBeenCalledWith(VALID_PRODUCT_ID);
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/inventory");
    });

    it("from master portal — revalidates /inventory/warehouse only", async () => {
      setHost("master.arogyadiet.com");
      deleteInventoryProductMock.mockResolvedValue(undefined);

      const result = await deleteProductAction(VALID_PRODUCT_ID);

      expect(result).toEqual({ success: true });
      expect(deleteInventoryProductMock).toHaveBeenCalledWith(VALID_PRODUCT_ID);
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith("/inventory/warehouse");
    });
  });

  describe("receiveStockAction (catalog area)", () => {
    it("from admin portal — revalidates /admin/inventory only", async () => {
      setHost("admin.arogyadiet.com");
      receiveInventoryStockMock.mockResolvedValue({
        id: "lot-1",
        batchNumber: "B001",
      });

      const fd = createReceiveStockFormData();
      const result = await receiveStockAction(fd);

      expect(result).toEqual({
        success: true,
        lotId: "lot-1",
        batchNumber: "B001",
      });
      expect(receiveInventoryStockMock).toHaveBeenCalled();
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/inventory");
    });

    it("from master portal — revalidates /inventory/warehouse only", async () => {
      setHost("master.arogyadiet.com");
      receiveInventoryStockMock.mockResolvedValue({
        id: "lot-2",
        batchNumber: "B002",
      });

      const fd = createReceiveStockFormData();
      const result = await receiveStockAction(fd);

      expect(result).toEqual({
        success: true,
        lotId: "lot-2",
        batchNumber: "B002",
      });
      expect(receiveInventoryStockMock).toHaveBeenCalled();
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith("/inventory/warehouse");
    });
  });

  describe("dispatchToManufacturingAction (manufacturing area)", () => {
    it("from admin portal — revalidates /admin/inventory/manufacturing only", async () => {
      setHost("admin.arogyadiet.com");
      sendToManufacturingMock.mockResolvedValue({ id: "order-1" });

      const fd = createDispatchToManufacturingFormData();
      const result = await dispatchToManufacturingAction(fd);

      expect(result).toEqual({ success: true, orderId: "order-1" });
      expect(sendToManufacturingMock).toHaveBeenCalled();
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith(
        "/admin/inventory/manufacturing",
      );
    });

    it("from master portal — revalidates /inventory/warehouse/manufacturing only", async () => {
      setHost("master.arogyadiet.com");
      sendToManufacturingMock.mockResolvedValue({ id: "order-2" });

      const fd = createDispatchToManufacturingFormData();
      const result = await dispatchToManufacturingAction(fd);

      expect(result).toEqual({ success: true, orderId: "order-2" });
      expect(sendToManufacturingMock).toHaveBeenCalled();
      expect(revalidatePathMock).toHaveBeenCalledTimes(1);
      expect(revalidatePathMock).toHaveBeenCalledWith(
        "/inventory/warehouse/manufacturing",
      );
    });
  });

  describe("Service failure — no revalidation (Req 7.5)", () => {
    it("deleteProductAction: service throws → revalidatePath NOT called", async () => {
      setHost("admin.arogyadiet.com");
      deleteInventoryProductMock.mockRejectedValue(
        new Error("Product not found"),
      );

      const result = await deleteProductAction(VALID_PRODUCT_ID);

      expect(result).toEqual({
        success: false,
        error: "Product not found",
      });
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("receiveStockAction: service throws → revalidatePath NOT called", async () => {
      setHost("master.arogyadiet.com");
      receiveInventoryStockMock.mockRejectedValue(
        new Error("Insufficient capacity"),
      );

      const fd = createReceiveStockFormData();
      const result = await receiveStockAction(fd);

      expect(result).toEqual({
        success: false,
        error: "Insufficient capacity",
      });
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("dispatchToManufacturingAction: service throws → revalidatePath NOT called", async () => {
      setHost("admin.arogyadiet.com");
      sendToManufacturingMock.mockRejectedValue(
        new Error("Lot depleted"),
      );

      const fd = createDispatchToManufacturingFormData();
      const result = await dispatchToManufacturingAction(fd);

      expect(result).toEqual({
        success: false,
        error: "Lot depleted",
      });
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });
});
