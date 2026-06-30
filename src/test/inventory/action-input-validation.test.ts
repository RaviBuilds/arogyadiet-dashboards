// Feature: master-inventory-management, Property 4: Invalid input is rejected with a descriptive error and no mutation
//
// Validates: Requirements 4.6, 6.6
//
// For any warehouse action input that fails validation — a missing required field,
// a missing product image on registration, a duplicate product key, or any malformed
// inventory-operation payload — the action returns a descriptive error result and
// performs no warehouse data mutation.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stub server-only so pure server utilities remain importable.
vi.mock("server-only", () => ({}));

// Mock next/headers — actions read the host header for portal context.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: () => "master.arogyadiet.com",
  })),
}));

// Mock next/cache — actions call revalidatePath on success.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock the auth gate to always authorize (we're testing validation, not auth).
vi.mock("@/lib/auth/adminAccess", () => ({
  checkWarehouseAccess: vi.fn(async () => ({ ok: true })),
  assertWarehouseAccess: vi.fn(async () => undefined),
  WarehouseAccessDeniedError: class extends Error {
    capability: string;
    constructor(cap: string) {
      super("Access denied");
      this.capability = cap;
    }
  },
}));

// Mock the inventoryEngine service — we assert these are NEVER called on invalid input.
const createInventoryProductMock = vi.fn();
const updateInventoryProductMock = vi.fn();
const uploadInventoryProductImageMock = vi.fn();

vi.mock("@/services/inventoryEngine", () => ({
  createInventoryProduct: (...args: unknown[]) => createInventoryProductMock(...args),
  updateInventoryProduct: (...args: unknown[]) => updateInventoryProductMock(...args),
  uploadInventoryProductImage: (...args: unknown[]) => uploadInventoryProductImageMock(...args),
  deleteInventoryProduct: vi.fn(),
  receiveInventoryStock: vi.fn(),
  dispatchInventoryStock: vi.fn(),
  processBulkInbound: vi.fn(),
  processBulkOutbound: vi.fn(),
  sendToManufacturing: vi.fn(),
  processManufacturingOutput: vi.fn(),
  revertPendingManufacturing: vi.fn(),
  sendMultiToManufacturing: vi.fn(),
  processBatchOutput: vi.fn(),
  createManufacturingMapping: vi.fn(),
  updateManufacturingMapping: vi.fn(),
  deleteManufacturingMapping: vi.fn(),
  uploadPurchaseOrderFile: vi.fn(),
  BulkInventoryError: class extends Error {
    processed: number;
    constructor(msg: string, processed: number) {
      super(msg);
      this.processed = processed;
    }
  },
}));

import { addProductAction, editProductAction } from "@/actions/inventory-actions";

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generates a FormData with a missing image file (the "image" field is absent
 * or not a File instance).
 */
function arbAddProductFormData_MissingImage(): fc.Arbitrary<FormData> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    category: fc.string({ minLength: 1, maxLength: 50 }),
    type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
    baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
    minStockThreshold: fc.nat({ max: 999 }).map(String),
    defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
  }).map((fields) => {
    const fd = new FormData();
    fd.set("name", fields.name);
    fd.set("category", fields.category);
    fd.set("type", fields.type);
    fd.set("baseUom", fields.baseUom);
    fd.set("minStockThreshold", fields.minStockThreshold);
    fd.set("defaultDurabilityDays", fields.defaultDurabilityDays);
    // Deliberately no "image" field
    return fd;
  });
}

/**
 * Generates a FormData with an image but INVALID required fields.
 * Variants: empty name, missing category, invalid type, missing baseUom.
 */
