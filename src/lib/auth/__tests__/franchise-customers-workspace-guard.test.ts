// src/lib/auth/__tests__/franchise-customers-workspace-guard.test.ts
//
// franchise-scoped-access Task 5.
//
// `guardFranchiseCustomersWorkspace` exists because the obvious implementation
// is broken in a way that is easy to miss:
//
//   `hasGroupAccess(config, "customers")` is FALSE for the `dietitian` level by
//   design (a Dietitian is granted no Operations_Group; their reachability comes
//   from DIETITIAN_ALLOWED_PREFIXES). And `landingRouteFor("dietitian")` is
//   "/customers". So gating the franchise customers page with the plain
//   `guardFranchiseGroupAccess("customers")` would redirect a franchise
//   Dietitian to the page they were already requesting — an INFINITE REDIRECT
//   LOOP, not merely a lockout.
//
// The loop-freedom assertion below is therefore the most important test in this
// file. It also pins that `guardFranchiseGroupAccess` KEEPS excluding
// Dietitians, since the Dietitian Activity pages depend on that.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_ID = "11111111-1111-4111-8111-111111111111";

  const state = {
    hasSession: true,
    roleCode: "FRANCHISE_ADMIN" as string | null,
    adminAccessLevel: "operations" as string | null,
    adminOperationsAccess: { customers: "manage" } as Record<
      string,
      string
    > | null,
    franchiseId: FRANCHISE_ID as string | null,
    franchiseOwnerUserId: null as string | null,
    franchiseStatus: "active",
    userId: "franchise-user-1",
  };

  const defaults = { ...state };
  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    constructor(private readonly result: Result) {}
    select() { return this; }
    eq() { return this; }
    single() { return this; }
    maybeSingle() { return this; }
    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  const rows = (): Record<string, Result> => ({
    users: {
      data: {
        id: state.userId,
        franchise_id: state.franchiseId,
        admin_access_level: state.adminAccessLevel,
        admin_operations_access: state.adminOperationsAccess,
        roles: state.roleCode ? { code: state.roleCode } : null,
      },
      error: null,
    },
    franchises: {
      data: {
        status: state.franchiseStatus,
        owner_user_id: state.franchiseOwnerUserId,
      },
      error: null,
    },
  });

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: state.hasSession ? { id: "auth-user-1" } : null },
        error: null,
      }),
    },
    from: (table: string) =>
      new FakeQuery(rows()[table] ?? { data: null, error: null }),
  };

  /** Records where a guard tried to send the caller. */
  const redirects: string[] = [];

  return { FRANCHISE_ID, state, reset, client, redirects };
});

// `redirect()` throws in Next.js to unwind rendering. Model that faithfully so a
// guard cannot "fall through" past a redirect, and so the target is observable.
class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
    this.name = "RedirectSignal";
  }
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    H.redirects.push(target);
    throw new RedirectSignal(target);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => H.client,
}));

import {
  guardFranchiseCustomersWorkspace,
  guardFranchiseGroupAccess,
} from "@/lib/auth/adminAccess";

/** Runs a guard and reports either its value or the redirect it attempted. */
async function run<T>(
  guard: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; redirectedTo: string }> {
  try {
    return { ok: true, value: await guard() };
  } catch (err) {
    if (err instanceof RedirectSignal) {
      return { ok: false, redirectedTo: err.target };
    }
    throw err;
  }
}

describe("guardFranchiseCustomersWorkspace", () => {
  beforeEach(() => {
    H.reset();
    H.redirects.length = 0;
  });

  // ── The loop bug this guard exists to avoid ───────────────────────────────

  it("admits a franchise Dietitian instead of redirecting them (no redirect loop)", async () => {
    H.reset({ adminAccessLevel: "dietitian", adminOperationsAccess: null });

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(true);
    // The load-bearing assertion: NO redirect was attempted at all. Had this
    // used the plain group guard, the target would have been "/customers" —
    // the page being requested — looping forever.
    expect(H.redirects).toEqual([]);
    if (result.ok) {
      expect(result.value.isDietitian).toBe(true);
      // A Dietitian is read-only: they never gain write access from this guard.
      expect(result.value.canManage).toBe(false);
      expect(result.value.franchiseId).toBe(H.FRANCHISE_ID);
    }
  });

  it("never redirects a Dietitian to their own landing route from this guard", async () => {
    H.reset({ adminAccessLevel: "dietitian", adminOperationsAccess: null });
    await run(() => guardFranchiseCustomersWorkspace());
    expect(H.redirects).not.toContain("/customers");
  });

  it("by contrast, guardFranchiseGroupAccess still EXCLUDES a Dietitian", async () => {
    // Pinned deliberately: the Dietitian Activity pages rely on this exclusion,
    // so the two guards must not be unified.
    H.reset({ adminAccessLevel: "dietitian", adminOperationsAccess: null });

    const result = await run(() => guardFranchiseGroupAccess("customers"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectedTo).toBe("/customers");
  });

  // ── Permission resolution ─────────────────────────────────────────────────

  it("grants canManage to a franchise user holding customers=manage", async () => {
    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canManage).toBe(true);
      expect(result.value.isDietitian).toBe(false);
      expect(result.value.franchiseId).toBe(H.FRANCHISE_ID);
      expect(result.value.userId).toBe("franchise-user-1");
    }
  });

  it("admits a view-only franchise user but withholds canManage", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.canManage).toBe(false);
    expect(H.redirects).toEqual([]);
  });

  it("redirects a franchise user who lacks the customers group entirely", async () => {
    H.reset({ adminOperationsAccess: { riders: "manage" } });

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(false);
    // landingRouteFor("operations") — their own home, not this page.
    if (!result.ok) expect(result.redirectedTo).toBe("/dashboard");
  });

  it("treats the Franchise_Owner as full access regardless of stored level", async () => {
    H.reset({
      franchiseOwnerUserId: "franchise-user-1",
      adminAccessLevel: "operations",
      adminOperationsAccess: {},
    });

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canManage).toBe(true);
      expect(result.value.config.level).toBe("inventory_operations");
    }
  });

  it("resolves franchiseId from the caller's users row, not a cookie", async () => {
    // The page previously trusted an `x-franchise-id` cookie; the guard reads
    // the authenticated user's own row instead.
    const result = await run(() => guardFranchiseCustomersWorkspace());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.franchiseId).toBe(H.FRANCHISE_ID);
  });

  // ── Eligibility rejections ────────────────────────────────────────────────

  it.each([
    ["no session", { hasSession: false }],
    ["a non-franchise role", { roleCode: "ADMIN" }],
    ["no role at all", { roleCode: null }],
    ["no franchise assigned", { franchiseId: null }],
    ["a suspended franchise", { franchiseStatus: "suspended" }],
  ])("redirects to /unauthorized for %s", async (_label, overrides) => {
    H.reset(overrides as Record<string, unknown>);

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectedTo).toBe("/unauthorized");
  });

  it("refuses a suspended franchise even for the Owner", async () => {
    H.reset({
      franchiseStatus: "suspended",
      franchiseOwnerUserId: "franchise-user-1",
    });

    const result = await run(() => guardFranchiseCustomersWorkspace());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectedTo).toBe("/unauthorized");
  });
});
