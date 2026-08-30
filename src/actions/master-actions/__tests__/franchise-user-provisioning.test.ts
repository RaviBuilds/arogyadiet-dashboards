// src/actions/master-actions/__tests__/franchise-user-provisioning.test.ts
//
// franchise-scoped-access Task 6.
//
// `createFranchiseUser` accepted an `accessLevel` but wrote ONLY that column,
// silently discarding the per-group matrix. An `operations`-level franchise user
// therefore resolved to `groups: {}`, `hasGroupAccess` was false for every
// group, and they could reach nothing beyond their landing route — i.e. the
// "Operations only" access level was non-functional for franchises.
//
// These tests pin that the matrix is persisted, that validation happens BEFORE
// any write (so a rejected submission leaves no orphaned auth user), and that
// the `franchises` group and `admin_clinic_id` can never be set for a franchise
// user.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_ID = "11111111-1111-4111-8111-111111111111";

  const state = {
    scopeKind: "full_network" as string,
    hasSession: true,
    franchiseExists: true,
    /** Existing `users` row matched by email, if any. */
    existingUser: null as { id: string; is_active: boolean } | null,
  };

  const defaults = { ...state };
  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.insertedUserRows.length = 0;
    calls.createdAuthEmails.length = 0;
    calls.deletedAuthUserIds.length = 0;
    calls.filters.length = 0;
  };

  const calls = {
    insertedUserRows: [] as Record<string, unknown>[],
    createdAuthEmails: [] as string[],
    deletedAuthUserIds: [] as string[],
    /**
     * Every `.eq(column, value)` applied, tagged with its table. Needed because
     * a missing FILTER is invisible to a fake that returns canned rows: the
     * roster query has to be checked by what it asked for, not by what it got.
     */
    filters: [] as { table: string; column: string; value: unknown }[],
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    private result: Result = { data: null, error: null };
    /**
     * Supabase inserts read as `.insert(...).select("id").single()`, so
     * `select()` runs AFTER `insert()`. Without this flag the read branch of
     * `select()` would clobber the insert's returned row.
     */
    private isInsert = false;

    constructor(private readonly table: string) {}

    select() {
      if (this.isInsert) return this;
      if (this.table === "roles") {
        this.result = { data: { id: "role-franchise-admin" }, error: null };
      } else if (this.table === "users") {
        this.result = { data: state.existingUser, error: null };
      } else if (this.table === "franchises") {
        this.result = { data: { owner_user_id: null }, error: null };
      }
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.isInsert = true;
      if (this.table === "users") {
        calls.insertedUserRows.push(payload);
        this.result = { data: { id: "new-user-1" }, error: null };
      }
      return this;
    }
    eq(column?: string, value?: unknown) {
      if (typeof column === "string") {
        calls.filters.push({ table: this.table, column, value });
      }
      return this;
    }
    order() { return this; }
    single() { return this; }
    maybeSingle() { return this; }

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
        createUser: async ({ email }: { email: string }) => {
          calls.createdAuthEmails.push(email);
          return { data: { user: { id: "auth-new-1" } }, error: null };
        },
        deleteUser: async (id: string) => {
          calls.deletedAuthUserIds.push(id);
          return { data: null, error: null };
        },
      },
    },
  };

  const serverClient = {
    auth: {
      getUser: async () => ({
        data: { user: state.hasSession ? { id: "auth-master-1" } : null },
        error: null,
      }),
    },
  };

  return { FRANCHISE_ID, state, reset, calls, adminClient, serverClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.adminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => H.serverClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/franchise/constants", () => ({
  FRANCHISE_FEATURES_ENABLED: true,
}));
vi.mock("@/lib/auth/scope-resolver", () => ({
  resolveScope: async () => ({
    ok: true,
    scope: { kind: H.state.scopeKind },
  }),
}));
vi.mock("@/repositories/franchise/franchiseRepository", () => ({
  getFranchiseById: async () =>
    H.state.franchiseExists ? { id: H.FRANCHISE_ID, name: "Franchise A" } : null,
}));
vi.mock("@/repositories/franchise/franchiseClinicRepository", () => ({
  listClinicsByFranchise: async () => [],
}));
vi.mock("@/services/DietitianAccountService", () => ({
  createDietitian: vi.fn(),
}));

import {
  createFranchiseUser,
  listFranchiseUsers,
} from "@/actions/master-actions/franchiseUserActions";
// Imported from the pure core, NOT from the `"use server"` action module: that
// module may export async functions only (see the note beside the zod schema in
// `franchiseUserActions.ts`).
import { FRANCHISE_USER_ACCESS_LEVELS } from "@/lib/auth/adminAccessCore";

const BASE_INPUT = {
  franchiseId: "11111111-1111-4111-8111-111111111111",
  fullName: "Ops User",
  email: "ops@example.com",
  password: "supersecret",
};

/** The single `users` row the action inserted. */
function insertedRow() {
  expect(H.calls.insertedUserRows).toHaveLength(1);
  return H.calls.insertedUserRows[0];
}

