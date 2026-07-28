// src/validations/__tests__/dietitianSchema.test.ts
//
// Unit tests for the Dietitian Zod schemas.
//
// Covers:
//  - the ordered Mobile number rejection (empty → required, then 10-digit)
//  - a valid create payload, including a null Dietitian_Clinic_Link
//  - the update schema dropping email/password while keeping the Clinic
//  - the Dietitian_Link schema accepting a null Dietitian
//
// Validates: Requirements 2.4, 2.5, 6.4

import { describe, it, expect } from "vitest";
import {
  createDietitianSchema,
  updateDietitianSchema,
  assignDietitianSchema,
} from "@/validations/dietitianSchema";
import {
  MOBILE_REQUIRED_FOR_DIETITIAN,
  MOBILE_MUST_BE_TEN_DIGITS,
  SELECTED_USER_IS_NOT_A_DIETITIAN,
} from "@/lib/dietitian/messages";

const CLINIC_ID = "3f2d1c4e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const PROFILE_ID = "8c7b6a5d-4e3f-4a2b-9c8d-7e6f5a4b3c2d";
const DIETITIAN_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Avinash D",
    email: "Arogyadiet.AvinashD@gmail.com",
    mobile: "9154850031",
    password: "secret123",
    clinicId: CLINIC_ID,
    ...overrides,
  };
}

/** The messages of every issue raised for the `mobile` field, in order. */
function mobileMessages(input: Record<string, unknown>): string[] {
  const result = createDietitianSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === "mobile")
    .map((issue) => issue.message);
}

describe("createDietitianSchema", () => {
  it("accepts a valid payload and normalises the email", () => {
    const result = createDietitianSchema.safeParse(validCreate());
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("arogyadiet.avinashd@gmail.com");
    expect(result.data?.clinicId).toBe(CLINIC_ID);
  });

  it("accepts an empty Dietitian_Clinic_Link", () => {
    const result = createDietitianSchema.safeParse(
      validCreate({ clinicId: null }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.clinicId).toBeNull();
  });

  // Requirement 2.4 — reported before the 10-digit check.
  it("reports an empty mobile as required and skips the digit check", () => {
    expect(mobileMessages(validCreate({ mobile: "" }))).toEqual([
      MOBILE_REQUIRED_FOR_DIETITIAN,
    ]);
    expect(mobileMessages(validCreate({ mobile: "   " }))).toEqual([
      MOBILE_REQUIRED_FOR_DIETITIAN,
    ]);
    expect(mobileMessages(validCreate({ mobile: undefined }))).toEqual([
      MOBILE_REQUIRED_FOR_DIETITIAN,
    ]);
  });

  // Requirement 2.5 — present but not exactly 10 digits.
  it("reports a non-10-digit mobile with the digit message", () => {
    for (const mobile of ["915485003", "91548500311", "91548500a1", "+919154850031"]) {
      expect(mobileMessages(validCreate({ mobile }))).toEqual([
        MOBILE_MUST_BE_TEN_DIGITS,
      ]);
    }
  });
});

describe("updateDietitianSchema", () => {
  it("drops email and password and keeps the editable Clinic", () => {
    const result = updateDietitianSchema.safeParse({
      fullName: "Nandini",
      mobile: "9154850030",
      clinicId: null,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      fullName: "Nandini",
      mobile: "9154850030",
      clinicId: null,
    });
  });
});

describe("assignDietitianSchema", () => {
  it("accepts a Dietitian reference and an empty link", () => {
    expect(
      assignDietitianSchema.safeParse({
        customerProfileId: PROFILE_ID,
        dietitianUserId: DIETITIAN_ID,
      }).success,
    ).toBe(true);
    expect(
      assignDietitianSchema.safeParse({
        customerProfileId: PROFILE_ID,
        dietitianUserId: null,
      }).success,
    ).toBe(true);
  });

  // Requirement 6.4 — a bad reference reads the same as a non-Dietitian row.
  it("rejects a malformed Dietitian reference with the pinned message", () => {
    const result = assignDietitianSchema.safeParse({
      customerProfileId: PROFILE_ID,
      dietitianUserId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      SELECTED_USER_IS_NOT_A_DIETITIAN,
    );
  });
});
