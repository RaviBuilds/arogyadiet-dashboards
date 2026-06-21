// src/lib/franchise/__tests__/context.test.ts
// Property tests for franchise context resolution logic
//
// Properties verified:
// - Property 6: Core records untouched — ADMIN/Core users always resolve to NULL franchise context
// - Property 3: Core and Master completeness — MASTER_ADMIN/ADMIN get unrestricted access context

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { FranchiseContext, FranchiseRole } from "@/types/franchise";
import {
  GLOBAL_ACCESS_ROLES,
  FRANCHISE_SCOPED_ROLE,
} from "../constants";

/**
 * Pure logic extracted from resolveFranchiseContext for testability.
 * This mirrors the resolution logic without Supabase dependency.
 */
function resolveContextFromUserRecord(
  roleCode: FranchiseRole,
  franchiseId: string | null,
  franchiseName: string | null
): FranchiseContext {
  // ADMIN / MASTER_ADMIN → global access, no franchise scoping
  if ((GLOBAL_ACCESS_ROLES as readonly string[]).includes(roleCode)) {
    return {
      role: roleCode,
      franchise_id: null,
      franchise_name: null,
      is_franchise_scoped: false,
    };
  }

  // FRANCHISE_ADMIN → scoped to their assigned franchise
  if (roleCode === FRANCHISE_SCOPED_ROLE) {
    return {
      role: roleCode,
      franchise_id: franchiseId,
      franchise_name: franchiseId ? franchiseName : null,
      is_franchise_scoped: true,
    };
  }

  // RIDER / CUSTOMER → return their franchise_id (null = core)
  return {
    role: roleCode,
    franchise_id: franchiseId,
    franchise_name: null,
    is_franchise_scoped: franchiseId !== null,
  };
}

// ─── Arbitrary generators ──────────────────────────────────────────────────

const arbUuid = fc.uuid();

const arbGlobalRole = fc.constantFrom<FranchiseRole>("ADMIN", "MASTER_ADMIN");
const arbFranchiseAdminRole = fc.constant<FranchiseRole>("FRANCHISE_ADMIN");
const arbCoreUserRole = fc.constantFrom<FranchiseRole>("RIDER", "CUSTOMER");
const arbAnyRole = fc.constantFrom<FranchiseRole>(
  "ADMIN",
  "MASTER_ADMIN",
  "FRANCHISE_ADMIN",
  "RIDER",
  "CUSTOMER"
);

const arbFranchiseName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// ─── Property Tests ────────────────────────────────────────────────────────

describe("Franchise Context Resolution - Property Tests", () => {
  describe("Property 6: Core records untouched — ADMIN users always get NULL franchise context", () => {
    it("ADMIN always resolves to null franchise_id regardless of user record state", () => {
      fc.assert(
        fc.property(
          fc.oneof(arbUuid, fc.constant(null)), // franchise_id on user record (could be anything)
          fc.oneof(arbFranchiseName, fc.constant(null)),
          (franchiseId, franchiseName) => {
            const context = resolveContextFromUserRecord(
              "ADMIN",
              franchiseId,
              franchiseName
            );

            expect(context.role).toBe("ADMIN");
            expect(context.franchise_id).toBeNull();
            expect(context.franchise_name).toBeNull();
            expect(context.is_franchise_scoped).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("MASTER_ADMIN always resolves to null franchise_id regardless of user record state", () => {
      fc.assert(
        fc.property(
          fc.oneof(arbUuid, fc.constant(null)),
          fc.oneof(arbFranchiseName, fc.constant(null)),
          (franchiseId, franchiseName) => {
            const context = resolveContextFromUserRecord(
              "MASTER_ADMIN",
              franchiseId,
              franchiseName
            );

            expect(context.role).toBe("MASTER_ADMIN");
            expect(context.franchise_id).toBeNull();
            expect(context.franchise_name).toBeNull();
            expect(context.is_franchise_scoped).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("any global role always resolves to unrestricted context", () => {
      fc.assert(
        fc.property(
          arbGlobalRole,
          fc.oneof(arbUuid, fc.constant(null)),
          fc.oneof(arbFranchiseName, fc.constant(null)),
          (role, franchiseId, franchiseName) => {
            const context = resolveContextFromUserRecord(
              role,
              franchiseId,
              franchiseName
            );

            // CRITICAL: global roles NEVER have franchise scoping
            expect(context.franchise_id).toBeNull();
            expect(context.is_franchise_scoped).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Property 3: Core and Master completeness — unrestricted access", () => {
    it("ADMIN and MASTER_ADMIN get unrestricted context (is_franchise_scoped = false)", () => {
      fc.assert(
        fc.property(arbGlobalRole, (role) => {
          const context = resolveContextFromUserRecord(role, null, null);

          expect(context.is_franchise_scoped).toBe(false);
          expect(context.franchise_id).toBeNull();
          // Role is preserved
          expect(["ADMIN", "MASTER_ADMIN"]).toContain(context.role);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("FRANCHISE_ADMIN context resolution", () => {
    it("FRANCHISE_ADMIN with assigned franchise is always scoped to that franchise", () => {
      fc.assert(
        fc.property(arbUuid, arbFranchiseName, (franchiseId, name) => {
          const context = resolveContextFromUserRecord(
            "FRANCHISE_ADMIN",
            franchiseId,
            name
          );

          expect(context.role).toBe("FRANCHISE_ADMIN");
          expect(context.franchise_id).toBe(franchiseId);
          expect(context.franchise_name).toBe(name);
          expect(context.is_franchise_scoped).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it("FRANCHISE_ADMIN without assigned franchise still marked as scoped (error state)", () => {
      const context = resolveContextFromUserRecord(
        "FRANCHISE_ADMIN",
        null,
        null
      );

      expect(context.role).toBe("FRANCHISE_ADMIN");
      expect(context.franchise_id).toBeNull();
      expect(context.franchise_name).toBeNull();
      expect(context.is_franchise_scoped).toBe(true);
    });
  });

  describe("Core user (RIDER/CUSTOMER) context resolution", () => {
    it("core users with NULL franchise_id are NOT franchise scoped", () => {
      fc.assert(
        fc.property(arbCoreUserRole, (role) => {
          const context = resolveContextFromUserRecord(role, null, null);

          expect(context.franchise_id).toBeNull();
          expect(context.is_franchise_scoped).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("franchise-assigned RIDER/CUSTOMER are scoped to their franchise", () => {
      fc.assert(
        fc.property(arbCoreUserRole, arbUuid, (role, franchiseId) => {
          const context = resolveContextFromUserRecord(
            role,
            franchiseId,
            null
          );

          expect(context.franchise_id).toBe(franchiseId);
          expect(context.is_franchise_scoped).toBe(true);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("Invariant: role is always preserved in context", () => {
    it("resolved context always contains the input role", () => {
      fc.assert(
        fc.property(
          arbAnyRole,
          fc.oneof(arbUuid, fc.constant(null)),
          fc.oneof(arbFranchiseName, fc.constant(null)),
          (role, franchiseId, franchiseName) => {
            const context = resolveContextFromUserRecord(
              role,
              franchiseId,
              franchiseName
            );

            expect(context.role).toBe(role);
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
