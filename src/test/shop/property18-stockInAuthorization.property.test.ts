// src/test/shop/property18-stockInAuthorization.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 18 (Task 7.2)
//
// Property 18: Stock In authorization admits only warehouse admins.
//
// `clinicStockInAction` and `setClinicProductVisibilityAction`
// (`src/actions/admin-actions/clinicShopInventoryActions.ts`) both gate via
// `checkWarehouseAccess("inventory_operations")` before any Zod validation, RPC
// call, or I/O. `checkWarehouseAccess` ultimately delegates the authorization
// DECISION to `resolveWarehouseAuthorization`
// (`src/lib/inventory/warehouse-access.ts`). Since this project's property
// tests avoid I/O and mocking Supabase, this property exercises
// `resolveWarehouseAuthorization` directly as the decision oracle rather than
// invoking the server actions themselves — consistent with every sibling
// property test in this suite.
//
// The property is quantified over every caller kind the requirements name: an
// anonymous / no-session caller, an Unscoped_Operations_Admin, a
// Clinic_Scoped_Admin, a Dietitian-level admin, an inventory-access admin, and
// a MASTER_ADMIN (added locally — `arbAdminScope`'s `{ kind: "admin", ... }`
// samples imply `roleCode = "ADMIN"`, never `MASTER_ADMIN`, so the always-
// authorized MASTER_ADMIN case is not otherwise covered).
//
// Two capability tiers are checked:
//   - `inventory_operations` (Stock In / visibility): authorized for
//     MASTER_ADMIN regardless of access level, or ADMIN with an access level
//     where `canAccess(accessLevel, "inventory")` is true. Every other
//     combination — including a Clinic_Scoped_Admin, who must be denied
//     identically to an Unscoped_Operations_Admin — is denied.
//   - `product_management`: authorized for MASTER_ADMIN ONLY. An ADMIN with
//     inventory access is NOT authorized for this tier.
//
// **Validates: Requirements 4.7, 4.8, 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.9, 19.4**

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  resolveWarehouseAuthorization,
  type WarehouseCapability,
} from "@/lib/inventory/warehouse-access";
import { canAccess, type AdminAccessLevel } from "@/lib/auth/adminAccessCore";
import {
  arbAdminScope,
  isWarehouseAdminSample,
  type AdminScopeSample,
} from "@/test/shop/clinicStockArbitraries";

const NUM_RUNS = 150;

/**
 * The access levels a MASTER_ADMIN can be sampled against — MASTER_ADMIN is
 * always authorized for `inventory_operations` and `product_management`
 * regardless of `accessLevel`, so this exists purely to prove the decision
 * really does ignore it.
 */
const MASTER_ADMIN_ACCESS_LEVELS: readonly AdminAccessLevel[] = [
  "inventory",
  "operations",
  "inventory_operations",
  "dietitian",
];

/** One caller presented to `resolveWarehouseAuthorization`. */
interface CallerCase {
  roleCode: string | null;
  accessLevel: AdminAccessLevel;
  /** Present only for callers derived from `arbAdminScope`, for cross-checks. */
  sourceScope?: AdminScopeSample;
}

/**
 * Map an `arbAdminScope` sample onto the `(roleCode, accessLevel)` pair
 * `resolveWarehouseAuthorization` consumes. `arbAdminScope`'s `"admin"` kind
 * always implies `roleCode === "ADMIN"` (Req 16 glossary); the accessLevel used
 * for the anonymous case is irrelevant since a null roleCode is denied for
 * every accessLevel and every capability.
 */
function callerFromScope(scope: AdminScopeSample): CallerCase {
  if (scope.kind === "anonymous") {
    return { roleCode: null, accessLevel: "operations", sourceScope: scope };
  }
  return { roleCode: "ADMIN", accessLevel: scope.level, sourceScope: scope };
}

/** A locally-defined MASTER_ADMIN caller — not covered by `arbAdminScope`. */
const arbMasterAdminCase: fc.Arbitrary<CallerCase> = fc
  .constantFrom(...MASTER_ADMIN_ACCESS_LEVELS)
  .map((accessLevel) => ({ roleCode: "MASTER_ADMIN", accessLevel }));

/** Every caller kind Property 18 must quantify over. */
const arbCallerCase: fc.Arbitrary<CallerCase> = fc.oneof(
  { arbitrary: arbAdminScope.map(callerFromScope), weight: 4 },
  { arbitrary: arbMasterAdminCase, weight: 1 },
);

describe("Property 18: Stock In authorization admits only warehouse admins (inventory_operations)", () => {
  const capability: WarehouseCapability = "inventory_operations";

  it("is authorized exactly for MASTER_ADMIN (any access level) and ADMIN with inventory access; every other caller is denied", () => {
    fc.assert(
      fc.property(arbCallerCase, (caller) => {
        const actual = resolveWarehouseAuthorization(
          caller.roleCode,
          caller.accessLevel,
          capability,
        );

        const expected =
          caller.roleCode === "MASTER_ADMIN" ||
          (caller.roleCode === "ADMIN" &&
            canAccess(caller.accessLevel, "inventory"));

        expect(actual).toBe(expected);

        // Sanity cross-check (not the sole oracle): for callers drawn from
        // `arbAdminScope`, the real decision must agree with the shared
        // arbitraries' own warehouse-admin predicate.
        if (caller.sourceScope) {
          expect(actual).toBe(isWarehouseAdminSample(caller.sourceScope));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies a Clinic_Scoped_Admin identically to an Unscoped_Operations_Admin (Req 16.2, 16.5, 16.9)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbAdminScope.filter(
            (scope) =>
              scope.kind === "admin" &&
              scope.level === "operations" &&
              scope.clinicId === null,
          ),
          arbAdminScope.filter(
            (scope) =>
              scope.kind === "admin" &&
              scope.level === "operations" &&
              scope.clinicId !== null,
          ),
        ),
        (scope) => {
          const caller = callerFromScope(scope);
          expect(
            resolveWarehouseAuthorization(
              caller.roleCode,
              caller.accessLevel,
              capability,
            ),
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies an anonymous / no-session caller regardless of the accessLevel presented (Req 16.4)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MASTER_ADMIN_ACCESS_LEVELS), (accessLevel) => {
        expect(resolveWarehouseAuthorization(null, accessLevel, capability)).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 18: Stock In authorization admits only warehouse admins (product_management)", () => {
  const capability: WarehouseCapability = "product_management";

  it("is authorized ONLY for MASTER_ADMIN — an ADMIN with inventory access is not authorized (Req 4.7, 4.8)", () => {
    fc.assert(
      fc.property(arbCallerCase, (caller) => {
        const actual = resolveWarehouseAuthorization(
          caller.roleCode,
          caller.accessLevel,
          capability,
        );

        const expected = caller.roleCode === "MASTER_ADMIN";

        expect(actual).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies an ADMIN holding inventory access for product_management even though inventory_operations would admit them", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AdminAccessLevel>("inventory", "inventory_operations"),
        (accessLevel) => {
          expect(
            resolveWarehouseAuthorization("ADMIN", accessLevel, "product_management"),
          ).toBe(false);
          expect(
            resolveWarehouseAuthorization(
              "ADMIN",
              accessLevel,
              "inventory_operations",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
