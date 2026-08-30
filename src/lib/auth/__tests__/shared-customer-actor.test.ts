// src/lib/auth/__tests__/shared-customer-actor.test.ts
//
// SECURITY tests for the cross-portal customer authorization helper.
//
// CONTEXT. `CourierForm`, `CustomerHistoryTab`, `KitEligibilityBadge` and
// `SendNewKitForm` live in `src/shared/components/admin/customers/` and import
// their server actions directly. `Customer360Dashboard` renders all four, and
// BOTH portals render that dashboard — so those server-action ids are compiled
// into the FRANCHISE client bundle and are directly invocable from it.
//
// Two holes followed from that, which these tests pin closed:
//
//   1. `saveShippingInfoAction` had NO authorization gate at all.
//   2. The history actions admit `FRANCHISE_ADMIN` (`ALLOWED_ROLES`) but checked
//      NO tenancy, so a franchise admin could read any tenant's history by
//      passing its `customerProfileId`.
//
// The third rule here is the Dietitian_Link. A franchise may now run a TEAM of
// Dietitians (`scripts/allow-multiple-franchise-dietitians.sql`), so tenancy
// alone is not sufficient: without the link check, one Dietitian could read a
// colleague's customer.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
  const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
  const SUBSCRIPTION_ID = "44444444-4444-4444-8444-444444444444";
  const DIETITIAN_ID = "55555555-5555-4555-8555-555555555555";

  const state = {
    /** Caller identity. */
    roleCode: "FRANCHISE_ADMIN" as string | null,
    callerFranchiseId: FRANCHISE_A,
    callerUserId: "franchise-user-1",
    isDietitian: false,
    /** Whether the franchise permission gate passes at all. */
    gateOk: true,
    gateError: "You do not have permission to perform this action.",
    /** The target rows. */
    profileExists: true,
    profileFranchiseId: FRANCHISE_A as string | null,
    profileDietitianId: null as string | null,
    subscriptionExists: true,
    subscriptionProfileId: PROFILE_ID as string | null,
  };

  const defaults = { ...state };
  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    constructor(private readonly table: string) {}
    select() { return this; }
    eq() { return this; }
    maybeSingle() { return this; }
    single() { return this; }

    private get result(): Result {
      if (this.table === "customer_profiles") {
        return {
          data: state.profileExists
            ? {
                id: PROFILE_ID,
                franchise_id: state.profileFranchiseId,
                dietitian_id: state.profileDietitianId,
              }
            : null,
          error: null,
        };
      }
      if (this.table === "subscriptions") {
        return {
          data: state.subscriptionExists
            ? {
                id: SUBSCRIPTION_ID,
                customer_profile_id: state.subscriptionProfileId,
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
    PROFILE_ID,
    SUBSCRIPTION_ID,
    DIETITIAN_ID,
    state,
    reset,
    adminClient: { from: (table: string) => new FakeQuery(table) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.adminClient,
}));

vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: async () => ({ roleCode: H.state.roleCode }),
  checkFranchiseCustomersRead: async () =>
    H.state.gateOk
      ? {
          ok: true,
          isDietitian: H.state.isDietitian,
          ctx: {
            franchiseId: H.state.callerFranchiseId,
            userId: H.state.callerUserId,
          },
        }
      : { ok: false, error: H.state.gateError },
  // The manage gate never returns a Dietitian: `canManageGroup` is false for
  // that level, so it denies before reaching a context.
  checkFranchiseGroupManage: async () =>
    H.state.gateOk && !H.state.isDietitian
      ? {
          ok: true,
          ctx: {
            franchiseId: H.state.callerFranchiseId,
            userId: H.state.callerUserId,
          },
        }
      : { ok: false, error: H.state.gateError },
}));

import {
  isFranchiseCaller,
  authorizeFranchiseCustomerAccess,
  authorizeFranchiseSubscriptionAccess,
} from "@/lib/auth/sharedCustomerActor";

const NOT_YOURS = "This customer does not belong to your franchise.";

describe("isFranchiseCaller", () => {
  beforeEach(() => H.reset());

  it("is true for a FRANCHISE_ADMIN", async () => {
    expect(await isFranchiseCaller()).toBe(true);
  });

  it("is false for a core ADMIN, so the original core gate still rejects them", async () => {
    H.reset({ roleCode: "ADMIN" });
    expect(await isFranchiseCaller()).toBe(false);
  });

  it("is false for MASTER_ADMIN", async () => {
    H.reset({ roleCode: "MASTER_ADMIN" });
    expect(await isFranchiseCaller()).toBe(false);
  });

  it("is false with no session, leaving the core gate to produce the message", async () => {
    H.reset({ roleCode: null });
    expect(await isFranchiseCaller()).toBe(false);
  });
});

