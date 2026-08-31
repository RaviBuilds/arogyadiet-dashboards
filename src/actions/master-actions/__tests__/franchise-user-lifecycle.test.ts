// src/actions/master-actions/__tests__/franchise-user-lifecycle.test.ts
//
// franchise-scoped-access Task 7 — updateFranchiseUser /
// toggleFranchiseUserActive / deleteFranchiseUser.
//
// The two rules these actions exist to enforce, and which these tests pin:
//
//  1. TENANT BINDING — a master-portal request must not be replayable with
//     another franchise's user id.
//
//  2. THE FRANCHISE_OWNER IS NOT EDITABLE HERE — the Owner's effective access is
//     derived from `franchises.owner_user_id`, not from `admin_access_level`. A
//     "successful" demotion would therefore be silently ineffective at runtime,
//     and a deactivation would lock the Franchise out of its own portal.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
  const USER_ID = "33333333-3333-4333-8333-333333333333";

  // `users.franchise_id` is stamped on a Franchise's Customers and Riders too,
  // so the tenant check alone does not identify portal staff. These let a test
  // hand the guard a same-tenant row that is NOT a franchise admin.
  const FRANCHISE_ADMIN_ROLE_ID = "44444444-4444-4444-8444-444444444444";
  const CUSTOMER_ROLE_ID = "55555555-5555-4555-8555-555555555555";
  const RIDER_ROLE_ID = "66666666-6666-4666-8666-666666666666";

  const state = {
    scopeKind: "full_network" as string,
    hasSession: true,
    userExists: true,
    userRoleId: FRANCHISE_ADMIN_ROLE_ID as string | null,
    userFranchiseId: FRANCHISE_A as string | null,
    userAccessLevel: "operations" as string | null,
    /** Stored matrix; a partial update must preserve this rather than reject. */
    userOperationsAccess: { customers: "manage" } as Record<
      string,
      string
    > | null,
    userIsActive: true,
    userAuthId: "auth-1" as string | null,
    ownerUserId: null as string | null,
  };

  const defaults = { ...state };

  const calls = {
    userUpdates: [] as Record<string, unknown>[],
    userDeletes: 0,
    authUpdates: [] as { id: string; payload: Record<string, unknown> }[],
    authDeletes: [] as string[],
    notifications: [] as { userId: string; payload: Record<string, unknown> }[],
  };

  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.userUpdates.length = 0;
    calls.userDeletes = 0;
    calls.authUpdates.length = 0;
    calls.authDeletes.length = 0;
    calls.notifications.length = 0;
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    private result: Result = { data: null, error: null };
    private isWrite = false;

    constructor(private readonly table: string) {}

    select() {
      if (this.isWrite) return this;
      if (this.table === "users") {
        this.result = {
          data: state.userExists
            ? {
                id: USER_ID,
                auth_user_id: state.userAuthId,
                role_id: state.userRoleId,
                franchise_id: state.userFranchiseId,
                admin_access_level: state.userAccessLevel,
                admin_operations_access: state.userOperationsAccess,
                is_active: state.userIsActive,
              }
            : null,
          error: null,
        };
      } else if (this.table === "franchises") {
        this.result = { data: { owner_user_id: state.ownerUserId }, error: null };
      } else if (this.table === "roles") {
        this.result = { data: { id: FRANCHISE_ADMIN_ROLE_ID }, error: null };
      }
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.isWrite = true;
      if (this.table === "users") calls.userUpdates.push(payload);
      this.result = { data: null, error: null };
      return this;
    }
    delete() {
      this.isWrite = true;
      if (this.table === "users") calls.userDeletes += 1;
      this.result = { data: null, error: null };
      return this;
    }
    eq() { return this; }
    maybeSingle() { return this; }
    single() { return this; }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  const adminClient = {
    from: (table: string) => new FakeQuery(table),
    auth: {
      admin: {
        updateUserById: async (id: string, payload: Record<string, unknown>) => {
          calls.authUpdates.push({ id, payload });
          return { data: null, error: null };
        },
        deleteUser: async (id: string) => {
          calls.authDeletes.push(id);
          return { data: null, error: null };
        },
      },
    },
  };

  const serverClient = {
    auth: {
      getUser: async () => ({
        data: { user: state.hasSession ? { id: "auth-master" } : null },
        error: null,
      }),
    },
  };

  return {
    FRANCHISE_A,
    FRANCHISE_B,
    USER_ID,
    FRANCHISE_ADMIN_ROLE_ID,
    CUSTOMER_ROLE_ID,
    RIDER_ROLE_ID,
    state,
    calls,
    reset,
    adminClient,
    serverClient,
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => H.adminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => H.serverClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/franchise/constants", () => ({ FRANCHISE_FEATURES_ENABLED: true }));
vi.mock("@/lib/auth/scope-resolver", () => ({
  resolveScope: async () => ({ ok: true, scope: { kind: H.state.scopeKind } }),
}));
vi.mock("@/lib/logger", () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", () => ({
  sendNotificationToUser: async (
    userId: string,
    payload: Record<string, unknown>,
  ) => {
    H.calls.notifications.push({ userId, payload });
  },
}));
vi.mock("@/repositories/franchise/franchiseRepository", () => ({
  getFranchiseById: async () => ({ id: H.FRANCHISE_A, name: "Franchise A" }),
}));
vi.mock("@/repositories/franchise/franchiseClinicRepository", () => ({
  listClinicsByFranchise: async () => [],
}));
vi.mock("@/services/DietitianAccountService", () => ({ createDietitian: vi.fn() }));

