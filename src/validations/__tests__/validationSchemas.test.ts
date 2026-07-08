// src/validations/__tests__/validationSchemas.test.ts
//
// Unit tests for the onboarding Zod validation schemas.
//
// Covers:
//  - enum rejection (gender, dietaryPreference, primaryCategory, paymentStatus)
//  - length bounds (name <=100, allergies <=500, email <=254, searchText <=255,
//    flatNumber <=50, floorNumber <=20)
//  - required flat number
//  - the all-optional profile-completion schema (empty object valid; each field
//    format-validated when present)
//  - email length/format edges
//  - addressCaptureSchema serviceability superRefine against a sample service area
//
// Validates: Requirements 4.1, 4.2, 4.3, 5.4, 9.2, 10.2

import { describe, it, expect } from "vitest";
import {
  createQuickOnboardingSchema,
  CUSTOMER_CATEGORIES,
  PAYMENT_STATUSES,
} from "@/validations/onboardingSchema";
import {
  addressCaptureSchema,
  createAddressCaptureSchema,
} from "@/validations/addressCaptureSchema";
import { realEmailSchema } from "@/validations/realEmailSchema";
import { profileCompletionSchema } from "@/validations/profileCompletionSchema";

// ─── Test fixtures ────────────────────────────────────────────────────────

const SERVICE_AREA = ["500081", "500084", "500032"];

/** A valid address payload against the SERVICE_AREA fixture. */
function validAddress(overrides: Record<string, unknown> = {}) {
  return {
    tag: "Home",
    searchText: "Madhapur, Hyderabad",
    flatNumber: "12B",
    floorNumber: "3",
    area: "Madhapur",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500081",
    lat: 17.4485,
    lng: 78.3908,
    ...overrides,
  };
}

/** A valid quick-onboarding payload (address bound to SERVICE_AREA). */
function validOnboarding(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Asha Rao",
    mobile: "9876543210",
    gender: "Female",
    dietaryPreference: "Veg",
    allergies: "Peanuts",
    email: "asha@example.com",
    isTestEmail: false,
    primaryCategory: "MEAL",
    planId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
    startDate: "2026-07-01",
    paymentStatus: "PAID",
    initialMealPreference: "VEG",
    cutoffAcknowledged: true,
    address: validAddress(),
    ...overrides,
  };
}

/** Build the onboarding schema bound to the sample service area. */
// Use a fixed `now` (2026-06-20T06:00:00Z = 11:30 IST, before 5 PM cutoff)
// so the earliest selectable start date is 2026-06-21 and the fixture's
// startDate "2026-07-01" always passes cutoff validation.
const FIXED_NOW = new Date("2026-06-20T06:00:00Z");
const onboardingSchema = createQuickOnboardingSchema(SERVICE_AREA, false, FIXED_NOW);
/** Build the address schema bound to the sample service area. */
const addressSchema = createAddressCaptureSchema(SERVICE_AREA);

// ─── onboardingSchema: enum rejection ───────────────────────────────────────

