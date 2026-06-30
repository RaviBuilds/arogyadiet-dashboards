// src/test/inventory/warehouse-access-inventory-ops.test.ts
//
// Feature: master-inventory-management, Property 2: Inventory operations are authorized for MASTER_ADMIN or inventory-access ADMIN
//
// **Validates: Requirements 6.1, 6.3, 6.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveWarehouseAuthorization } from "@/lib/inventory/warehouse-access";
import {
  canAccess,
  ADMIN_ACCESS_LEVELS,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** All valid AdminAccessLevel values. */
const arbAccessLevel = fc.constantFrom<AdminAccessLevel>(...ADMIN_ACCESS_LEVELS);

/** Known role codes including the privileged ones plus extras. */
const arbRoleCode = fc.oneof(
  fc.constantFrom(
    "MASTER_ADMIN",
    "ADMIN",
    "RIDER",
    "FRANCHISE_ADMIN",
    "CUSTOMER",
  ),
  fc.constant(null as string | null),
  fc.string({ minLength: 1, maxLength: 20 }),
);

// ─── Property 2: Inventory operations authorization ───────────────────────────

describe("resolveWarehouseAuthorization — Property 2: Inventory operations are authorized for MASTER_ADMIN or inventory-access ADMIN", () => {
  it("returns true iff roleCode is MASTER_ADMIN, or roleCode is ADMIN with canAccess(level, 'inventory') true", () => {
    fc.assert(
      fc.property(arbRoleCode, arbAccessLevel, (roleCode, accessLevel) => {
        const result = resolveWarehouseAuthorization(
          roleCode,
          accessLevel,
          "inventory_operations",
        );

        const expectedAuthorized =
          roleCode === "MASTER_ADMIN" ||
          (roleCode === "ADMIN" && canAccess(accessLevel, "inventory"));

        expect(result).toBe(expectedAuthorized);
      }),
      { numRuns: 100 },
    );
  });

  it("MASTER_ADMIN is always authorized regardless of access level", () => {
    fc.assert(
      fc.property(arbAccessLevel, (accessLevel) => {
        const result = resolveWarehouseAuthorization(
          "MASTER_ADMIN",
          accessLevel,
          "inventory_operations",
        );
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("ADMIN with inventory access is authorized", () => {
    // Levels that grant inventory access: "inventory", "inventory_operations"
    const arbInventoryGrantingLevel = fc.constantFrom<AdminAccessLevel>(
      "inventory",
      "inventory_operations",
    );

    fc.assert(
      fc.property(arbInventoryGrantingLevel, (accessLevel) => {
        const result = resolveWarehouseAuthorization(
          "ADMIN",
          accessLevel,
          "inventory_operations",
        );
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("ADMIN without inventory access is denied", () => {
    // The only level that does NOT grant inventory: "operations"
    const result = resolveWarehouseAuthorization(
      "ADMIN",
      "operations",
      "inventory_operations",
    );
    expect(result).toBe(false);
  });

  it("any role other than MASTER_ADMIN or ADMIN is denied regardless of access level", () => {
    const arbNonPrivilegedRole = fc.oneof(
      fc.constantFrom("RIDER", "FRANCHISE_ADMIN", "CUSTOMER"),
      fc.constant(null as string | null),
      fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((s) => s !== "MASTER_ADMIN" && s !== "ADMIN"),
    );

    fc.assert(
      fc.property(arbNonPrivilegedRole, arbAccessLevel, (roleCode, accessLevel) => {
        const result = resolveWarehouseAuthorization(
          roleCode,
          accessLevel,
          "inventory_operations",
        );
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