import {
  updateFranchiseUser,
  toggleFranchiseUserActive,
  deleteFranchiseUser,
} from "@/actions/master-actions/franchiseUserActions";

const BASE = () => ({
  franchiseId: H.FRANCHISE_A,
  userId: H.USER_ID,
});

describe("updateFranchiseUser", () => {
  beforeEach(() => H.reset());

  it("persists profile fields, level and matrix", async () => {
    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Renamed User",
      mobile: "9999999999",
      accessLevel: "operations",
      operationsAccess: { customers: "view", riders: "manage" },
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates).toHaveLength(1);
    const row = H.calls.userUpdates[0];
    expect(row.full_name).toBe("Renamed User");
    expect(row.mobile).toBe("9999999999");
    expect(row.admin_access_level).toBe("operations");
    expect(row.admin_operations_access).toEqual({
      customers: "view",
      riders: "manage",
    });
  });

  it("clears the matrix when moving away from the operations level", async () => {
    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "inventory_operations",
      operationsAccess: { customers: "manage" },
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates[0].admin_operations_access).toBeNull();
  });

  it("sends exactly one notification, and only when the level actually changed", async () => {
    await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "inventory",
    });

    expect(H.calls.notifications).toHaveLength(1);
    expect(H.calls.notifications[0].userId).toBe(H.USER_ID);
    expect(H.calls.notifications[0].payload.type).toBe(
      "ADMIN_ACCESS_LEVEL_CHANGED",
    );
    expect(H.calls.notifications[0].payload.message).toContain("Inventory only");
    expect(H.calls.notifications[0].payload.actionUrl).toBe("/inventory");
  });

  it("sends no notification when the level is unchanged", async () => {
    await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "operations",
      operationsAccess: { customers: "manage" },
    });

    expect(H.calls.notifications).toEqual([]);
  });

  it("rejects an invalid access level without writing", async () => {
    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "sudo",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("accessLevel");
    expect(H.calls.userUpdates).toEqual([]);
  });

  it("rejects the franchises group without writing", async () => {
    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "operations",
      operationsAccess: { franchises: "manage" } as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("not available to a franchise user");
    expect(H.calls.userUpdates).toEqual([]);
  });

  it("requires a full name", async () => {
    const result = await updateFranchiseUser({ ...BASE(), fullName: "   " });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("fullName");
    expect(H.calls.userUpdates).toEqual([]);
  });

  // ── Rule 1: tenant binding ────────────────────────────────────────────────

  it("refuses a user belonging to a different franchise", async () => {
    H.reset({ userFranchiseId: H.FRANCHISE_B });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "User",
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "This user does not belong to the selected franchise",
      );
    }
    expect(H.calls.userUpdates).toEqual([]);
  });

  it("refuses a non-existent user", async () => {
    H.reset({ userExists: false });
    const result = await updateFranchiseUser({ ...BASE(), fullName: "User" });
    expect(result.success).toBe(false);
    expect(H.calls.userUpdates).toEqual([]);
  });

  // ── Rule 2: the Franchise_Owner ───────────────────────────────────────────

  it("refuses to change the Franchise_Owner's access level", async () => {
    H.reset({ ownerUserId: H.USER_ID });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Owner",
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Franchise Owner");
      expect(result.field).toBe("accessLevel");
    }
    // Critically: nothing was written, so the UI cannot report a demotion that
    // the runtime override would ignore anyway.
    expect(H.calls.userUpdates).toEqual([]);
    expect(H.calls.notifications).toEqual([]);
  });

  it("preserves the stored matrix on a partial update that omits it", async () => {
    // Renaming a user must not require resubmitting the whole permission
    // matrix, and must not silently clear it.
    H.reset({ userOperationsAccess: { customers: "view", operations: "manage" } });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Renamed Only",
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates[0].admin_operations_access).toEqual({
      customers: "view",
      operations: "manage",
    });
  });

  it("still lets the Franchise_Owner's profile fields be edited", async () => {
    H.reset({ ownerUserId: H.USER_ID });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Owner Renamed",
      mobile: "8888888888",
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates[0].full_name).toBe("Owner Renamed");
  });

  // ── Dietitian accounts are managed elsewhere ──────────────────────────────

  it("refuses to move a Dietitian out of the dietitian level", async () => {
    H.reset({ userAccessLevel: "dietitian" });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Dietitian",
      accessLevel: "operations",
      operationsAccess: { customers: "manage" },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("accessLevel");
    expect(H.calls.userUpdates).toEqual([]);
  });

  it("refuses a caller outside the full_network scope", async () => {
    H.reset({ scopeKind: "franchise" });
    const result = await updateFranchiseUser({ ...BASE(), fullName: "User" });
    expect(result.success).toBe(false);
    expect(H.calls.userUpdates).toEqual([]);
  });
});

