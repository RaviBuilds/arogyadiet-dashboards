// src/test/inventory/warehouse-access-guard.test.ts
//
// Unit tests for the warehouse access guard functions (assertWarehouseAccess,
// checkWarehouseAccess) in src/lib/auth/adminAccess.ts.
//
// Requirements: 6.3

import { describe, it, expect, beforeEach, vi } from "vitest";

// `server-only` throws if imported outside an RSC bundle; stub it for tests.
vi.mock("server-only", () => ({}));

// redirect() normally throws a Next.js control-flow signal; stub it.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Controllable fake Supabase SSR client.
const getUserMock = vi.fn();
const singleMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ single: singleMock }) }),
    }),
  }),
}));

import {
  assertWarehouseAccess,
  checkWarehouseAccess,
  WarehouseAccessDeniedError,
} from "@/lib/auth/adminAccess";
import type { OperationsAccess } from "@/lib/auth/adminAccessCore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setContext(
  roleCode: string | null,
  level: string | null,
  groups?: OperationsAccess | null,
) {
  if (roleCode === null) {
    getUserMock.mockResolvedValue({ data: { user: null } });
    return;
  }
  getUserMock.mockResolvedValue({ data: { user: { id: "auth-1" } } });
  singleMock.mockResolvedValue({
    data: {
      id: "user-1",
      admin_access_level: level,
      admin_operations_access: groups ?? null,
      roles: { code: roleCode },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── checkWarehouseAccess ─────────────────────────────────────────────────────

describe("checkWarehouseAccess", () => {
  describe("MASTER_ADMIN", () => {
    it("allows inventory_operations", async () => {
      setContext("MASTER_ADMIN", null);
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({ ok: true });
    });

    it("allows product_management", async () => {
      setContext("MASTER_ADMIN", null);
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({ ok: true });
    });
  });

  describe("ADMIN with inventory access", () => {
    it("allows inventory_operations", async () => {
      setContext("ADMIN", "inventory");
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({ ok: true });
    });

    it("denies product_management", async () => {
      setContext("ADMIN", "inventory");
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });
  });

  describe("ADMIN with inventory_operations (full) access", () => {
    it("allows inventory_operations", async () => {
      setContext("ADMIN", "inventory_operations");
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({ ok: true });
    });

    it("denies product_management", async () => {
      setContext("ADMIN", "inventory_operations");
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });
  });

  describe("ADMIN without inventory access (operations-only)", () => {
    it("denies inventory_operations", async () => {
      setContext("ADMIN", "operations");
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });

    it("denies product_management", async () => {
      setContext("ADMIN", "operations");
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });
  });

  describe("RIDER role (unauthorized)", () => {
    it("denies inventory_operations", async () => {
      setContext("RIDER", null);
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });

    it("denies product_management", async () => {
      setContext("RIDER", null);
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });
  });

  describe("null roleCode (no session)", () => {
    it("denies inventory_operations", async () => {
      setContext(null, null);
      const result = await checkWarehouseAccess("inventory_operations");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });

    it("denies product_management", async () => {
      setContext(null, null);
      const result = await checkWarehouseAccess("product_management");
      expect(result).toEqual({
        ok: false,
        error: "You do not have permission to perform this action.",
      });
    });
  });

  it("returns exactly the expected denial error string", async () => {
    setContext("RIDER", null);
    const result = await checkWarehouseAccess("inventory_operations");
    expect(result).toHaveProperty("ok", false);
    if (!result.ok) {
      expect(result.error).toBe(
        "You do not have permission to perform this action.",
      );
    }
  });
});

// ─── assertWarehouseAccess ────────────────────────────────────────────────────

describe("assertWarehouseAccess", () => {
  it("resolves without throwing for MASTER_ADMIN (inventory_operations)", async () => {
    setContext("MASTER_ADMIN", null);
    await expect(
      assertWarehouseAccess("inventory_operations"),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for MASTER_ADMIN (product_management)", async () => {
    setContext("MASTER_ADMIN", null);
    await expect(
      assertWarehouseAccess("product_management"),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for ADMIN with inventory access (inventory_operations)", async () => {
    setContext("ADMIN", "inventory");
    await expect(
      assertWarehouseAccess("inventory_operations"),
    ).resolves.toBeUndefined();
  });

  it("throws WarehouseAccessDeniedError for ADMIN attempting product_management", async () => {
    setContext("ADMIN", "inventory");
    await expect(
      assertWarehouseAccess("product_management"),
    ).rejects.toThrow(WarehouseAccessDeniedError);

    setContext("ADMIN", "inventory");
    await expect(
      assertWarehouseAccess("product_management"),
    ).rejects.toMatchObject({
      name: "WarehouseAccessDeniedError",
      capability: "product_management",
    });
  });

  it("throws WarehouseAccessDeniedError for ADMIN without inventory access", async () => {
    setContext("ADMIN", "operations");
    await expect(
      assertWarehouseAccess("inventory_operations"),
    ).rejects.toThrow(WarehouseAccessDeniedError);
  });

  it("throws WarehouseAccessDeniedError for RIDER", async () => {
    setContext("RIDER", null);
    await expect(
      assertWarehouseAccess("inventory_operations"),
    ).rejects.toThrow(WarehouseAccessDeniedError);

    setContext("RIDER", null);
    await expect(
      assertWarehouseAccess("product_management"),
    ).rejects.toThrow(WarehouseAccessDeniedError);
  });

  it("throws WarehouseAccessDeniedError when no session (null roleCode)", async () => {
    setContext(null, null);
    await expect(
      assertWarehouseAccess("inventory_operations"),
    ).rejects.toThrow(WarehouseAccessDeniedError);

    setContext(null, null);
    await expect(
      assertWarehouseAccess("product_management"),
    ).rejects.toThrow(WarehouseAccessDeniedError);
  });
});
