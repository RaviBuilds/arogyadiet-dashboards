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
//
// Past-date flexibility extension (Requirements 8.1–8.7):
//   - pastDateEnabled: boolean flag to enable past-date start date selection
//   - automationOverrideAcknowledged: acknowledge automation re-run for tomorrow after 5 PM
//   - pastDayStatuses: array capturing delivery history for past days

import { z } from "zod";
import { CUSTOMER_CATEGORIES } from "@/lib/onboarding/category";
import {
  createAddressCaptureSchema,
} from "@/validations/addressCaptureSchema";
import {
  istDateStringOf,
  istHourOf,
  addDaysToISODate,
} from "@/lib/dates/ist";
import {
  earliestStartDate,
  ONBOARDING_CUTOFF_HOUR_IST,
} from "@/lib/onboarding/cutoff";

/** Re-export the canonical Customer_Category set for form/enum use (Req 13.2). */
export { CUSTOMER_CATEGORIES } from "@/lib/onboarding/category";

/** Payment status values relevant to onboarding (Req 4.4, 8.1). */
export const PAYMENT_STATUSES = ["PAID", "PENDING"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ─── Past Day Status Entry Schema (Req 8.2) ──────────────────────────────────
// Each entry captures the delivery outcome for one past day. Per-entry
// superRefine ensures Delivered days have mealType + deliveryAddress.

export const MEAL_STATUSES = ["Delivered", "Skipped"] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

export const MEAL_TYPES = ["VEG", "EGG", "CHICKEN"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const DELIVERY_ADDRESSES = ["Primary", "Secondary"] as const;
export type DeliveryAddress = (typeof DELIVERY_ADDRESSES)[number];

/** Zod schema for a single past day status entry with conditional refinement. */
export const pastDayStatusEntrySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format."),
    mealStatus: z.enum(MEAL_STATUSES),
    mealType: z.enum(MEAL_TYPES).nullable(),
    deliveryAddress: z.enum(DELIVERY_ADDRESSES).nullable(),
  })
  .superRefine((entry, ctx) => {
    if (entry.mealStatus === "Delivered") {
      if (!entry.mealType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mealType"],
          message: "Meal type required for delivered days.",
        });
      }
      if (!entry.deliveryAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryAddress"],
          message: "Address required for delivered days.",
        });
      }
    }
  });

export type PastDayStatusEntry = z.infer<typeof pastDayStatusEntrySchema>;

/**
 * Build the Quick_Onboarding_Form schema bound to a franchise's serviceable
 * pincodes so the nested address is validated against the real service area.
 *
 * @param serviceAreaPincodes the serviceable pincodes for the admin's franchise
 * @param skipServiceabilityCheck if true, skips the serviceability validation (for KIT category)
 * @param now optional Date override for deterministic testing of cutoff/past-date rules
 */
export function createQuickOnboardingSchema(
  serviceAreaPincodes: string[] = [],
  skipServiceabilityCheck: boolean = false,
  now: Date = new Date(),
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

      // Optional manual clinic assignment (for KIT customers).
      clinicId: z.string().uuid("Select a valid clinic.").optional(),

      // Optional Dietitian_Link selected during onboarding (dietitian-management,
      // Req 7.1–7.7 for MEAL, Req 9.1–9.4 for ACCOMMODATION). Persisted inside the
      // same atomic operation that creates the Customer_Record.
      dietitianId: z.string().uuid("Select a valid dietitian.").optional(),

      // Req 4.5 / 5: primary address captured via Address_Capture.
      address: createAddressCaptureSchema(serviceAreaPincodes, skipServiceabilityCheck),

      // ─── Past-date flexibility fields (Req 8.1–8.7) ─────────────────────
      // Req 8.1: boolean flag to enable past-date start date selection.
      pastDateEnabled: z.boolean().default(false),

      // Req 8.6: acknowledgment for automation override when selecting tomorrow after 5 PM.
      automationOverrideAcknowledged: z.boolean().default(false),

      // Req 8.2: array of past day status entries with per-entry validation.
      pastDayStatuses: z.array(pastDayStatusEntrySchema).optional().default([]),
    })
    .superRefine((data, ctx) => {
      // ─── Existing category-based conditional validation ────────────────
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

      // ─── Past-date conditional rules (Req 8.3–8.5, 8.7) ──────────────
      const istToday = istDateStringOf(now);
      const istHour = istHourOf(now);

      if (data.pastDateEnabled) {
        // Req 8.3: pastDayStatuses must have 1–30 entries when past-date mode is active
        if (!data.pastDayStatuses || data.pastDayStatuses.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pastDayStatuses"],
            message: "Past day statuses are required when past-date mode is enabled.",
          });
        } else if (data.pastDayStatuses.length > 30) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pastDayStatuses"],
            message: "Past day statuses cannot exceed 30 entries.",
          });
        }

        // Req 8.4: startDate must be earlier than today and within 30 days of today
        if (data.startDate) {
          const thirtyDaysAgo = addDaysToISODate(istToday, -30);
          if (data.startDate >= istToday) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["startDate"],
              message: "Start date must be earlier than today when past-date mode is enabled.",
            });
          } else if (data.startDate < thirtyDaysAgo) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["startDate"],
              message: "Start date cannot be more than 30 days in the past.",
            });
          }
        }
      } else {
        // Req 8.5: When pastDateEnabled is false, enforce existing cutoff rules.
        // Only validate for non-KIT categories that have a start date.
        if (data.primaryCategory !== "KIT" && data.startDate) {
          const tomorrow = addDaysToISODate(istToday, 1);

          // Req 8.7: When automationOverrideAcknowledged is true, allow tomorrow
          // even after 5 PM IST cutoff.
          if (
            data.automationOverrideAcknowledged &&
            data.startDate === tomorrow &&
            istHour >= ONBOARDING_CUTOFF_HOUR_IST
          ) {
            // Allowed — admin acknowledged automation override for tomorrow after 5 PM
          } else {
            // Standard cutoff validation
            const earliest = earliestStartDate(now);
            if (data.startDate < earliest) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["startDate"],
                message: `Start date must be on or after ${earliest}.`,
              });
            }
          }
        }
      }
    });
}

/**
 * Default Quick_Onboarding_Form schema with no serviceable pincodes bound.
 * The action layer rebuilds it via {@link createQuickOnboardingSchema} with the
 * resolved service area so the address serviceability check is meaningful.
 *
 * For past-date and cutoff validation, this static schema evaluates against
 * the current wall-clock time at parse-time. Use createQuickOnboardingSchema
 * with a `now` parameter for deterministic testing.
 */
export const quickOnboardingSchema = createQuickOnboardingSchema([], false);

export type QuickOnboardingInput = z.infer<typeof quickOnboardingSchema>;