describe("createFranchiseUser — access level and group matrix", () => {
  beforeEach(() => {
    H.reset();
  });

  it("persists the group matrix for the operations level", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
      operationsAccess: { customers: "manage", riders: "view" },
    });

    expect(result.success).toBe(true);
    expect(insertedRow().admin_access_level).toBe("operations");
    expect(insertedRow().admin_operations_access).toEqual({
      customers: "manage",
      riders: "view",
    });
  });

  it("stores null for inventory_operations, which carries no per-group config", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory_operations",
      // Even if a matrix is submitted, a non-operations level discards it.
      operationsAccess: { customers: "manage" },
    });

    expect(result.success).toBe(true);
    expect(insertedRow().admin_operations_access).toBeNull();
  });

  it("stores null for the inventory level", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory",
    });

    expect(result.success).toBe(true);
    expect(insertedRow().admin_operations_access).toBeNull();
  });

  it("defaults to inventory_operations when no level is given", async () => {
    const result = await createFranchiseUser(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(insertedRow().admin_access_level).toBe("inventory_operations");
    expect(insertedRow().admin_operations_access).toBeNull();
  });

  it("never sets admin_clinic_id for a franchise user", async () => {
    await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
      operationsAccess: { customers: "manage" },
    });

    // One Franchise owns exactly one Clinic, and the DB restricts this column
    // to Core Clinics, so it must never appear on a franchise insert.
    expect(insertedRow()).not.toHaveProperty("admin_clinic_id");
  });

  it("stamps role FRANCHISE_ADMIN, the franchise id, and a forced password change", async () => {
    await createFranchiseUser({ ...BASE_INPUT, accessLevel: "operations", operationsAccess: { customers: "view" } });

    const row = insertedRow();
    expect(row.role_id).toBe("role-franchise-admin");
    expect(row.franchise_id).toBe(H.FRANCHISE_ID);
    expect(row.force_password_change).toBe(true);
    expect(row.is_active).toBe(true);
  });

  // ── Rejections, all BEFORE any write ──────────────────────────────────────

  it("rejects the franchises group and writes nothing", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
      operationsAccess: { customers: "manage", franchises: "manage" } as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not available to a franchise user");
      expect(result.field).toBe("operationsAccess");
    }
    // Validation precedes auth-user creation, so nothing is left behind.
    expect(H.calls.createdAuthEmails).toEqual([]);
    expect(H.calls.insertedUserRows).toEqual([]);
    expect(H.calls.deletedAuthUserIds).toEqual([]);
  });

  it("rejects an empty group selection on the operations level", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
      operationsAccess: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Select at least one operations group");
    }
    expect(H.calls.createdAuthEmails).toEqual([]);
  });

  it("rejects an operations level submitted with no matrix at all", async () => {
    // This is the case that used to succeed and produce an unusable account.
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
    });

    expect(result.success).toBe(false);
    expect(H.calls.insertedUserRows).toEqual([]);
  });

  it("rejects an invalid permission value", async () => {
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "operations",
      operationsAccess: { customers: "sometimes" } as never,
    });

    expect(result.success).toBe(false);
    expect(H.calls.createdAuthEmails).toEqual([]);
  });

  it("rejects the dietitian level on this generic path", async () => {
    // A Franchise Dietitian carries extra invariants (clinic auto-assignment)
    // that only `createFranchiseDietitian` enforces.
    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "dietitian",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("accessLevel");
    expect(H.calls.createdAuthEmails).toEqual([]);
  });

  it("excludes dietitian from the offered levels", () => {
    expect(FRANCHISE_USER_ACCESS_LEVELS).not.toContain("dietitian");
    expect([...FRANCHISE_USER_ACCESS_LEVELS].sort()).toEqual([
      "inventory",
      "inventory_operations",
      "operations",
    ]);
  });

  it("refuses a caller outside the full_network scope", async () => {
    H.reset({ scopeKind: "franchise" });

    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    expect(H.calls.createdAuthEmails).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    H.reset({ hasSession: false });

    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Unauthorized");
  });

  it("refuses when the target franchise does not exist", async () => {
    H.reset({ franchiseExists: false });

    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("franchiseId");
    expect(H.calls.createdAuthEmails).toEqual([]);
  });

  it("refuses a duplicate active email", async () => {
    H.reset({ existingUser: { id: "existing-1", is_active: true } });

    const result = await createFranchiseUser({
      ...BASE_INPUT,
      accessLevel: "inventory",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("email");
    expect(H.calls.createdAuthEmails).toEqual([]);
  });
});

describe("listFranchiseUsers", () => {
  beforeEach(() => {
    H.reset();
  });

  it("refuses a caller outside the full_network scope", async () => {
    H.reset({ scopeKind: "franchise" });
    const result = await listFranchiseUsers(H.FRANCHISE_ID);
    expect(result.success).toBe(false);
  });

  it("requires a franchise id", async () => {
    const result = await listFranchiseUsers("   ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("franchiseId");
  });

  it("restricts the roster to FRANCHISE_ADMIN rows, not every user of the tenant", async () => {
    // FOUND IN MANUAL TESTING. `users.franchise_id` is stamped on a Franchise's
    // Customers and Riders as well as its portal staff, so filtering on the
    // tenant alone listed a real Customer and a Rider in the master portal's
    // Franchise Users roster — each carrying a fabricated
    // "Inventory + Operations (Full Access)" badge, because `resolveAccessLevel`
    // maps their NULL `admin_access_level` to `DEFAULT_ACCESS_LEVEL` — with live
    // Edit / Deactivate / Delete controls pointed at them.
    const result = await listFranchiseUsers(H.FRANCHISE_ID);
    expect(result.success).toBe(true);

    const userFilters = H.calls.filters.filter((f) => f.table === "users");

    expect(userFilters).toEqual(
      expect.arrayContaining([
        { table: "users", column: "franchise_id", value: H.FRANCHISE_ID },
        { table: "users", column: "role_id", value: "role-franchise-admin" },
      ]),
    );

    // The role id must come from a `roles` lookup rather than being assumed, so
    // the filter cannot silently match nothing if ids differ per environment.
    expect(H.calls.filters).toEqual(
      expect.arrayContaining([
        { table: "roles", column: "code", value: "FRANCHISE_ADMIN" },
      ]),
    );
  });
});
