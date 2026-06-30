// Feature: master-inventory-management, Property 7: Deleting a non-existent or already-deleted product errors without mutation
//
// Validates: Requirements 4.7
//
// For any product identifier that is unknown or refers to an already soft-deleted product,
// the delete action returns a descriptive error result and leaves all warehouse data unchanged
// (delete does not "succeed" a second time).

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mock setup ──────────────────────────────────────────────────────────────

const selectMock = vi.fn();
const eqMock = vi.fn();
const singleMock = vi.fn();
const updateMock = vi.fn();
const updateEqMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "inventory_products") {
        return {
          select: (...args: unknown[]) => {
            selectMock(...args);
            return {
              eq: (...eqArgs: unknown[]) => {
                eqMock(...eqArgs);
                return { single: singleMock };
              },
            };
          },
          update: (payload: unknown) => {
            updateMock(payload);
            return {
              eq: (...eqArgs: unknown[]) => {
                updateEqMock(...eqArgs);
                return { data: null, error: null };
              },
            };
          },
        };
      }
      return {};
    },
  }),
}));

import { deleteInventoryProduct } from "@/services/inventoryEngine";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Random product IDs: UUIDs, arbitrary strings, empty strings. */
const arbProductId = fc.oneof(
  fc.uuid(),
  fc.string({ minLength: 1, maxLength: 50 }),
);

/** Random non-null deleted_at timestamps (ISO strings). */
const arbDeletedAtTimestamp = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-12-31").getTime() })
  .map((ms) => new Date(ms).toISOString());

// ─── Property test ───────────────────────────────────────────────────────────

describe("deleteInventoryProduct — Property 7: Deleting a non-existent or already-deleted product errors without mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Case 1: throws 'not found' error and performs no update when product does not exist (fetch error)", async () => {
    await fc.assert(
      fc.asyncProperty(arbProductId, async (productId) => {
        vi.clearAllMocks();

        // Simulate Supabase returning a fetch error (product not found)
        singleMock.mockResolvedValue({
          data: null,
          error: { message: "Row not found", code: "PGRST116" },
        });

        await expect(deleteInventoryProduct(productId)).rejects.toThrow(
          /not found/i,
        );

        // The update() call should never be reached
        expect(updateMock).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("Case 1b: throws 'not found' error and performs no update when product data is null", async () => {
    await fc.assert(
      fc.asyncProperty(arbProductId, async (productId) => {
        vi.clearAllMocks();

        // Simulate Supabase returning null data with no error
        singleMock.mockResolvedValue({
          data: null,
          error: null,
        });

        await expect(deleteInventoryProduct(productId)).rejects.toThrow(
          /not found/i,
        );

        // The update() call should never be reached
        expect(updateMock).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("Case 2: throws 'already been deleted' error and performs no update when product is already soft-deleted", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbProductId,
        arbDeletedAtTimestamp,
        async (productId, deletedAt) => {
          vi.clearAllMocks();

          // Simulate Supabase returning a product that already has deleted_at set
          singleMock.mockResolvedValue({
            data: { id: productId, deleted_at: deletedAt },
            error: null,
          });

          await expect(deleteInventoryProduct(productId)).rejects.toThrow(
            /already been deleted/i,
          );

          // The update() call should never be reached
          expect(updateMock).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