describe("authorizeFranchiseCustomerAccess", () => {
  beforeEach(() => H.reset());

  describe("permission", () => {
    it("allows a franchise user with customers access to READ", async () => {
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(true);
    });

    it("allows a franchise user with customers manage to WRITE", async () => {
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "manage");
      expect(result.ok).toBe(true);
    });

    it("refuses when the permission gate denies, without consulting any row", async () => {
      H.reset({ gateOk: false });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "You do not have permission to perform this action.",
        );
      }
    });

    it("refuses a Dietitian a MANAGE action even on their own assigned customer", async () => {
      // A Dietitian's workspace is read-only; `canManageGroup` is false for that
      // level, so the manage gate denies before tenancy is even reached.
      H.reset({ isDietitian: true, profileDietitianId: H.state.callerUserId });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "manage");
      expect(result.ok).toBe(false);
    });
  });

  describe("tenancy", () => {
    it("refuses a customer belonging to another franchise", async () => {
      H.reset({ profileFranchiseId: H.FRANCHISE_B });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(NOT_YOURS);
    });

    it("refuses a customer with no franchise at all (a Core_Business customer)", async () => {
      H.reset({ profileFranchiseId: null });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(NOT_YOURS);
    });

    it("reports a MISSING customer identically to an out-of-tenant one", async () => {
      // Otherwise the response distinguishes "exists elsewhere" from "does not
      // exist", which turns this into a probe for valid profile ids.
      H.reset({ profileExists: false });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(NOT_YOURS);
    });

    it("requires a customer id", async () => {
      const result = await authorizeFranchiseCustomerAccess("   ", "read");
      expect(result.ok).toBe(false);
    });
  });

  describe("the Dietitian_Link", () => {
    it("allows a Franchise Dietitian their OWN assigned customer", async () => {
      H.reset({ isDietitian: true, profileDietitianId: "franchise-user-1" });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(true);
    });

    it("refuses a Franchise Dietitian a COLLEAGUE's customer in the same tenant", async () => {
      // The whole reason tenancy alone is insufficient once a franchise may have
      // more than one active Dietitian.
      H.reset({ isDietitian: true, profileDietitianId: H.DIETITIAN_ID });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(NOT_YOURS);
    });

    it("refuses a Franchise Dietitian an UNASSIGNED customer", async () => {
      H.reset({ isDietitian: true, profileDietitianId: null });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(false);
    });

    it("does NOT apply the link check to a non-Dietitian franchise user", async () => {
      // An owner or operations user reads the whole tenant; the link is a
      // Dietitian-only narrowing.
      H.reset({ isDietitian: false, profileDietitianId: H.DIETITIAN_ID });
      const result = await authorizeFranchiseCustomerAccess(H.PROFILE_ID, "read");
      expect(result.ok).toBe(true);
    });
  });
});

