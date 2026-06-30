// src/test/inventory/workspace-route-guard.test.ts
//
// Integration tests for the Master warehouse workspace route guard.
// The layout at src/app/master/(main)/inventory/warehouse/layout.tsx calls
// getCurrentAdminContext() and redirects to /unauthorized when the role is not
// MASTER_ADMIN.
//
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5

import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub `server-only` so we can import server modules in tests.
vi.mock("server-only", () => ({}));

// Mock next/navigation — redirect throws a control-flow signal in Next.js.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// Mock next/link as a simple passthrough (used in the layout JSX).
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    ({ type: "a", props: { href, children } }),
}));

// Mock the shared components rendered by the layout to avoid pulling in their
// full dependency trees.
vi.mock("@/shared/components/admin/inventory/InventoryHeader", () => ({
  default: () => ({ type: "div", props: { "data-testid": "inventory-header" } }),
}));
vi.mock("@/shared/components/admin/inventory/OperationsCart", () => ({
  default: () => ({ type: "div", props: { "data-testid": "operations-cart" } }),
}));

// Controllable mock for getCurrentAdminContext.
const getCurrentAdminContextMock = vi.fn();
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: () => getCurrentAdminContextMock(),
}));

// Import the layout as an async function (RSC pattern).
import MasterWarehouseLayout from "@/app/master/(main)/inventory/warehouse/layout";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockContext(roleCode: string | null, userId: string | null = "user-1") {
  getCurrentAdminContextMock.mockResolvedValue({
    userId,
    roleCode,
    accessLevel: "full",
    config: { level: "full", groups: {} },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Master Warehouse Workspace Route Guard (layout.tsx)", () => {
  describe("Requirement 8.1 — MASTER_ADMIN renders the workspace", () => {
    it("does NOT redirect and returns JSX when roleCode is MASTER_ADMIN", async () => {
      mockContext("MASTER_ADMIN");

      const result = await MasterWarehouseLayout({
        children: "workspace-content",
      });

      // No redirect should have been called.
      expect(redirectMock).not.toHaveBeenCalled();

      // The layout should return valid JSX (a React element).
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });
  });

  describe("Requirement 8.2, 8.5 — No session / expired session → redirect to login (unauthorized)", () => {
    it("redirects to /unauthorized when roleCode is null (no session)", async () => {
      mockContext(null, null);

      await expect(
        MasterWarehouseLayout({ children: "content" }),
      ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");

      expect(redirectMock).toHaveBeenCalledWith("/unauthorized");
    });
  });

  describe("Requirement 8.3, 8.4 — Non-MASTER_ADMIN roles → /unauthorized", () => {
    it("redirects to /unauthorized when roleCode is ADMIN", async () => {
      mockContext("ADMIN");

      await expect(
        MasterWarehouseLayout({ children: "content" }),
      ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");

      expect(redirectMock).toHaveBeenCalledWith("/unauthorized");
    });

    it("redirects to /unauthorized when roleCode is RIDER", async () => {
      mockContext("RIDER");

      await expect(
        MasterWarehouseLayout({ children: "content" }),
      ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");

      expect(redirectMock).toHaveBeenCalledWith("/unauthorized");
    });

    it("redirects to /unauthorized when roleCode is FRANCHISE_ADMIN", async () => {
      mockContext("FRANCHISE_ADMIN");

      await expect(
        MasterWarehouseLayout({ children: "content" }),
      ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");

      expect(redirectMock).toHaveBeenCalledWith("/unauthorized");
    });
  });

  describe("Requirement 8.5 — Expired/invalid session treated as unauthenticated", () => {
    it("treats an empty string roleCode as unauthenticated", async () => {
      // Edge case: context resolves but with empty string role (malformed session).
      mockContext("");

      await expect(
        MasterWarehouseLayout({ children: "content" }),
      ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");

      expect(redirectMock).toHaveBeenCalledWith("/unauthorized");
    });
  });
});