function arbAddProductFormData_InvalidFields(): fc.Arbitrary<FormData> {
  // Pick which field to invalidate
  return fc.oneof(
    // Empty/whitespace-only name
    fc.record({
      name: fc.constantFrom("", "   ", "\t", "\n"),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Empty category
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.constantFrom("", "  "),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Invalid type
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("", "INVALID", "raw_material", "unknown"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Invalid baseUom
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("", "GALLON", "lb", "invalid"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
  ).map((fields) => {
    const fd = new FormData();
    fd.set("name", fields.name);
    fd.set("category", fields.category);
    fd.set("type", fields.type);
    fd.set("baseUom", fields.baseUom);
    fd.set("minStockThreshold", fields.minStockThreshold);
    fd.set("defaultDurabilityDays", fields.defaultDurabilityDays);
    // Provide a valid image so the failure comes from field validation
    fd.set("image", new File(["fake-image-data"], "product.png", { type: "image/png" }));
    return fd;
  });
}

/**
 * Generates a FormData for editProductAction with invalid data:
 * - Missing productId (empty or non-uuid)
 * - Invalid fields (same field variants as add)
 */
function arbEditProductFormData_Invalid(): fc.Arbitrary<FormData> {
  return fc.oneof(
    // Missing/invalid productId
    fc.record({
      productId: fc.constantFrom("", "not-a-uuid", "123", "   "),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Valid productId but empty name
    fc.record({
      productId: fc.uuid(),
      name: fc.constantFrom("", "   ", "\t"),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Valid productId but invalid type
    fc.record({
      productId: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("", "BADTYPE", "xyz"),
      baseUom: fc.constantFrom("KG", "LITRE", "UNIT"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
    // Valid productId but invalid baseUom
    fc.record({
      productId: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("RAW_MATERIAL", "FINISHED_GOOD"),
      baseUom: fc.constantFrom("", "GALLON", "invalid"),
      minStockThreshold: fc.nat({ max: 999 }).map(String),
      defaultDurabilityDays: fc.nat({ max: 365 }).map(String),
    }),
  ).map((fields) => {
    const fd = new FormData();
    fd.set("productId", fields.productId);
    fd.set("name", fields.name);
    fd.set("category", fields.category);
    fd.set("type", fields.type);
    fd.set("baseUom", fields.baseUom);
    fd.set("minStockThreshold", fields.minStockThreshold);
    fd.set("defaultDurabilityDays", fields.defaultDurabilityDays);
    return fd;
  });
}

// ─── Property tests ───────────────────────────────────────────────────────────

describe("Action input-validation contract — Property 4: Invalid input is rejected with a descriptive error and no mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("addProductAction rejects FormData with missing image and never calls createInventoryProduct", () => {
    fc.assert(
      fc.asyncProperty(arbAddProductFormData_MissingImage(), async (formData) => {
        const result = await addProductAction(formData);

        // Must fail
        expect(result.success).toBe(false);
        if (!result.success) {
          // Error string must be descriptive (non-empty)
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe("string");
          expect(result.error.length).toBeGreaterThan(0);
        }

        // Service mutation must NOT have been called
        expect(createInventoryProductMock).not.toHaveBeenCalled();
        expect(uploadInventoryProductImageMock).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("addProductAction rejects FormData with invalid required fields and never calls createInventoryProduct", () => {
    fc.assert(
      fc.asyncProperty(arbAddProductFormData_InvalidFields(), async (formData) => {
        const result = await addProductAction(formData);

        // Must fail
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe("string");
          expect(result.error.length).toBeGreaterThan(0);
        }

        // Service mutation must NOT have been called
        expect(createInventoryProductMock).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("editProductAction rejects FormData with missing/invalid productId or invalid fields and never calls updateInventoryProduct", () => {
    fc.assert(
      fc.asyncProperty(arbEditProductFormData_Invalid(), async (formData) => {
        const result = await editProductAction(formData);

        // Must fail
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe("string");
          expect(result.error.length).toBeGreaterThan(0);
        }

        // Service mutation must NOT have been called
        expect(updateInventoryProductMock).not.toHaveBeenCalled();
        expect(uploadInventoryProductImageMock).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("all rejected results have the shape { success: false, error: string } with no extra fields suggesting mutation", () => {
    fc.assert(
      fc.asyncProperty(
        fc.oneof(
          arbAddProductFormData_MissingImage(),
          arbAddProductFormData_InvalidFields(),
        ),
        async (formData) => {
          const result = await addProductAction(formData);

          expect(result).toHaveProperty("success", false);
          expect(result).toHaveProperty("error");
          // Must NOT have a productId (that would indicate success/mutation)
          expect(result).not.toHaveProperty("productId");
        },
      ),
      { numRuns: 100 },
    );
  });
});
