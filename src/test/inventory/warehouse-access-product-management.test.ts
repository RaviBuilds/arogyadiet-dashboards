// Feature: master-inventory-management, Property 1: Product management is authorized for MASTER_ADMIN only
//
// Validates: Requirements 1.4, 1.5, 1.6
//
// For any role code and access level, resolveWarehouseAuthorization(role, level, "product_management")
// returns true if and only if the role is "MASTER_ADMIN"; for every other role it returns false,
// regardless of access level.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveWarehouseAuthorization } from "@/lib/inventory/warehouse-access";
import {
  ADMIN_ACCESS_LEVELS,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";

// ─── Generators ──────────────────────────────────────────────────────────────

/** All valid AdminAccessLevel values. */
const arbAccessLevel = fc.constantFrom<AdminAccessLevel>(...ADMIN_ACCESS_LEVELS);

/** Known role codes (including MASTER_ADMIN and others that must be denied). */
const KNOWN_ROLES = ["MASTER_ADMIN", "ADMIN", "RIDER", "FRANCHISE_ADMIN"] as const;

/** Role code generator: known roles, null, and arbitrary strings. */
const arbRoleCode = fc.oneof(
  fc.constantFrom<string | null>(...KNOWN_ROLES, null),
  fc.string({ minLength: 0, maxLength: 30 }),
);

/** Role code that is explicitly NOT "MASTER_ADMIN". */
const arbNonMasterRole = fc.oneof(
  fc.constantFrom<string | null>("ADMIN", "RIDER", "FRANCHISE_ADMIN", null),
  fc.string({ minLength: 0, maxLength: 30 }).filter((s) => s !== "MASTER_ADMIN"),
);

// ─── Property test ───────────────────────────────────────────────────────────

describe("resolveWarehouseAuthorization — Property 1: Product management is authorized for MASTER_ADMIN only", () => {
  it("returns true for product_management when roleCode is MASTER_ADMIN, for any access level", () => {
    fc.assert(
      fc.property(arbAccessLevel, (level) => {
        const result = resolveWarehouseAuthorization("MASTER_ADMIN", level, "product_management");
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("returns false for product_management for any non-MASTER_ADMIN role, regardless of access level", () => {
    fc.assert(
      fc.property(arbNonMasterRole, arbAccessLevel, (role, level) => {
        const result = resolveWarehouseAuthorization(role, level, "product_management");
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("product_management authorization is a pure function of roleCode only (access level has no effect)", () => {
    fc.assert(
      fc.property(arbRoleCode, arbAccessLevel, arbAccessLevel, (role, level1, level2) => {
        const result1 = resolveWarehouseAuthorization(role, level1, "product_management");
        const result2 = resolveWarehouseAuthorization(role, level2, "product_management");
        // For product_management, the result depends solely on roleCode, not access level
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 },
    );
  });

  it("product_management returns true iff roleCode === 'MASTER_ADMIN' (biconditional)", () => {
    fc.assert(
      fc.property(arbRoleCode, arbAccessLevel, (role, level) => {
        const result = resolveWarehouseAuthorization(role, level, "product_management");
        expect(result).toBe(role === "MASTER_ADMIN");
      }),
      { numRuns: 100 },
    );
  });
});
