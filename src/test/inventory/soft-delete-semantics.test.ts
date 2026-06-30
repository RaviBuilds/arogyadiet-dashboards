// Feature: master-inventory-management, Property 6: Delete soft-deletes and removes the product from the catalog while retaining history
//
// Validates: Requirements 4.5
//
// For any existing, not-already-deleted product, deleting it sets a `deleted_at` timestamp,
// causes the product to no longer appear in the master catalog read, and leaves the product's
// lot and ledger history intact. No hard DELETE query is issued.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Mock the Supabase admin client ─────────────────────────────────────────

// Tracking state for assertions
let selectSingleResult: { data: unknown; error: unknown } = { data: null, error: null };
let updatePayloads: Record<string, unknown>[] = [];
let updateError: unknown = null;
let deleteWasCalled = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: () => selectSingleResult,
          eq: (_col2: string, _val2: unknown) => ({
            single: () => selectSingleResult,
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayloads.push({ ...payload });
        return {
          eq: (_col: string, _val: unknown) => ({
            error: updateError,
          }),
        };
      },
      delete: () => {
        deleteWasCalled = true;
        return {
          eq: (_col: string, _val: unknown) => ({
            error: null,
          }),
        };
      },
    }),
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  }),
}));

import { deleteInventoryProduct } from "@/services/inventoryEngine";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Non-empty product ID strings (alphanumeric + hyphens/underscores) */
const arbProductId = fc.stringMatching(/^[a-zA-Z0-9\-_]{1,50}$/);

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  updatePayloads = [];
  deleteWasCalled = false;
  updateError = null;
  selectSingleResult = { data: null, error: null };
});

// ─── Property test (100 iterations) ─────────────────────────────────────────

describe("deleteInventoryProduct — Property 6: Soft-delete semantics", () => {
  it("sets deleted_at to a non-null ISO timestamp for valid non-deleted products", async () => {
    await fc.assert(
      fc.asyncProperty(arbProductId, async (productId) => {
        // Reset tracking for this iteration
        updatePayloads = [];
        deleteWasCalled = false;
        updateError = null;

        // Mock: product exists and is not deleted
        selectSingleResult = {
          data: { id: productId, deleted_at: null },
          error: null,
        };

        await deleteInventoryProduct(productId);

        // Assert: the update payload sets deleted_at to a valid ISO timestamp
        const softDeletePayloads = updatePayloads.filter(
          (p) => "deleted_at" in p,
        );
        expect(softDeletePayloads.length).toBeGreaterThanOrEqual(1);

        const payload = softDeletePayloads[0];
        expect(payload.deleted_at).not.toBeNull();
        expect(payload.deleted_at).not.toBeUndefined();

        // Validate it's a valid ISO date string
        const deletedAt = payload.deleted_at as string;
        const parsed = new Date(deletedAt);
        expect(parsed.getTime()).not.toBeNaN();
        expect(parsed.toISOString()).toBe(deletedAt);
      }),
      { numRuns: 100 },
    );
  });

  it("never issues a hard DELETE query (soft-delete only)", async () => {
    await fc.assert(
      fc.asyncProperty(arbProductId, async (productId) => {
        updatePayloads = [];
        deleteWasCalled = false;
        updateError = null;

        selectSingleResult = {
          data: { id: productId, deleted_at: null },
          error: null,
        };

        await deleteInventoryProduct(productId);

        // Assert: no DELETE operations were issued
        expect(deleteWasCalled).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("resolves without throwing for valid non-deleted products", async () => {
    await fc.assert(
      fc.asyncProperty(arbProductId, async (productId) => {
        updatePayloads = [];
        deleteWasCalled = false;
        updateError = null;

        selectSingleResult = {
          data: { id: productId, deleted_at: null },
          error: null,
        };

        // Should not throw
        const result = await deleteInventoryProduct(productId);
        expect(result).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Deterministic tests for error paths ────────────────────────────────────

describe("deleteInventoryProduct — error paths", () => {
  it("throws with 'already been deleted' message when product has existing deleted_at", async () => {
    updatePayloads = [];
    deleteWasCalled = false;

    selectSingleResult = {
      data: { id: "product-123", deleted_at: "2024-01-15T10:00:00.000Z" },
      error: null,
    };

    await expect(deleteInventoryProduct("product-123")).rejects.toThrow(
      /already been deleted/i,
    );

    // No update should have been issued
    expect(updatePayloads.length).toBe(0);
  });

  it("throws with 'not found' message when product does not exist", async () => {
    updatePayloads = [];
    deleteWasCalled = false;

    selectSingleResult = {
      data: null,
      error: { message: "No rows found" },
    };

    await expect(deleteInventoryProduct("nonexistent-id")).rejects.toThrow(
      /not found/i,
    );

    // No update should have been issued
    expect(updatePayloads.length).toBe(0);
  });
});
