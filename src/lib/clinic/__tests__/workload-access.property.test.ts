// Feature: core-clinic-architecture, Property 33: Workload-view authorization
//
// Property test for `canAccessWorkloadView` (src/lib/clinic/workload-access.ts).
//
// Property 33: Workload-view authorization
//   For any user role, access to the workload view (including its kitchen
//   breakdown) is granted if and only if the role is ADMIN or MASTER_ADMIN; all
//   other roles, including franchise admin, are denied and no clinic or kitchen
//   workload data is returned.
//
// Validates: Requirements 13.4, 13.5

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { canAccessWorkloadView } from "../workload-access";

// ─── Generators ──────────────────────────────────────────────────────────────

/** The two role codes that grant access (Req 13.4). */
const arbAllowedRole = fc.constantFrom("ADMIN", "MASTER_ADMIN");

/**
 * A broad pool of values that must be denied (Req 13.5): the franchise admin
 * role, other known roles, arbitrary strings, the empty string, and the
 * absent-role sentinels null / undefined.
 */
const arbDeniedRole = fc.oneof(
  fc.constantFrom<string | null | undefined>(
    "FRANCHISE_ADMIN",
    "RIDER",
    "CUSTOMER",
    "",
    null,
    undefined
  ),
  // Arbitrary strings, excluding the two exact allowed codes.
  fc
    .string()
    .filter((s) => s !== "ADMIN" && s !== "MASTER_ADMIN")
);

/** Any role value at all (allowed, denied, or arbitrary). */
const arbAnyRole: fc.Arbitrary<string | null | undefined> = fc.oneof(
  arbAllowedRole,
  arbDeniedRole
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("canAccessWorkloadView - Property 33: Workload-view authorization", () => {
  it("grants access if and only if the role is exactly ADMIN or MASTER_ADMIN", () => {
    fc.assert(
      fc.property(arbAnyRole, (role) => {
        const expected = role === "ADMIN" || role === "MASTER_ADMIN";
        // Biconditional: access ⇔ role ∈ {ADMIN, MASTER_ADMIN}
        expect(canAccessWorkloadView(role)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it("always grants access to ADMIN and MASTER_ADMIN", () => {
    fc.assert(
      fc.property(arbAllowedRole, (role) => {
        expect(canAccessWorkloadView(role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("always denies every other role, including franchise admin, empty, null, and undefined", () => {
    fc.assert(
      fc.property(arbDeniedRole, (role) => {
        expect(canAccessWorkloadView(role)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("denies the franchise admin role specifically (Req 13.5)", () => {
    expect(canAccessWorkloadView("FRANCHISE_ADMIN")).toBe(false);
  });

  it("denies a missing role (null / undefined)", () => {
    expect(canAccessWorkloadView(null)).toBe(false);
    expect(canAccessWorkloadView(undefined)).toBe(false);
  });
});
