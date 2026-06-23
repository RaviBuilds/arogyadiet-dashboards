// src/shared/components/shared/__tests__/RBACGate.test.ts
// Unit tests for RBAC gate logic
//
// Tests:
// - FRANCHISE_ADMIN cannot see master controls
// - ADMIN sees core data without franchise-selection step
// - MASTER_ADMIN sees all controls
// - Invalid role shows access denied
// - FRANCHISE_ADMIN with no franchise shows appropriate message

import { describe, it, expect } from "vitest";
import type { FranchiseRole } from "@/types/franchise";

/**
 * Pure logic extraction of the RBACGate component's rendering decision.
 * Returns true if children should be rendered, false if fallback should be shown.
 */
function shouldRender(params: {
  role: FranchiseRole | null;
  franchiseId?: string | null;
  allowedRoles?: FranchiseRole[];
  deniedRoles?: FranchiseRole[];
  requireFranchise?: boolean;
}): boolean {
  const { role, franchiseId, allowedRoles, deniedRoles, requireFranchise } = params;

  // No role = not authenticated
  if (!role) return false;

  // Explicit deny takes priority
  if (deniedRoles && deniedRoles.includes(role)) return false;

  // Check allowed roles
  if (allowedRoles && !allowedRoles.includes(role)) return false;

  // Check franchise requirement
  if (requireFranchise && !franchiseId) return false;

  return true;
}

describe("RBACGate Logic", () => {
  describe("FRANCHISE_ADMIN cannot see master controls", () => {
    it("denied when deniedRoles includes FRANCHISE_ADMIN", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          deniedRoles: ["FRANCHISE_ADMIN"],
        })
      ).toBe(false);
    });

    it("denied when allowedRoles is MASTER_ADMIN only", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["MASTER_ADMIN"],
        })
      ).toBe(false);
    });

    it("denied when allowedRoles is ADMIN + MASTER_ADMIN", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["ADMIN", "MASTER_ADMIN"],
        })
      ).toBe(false);
    });
  });

  describe("ADMIN sees core data without franchise-selection step", () => {
    it("allowed when no restrictions specified", () => {
      expect(shouldRender({ role: "ADMIN" })).toBe(true);
    });

    it("allowed when allowedRoles includes ADMIN", () => {
      expect(
        shouldRender({ role: "ADMIN", allowedRoles: ["ADMIN", "MASTER_ADMIN"] })
      ).toBe(true);
    });

    it("allowed even without franchiseId (doesn't require franchise)", () => {
      expect(
        shouldRender({ role: "ADMIN", franchiseId: null })
      ).toBe(true);
    });
  });

  describe("MASTER_ADMIN sees all controls", () => {
    it("allowed when no restrictions", () => {
      expect(shouldRender({ role: "MASTER_ADMIN" })).toBe(true);
    });

    it("allowed for master-only gates", () => {
      expect(
        shouldRender({ role: "MASTER_ADMIN", allowedRoles: ["MASTER_ADMIN"] })
      ).toBe(true);
    });

    it("allowed for admin-or-above gates", () => {
      expect(
        shouldRender({ role: "MASTER_ADMIN", allowedRoles: ["ADMIN", "MASTER_ADMIN"] })
      ).toBe(true);
    });
  });

  describe("Invalid/null role shows access denied (fallback)", () => {
    it("null role returns false (fallback rendered)", () => {
      expect(shouldRender({ role: null })).toBe(false);
    });

    it("null role with allowedRoles returns false", () => {
      expect(
        shouldRender({ role: null, allowedRoles: ["ADMIN"] })
      ).toBe(false);
    });
  });

  describe("FRANCHISE_ADMIN with no franchise shows appropriate message", () => {
    it("denied when requireFranchise is true and franchiseId is null", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["FRANCHISE_ADMIN"],
          requireFranchise: true,
          franchiseId: null,
        })
      ).toBe(false);
    });

    it("allowed when requireFranchise is true and franchiseId is provided", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["FRANCHISE_ADMIN"],
          requireFranchise: true,
          franchiseId: "some-uuid",
        })
      ).toBe(true);
    });

    it("FRANCHISE_ADMIN passes when no franchise requirement", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["FRANCHISE_ADMIN"],
        })
      ).toBe(true);
    });
  });

  describe("Deny takes priority over allow", () => {
    it("denied even if role is in allowedRoles when also in deniedRoles", () => {
      expect(
        shouldRender({
          role: "FRANCHISE_ADMIN",
          allowedRoles: ["FRANCHISE_ADMIN", "ADMIN"],
          deniedRoles: ["FRANCHISE_ADMIN"],
        })
      ).toBe(false);
    });
  });
});
