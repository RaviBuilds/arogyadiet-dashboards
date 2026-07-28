// src/validations/accommodationSchema.ts
//
// Zod validation schemas for the Accommodation Customer Flow feature.
// Covers onboarding, stay management, health logging, and add-on services.
//
// Validates: Requirements 1.2, 1.3, 1.7, 2.1, 2.2, 5.6, 9.1, 9.4, 13.5, 14.1

import { z } from "zod";

/**
 * Schema for accommodation-specific onboarding in the Quick_Onboard_Form.
 *
 * Includes conditional validation via superRefine:
 * - When `isSharedPayment` is true, `paymentHostMobile` is required.
 * - When `isSharedPayment` is false, `paymentAmount` must be present and > 0.
 *
 * Validates: Requirements 1.2, 1.3, 1.7, 2.1, 2.2
 */
export const accommodationOnboardingSchema = z
  .object({
    fullName: z.string().min(1).max(100),
    mobile: z.string().regex(/^[6-9]\d{9}$/),
    gender: z.enum(["Male", "Female", "Other"]),
    dietaryPreference: z.enum(["Veg", "Non-Veg"]),
    allergies: z.string().max(500).optional(),
    email: z.string().email().max(254).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    totalNights: z.coerce.number().int().min(1).max(365),
    stayType: z.enum(["AC Villa", "Village Style Hut"]),
    occupancyType: z.enum(["Single", "Double"]),
    mealPreference: z.enum(["VEG", "EGG", "CHICKEN"]),
    paymentAmount: z.coerce.number().min(1).max(9999999).optional(),
    isSharedPayment: z.boolean().default(false),
    paymentHostMobile: z
      .string()
      .regex(/^[6-9]\d{9}$/)
      .optional(),
    // Admin-set temporary PIN for the customer's first login (mirrors the
    // mandatory Temp PIN field on the generic Quick Onboard flow).
    tempPin: z.string().regex(/^\d{6}$/, "Temporary PIN must be exactly 6 digits."),
    // Optional Dietitian_Link selected in the Category & Plan step
    // (dietitian-management, Req 9.1–9.4). Persisted atomically with the
    // Customer_Record.
    dietitianUserId: z.string().uuid("Select a valid dietitian.").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isSharedPayment) {
      if (!data.paymentHostMobile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentHostMobile"],
          message:
            "Payment host mobile number is required for shared payment.",
        });
      }
    } else {
      if (!data.paymentAmount || data.paymentAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentAmount"],
          message:
            "Payment amount is required and must be greater than zero.",
        });
      }
    }
  });

/** Inferred input type for the accommodation onboarding form. */
export type AccommodationOnboardingInput = z.infer<
  typeof accommodationOnboardingSchema
>;

/**
 * Schema for extending an active stay.
 *
 * Validates additional nights (1–365) and a required payment amount
 * that will have GST breakup applied (18% inclusive).
 *
 * Validates: Requirements 14.1
 */
export const extendStaySchema = z.object({
  additionalNights: z.coerce.number().int().min(1).max(365),
  paymentAmount: z.coerce.number().min(1).max(9999999),
});

/** Inferred input type for extending a stay. */
export type ExtendStayInput = z.infer<typeof extendStaySchema>;

/**
 * Schema for creating a new stay entry for returning guests.
 *
 * Covers all required fields for a fresh stay: dates, accommodation type,
 * occupancy, payment, and meal preference.
 *
 * Validates: Requirements 13.5
 */
export const createStaySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalNights: z.coerce.number().int().min(1).max(365),
  stayType: z.enum(["AC Villa", "Village Style Hut"]),
  occupancyType: z.enum(["Single", "Double"]),
  paymentAmount: z.coerce.number().min(1).max(9999999),
  mealPreference: z.enum(["VEG", "EGG", "CHICKEN"]),
});

/** Inferred input type for creating a new stay entry. */
export type CreateStayInput = z.infer<typeof createStaySchema>;

/**
 * Schema for customer-submitted daily health log entries.
 *
 * Includes conditional validation via superRefine:
 * - When `activityDurationMinutes` is provided, `activityName` must be
 *   non-empty (trimmed) to ensure duration always has a named activity.
 *
 * Validates: Requirements 9.1, 9.4
 */
export const customerHealthLogSchema = z
  .object({
    waterIntakeLiters: z.coerce
      .number()
      .min(0.1)
      .max(15.0)
      .multipleOf(0.1),
    activityName: z.string().max(100).optional(),
    activityDurationMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.activityDurationMinutes && !data.activityName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activityName"],
        message: "Activity name is required when duration is provided.",
      });
    }
  });

/** Inferred input type for customer health log submission. */
export type CustomerHealthLogInput = z.infer<typeof customerHealthLogSchema>;

/**
 * Schema for admin-submitted daily health monitoring data.
 *
 * All metric fields are optional — the admin may record only the metrics
 * measured during a particular checkup session.
 *
 * Validates: Requirements 5.6
 */
export const adminHealthLogSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.coerce.number().min(30.0).max(300.0).optional(),
  bpSystolic: z.coerce.number().int().min(60).max(250).optional(),
  bpDiastolic: z.coerce.number().int().min(40).max(150).optional(),
  sugarLevelMgdl: z.coerce.number().int().min(30).max(600).optional(),
  notes: z.string().max(500).optional(),
});

/** Inferred input type for admin health log submission. */
export type AdminHealthLogInput = z.infer<typeof adminHealthLogSchema>;

/**
 * Schema for requesting an add-on wellness service.
 *
 * Only requires a non-empty service type string — the available services
 * are managed in the UI layer and validated against the service catalog
 * at the action/service layer.
 */
export const addonServiceRequestSchema = z.object({
  serviceType: z.string().min(1),
});

/** Inferred input type for add-on service requests. */
export type AddonServiceRequestInput = z.infer<
  typeof addonServiceRequestSchema
>;
