// src/lib/auth/__tests__/adminAccessGuards.test.ts
//
// Unit tests for the server-only group-scoped guards (admin-access-control,
// Task 3.3). The Supabase SSR client and next/navigation are mocked so the
// guards run without a session or a live database.

import { describe, it, expect, beforeEach, vi } from "vitest";

// `server-only` throws if imported outside an RSC bundle; stub it for tests.
vi.mock("server-only", () => ({}));

// redirect() normally throws a Next.js control-flow signal; model it as a throw
// we can assert on.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
  assertGroupAccess,
  assertGroupManage,
  guardAdminGroup,
} from "../adminAccess";
import type { OperationsAccess } from "../adminAccessCore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setContext(
  roleCode: string | null,
  level: string | null,
  groups: OperationsAccess | null,
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
      admin_operations_access: groups,
      roles: { code: roleCode },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── assertGroupManage ─────────────────────────────────────────────────────────

describe("assertGroupManage", () => {
  it("denies when there is no session", async () => {
    setContext(null, null, null);
    await expect(assertGroupManage("customers")).rejects.toMatchObject({
      name: "GroupAccessDeniedError",
      readOnly: false,
    });
  });

  it("denies a non-ADMIN role", async () => {
    setContext("MASTER_ADMIN", null, null);
    await expect(assertGroupManage("customers")).rejects.toMatchObject({
      name: "GroupAccessDeniedError",
      readOnly: false,
    });
  });

  it("denies an inventory-only admin (no operations group access)", async () => {
    setContext("ADMIN", "inventory", null);
    await expect(assertGroupManage("customers")).rejects.toMatchObject({
      readOnly: false,
    });
  });

  it("permits a full-access admin", async () => {
    setContext("ADMIN", "inventory_operations", null);
    await expect(assertGroupManage("customers")).resolves.toMatchObject({
      level: "inventory_operations",
    });
  });

  it("permits a manage group and rejects an absent group", async () => {
    setContext("ADMIN", "operations", { customers: "manage" });
    await expect(assertGroupManage("customers")).resolves.toBeTruthy();

    setContext("ADMIN", "operations", { customers: "manage" });
    await expect(assertGroupManage("riders")).rejects.toMatchObject({
      readOnly: false,
    });
  });

  it("rejects a view group as read-only", async () => {
    setContext("ADMIN", "operations", { customers: "view" });
    await expect(assertGroupManage("customers")).rejects.toMatchObject({
      readOnly: true,
    });
  });
});

// ─── assertGroupAccess ──────────────────────────────────────────────────────────

describe("assertGroupAccess", () => {
  it("permits a view group (read access)", async () => {
    setContext("ADMIN", "operations", { customers: "view" });
    await expect(assertGroupAccess("customers")).resolves.toBeTruthy();
  });

  it("denies a group the admin does not have", async () => {
    setContext("ADMIN", "operations", { customers: "view" });
    await expect(assertGroupAccess("franchises")).rejects.toMatchObject({
      readOnly: false,
    });
  });
});

// ─── guardAdminGroup (redirect-style) ───────────────────────────────────────────

describe("guardAdminGroup", () => {
  it("redirects a non-ADMIN to /unauthorized", async () => {
    setContext(null, null, null);
    await expect(guardAdminGroup("customers")).rejects.toThrow(
      "REDIRECT:/unauthorized",
    );
  });

  it("redirects an operations admin lacking the group to their landing route", async () => {
    setContext("ADMIN", "operations", { riders: "manage" });
    await expect(guardAdminGroup("customers")).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });

  it("redirects an inventory admin to /inventory", async () => {
    setContext("ADMIN", "inventory", null);
    await expect(guardAdminGroup("customers")).rejects.toThrow(
      "REDIRECT:/inventory",
    );
  });

  it("returns the config when the group is granted", async () => {
    setContext("ADMIN", "operations", { customers: "view" });
    await expect(guardAdminGroup("customers")).resolves.toMatchObject({
      level: "operations",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
