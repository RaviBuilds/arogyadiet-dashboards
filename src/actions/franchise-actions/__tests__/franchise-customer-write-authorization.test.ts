// src/actions/franchise-actions/__tests__/franchise-customer-write-authorization.test.ts
//
// franchise-scoped-access Tasks 1 + 3.
//
// Task 1 (characterize): the Franchise_Portal's customer-management wrappers in
// `franchiseCustomerManagementActions.ts` delegate to the ADMIN customer
// actions, and every one of those opens with `checkGroupManage("customers")`,
// which admits only `ADMIN` / `MASTER_ADMIN`:
//
//     if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
//       throw new GroupAccessDeniedError(group, false);
//     }
//
// A franchise user's role is `FRANCHISE_ADMIN`, so every franchise customer
// write is refused — including for the Franchise_Owner. The "franchise manage
// user CAN write" tests below are therefore RED until Task 3 lands.
//
// Task 3 (fix): the wrappers gain their own franchise gate and call the ungated
// cores extracted in Task 2, so they no longer traverse the admin gate.
//
// FIDELITY NOTE: this suite fakes ONLY session resolution (the Supabase
// clients). The REAL `getCurrentAdminContext` / `assertGroupManage` /
// `checkGroupManage` logic executes, so the bug reproduces for the real reason
// rather than a re-implemented approximation of it. That is also what makes the
// escalation test meaningful: it exercises the actual role check that is
// currently the only thing standing between a franchise session and an admin
// action.
//
// HOISTING NOTE: `admin-actions/customerActions.ts` builds its service-role
// client at MODULE LOAD, which under ESM happens before any module-level
// `const`/`class` in this file is initialised. All shared harness state
// therefore lives in a `vi.hoisted` block, which vitest lifts alongside the
// `vi.mock` factories.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
  const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

  interface SessionState {
    /** `public.users.id` of the signed-in caller. */
    userId: string;
    roleCode: string;
    adminAccessLevel: string | null;
    adminOperationsAccess: Record<string, string> | null;
    franchiseId: string | null;
    /** `franchises.owner_user_id`; equal to `userId` makes the caller the Owner. */
    franchiseOwnerUserId: string | null;
    franchiseStatus: string;
    /** `customer_profiles.franchise_id` of the write target. */
    targetCustomerFranchiseId: string | null;
    /**
     * `users.franchise_id` of the write target, as read back by `guardAuthUser`
     * / `guardEmail` through the ADMIN client.
     *
     * Kept separate from `franchiseId` (the CALLER's tenant, resolved through the
     * server client) so a cross-tenant target can be expressed at all. With one
     * shared `users` row the two were always equal by construction, which made
     * the tenancy conjunct of those guards untestable.
     */
    targetUserFranchiseId: string | null;
  }

  const defaults = (): SessionState => ({
    userId: "franchise-user-1",
    roleCode: "FRANCHISE_ADMIN",
    adminAccessLevel: "operations",
    adminOperationsAccess: { customers: "manage" },
    franchiseId: FRANCHISE_A,
    franchiseOwnerUserId: null,
    franchiseStatus: "active",
    targetCustomerFranchiseId: FRANCHISE_A,
    targetUserFranchiseId: FRANCHISE_A,
  });

  const state = {
    session: defaults(),
    serverWrites: [] as string[],
    adminWrites: [] as string[],
    serviceRoleWrites: [] as string[],
  };

  const reset = (overrides: Partial<SessionState> = {}) => {
    state.session = { ...defaults(), ...overrides };
    state.serverWrites.length = 0;
    state.adminWrites.length = 0;
    state.serviceRoleWrites.length = 0;
  };

  type Result = { data: unknown; error: unknown };

  /**
   * The `users` row shape every context resolver selects.
   *
   * @param usersFranchiseId Overrides `users.franchise_id`. The ADMIN client
   *   passes the TARGET's tenant here, because that client is what
   *   `guardAuthUser` / `guardEmail` use to look the target up; the server
   *   client omits it and so reports the CALLER's tenant, which is what the
   *   context resolvers need.
   */
  const rows = (usersFranchiseId?: string | null): Record<string, Result> => ({
    users: {
      data: {
        id: state.session.userId,
        admin_access_level: state.session.adminAccessLevel,
        admin_operations_access: state.session.adminOperationsAccess,
        admin_clinic_id: null,
        franchise_id:
          usersFranchiseId === undefined
            ? state.session.franchiseId
            : usersFranchiseId,
        dietitian_clinic_id: null,
        is_active: true,
        roles: { code: state.session.roleCode },
      },
      error: null,
    },
    franchises: {
      data: {
        status: state.session.franchiseStatus,
        owner_user_id: state.session.franchiseOwnerUserId,
        name: "Franchise A",
      },
      error: null,
    },
    customer_profiles: {
      data: {
        id: PROFILE_ID,
        franchise_id: state.session.targetCustomerFranchiseId,
      },
      error: null,
    },
  });

  /**
   * A chainable, awaitable stand-in for a PostgREST query builder. Every builder
   * method returns `this`; awaiting resolves to the table's configured row.
   * Mutations are recorded so a test can assert a denied write touched nothing.
   */
  class FakeQuery implements PromiseLike<Result> {
    constructor(
      private readonly table: string,
      private readonly result: Result,
      private readonly writeLog: string[],
    ) {}

    select() { return this; }
    eq() { return this; }
    neq() { return this; }
    in() { return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    single() { return this; }
    maybeSingle() { return this; }

    update() { this.writeLog.push(`${this.table}.update`); return this; }
    insert() { this.writeLog.push(`${this.table}.insert`); return this; }
    upsert() { this.writeLog.push(`${this.table}.upsert`); return this; }
    delete() { this.writeLog.push(`${this.table}.delete`); return this; }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  const makeClient = (
    writeLog: string[],
    usersFranchiseId?: string | null,
  ) => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "auth-user-1" } },
        error: null,
      }),
      admin: {
        updateUserById: async () => ({ data: null, error: null }),
        generateLink: async () => ({ data: null, error: null }),
        deleteUser: async () => ({ data: null, error: null }),
        createUser: async () => ({
          data: { user: { id: "auth-user-new" } },
          error: null,
        }),
        // `adminUpdateCustomerEmailCore` checks the new address is not already
        // taken. Empty list = available.
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
    storage: {
      from: () => ({
        remove: async () => ({ data: null, error: null }),
        upload: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
    // Rows resolve at query time, so a test may mutate `session` after the
    // client has already been constructed.
    from: (table: string) =>
      new FakeQuery(
        table,
        rows(usersFranchiseId)[table] ?? { data: null, error: null },
        writeLog,
      ),
  });

  return { FRANCHISE_A, FRANCHISE_B, PROFILE_ID, state, reset, makeClient };
});

