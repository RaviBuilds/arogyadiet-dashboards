// src/validations/onboardingSchema.ts
//
// Zod schema for the admin Quick_Onboarding_Form payload. Reuses the shared
// Customer_Category set from the pure onboarding logic and the map-based
// Address_Capture schema so form validation, server-action re-validation, and
// the OnboardingService all share one definition.
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 9.2 (email), 10.2, 13.2
//   Cross-field rules that depend on runtime state (start date vs 5 PM cutoff,
//   PAID precondition, duplicate mobile) are enforced in the action/service
//   layer, not here.

import { z } from "zod";
import { CUSTOMER_CATEGORIES } from "@/lib/onboarding/category";
import {
  addressCaptureSchema,
  createAddressCaptureSchema,
} from "@/validations/addressCaptureSchema";

/** Re-export the canonical Customer_Category set for form/enum use (Req 13.2). */
export { CUSTOMER_CATEGORIES } from "@/lib/onboarding/category";

/** Payment status values relevant to onboarding (Req 4.4, 8.1). */
export const PAYMENT_STATUSES = ["PAID", "PENDING"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Build the Quick_Onboarding_Form schema bound to a franchise's serviceable
 * pincodes so the nested address is validated against the real service area.
 *
 * @param serviceAreaPincodes the serviceable pincodes for the admin's franchise
 * @param skipServiceabilityCheck if true, skips the serviceability validation (for KIT category)
 */
export function createQuickOnboardingSchema(
  serviceAreaPincodes: string[] = [],
  skipServiceabilityCheck: boolean = false,
) {
  return z
    .object({
      // Req 4.1: required priority info.
      fullName: z
        .string()
        .min(1, "Name is required.")
        .max(100, "Name must be at most 100 characters."),
      mobile: z
        .string()
        .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."),
      gender: z.enum(["Male", "Female", "Other"]),

      // Req 4.2: diet preference limited to Veg/Non-Veg.
      dietaryPreference: z.enum(["Veg", "Non-Veg"]),

      // Req 4.3: optional allergies up to 500 characters.
      allergies: z
        .string()
        .max(500, "Allergies must be at most 500 characters.")
        .optional(),

      // Req 10.2: optional admin-entered email (real or placeholder Test_Email).
      email: z
        .string()
        .max(254, "Email must be at most 254 characters.")
        .email("Enter a valid email address.")
        .optional(),
      isTestEmail: z.boolean().default(false),

      // Req 13.2: exactly one Primary_Category.
      primaryCategory: z.enum(CUSTOMER_CATEGORIES),

      // Req 4.4: subscription plan (conditional based on category).
      planId: z.string().uuid("Select a valid subscription plan.").optional(),

      // KIT-specific fields (Req 2.1, 2.2, 2.3).
      kitProductId: z.string().uuid("Select a valid KIT product.").optional(),
      kitDurationDays: z.coerce.number().int("Kit duration must be a whole number.").positive("Kit duration must be at least 1 day.").optional(),

      startDate: z.string().optional(), // ISO date; required for MEAL, optional for KIT
      paymentStatus: z.enum(PAYMENT_STATUSES),

      // Initial meal preference for daily preferences (VEG, EGG, or CHICKEN).
      // This sets the default meal type for entire subscription period.
      initialMealPreference: z.enum(["VEG", "EGG", "CHICKEN"], {
        message: "Select an initial meal preference.",
      }),

      // Req 7.2/7.3: cutoff acknowledgment (gating enforced in the UI/action).
      cutoffAcknowledged: z.boolean().default(false),

      // Req 4.5 / 5: primary address captured via Address_Capture.
      address: createAddressCaptureSchema(serviceAreaPincodes, skipServiceabilityCheck),
    })
    .superRefine((data, ctx) => {
      // Conditional validation based on primaryCategory (Req 2.1, 2.2, 2.3).
      if (data.primaryCategory === "KIT") {
        // KIT category requires kitProductId and kitDurationDays
        if (!data.kitProductId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["kitProductId"],
            message: "KIT product selection is required for KIT category.",
          });
        }
        if (!data.kitDurationDays) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["kitDurationDays"],
            message: "Kit duration (days) is required for KIT category.",
          });
        }
        // startDate is NOT required for KIT
      } else {
        // MEAL/Accommodation category requires startDate
        if (!data.startDate || data.startDate.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["startDate"],
            message: "Start date is required.",
          });
        }
        if (data.primaryCategory === "MEAL" && !data.planId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["planId"],
            message: "Subscription plan is required for MEAL category.",
          });
        }
      }
    });
}

/**
 * Default Quick_Onboarding_Form schema with no serviceable pincodes bound.
 * The action layer rebuilds it via {@link createQuickOnboardingSchema} with the
 * resolved service area so the address serviceability check is meaningful.
 */
export const quickOnboardingSchema = z
  .object({
    fullName: z
      .string()
      .min(1, "Name is required.")
      .max(100, "Name must be at most 100 characters."),
    mobile: z
      .string()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."),
    gender: z.enum(["Male", "Female", "Other"]),
    dietaryPreference: z.enum(["Veg", "Non-Veg"]),
    allergies: z
      .string()
      .max(500, "Allergies must be at most 500 characters.")
      .optional(),
    email: z
      .string()
      .max(254, "Email must be at most 254 characters.")
      .email("Enter a valid email address.")
      .optional(),
    isTestEmail: z.boolean().default(false),
    primaryCategory: z.enum(CUSTOMER_CATEGORIES),
    planId: z.string().uuid("Select a valid subscription plan.").optional(),
    kitProductId: z.string().uuid("Select a valid KIT product.").optional(),
    kitDurationDays: z.coerce.number().int("Kit duration must be a whole number.").positive("Kit duration must be at least 1 day.").optional(),
    startDate: z.string().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES),
    initialMealPreference: z.enum(["VEG", "EGG", "CHICKEN"], {
      message: "Select an initial meal preference.",
    }),
    cutoffAcknowledged: z.boolean().default(false),
    address: addressCaptureSchema,
  })
  .superRefine((data, ctx) => {
    // Conditional validation based on primaryCategory (Req 2.1, 2.2, 2.3).
    if (data.primaryCategory === "KIT") {
      // KIT category requires kitProductId and kitDurationDays
      if (!data.kitProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kitProductId"],
          message: "KIT product selection is required for KIT category.",
        });
      }
      if (!data.kitDurationDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kitDurationDays"],
          message: "Kit duration (days) is required for KIT category.",
        });
      }
    } else {
      // MEAL/Accommodation category requires startDate
      if (!data.startDate || data.startDate.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "Start date is required.",
        });
      }
      if (data.primaryCategory === "MEAL" && !data.planId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["planId"],
          message: "Subscription plan is required for MEAL category.",
        });
      }
    }
  });

export type QuickOnboardingInput = z.infer<typeof quickOnboardingSchema>;