describe("quickOnboardingSchema enum rejection", () => {
  it("accepts a fully valid payload", () => {
    const result = onboardingSchema.safeParse(validOnboarding());
    expect(result.success).toBe(true);
  });

  it("rejects an invalid gender", () => {
    const result = onboardingSchema.safeParse(
      validOnboarding({ gender: "Unknown" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid dietaryPreference (Req 4.2)", () => {
    const result = onboardingSchema.safeParse(
      validOnboarding({ dietaryPreference: "Vegan" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid primaryCategory (Req 13.2)", () => {
    const result = onboardingSchema.safeParse(
      validOnboarding({ primaryCategory: "FOOD" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid paymentStatus (Req 4.4)", () => {
    const result = onboardingSchema.safeParse(
      validOnboarding({ paymentStatus: "REFUNDED" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts every declared customer category", () => {
    for (const category of CUSTOMER_CATEGORIES) {
      // Build category-appropriate payload
      const payload = validOnboarding({ primaryCategory: category });
      
      // Add KIT-specific fields for KIT category
      if (category === "KIT") {
        payload.kitProductId = "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f";
        payload.kitDurationDays = 30;
        delete (payload as Record<string, unknown>).planId;
      }
      
      const result = onboardingSchema.safeParse(payload);
      expect(result.success).toBe(true);
    }
  });

  it("accepts every declared payment status", () => {
    for (const status of PAYMENT_STATUSES) {
      const result = onboardingSchema.safeParse(
        validOnboarding({ paymentStatus: status }),
      );
      expect(result.success).toBe(true);
    }
  });
});

// ─── onboardingSchema: length bounds ─────────────────────────────────────────

describe("quickOnboardingSchema length bounds", () => {
  it("accepts a 100-char name and rejects a 101-char name (Req 4.1)", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ fullName: "a".repeat(100) }))
        .success,
    ).toBe(true);
    expect(
      onboardingSchema.safeParse(validOnboarding({ fullName: "a".repeat(101) }))
        .success,
    ).toBe(false);
  });

  it("rejects an empty name (Req 4.1)", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ fullName: "" })).success,
    ).toBe(false);
  });

  it("accepts 500-char allergies and rejects 501-char allergies (Req 4.3)", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ allergies: "a".repeat(500) }))
        .success,
    ).toBe(true);
    expect(
      onboardingSchema.safeParse(validOnboarding({ allergies: "a".repeat(501) }))
        .success,
    ).toBe(false);
  });

  it("treats allergies as optional (Req 4.3)", () => {
    const payload = validOnboarding();
    delete (payload as Record<string, unknown>).allergies;
    expect(onboardingSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an invalid mobile number", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ mobile: "12345" })).success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse(validOnboarding({ mobile: "5876543210" }))
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid planId", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ planId: "plan-1" })).success,
    ).toBe(false);
  });
});

// ─── onboardingSchema: email length / format edges ───────────────────────────

describe("quickOnboardingSchema email edges (Req 10.2, 9.2)", () => {
  it("treats email as optional", () => {
    const payload = validOnboarding();
    delete (payload as Record<string, unknown>).email;
    expect(onboardingSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(
      onboardingSchema.safeParse(validOnboarding({ email: "not-an-email" }))
        .success,
    ).toBe(false);
  });

  it("rejects an email longer than 254 characters", () => {
    // local(243) + "@" + "example.com"(11) = 255 chars
    const longEmail = `${"a".repeat(243)}@example.com`;
    expect(longEmail.length).toBe(255);
    expect(
      onboardingSchema.safeParse(validOnboarding({ email: longEmail })).success,
    ).toBe(false);
  });

  it("accepts an email exactly 254 characters", () => {
    const email254 = `${"a".repeat(242)}@example.com`;
    expect(email254.length).toBe(254);
    expect(
      onboardingSchema.safeParse(validOnboarding({ email: email254 })).success,
    ).toBe(true);
  });
});

// ─── addressCaptureSchema: length bounds & required flat ──────────────────────

describe("addressCaptureSchema length bounds and required flat (Req 5.4)", () => {
  it("accepts a valid address", () => {
    expect(addressSchema.safeParse(validAddress()).success).toBe(true);
  });

  it("rejects a missing/empty flat number (Req 5.4)", () => {
    expect(
      addressSchema.safeParse(validAddress({ flatNumber: "" })).success,
    ).toBe(false);
  });

  it("accepts a 50-char flat number and rejects a 51-char one", () => {
    expect(
      addressSchema.safeParse(validAddress({ flatNumber: "a".repeat(50) }))
        .success,
    ).toBe(true);
    expect(
      addressSchema.safeParse(validAddress({ flatNumber: "a".repeat(51) }))
        .success,
    ).toBe(false);
  });

  it("accepts a 20-char floor number and rejects a 21-char one", () => {
    expect(
      addressSchema.safeParse(validAddress({ floorNumber: "a".repeat(20) }))
        .success,
    ).toBe(true);
    expect(
      addressSchema.safeParse(validAddress({ floorNumber: "a".repeat(21) }))
        .success,
    ).toBe(false);
  });

  it("treats floor number as optional", () => {
    const addr = validAddress();
    delete (addr as Record<string, unknown>).floorNumber;
    expect(addressSchema.safeParse(addr).success).toBe(true);
  });

  it("accepts a 255-char searchText and rejects a 256-char one", () => {
    expect(
      addressSchema.safeParse(validAddress({ searchText: "a".repeat(255) }))
        .success,
    ).toBe(true);
    expect(
      addressSchema.safeParse(validAddress({ searchText: "a".repeat(256) }))
        .success,
    ).toBe(false);
  });

  it("treats searchText as optional", () => {
    const addr = validAddress();
    delete (addr as Record<string, unknown>).searchText;
    expect(addressSchema.safeParse(addr).success).toBe(true);
  });

  it("defaults the tag to Home when omitted (Req 5.1)", () => {
    const addr = validAddress();
    delete (addr as Record<string, unknown>).tag;
    const result = addressSchema.safeParse(addr);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tag).toBe("Home");
    }
  });

  it("rejects an invalid tag", () => {
    expect(
      addressSchema.safeParse(validAddress({ tag: "Warehouse" })).success,
    ).toBe(false);
  });

  it("rejects missing auto-filled locality fields", () => {
    expect(addressSchema.safeParse(validAddress({ area: "" })).success).toBe(
      false,
    );
    expect(addressSchema.safeParse(validAddress({ city: "" })).success).toBe(
      false,
    );
    expect(addressSchema.safeParse(validAddress({ state: "" })).success).toBe(
      false,
    );
  });
});

