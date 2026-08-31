// src/lib/auth/__tests__/dietitianGuards.test.ts
//
// Unit tests for the server-only Dietitian guards (dietitian-management,
// Task 3.4). The Supabase SSR client and next/navigation are mocked so the
// guards run without a session or a live database.
//
// Validates: Requirements 5.3, 5.8, 5.9, 5.10, 16.5

import { describe, it, expect, beforeEach, vi } from "vitest";

// `server-only` throws if imported outside an RSC bundle; stub it for tests.
vi.mock("server-only", () => ({}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Controllable fake Supabase SSR client: `users` resolves via .single(),
// `customer_profiles` via .maybeSingle().
const getUserMock = vi.fn();
const userRowMock = vi.fn();
const customerRowMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: userRowMock,
          maybeSingle:
            table === "customer_profiles" ? customerRowMock : userRowMock,
        }),
      }),
    }),
  }),
}));

import {
  getCurrentDietitianContext,
  guardDietitianPage,
  checkDietitianScope,
  assertDietitianScope,
  dietitianScopeFromContext,
} from "../adminAccess";
import { CUSTOMER_NOT_IN_SCOPE } from "@/lib/dietitian/messages";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ME = "11111111-1111-4111-8111-111111111111";
const CLINIC = "22222222-2222-4222-8222-222222222222";
const FRANCHISE = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

function setUser(
  row:
    | null
    | {
        roleCode: string;
        level: string | null;
        franchiseId?: string | null;
        clinicId?: string | null;
        isActive?: boolean;
      },
) {
  if (row === null) {
    getUserMock.mockResolvedValue({ data: { user: null } });
    return;
  }
  getUserMock.mockResolvedValue({ data: { user: { id: "auth-1" } } });
  userRowMock.mockResolvedValue({
    data: {
      id: ME,
      admin_access_level: row.level,
      franchise_id: row.franchiseId ?? null,
      dietitian_clinic_id: row.clinicId ?? null,
      is_active: row.isActive ?? true,
      roles: { code: row.roleCode },
    },
  });
}

function setCustomer(
  row: null | {
    clinic_id?: string | null;
    franchise_id?: string | null;
    dietitian_id?: string | null;
  },
) {
  customerRowMock.mockResolvedValue({
    data:
      row === null
        ? null
        : {
            id: CUSTOMER,
            clinic_id: row.clinic_id ?? null,
            franchise_id: row.franchise_id ?? null,
            dietitian_id: row.dietitian_id ?? null,
          },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getCurrentDietitianContext (mirrors current_dietitian()) ─────────────────

describe("getCurrentDietitianContext", () => {
  it("returns null when there is no session", async () => {
    setUser(null);
    expect(await getCurrentDietitianContext()).toBeNull();
  });

  it("returns null for a non-dietitian access level", async () => {
    setUser({ roleCode: "ADMIN", level: "inventory_operations" });
    expect(await getCurrentDietitianContext()).toBeNull();
  });

  it("returns null for a NULL access level (coerced to full access)", async () => {
    setUser({ roleCode: "ADMIN", level: null });
    expect(await getCurrentDietitianContext()).toBeNull();
  });

  it("returns null for a deactivated dietitian", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", isActive: false });
    expect(await getCurrentDietitianContext()).toBeNull();
  });

  it("returns null for a non-dietitian role code", async () => {
    setUser({ roleCode: "RIDER", level: "dietitian" });
    expect(await getCurrentDietitianContext()).toBeNull();
  });

  it("resolves a core dietitian with its clinic link", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    expect(await getCurrentDietitianContext()).toEqual({
      userId: ME,
      roleCode: "ADMIN",
      clinicId: CLINIC,
      franchiseId: null,
    });
  });

  it("resolves a franchise dietitian", async () => {
    setUser({
      roleCode: "FRANCHISE_ADMIN",
      level: "dietitian",
      franchiseId: FRANCHISE,
    });
    expect(await getCurrentDietitianContext()).toEqual({
      userId: ME,
      roleCode: "FRANCHISE_ADMIN",
      clinicId: null,
      franchiseId: FRANCHISE,
    });
  });
});

// ─── dietitianScopeFromContext ───────────────────────────────────────────────

describe("dietitianScopeFromContext", () => {
  it("maps a core context to a core scope", () => {
    expect(
      dietitianScopeFromContext({
        userId: ME,
        roleCode: "ADMIN",
        clinicId: CLINIC,
        franchiseId: null,
      }),
    ).toEqual({ kind: "core", dietitianUserId: ME, clinicId: CLINIC });
  });

  it("maps a franchise context to a tenant scope", () => {
    expect(
      dietitianScopeFromContext({
        userId: ME,
        roleCode: "FRANCHISE_ADMIN",
        clinicId: CLINIC,
        franchiseId: FRANCHISE,
      }),
    ).toEqual({ kind: "franchise", dietitianUserId: ME, franchiseId: FRANCHISE });
  });
});

// ─── guardDietitianPage (redirect-style, Req 5.3) ─────────────────────────────

describe("guardDietitianPage", () => {
  it("redirects a non-dietitian to /unauthorized", async () => {
    setUser({ roleCode: "ADMIN", level: "operations" });
    await expect(guardDietitianPage()).rejects.toThrow("REDIRECT:/unauthorized");
  });

  it("returns the context for a dietitian", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    await expect(guardDietitianPage()).resolves.toMatchObject({ userId: ME });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects a franchise dietitian asking for an admin-portal page", async () => {
    setUser({
      roleCode: "FRANCHISE_ADMIN",
      level: "dietitian",
      franchiseId: FRANCHISE,
    });
    await expect(guardDietitianPage("/admin")).rejects.toThrow(
      "REDIRECT:/unauthorized",
    );
  });

  it("permits a franchise dietitian on the franchise portal", async () => {
    setUser({
      roleCode: "FRANCHISE_ADMIN",
      level: "dietitian",
      franchiseId: FRANCHISE,
    });
    await expect(guardDietitianPage("/franchise")).resolves.toMatchObject({
      roleCode: "FRANCHISE_ADMIN",
    });
  });
});