describe("authorizeFranchiseSubscriptionAccess", () => {
  beforeEach(() => H.reset());

  it("allows a subscription whose customer is in the caller's franchise", async () => {
    const result = await authorizeFranchiseSubscriptionAccess(
      H.SUBSCRIPTION_ID,
      "manage",
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a subscription whose customer belongs to another franchise", async () => {
    // The shipping action's input also carries a `customer_profile_id`. Resolving
    // the owner from the SUBSCRIPTION instead is what stops a caller pairing
    // their own profile id with another tenant's subscription.
    H.reset({ profileFranchiseId: H.FRANCHISE_B });
    const result = await authorizeFranchiseSubscriptionAccess(
      H.SUBSCRIPTION_ID,
      "manage",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NOT_YOURS);
  });

  it("refuses a subscription that does not exist", async () => {
    H.reset({ subscriptionExists: false });
    const result = await authorizeFranchiseSubscriptionAccess(
      H.SUBSCRIPTION_ID,
      "manage",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NOT_YOURS);
  });

  it("refuses a subscription with no owning customer profile", async () => {
    H.reset({ subscriptionProfileId: null });
    const result = await authorizeFranchiseSubscriptionAccess(
      H.SUBSCRIPTION_ID,
      "manage",
    );
    expect(result.ok).toBe(false);
  });

  it("requires a subscription id", async () => {
    const result = await authorizeFranchiseSubscriptionAccess("  ", "manage");
    expect(result.ok).toBe(false);
  });

  it("still applies the permission gate, not merely tenancy", async () => {
    H.reset({ gateOk: false });
    const result = await authorizeFranchiseSubscriptionAccess(
      H.SUBSCRIPTION_ID,
      "manage",
    );
    expect(result.ok).toBe(false);
  });
});

// ─── Wiring guard ────────────────────────────────────────────────────────────
//
// The unit tests above prove the helper decides correctly. These prove the
// cross-portal actions actually CONSULT it. Without this, someone could remove a
// gate and every test above would still pass while the hole reopened — which is
// precisely how `saveShippingInfoAction` came to have no authorization at all.
//
// Asserted on source rather than by invoking the actions: each one pulls in
// KitLifecycleService / repositories / the service-role client at module load,
// so exercising them here would mean faking most of the data layer for a check
// that is fundamentally structural. Same approach as
// `src/test/dietitian/smoke.test.ts` and
// `src/lib/auth/__tests__/operational-write-denial.property.test.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const readAction = (...segments: string[]) =>
  readFileSync(path.join(REPO_ROOT, "src", "actions", ...segments), "utf8");

describe("Wiring: every cross-portal customer action consults the shared gate", () => {
  it("shippingActions.saveShippingInfoAction is gated for BOTH portals", () => {
    const source = readAction("admin-actions", "shippingActions.ts");

    // The franchise branch, with tenancy resolved from the SUBSCRIPTION.
    expect(source).toContain("isFranchiseCaller");
    expect(source).toContain("authorizeFranchiseSubscriptionAccess");
    // The core branch, which previously did not exist at all.
    expect(source).toMatch(/assertGroupAccess\("customers"\)/);
  });

  it("kitLifecycleActions gates sendNewKit as a WRITE and eligibility as a READ", () => {
    const source = readAction("admin-actions", "kitLifecycleActions.ts");

    expect(source).toContain("authorizeFranchiseCustomerAccess");
    // Sending a KIT is a write, so the franchise branch must ask for manage;
    // the eligibility badge is a read and must not.
    expect(source).toMatch(
      /authorizeFranchiseCustomerAccess\(\s*customerProfileId,\s*"manage"\s*\)/,
    );
    expect(source).toMatch(
      /authorizeFranchiseCustomerAccess\(customerProfileId,\s*"read"\)/,
    );
    // The core path must survive untouched.
    expect(source).toMatch(/assertGroupAccess\("customers"\)/);
  });

  it("customerHistoryActions routes every history read through the tenancy-aware gate", () => {
    const source = readAction("admin-actions", "customerHistoryActions.ts");

    expect(source).toContain("authorizeFranchiseCustomerAccess");

    // No history action may still call the bare role check directly: that is the
    // one that admits FRANCHISE_ADMIN with no tenancy whatsoever.
    const historyActions = [
      "getAdminMealSubscriptionHistoryAction",
      "getAdminKitHistoryAction",
      "getAdminStayHistoryAction",
      "getAdminAddonRequestHistoryAction",
    ];
    for (const action of historyActions) {
      const body = source.slice(source.indexOf(`export async function ${action}`));
      const firstAuthCall = body.slice(0, body.indexOf("try {"));
      expect(
        firstAuthCall,
        `${action} must authorize via assertHistoryAccess (tenancy-aware), not assertAdmin`,
      ).toContain("assertHistoryAccess");
    }

    // `assertAdmin` itself must remain — it is the unchanged CORE branch.
    expect(source).toContain("return assertAdmin();");
  });

  it("the franchise branch is additive: no core gate was removed", () => {
    // The hard constraint of this work is that Core_Business behaviour on the
    // admin dashboard does not change. Every action keeps its original core
    // check inside an `else`, so this asserts the core branch still exists
    // alongside the new franchise one.
    const kit = readAction("admin-actions", "kitLifecycleActions.ts");
    const history = readAction("admin-actions", "customerHistoryActions.ts");

    expect(kit).toContain("GroupAccessDeniedError");
    expect(kit).toContain("You do not have permission to manage customers.");
    expect(kit).toContain("You do not have permission to view customers.");
    expect(history).toContain("You do not have access to this customer's history.");
  });
});
