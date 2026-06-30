// Feature: master-inventory-management, Property 5: Edit replaces the product image only when a new image is provided
//
// Validates: Requirements 4.4
//
// For any valid edit-product submission applied to an existing product, the resulting stored image
// equals the newly supplied image when one is provided and equals the product's previously stored
// image when none is provided, while every other edited field equals the submitted value.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mock Supabase admin client ─────────────────────────────────────────────

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: (...args: unknown[]) => {
        selectMock(table, ...args);
        return {
          eq: (col: string, val: unknown) => ({
            is: (col2: string, val2: unknown) => ({
              single: () => selectMock._singleResult,
            }),
            single: () => selectMock._singleResult,
          }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        updateMock(table, payload);
        return {
          eq: (_col: string, _val: unknown) => ({
            select: (..._args: unknown[]) => ({
              single: () => updateMock._singleResult,
            }),
          }),
        };
      },
    }),
  }),
}));

// ─── Generators ──────────────────────────────────────────────────────────────

/** Non-empty string representing an existing image URL stored in the DB. */
const arbExistingImageUrl = fc.string({ minLength: 1, maxLength: 200 }).filter(
  (s) => s.trim().length > 0,
);

/** A new image URL that should replace the existing one (non-null, non-empty). */
const arbNewImageUrl = fc.string({ minLength: 1, maxLength: 200 }).filter(
  (s) => s.trim().length > 0,
);

/** Values that indicate "no new image provided" — null, undefined, or empty string. */
const arbNoImage = fc.constantFrom<string | null | undefined>(null, undefined, "");

/** A valid product name (non-empty trimmed string). */
const arbProductName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** A valid category. */
const arbCategory = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

// ─── Property test ───────────────────────────────────────────────────────────

describe("updateInventoryProduct — Property 5: Edit replaces the product image only when a new image is provided", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes image_url in the update payload when a new non-empty image is provided", async () => {
    const { updateInventoryProduct } = await import(
      "@/services/inventoryEngine"
    );

    await fc.assert(
      fc.asyncProperty(
        arbExistingImageUrl,
        arbNewImageUrl,
        arbProductName,
        arbCategory,
        async (existingImage, newImage, name, category) => {
          const productId = "test-product-id";

          // Mock the existing product fetch
          selectMock._singleResult = {
            data: { id: productId, image_url: existingImage },
            error: null,
          };

          // Mock the update result
          updateMock._singleResult = {
            data: {
              id: productId,
              name: name.trim(),
              image_url: newImage.trim(),
              category: category.trim(),
              type: "RAW_MATERIAL",
              base_uom: "KG",
              min_stock_threshold: "10",
              default_durability_days: 30,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: new Date().toISOString(),
            },
            error: null,
          };

          await updateInventoryProduct(productId, {
            name,
            category,
            imageUrl: newImage,
          });

          // Find the update call and check the payload
          const updateCall = updateMock.mock.calls[updateMock.mock.calls.length - 1];
          expect(updateCall).toBeDefined();
          const [_table, payload] = updateCall;

          // When a new image is provided, image_url MUST be in the payload
          expect(payload).toHaveProperty("image_url");
          expect(payload.image_url).toBe(newImage.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does NOT include image_url in the update payload when no new image is provided", async () => {
    const { updateInventoryProduct } = await import(
      "@/services/inventoryEngine"
    );

    await fc.assert(
      fc.asyncProperty(
        arbExistingImageUrl,
        arbNoImage,
        arbProductName,
        arbCategory,
        async (existingImage, noImage, name, category) => {
          const productId = "test-product-id";

          // Mock the existing product fetch
          selectMock._singleResult = {
            data: { id: productId, image_url: existingImage },
            error: null,
          };

          // Mock the update result — image should remain the existing one
          updateMock._singleResult = {
            data: {
              id: productId,
              name: name.trim(),
              image_url: existingImage,
              category: category.trim(),
              type: "RAW_MATERIAL",
              base_uom: "KG",
              min_stock_threshold: "10",
              default_durability_days: 30,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: new Date().toISOString(),
            },
            error: null,
          };

          await updateInventoryProduct(productId, {
            name,
            category,
            imageUrl: noImage as string | undefined,
          });

          // Find the update call and check the payload
          const updateCall = updateMock.mock.calls[updateMock.mock.calls.length - 1];
          expect(updateCall).toBeDefined();
          const [_table, payload] = updateCall;

          // When no new image is provided, image_url must NOT appear in the payload
          // (the existing image is retained by omission)
          expect(payload).not.toHaveProperty("image_url");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("other edited fields are always included in the update payload regardless of image presence", async () => {
    const { updateInventoryProduct } = await import(
      "@/services/inventoryEngine"
    );

    await fc.assert(
      fc.asyncProperty(
        arbExistingImageUrl,
        fc.oneof(arbNewImageUrl, arbNoImage),
        arbProductName,
        arbCategory,
        async (existingImage, imageInput, name, category) => {
          const productId = "test-product-id";

          // Mock the existing product fetch
          selectMock._singleResult = {
            data: { id: productId, image_url: existingImage },
            error: null,
          };

          // Mock the update result
          updateMock._singleResult = {
            data: {
              id: productId,
              name: name.trim(),
              image_url:
                imageInput && imageInput.trim() !== ""
                  ? (imageInput as string).trim()
                  : existingImage,
              category: category.trim(),
              type: "RAW_MATERIAL",
              base_uom: "KG",
              min_stock_threshold: "10",
              default_durability_days: 30,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: new Date().toISOString(),
            },
            error: null,
          };

          await updateInventoryProduct(productId, {
            name,
            category,
            imageUrl: imageInput as string | undefined,
          });

          // Find the update call and check the payload
          const updateCall = updateMock.mock.calls[updateMock.mock.calls.length - 1];
          expect(updateCall).toBeDefined();
          const [_table, payload] = updateCall;

          // Name and category fields must always be present in the payload
          expect(payload).toHaveProperty("name", name.trim());
          expect(payload).toHaveProperty("category", category.trim());
          // updated_at is always set
          expect(payload).toHaveProperty("updated_at");
        },
      ),
      { numRuns: 100 },
    );
  });
});