// ─── checkDietitianScope (Req 5.8, 5.9, 5.10, 16.5) ──────────────────────────

describe("checkDietitianScope", () => {
  it("denies a non-dietitian caller with a no-permission message", async () => {
    setUser({ roleCode: "ADMIN", level: "inventory_operations" });
    const r = await checkDietitianScope(CUSTOMER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permission/i);
  });

  it("denies a malformed customer id without a round trip", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    const r = await checkDietitianScope("not-a-uuid");
    expect(r).toEqual({ ok: false, error: CUSTOMER_NOT_IN_SCOPE });
    expect(customerRowMock).not.toHaveBeenCalled();
  });

  it("denies an unreadable / missing row with the pinned message", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer(null);
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });
  });

  it("denies a customer of another clinic and dietitian (Req 5.9)", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer({ clinic_id: OTHER, dietitian_id: OTHER });
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });
  });

  it("permits a customer linked to the dietitian", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer({ clinic_id: OTHER, dietitian_id: ME });
    const r = await checkDietitianScope(CUSTOMER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.userId).toBe(ME);
  });

  it("denies a clinic-mate the dietitian is not assigned to (assignment-only scope)", async () => {
    // SECURITY: a Core Dietitian reads ONLY their assigned customers. Sharing
    // the linked Clinic no longer grants read scope.
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer({ clinic_id: CLINIC, dietitian_id: OTHER });
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });
  });

  it("denies clinic membership when the dietitian has no clinic link (Req 4.4)", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: null });
    setCustomer({ clinic_id: CLINIC });
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });
  });

  it("scopes a franchise dietitian to its own tenant only", async () => {
    setUser({
      roleCode: "FRANCHISE_ADMIN",
      level: "dietitian",
      franchiseId: FRANCHISE,
      clinicId: CLINIC,
    });
    // UPDATED by franchise-scoped-access Task 11: a Franchise Dietitian now
    // needs BOTH the tenant AND the Dietitian_Link. The tenant alone used to
    // suffice, which was equivalent to "their own customers" only while a
    // Franchise was capped at one Dietitian; with a team it would expose every
    // colleague's customers.
    setCustomer({ franchise_id: FRANCHISE, dietitian_id: ME });
    expect((await checkDietitianScope(CUSTOMER)).ok).toBe(true);

    // Same tenant, NOT linked to this Dietitian — the colleague-isolation case.
    setCustomer({ franchise_id: FRANCHISE, dietitian_id: null });
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });

    // Linked but out of tenant — the link alone must not defeat the tenant check.
    setCustomer({ franchise_id: OTHER, dietitian_id: ME, clinic_id: CLINIC });
    expect(await checkDietitianScope(CUSTOMER)).toEqual({
      ok: false,
      error: CUSTOMER_NOT_IN_SCOPE,
    });
  });
});

// ─── assertDietitianScope (throw-style twin) ──────────────────────────────────

describe("assertDietitianScope", () => {
  it("throws DietitianScopeError with the pinned message on a scope miss", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer({ clinic_id: OTHER });
    await expect(assertDietitianScope(CUSTOMER)).rejects.toMatchObject({
      name: "DietitianScopeError",
      message: CUSTOMER_NOT_IN_SCOPE,
    });
  });

  it("returns the context when the customer is in scope", async () => {
    setUser({ roleCode: "ADMIN", level: "dietitian", clinicId: CLINIC });
    setCustomer({ clinic_id: CLINIC, dietitian_id: ME });
    await expect(assertDietitianScope(CUSTOMER)).resolves.toMatchObject({
      userId: ME,
    });
  });
});