// ─── Module mocks ────────────────────────────────────────────────────────────
//
// Only the CLIENTS are faked. `@/lib/auth/adminAccess` is deliberately NOT
// mocked, so the real authorization logic runs.

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => H.makeClient(H.state.serverWrites),
}));

// The ADMIN client is what the tenancy guards (`guardProfile`, `guardAuthUser`,
// `guardEmail`) use to look the TARGET row up, so its `users.franchise_id`
// reports the target's tenant rather than the caller's. Defaults to the same
// franchise, so every pre-existing test is unaffected.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    H.makeClient(H.state.adminWrites, H.state.session.targetUserFranchiseId),
}));

// The module-load service-role client inside `admin-actions/customerActions.ts`.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => H.makeClient(H.state.serviceRoleWrites),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock("@/services/emailService", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/customer/customerProfileNotifications", () => ({
  notifyAdminCustomerProfileUpdated: vi.fn(async () => {}),
  resolveUserIdFromProfile: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/franchise/context", () => ({
  resolveFranchiseContext: async () => ({
    role: H.state.session.roleCode,
    franchise_id: H.state.session.franchiseId,
    is_franchise_scoped: H.state.session.roleCode === "FRANCHISE_ADMIN",
  }),
}));

// ─── Subjects ────────────────────────────────────────────────────────────────

