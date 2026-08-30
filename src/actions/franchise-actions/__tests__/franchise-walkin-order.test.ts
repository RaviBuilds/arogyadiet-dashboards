// src/actions/franchise-actions/__tests__/franchise-walkin-order.test.ts
//
// The franchise WALK-IN (counter sale) action.
//
// WHAT THIS ADDS: the franchise portal had no counter-sale path at all. Its
// assisted-order page injected only four actions, and `AssistedOrderBuilder`
// gates the entire walk-in buyer mode on
// `typeof actions.markPaidAndPlaceWalkInOrderAction === "function"` — so the mode
// simply never rendered. Injecting a franchise wrapper is what turns it on.
//
// THE SECURITY-RELEVANT DIFFERENCE FROM ADMIN: the admin action takes an
// `explicitClinicId` and resolves a fulfilling Core_Clinic. The franchise wrapper
// takes NO clinic and passes none — `placeWalkInOrder` requires one only for a
// CORE operator, a franchise order is attributed by `franchise_id` with
// `clinic_id` NULL by design, and accepting one from the client would let a
// franchise operator stamp another tenant's clinic onto the sale. The
// "passes no fulfilling clinic" test is what holds that.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";

  const state = {
    role: "FRANCHISE_ADMIN" as string | null,
    franchiseId: FRANCHISE_A as string | null,
    hasSession: true,
    userRowId: "franchise-user-1" as string | null,
    serviceOk: true,
    serviceError: "Walk-in buyer name is required.",
  };

  const defaults = { ...state };
  const calls = {
    placeWalkIn: [] as unknown[][],
    revalidated: [] as string[],
  };

  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.placeWalkIn.length = 0;
    calls.revalidated.length = 0;
  };

  return { FRANCHISE_A, state, calls, reset };
});

vi.mock("@/lib/franchise/context", () => ({
  resolveFranchiseContext: async () =>
    H.state.role === null
      ? null
      : { role: H.state.role, franchise_id: H.state.franchiseId },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: H.state.hasSession ? { id: "auth-user-1" } : null },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: H.state.userRowId ? { id: H.state.userRowId } : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/services/AssistedOrderService", () => ({
  AssistedOrderService: class {
    async placeWalkInOrder(...args: unknown[]) {
      H.calls.placeWalkIn.push(args);
      return H.state.serviceOk
        ? { ok: true, value: { addonOrderId: "order-1" } }
        : { ok: false, error: H.state.serviceError };
    }
    async placeOrder() {
      return { ok: true, value: { addonOrderId: "order-1" } };
    }
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    H.calls.revalidated.push(path);
  },
}));

import { markPaidAndPlaceWalkInOrderAction } from "@/actions/franchise-actions/franchiseAssistedOrderActions";

const CART = [{ productId: "product-1", quantity: 2 }] as never;
const WALK_IN = {
  name: "Counter Buyer",
  mobile: "9876543210",
  address: "Shop front",
} as never;

const UNAUTHORIZED = "You are not authorized to place assisted shop orders.";

describe("markPaidAndPlaceWalkInOrderAction (franchise)", () => {
  beforeEach(() => H.reset());

  it("places the counter sale for an authorized franchise operator", async () => {
    const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

    expect(result.success).toBe(true);
    expect(H.calls.placeWalkIn).toHaveLength(1);
  });

  it("delegates with the server-resolved FRANCHISE scope, never a client-supplied one", async () => {
    await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

    const [ctx] = H.calls.placeWalkIn[0] as [
      { userId: string; role: string; scope: { kind: string; franchiseId: string } },
    ];
    expect(ctx.role).toBe("FRANCHISE_ADMIN");
    expect(ctx.scope).toEqual({
      kind: "FRANCHISE",
      franchiseId: H.FRANCHISE_A,
    });
    // `placed_by_user_id` is stamped from this, for audit.
    expect(ctx.userId).toBe("franchise-user-1");
  });

  it("places the sale as PAID — placement is gated on it", async () => {
    await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);
    const args = H.calls.placeWalkIn[0];
    expect(args[3]).toBe("PAID");
  });

  it("passes NO fulfilling clinic", async () => {
    // A franchise order carries `clinic_id` NULL by design; accepting or
    // inventing a clinic here would let a franchise operator stamp another
    // tenant's Core_Clinic onto the sale.
    await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);
    const args = H.calls.placeWalkIn[0];
    // (ctx, cart, walkIn, status, discount) — nothing in the clinic position.
    expect(args[5]).toBeUndefined();
  });

  it("forwards an optional discount", async () => {
    const discount = { type: "FLAT", value: 50 } as never;
    await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN, discount);
    expect(H.calls.placeWalkIn[0][4]).toBe(discount);
  });

  it("revalidates the franchise ledger and the shop stock view", async () => {
    await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);
    expect(H.calls.revalidated).toContain("/franchise/customers/shop-orders");
    expect(H.calls.revalidated).toContain("/franchise/shop-products");
  });

  describe("authorization — rejected before any service call", () => {
    it("refuses a non-franchise role", async () => {
      H.reset({ role: "ADMIN" });

      const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe(UNAUTHORIZED);
      expect(H.calls.placeWalkIn).toEqual([]);
    });

    it("refuses a franchise admin with no franchise assigned", async () => {
      H.reset({ franchiseId: null });

      const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe(UNAUTHORIZED);
      expect(H.calls.placeWalkIn).toEqual([]);
    });

    it("refuses when there is no franchise context at all", async () => {
      H.reset({ role: null });

      const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

      expect(result.success).toBe(false);
      expect(H.calls.placeWalkIn).toEqual([]);
    });

    it("refuses when there is no authenticated session", async () => {
      H.reset({ hasSession: false });

      const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

      expect(result.success).toBe(false);
      expect(H.calls.placeWalkIn).toEqual([]);
    });

    it("refuses when the caller's users row cannot be resolved", async () => {
      // Without it there is no `placed_by_user_id` to stamp, so the sale would be
      // unattributable.
      H.reset({ userRowId: null });

      const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

      expect(result.success).toBe(false);
      expect(H.calls.placeWalkIn).toEqual([]);
    });

    it("does not revalidate anything on a denial", async () => {
      H.reset({ role: "ADMIN" });
      await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);
      expect(H.calls.revalidated).toEqual([]);
    });
  });

  it("propagates a service-side rejection without revalidating", async () => {
    // The service is authoritative on buyer validation, re-pricing and stock.
    H.reset({ serviceOk: false });

    const result = await markPaidAndPlaceWalkInOrderAction(CART, WALK_IN);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Walk-in buyer name is required.");
    }
    expect(H.calls.revalidated).toEqual([]);
  });
});