describe("toggleFranchiseUserActive", () => {
  beforeEach(() => H.reset());

  it("deactivates and bans the Auth account", async () => {
    const result = await toggleFranchiseUserActive({
      ...BASE(),
      currentlyActive: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(false);
    expect(H.calls.userUpdates[0].is_active).toBe(false);
    // Without the ban the user could simply sign in again.
    expect(H.calls.authUpdates).toEqual([
      { id: "auth-1", payload: { ban_duration: "876600h" } },
    ]);
  });

  it("reactivates and unbans the Auth account", async () => {
    H.reset({ userIsActive: false });

    const result = await toggleFranchiseUserActive({
      ...BASE(),
      currentlyActive: false,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(true);
    expect(H.calls.userUpdates[0].is_active).toBe(true);
    expect(H.calls.authUpdates).toEqual([
      { id: "auth-1", payload: { ban_duration: "none" } },
    ]);
  });

  it("refuses to deactivate the Franchise_Owner", async () => {
    H.reset({ ownerUserId: H.USER_ID });

    const result = await toggleFranchiseUserActive({
      ...BASE(),
      currentlyActive: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Franchise Owner");
    // Deactivating the Owner would lock the franchise out of its own portal.
    expect(H.calls.userUpdates).toEqual([]);
    expect(H.calls.authUpdates).toEqual([]);
  });

  it("allows REACTIVATING the Franchise_Owner", async () => {
    H.reset({ ownerUserId: H.USER_ID, userIsActive: false });

    const result = await toggleFranchiseUserActive({
      ...BASE(),
      currentlyActive: false,
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates[0].is_active).toBe(true);
  });

  it("refuses a cross-franchise target", async () => {
    H.reset({ userFranchiseId: H.FRANCHISE_B });

    const result = await toggleFranchiseUserActive({
      ...BASE(),
      currentlyActive: true,
    });

    expect(result.success).toBe(false);
    expect(H.calls.userUpdates).toEqual([]);
    expect(H.calls.authUpdates).toEqual([]);
  });
});

describe("deleteFranchiseUser", () => {
  beforeEach(() => H.reset());

  it("removes the users row BEFORE the Auth account", async () => {
    const result = await deleteFranchiseUser(BASE());

    expect(result.success).toBe(true);
    expect(H.calls.userDeletes).toBe(1);
    // Deleting Auth first would leave an orphaned users row pointing at a
    // non-existent identity, which no guard can resolve.
    expect(H.calls.authDeletes).toEqual(["auth-1"]);
  });

  it("refuses to delete the Franchise_Owner", async () => {
    H.reset({ ownerUserId: H.USER_ID });

    const result = await deleteFranchiseUser(BASE());

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Franchise Owner");
    expect(H.calls.userDeletes).toBe(0);
    expect(H.calls.authDeletes).toEqual([]);
  });

  it("refuses a cross-franchise target", async () => {
    H.reset({ userFranchiseId: H.FRANCHISE_B });

    const result = await deleteFranchiseUser(BASE());

    expect(result.success).toBe(false);
    expect(H.calls.userDeletes).toBe(0);
    expect(H.calls.authDeletes).toEqual([]);
  });

  it("refuses a caller outside the full_network scope", async () => {
    H.reset({ scopeKind: "franchise" });
    const result = await deleteFranchiseUser(BASE());
    expect(result.success).toBe(false);
    expect(H.calls.userDeletes).toBe(0);
  });

  it("requires both ids", async () => {
    const noFranchise = await deleteFranchiseUser({
      franchiseId: "  ",
      userId: H.USER_ID,
    });
    expect(noFranchise.success).toBe(false);

    const noUser = await deleteFranchiseUser({
      franchiseId: H.FRANCHISE_A,
      userId: "  ",
    });
    expect(noUser.success).toBe(false);
    expect(H.calls.userDeletes).toBe(0);
  });
});

// ─── Rule 1b: the target must be franchise PORTAL staff ─────────────────────
//
// FOUND IN MANUAL TESTING. `users.franchise_id` is stamped on every user tied to
// a Franchise, INCLUDING its Customers (role `CUSTOMER`) and Riders (role
// `RIDER`) — that column is how their records are attributed to the tenant.
//
// `listFranchiseUsers` selected on `franchise_id` alone, so the master portal's
// Franchise Users roster listed a real paying Customer and a Rider next to the
// franchise's own staff, each rendered with a fabricated
// "Inventory + Operations (Full Access)" badge (their `admin_access_level` is
// NULL, and `resolveAccessLevel` maps NULL to the backward-compatible
// `DEFAULT_ACCESS_LEVEL`). Every row's Edit / Deactivate / Delete control was
// wired at them, and the write guard checked only tenancy and ownership — so
// Delete would have destroyed a Customer's account and Deactivate would have
// locked them out of `customer.arogyadiet.com`.
//
// These people are administered from the Customers and Riders sections and sign
// in on their own subdomains. The guard is asserted here, at the write path, and
// not merely in the list query, because hiding a row does not stop a replayed
// request from naming its id.

describe("Rule 1b: Customers and Riders are not manageable as franchise users", () => {
  beforeEach(() => H.reset());

  for (const [label, roleId] of [
    ["a Customer", "CUSTOMER_ROLE_ID"],
    ["a Rider", "RIDER_ROLE_ID"],
  ] as const) {
    it(`updateFranchiseUser refuses ${label} of the same franchise`, async () => {
      H.reset({ userRoleId: H[roleId] });

      const result = await updateFranchiseUser({
        ...BASE(),
        fullName: "Renamed",
        accessLevel: "inventory",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("not a franchise portal user");
      }
      expect(H.calls.userUpdates).toEqual([]);
      expect(H.calls.notifications).toEqual([]);
    });

    it(`toggleFranchiseUserActive refuses ${label} of the same franchise`, async () => {
      H.reset({ userRoleId: H[roleId] });

      const result = await toggleFranchiseUserActive({
        ...BASE(),
        currentlyActive: true,
      });

      expect(result.success).toBe(false);
      // The Auth account must not be banned — that is what would have locked a
      // real Customer out of their own portal.
      expect(H.calls.userUpdates).toEqual([]);
      expect(H.calls.authUpdates).toEqual([]);
    });

    it(`deleteFranchiseUser refuses ${label} of the same franchise`, async () => {
      H.reset({ userRoleId: H[roleId] });

      const result = await deleteFranchiseUser(BASE());

      expect(result.success).toBe(false);
      // The most destructive case: neither the users row nor the Auth identity
      // may be touched.
      expect(H.calls.userDeletes).toBe(0);
      expect(H.calls.authDeletes).toEqual([]);
    });
  }

  it("still permits a genuine franchise admin of the same franchise", async () => {
    // Guards the guard: the role check must not reject the users it exists to
    // protect. Without this, the three tests above would also pass if the
    // action simply refused everything.
    H.reset({ userRoleId: H.FRANCHISE_ADMIN_ROLE_ID });

    const result = await updateFranchiseUser({
      ...BASE(),
      fullName: "Legit Staff",
      accessLevel: "inventory",
    });

    expect(result.success).toBe(true);
    expect(H.calls.userUpdates).toHaveLength(1);
  });
});