import {
  franchiseUpdateCustomerBasicInfo,
  franchiseDeleteCustomerCoupon,
  franchiseUpdateCustomerEmail,
} from "@/actions/franchise-actions/franchiseCustomerManagementActions";
import { updateCustomerBasicInfo } from "@/actions/admin-actions/customerActions";

const BASIC_INFO = {
  fullName: "Updated Name",
  mobile: "9999999999",
  gender: "male",
  dateOfBirth: "1990-01-01",
};

const NO_PERMISSION_MESSAGE =
  "You do not have permission to perform this action.";
const READ_ONLY_MESSAGE = "You have read-only access to this section.";

describe("franchise customer writes — authorization", () => {
  beforeEach(() => {
    H.reset();
  });

  // ── The fix (RED until Task 3) ─────────────────────────────────────────────

  it("a franchise user with customers=manage CAN update a customer in their franchise", async () => {
    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: true });
  });

  it("the Franchise_Owner CAN update a customer regardless of stored access level", async () => {
    // The Owner override: `franchises.owner_user_id === users.id` resolves to
    // full access whatever `admin_access_level` says (Req 21.6).
    H.reset({
      franchiseOwnerUserId: "franchise-user-1",
      adminAccessLevel: "operations",
      adminOperationsAccess: {},
    });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: true });
  });

  // ── Manage vs View enforcement (Req 4) ────────────────────────────────────

  it("a franchise user with customers=view is refused and writes nothing", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: false, error: READ_ONLY_MESSAGE });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("a franchise user without the customers group at all is refused and writes nothing", async () => {
    H.reset({ adminOperationsAccess: { riders: "manage" } });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: false, error: NO_PERMISSION_MESSAGE });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  // ── Tenancy, independent of permission level ──────────────────────────────

  it("rejects a customer belonging to a different franchise even with manage access", async () => {
    H.reset({ targetCustomerFranchiseId: H.FRANCHISE_B });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({
      success: false,
      error: "This customer does not belong to your franchise.",
    });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("rejects a caller with no franchise assigned", async () => {
    H.reset({ franchiseId: null });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({
      success: false,
      error: "No franchise is assigned to your account.",
    });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("refuses a caller whose franchise is suspended, even with manage access", async () => {
    // The franchise gate applies every eligibility rule the portal layout
    // applies, so a suspended tenant cannot write even though the caller's
    // stored Access_Level would otherwise permit it.
    H.reset({ franchiseStatus: "suspended" });

    const result = await franchiseUpdateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: false, error: NO_PERMISSION_MESSAGE });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  // ── Coupons went through the same broken path ─────────────────────────────

  it("a franchise user with customers=manage CAN delete a customer coupon", async () => {
    const result = await franchiseDeleteCustomerCoupon("coupon-1", H.PROFILE_ID);

    expect(result).toEqual({ success: true });
  });

  it("a franchise user with customers=view CANNOT delete a customer coupon", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseDeleteCustomerCoupon("coupon-1", H.PROFILE_ID);

    expect(result).toEqual({ success: false, error: READ_ONLY_MESSAGE });
    expect(H.state.adminWrites).not.toContain("coupons.delete");
  });

  // ── The escalation guard (GREEN now, MUST STAY GREEN) ─────────────────────

  it("SECURITY: a franchise session cannot invoke the admin customer action directly", async () => {
    // `Customer360Dashboard` is shared and imports the admin actions as
    // fallbacks for its `actions` prop, so their server-action ids are present
    // in the franchise client bundle and are directly invocable. The ONLY thing
    // preventing a cross-tenant write through that path is the admin gate's
    // role check — which is precisely why Task 2 extracts ungated cores instead
    // of teaching `checkGroupManage` to accept `FRANCHISE_ADMIN`.
    //
    // The admin action performs NO franchise ownership check of its own: if this
    // ever returns success for a FRANCHISE_ADMIN, that is an unrestricted
    // cross-tenant write.
    const result = await updateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: false, error: NO_PERMISSION_MESSAGE });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("SECURITY: the escalation guard holds even for a franchise Owner", async () => {
    H.reset({ franchiseOwnerUserId: "franchise-user-1" });

    const result = await updateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: false, error: NO_PERMISSION_MESSAGE });
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  // ── Core Business is unaffected ───────────────────────────────────────────

  it("a Core admin with manage access still writes through the admin action", async () => {
    H.reset({
      roleCode: "ADMIN",
      adminAccessLevel: "inventory_operations",
      adminOperationsAccess: null,
      franchiseId: null,
    });

    const result = await updateCustomerBasicInfo(
      H.PROFILE_ID,
      "user-1",
      BASIC_INFO,
    );

    expect(result).toEqual({ success: true });
    expect(H.state.serviceRoleWrites).toContain("users.update");
    expect(H.state.serviceRoleWrites).toContain("customer_profiles.update");
  });
});

// ─── franchiseUpdateCustomerEmail ────────────────────────────────────────────
//
// THE BUG THESE PIN: `Customer360Dashboard` accepts eleven injectable customer
// actions and the franchise portal overrode only TEN. `adminUpdateCustomerEmail`
// was the omission, so the shared component fell back to the ADMIN action, whose
// `checkGroupManage("customers")` admits only ADMIN / MASTER_ADMIN — a franchise
// admin editing a customer's email in the User Management tab was always refused.
//
// The fix extracts `adminUpdateCustomerEmailCore` (verbatim body, gate left
// behind in the admin action) and adds a franchise wrapper over it.
//
// GUARD CHOICE: `guardAuthUser`, not `guardEmail`. The identifier supplied is the
// customer's `auth_user_id`; the NEW address is by definition not yet on any row,
// so resolving the tenant by email would find nothing and refuse every
// legitimate change. The cross-tenant test below is what holds that choice in
// place.

describe("franchiseUpdateCustomerEmail", () => {
  const NEW_EMAIL = "updated.customer@example.com";
  const AUTH_USER_ID = "auth-user-1";

  beforeEach(() => {
    H.reset();
  });

  it("lets a franchise user with customers=manage change the email", () => {
    // The regression itself: this returned NO_PERMISSION before the wrapper
    // existed, because the admin action's role check rejected FRANCHISE_ADMIN.
    return franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL).then(
      (result) => {
        expect(result.success).toBe(true);
      },
    );
  });

  it("lets the Franchise_Owner change the email", async () => {
    // The Owner's access is derived from `franchises.owner_user_id`, not from
    // `admin_access_level`, so it must survive an empty group matrix.
    H.reset({
      adminAccessLevel: "operations",
      adminOperationsAccess: null,
      franchiseOwnerUserId: "franchise-user-1",
    });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL);
    expect(result.success).toBe(true);
  });

  it("refuses a view-only franchise user with the read-only message", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(READ_ONLY_MESSAGE);
    // Nothing may reach Auth or the users table on a denial.
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("refuses a franchise user with no access to the customers group", async () => {
    H.reset({ adminOperationsAccess: {} });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NO_PERMISSION_MESSAGE);
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("refuses a target user belonging to a DIFFERENT franchise", async () => {
    // Tenancy, checked independently of permission. Without this the wrapper
    // would happily rewrite the login email of another tenant's customer.
    H.reset({ targetUserFranchiseId: H.FRANCHISE_B });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "This customer does not belong to your franchise.",
      );
    }
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("refuses a caller with no franchise assigned", async () => {
    H.reset({ franchiseId: null });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, NEW_EMAIL);
    expect(result.success).toBe(false);
    expect(H.state.serviceRoleWrites).toEqual([]);
  });

  it("rejects a malformed email, carrying the admin validation over verbatim", async () => {
    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, "not-an-email");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Invalid email format");
  });

  it("checks permission and tenancy BEFORE validating the email", async () => {
    // Order matters: a view-only caller must not be able to distinguish
    // "malformed address" from "not allowed", which would leak that the gate was
    // passed. Both denials must report the permission failure.
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseUpdateCustomerEmail(AUTH_USER_ID, "not-an-email");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(READ_ONLY_MESSAGE);
  });
});
