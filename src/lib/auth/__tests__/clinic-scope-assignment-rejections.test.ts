// src/lib/auth/__tests__/clinic-scope-assignment-rejections.test.ts
//
// Unit tests for `validateClinicScopeAssignment` (clinic-scoped-shop-inventory,
// Requirement 13.11-13.14). These pin down the four named rejection scenarios
// with concrete example values, complementing the generated-input property
// test that covers the same function.

import { describe, it, expect } from "vitest";
import { validateClinicScopeAssignment } from "../adminAccessCore";

const CLINIC_ID = "11111111-1111-1111-1111-111111111111";

describe("validateClinicScopeAssignment: rejection scenarios", () => {
  // Requirement 13.11
  it("rejects clinic access checked with no clinic selected", () => {
    const result = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: null,
      groups: {},
      isCoreClinic: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "A clinic must be selected for clinic level access",
      );
    }
  });

  // Requirement 13.13
  it("rejects the operations group present alongside a clinic scope", () => {
    const result = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID,
      groups: { operations: "manage" },
      isCoreClinic: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "The operations and franchises groups are unavailable for clinic level access",
      );
    }
  });

  // Requirement 13.13
  it("rejects the franchises group present alongside a clinic scope", () => {
    const result = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID,
      groups: { franchises: "view" },
      isCoreClinic: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "The operations and franchises groups are unavailable for clinic level access",
      );
    }
  });

  // Requirement 13.14
  it("rejects a clinic scope on a non-operations access level", () => {
    const result = validateClinicScopeAssignment({
      level: "inventory",
      clinicAccess: true,
      clinicId: CLINIC_ID,
      groups: {},
      isCoreClinic: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Clinic level access requires the operations access level",
      );
    }
  });

  // Requirement 13.14 (additional non-operations levels)
  it("rejects a clinic scope on the inventory_operations and dietitian levels", () => {
    for (const level of ["inventory_operations", "dietitian"] as const) {
      const result = validateClinicScopeAssignment({
        level,
        clinicAccess: true,
        clinicId: CLINIC_ID,
        groups: {},
        isCoreClinic: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "Clinic level access requires the operations access level",
        );
      }
    }
  });

  // Requirement 13.12
  it("rejects a clinic with a non-null franchise_id", () => {
    const result = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID,
      groups: {},
      isCoreClinic: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "The selected clinic is unavailable for clinic level access",
      );
    }
  });

  // Positive control: the same input shape succeeds when every condition is
  // satisfied, proving the rejections above are testing the rejection reason
  // specifically, not some unrelated failure.
  it("accepts a well-formed clinic scope assignment", () => {
    const result = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID,
      groups: { customers: "manage", subscriptions: "view", riders: "manage", shop_products: "manage" },
      isCoreClinic: true,
    });

    expect(result.ok).toBe(true);
  });
});