// ─── addressCaptureSchema: serviceability superRefine ─────────────────────────

describe("addressCaptureSchema serviceability superRefine (Req 5.6)", () => {
  it("accepts a pincode inside the sample service area", () => {
    for (const pincode of SERVICE_AREA) {
      expect(addressSchema.safeParse(validAddress({ pincode })).success).toBe(
        true,
      );
    }
  });

  it("rejects a pincode outside the sample service area", () => {
    const result = addressSchema.safeParse(validAddress({ pincode: "110001" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => issue.message)
        .join(" ");
      expect(message).toContain("110001");
    }
  });

  it("rejects every pincode when the service area is empty (default schema)", () => {
    const result = addressCaptureSchema.safeParse(validAddress());
    expect(result.success).toBe(false);
  });

  it("rejects a malformed pincode even if it appears in the service area", () => {
    const schema = createAddressCaptureSchema(["50008"]);
    expect(addressSchema.safeParse(validAddress({ pincode: "50008" })).success).toBe(
      false,
    );
    // With a syntactically invalid member, still not serviceable.
    expect(schema.safeParse(validAddress({ pincode: "50008" })).success).toBe(
      false,
    );
  });
});

// ─── realEmailSchema: length / format edges (Req 10.2, 10.5) ──────────────────

describe("realEmailSchema email length/format edges", () => {
  it("accepts a valid email", () => {
    expect(realEmailSchema.safeParse("real@example.com").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(realEmailSchema.safeParse("").success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(realEmailSchema.safeParse("nope").success).toBe(false);
    expect(realEmailSchema.safeParse("a@b").success).toBe(false);
  });

  it("accepts an email exactly 254 characters", () => {
    const email254 = `${"a".repeat(242)}@example.com`;
    expect(email254.length).toBe(254);
    expect(realEmailSchema.safeParse(email254).success).toBe(true);
  });

  it("rejects an email longer than 254 characters", () => {
    const email255 = `${"a".repeat(243)}@example.com`;
    expect(email255.length).toBe(255);
    expect(realEmailSchema.safeParse(email255).success).toBe(false);
  });
});

// ─── profileCompletionSchema: all-optional (Req 9.2) ─────────────────────────

describe("profileCompletionSchema all-optional behavior (Req 9.2)", () => {
  it("accepts an empty object", () => {
    expect(profileCompletionSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a subset of valid fields", () => {
    expect(
      profileCompletionSchema.safeParse({ gender: "Male" }).success,
    ).toBe(true);
    expect(
      profileCompletionSchema.safeParse({
        dateOfBirth: "1990-05-12",
        dietaryPreference: "Non-Veg",
      }).success,
    ).toBe(true);
  });

  it("format-validates dateOfBirth when present", () => {
    expect(
      profileCompletionSchema.safeParse({ dateOfBirth: "12-05-1990" }).success,
    ).toBe(false);
    expect(
      profileCompletionSchema.safeParse({ dateOfBirth: "2020-01-01" }).success,
    ).toBe(true);
  });

  it("format-validates gender enum when present", () => {
    expect(
      profileCompletionSchema.safeParse({ gender: "Nope" }).success,
    ).toBe(false);
  });

  it("format-validates dietaryPreference enum when present", () => {
    expect(
      profileCompletionSchema.safeParse({ dietaryPreference: "Vegan" }).success,
    ).toBe(false);
  });

  it("enforces allergies length (<=500) when present", () => {
    expect(
      profileCompletionSchema.safeParse({ allergies: "a".repeat(500) }).success,
    ).toBe(true);
    expect(
      profileCompletionSchema.safeParse({ allergies: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("enforces medicalHistoryNotes length (<=2000) when present", () => {
    expect(
      profileCompletionSchema.safeParse({
        medicalHistoryNotes: "a".repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      profileCompletionSchema.safeParse({
        medicalHistoryNotes: "a".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("format-validates email when present, including length edges", () => {
    expect(
      profileCompletionSchema.safeParse({ email: "bad" }).success,
    ).toBe(false);
    const email254 = `${"a".repeat(242)}@example.com`;
    expect(
      profileCompletionSchema.safeParse({ email: email254 }).success,
    ).toBe(true);
    const email255 = `${"a".repeat(243)}@example.com`;
    expect(
      profileCompletionSchema.safeParse({ email: email255 }).success,
    ).toBe(false);
  });
});

// ─── onboardingSchema: KIT category conditional validation (Req 2.1, 2.2, 2.3) ───

describe("quickOnboardingSchema KIT category conditional validation", () => {
  it("accepts a valid KIT category payload with kitProductId and kitDurationDays", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitDurationDays: 30,
      planId: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(true);
  });

  it("rejects KIT category when kitProductId is missing", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitDurationDays: 30,
      planId: undefined,
      kitProductId: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        "KIT product selection is required for KIT category.",
      );
    }
  });

  it("rejects KIT category when kitDurationDays is missing", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      planId: undefined,
      kitDurationDays: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        "Kit duration (days) is required for KIT category.",
      );
    }
  });

  it("rejects KIT category when kitProductId is not a valid UUID", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "invalid-uuid",
      kitDurationDays: 30,
      planId: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("Select a valid KIT product.");
    }
  });

  it("rejects KIT category when kitDurationDays is not a positive integer", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitDurationDays: 0,
      planId: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("Kit duration must be at least 1 day.");
    }
  });

  it("rejects KIT category when kitDurationDays is a decimal", () => {
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitDurationDays: 30.5,
      planId: undefined,
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("Kit duration must be a whole number.");
    }
  });

  it("accepts MEAL category with planId and without KIT fields", () => {
    const mealPayload = validOnboarding({
      primaryCategory: "MEAL",
      planId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitProductId: undefined,
      kitDurationDays: undefined,
    });
    const result = onboardingSchema.safeParse(mealPayload);
    expect(result.success).toBe(true);
  });

  it("rejects MEAL category when planId is missing", () => {
    const mealPayload = validOnboarding({
      primaryCategory: "MEAL",
      planId: undefined,
      kitProductId: undefined,
      kitDurationDays: undefined,
    });
    const result = onboardingSchema.safeParse(mealPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        "Subscription plan is required for MEAL category.",
      );
    }
  });

  it("accepts KIT category with planId present but ignores it", () => {
    // KIT category doesn't require planId to be absent, just kitProductId and kitDurationDays to be present
    const kitPayload = validOnboarding({
      primaryCategory: "KIT",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitDurationDays: 30,
      planId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f", // Even if present
    });
    const result = onboardingSchema.safeParse(kitPayload);
    expect(result.success).toBe(true);
  });

  it("accepts MEAL category with KIT fields present but ignores them", () => {
    // MEAL category doesn't require KIT fields to be absent, just planId to be present
    const mealPayload = validOnboarding({
      primaryCategory: "MEAL",
      planId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f",
      kitProductId: "3f1e9c6a-2b7d-4c8e-9f10-1a2b3c4d5e6f", // Even if present
      kitDurationDays: 30,
    });
    const result = onboardingSchema.safeParse(mealPayload);
    expect(result.success).toBe(true);
  });
});
