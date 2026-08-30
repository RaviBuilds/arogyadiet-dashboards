// src/actions/franchise-actions/__tests__/franchise-shop-order-authorization.test.ts
//
// Authorization + tenancy for the franchise Shop_Orders ledger row actions.
//
// WHY THESE ARE WRAPPERS RATHER THAN A FRANCHISE BRANCH IN THE ADMIN ACTIONS:
// `adminUpdateAddonOrderDeliveryDate` / `adminMarkAddonOrderDeliveredOffline` open
// with `checkGroupManage("customers")`, admitting only ADMIN / MASTER_ADMIN. That
// refusal is CORRECT — and `customer-actions-authorization.pin.test.ts` pins it —
// so the franchise portal gets its own gated wrappers over the shared ungated
// cores instead.
//
// THE TENANCY ANCHOR THAT MATTERS: `addon_orders.franchise_id`, never the customer
// profile's. A walk-in counter sale has `customer_profile_id IS NULL` (enforced by
// `addon_orders_buyer_identity_check`), so resolving the tenant through the profile
// would make every walk-in invisible — the bug in the franchise shop-products
// page's inline "Recent Orders" tab. The walk-in test below is what holds that.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
  const ORDER_ID = "33333333-3333-4333-8333-333333333333";

  const state = {
    gateOk: true,
    gateError: "You do not have permission to perform this action.",
    callerFranchiseId: FRANCHISE_A,
    orderExists: true,
    orderFranchiseId: FRANCHISE_A as string | null,
    /** A walk-in sale carries no customer profile at all. */
    orderCustomerProfileId: "profile-1" as string | null,
  };

  const defaults = { ...state };
  const calls = {
    updateDeliveryDate: [] as { id: string; date: string }[],
    markDelivered: [] as string[],
    revalidated: [] as string[],
  };

  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.updateDeliveryDate.length = 0;
    calls.markDelivered.length = 0;
    calls.revalidated.length = 0;
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    constructor(private readonly table: string) {}
    select() { return this; }
    eq() { return this; }
    maybeSingle() { return this; }
    single() { return this; }

    private get result(): Result {
      if (this.table === "addon_orders") {
        return {
          data: state.orderExists
            ? {
                id: ORDER_ID,
                franchise_id: state.orderFranchiseId,
                customer_profile_id: state.orderCustomerProfileId,
              }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  return {
    FRANCHISE_A,
    FRANCHISE_B,
    ORDER_ID,
    state,
    calls,
    reset,
    adminClient: { from: (table: string) => new FakeQuery(table) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.adminClient,
}));

vi.mock("@/lib/auth/adminAccess", () => ({
  checkFranchiseGroupManage: async () =>
    H.state.gateOk
      ? { ok: true, ctx: { franchiseId: H.state.callerFranchiseId } }
      : { ok: false, error: H.state.gateError },
}));

// Mocked wholesale: the real module builds a service-role client at module load,
// and these tests are about the guard, not the write itself. Spying also lets us
// assert that a denial performs NO write at all.
vi.mock("@/services/addonOrderCore", () => ({
  updateAddonOrderDeliveryDateCore: async (id: string, date: string) => {
    H.calls.updateDeliveryDate.push({ id, date });
    return { success: true };
  },
  markAddonOrderDeliveredOfflineCore: async (id: string) => {
    H.calls.markDelivered.push(id);
    return { success: true };
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    H.calls.revalidated.push(path);
  },
}));

import {
  franchiseUpdateAddonOrderDeliveryDate,
  franchiseMarkAddonOrderDeliveredOffline,
} from "@/actions/franchise-actions/franchiseShopOrderActions";

const NOT_YOURS = "This order does not belong to your franchise.";
const FUTURE_DATE = "2099-01-01";

describe("franchiseUpdateAddonOrderDeliveryDate", () => {
  beforeEach(() => H.reset());

  it("reschedules an order belonging to the caller's franchise", async () => {
    const result = await franchiseUpdateAddonOrderDeliveryDate(
      H.ORDER_ID,
      FUTURE_DATE,
    );

    expect(result.success).toBe(true);
    expect(H.calls.updateDeliveryDate).toEqual([
      { id: H.ORDER_ID, date: FUTURE_DATE },
    ]);
  });

  it("revalidates the franchise surfaces that show shop orders", async () => {
    await franchiseUpdateAddonOrderDeliveryDate(H.ORDER_ID, FUTURE_DATE);
    expect(H.calls.revalidated).toContain("/franchise/customers/shop-orders");
  });

  it("refuses an order belonging to ANOTHER franchise, and writes nothing", async () => {
    H.reset({ orderFranchiseId: H.FRANCHISE_B });

    const result = await franchiseUpdateAddonOrderDeliveryDate(
      H.ORDER_ID,
      FUTURE_DATE,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NOT_YOURS);
    expect(H.calls.updateDeliveryDate).toEqual([]);
    expect(H.calls.revalidated).toEqual([]);
  });

  it("refuses a CORE_BUSINESS order (no franchise stamp)", async () => {
    H.reset({ orderFranchiseId: null });

    const result = await franchiseUpdateAddonOrderDeliveryDate(
      H.ORDER_ID,
      FUTURE_DATE,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NOT_YOURS);
    expect(H.calls.updateDeliveryDate).toEqual([]);
  });

  it("reports a MISSING order identically to an out-of-tenant one", async () => {
    // Otherwise the response distinguishes "exists elsewhere" from "does not
    // exist", turning this into a probe for valid order ids.
    H.reset({ orderExists: false });

    const result = await franchiseUpdateAddonOrderDeliveryDate(
      H.ORDER_ID,
      FUTURE_DATE,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NOT_YOURS);
  });

  it("refuses a view-only franchise user before any row is read", async () => {
    H.reset({
      gateOk: false,
      gateError: "You have read-only access to this section.",
    });

    const result = await franchiseUpdateAddonOrderDeliveryDate(
      H.ORDER_ID,
      FUTURE_DATE,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("You have read-only access to this section.");
    }
    expect(H.calls.updateDeliveryDate).toEqual([]);
  });

  it("requires an order id", async () => {
    const result = await franchiseUpdateAddonOrderDeliveryDate("   ", FUTURE_DATE);
    expect(result.success).toBe(false);
    expect(H.calls.updateDeliveryDate).toEqual([]);
  });
});

describe("franchiseMarkAddonOrderDeliveredOffline", () => {
  beforeEach(() => H.reset());

  it("marks an order of the caller's franchise delivered", async () => {
    const result = await franchiseMarkAddonOrderDeliveredOffline(H.ORDER_ID);

    expect(result.success).toBe(true);
    expect(H.calls.markDelivered).toEqual([H.ORDER_ID]);
  });

  it("WORKS FOR A WALK-IN SALE, which has no customer profile", async () => {
    // The case the inline "Recent Orders" tab on the franchise shop-products page
    // gets wrong: it joins through `customer_profiles` with `!inner`, so a walk-in
    // (customer_profile_id IS NULL) is invisible there. Because tenancy here is
    // read from `addon_orders.franchise_id`, a counter sale is a first-class row.
    H.reset({ orderCustomerProfileId: null });

    const result = await franchiseMarkAddonOrderDeliveredOffline(H.ORDER_ID);

    expect(result.success).toBe(true);
    expect(H.calls.markDelivered).toEqual([H.ORDER_ID]);
  });

  it("refuses another franchise's order, and writes nothing", async () => {
    H.reset({ orderFranchiseId: H.FRANCHISE_B });

    const result = await franchiseMarkAddonOrderDeliveredOffline(H.ORDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NOT_YOURS);
    expect(H.calls.markDelivered).toEqual([]);
    expect(H.calls.revalidated).toEqual([]);
  });

  it("refuses when the caller has no franchise customers permission", async () => {
    H.reset({ gateOk: false });

    const result = await franchiseMarkAddonOrderDeliveredOffline(H.ORDER_ID);

    expect(result.success).toBe(false);
    expect(H.calls.markDelivered).toEqual([]);
  });

  it("checks permission BEFORE tenancy", async () => {
    // A caller without permission must not be able to distinguish "not your
    // order" from "not allowed" — that would leak which orders exist.
    H.reset({ gateOk: false, orderFranchiseId: H.FRANCHISE_B });

    const result = await franchiseMarkAddonOrderDeliveredOffline(H.ORDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "You do not have permission to perform this action.",
      );
    }
  });
});
