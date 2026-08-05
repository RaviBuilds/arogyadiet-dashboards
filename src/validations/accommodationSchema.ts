// src/validations/accommodationSchema.ts
//
// Zod validation schemas for the Accommodation Customer Flow feature.
// Covers onboarding, stay management, health logging, and add-on services.
//
// The accommodation-payment-lifecycle feature extends this file with the
// backdated-stay toggle, the total/advance onboarding payment split, and the
// Record Payment / Record Refund / Early Checkout schemas. Every range here is
// enforced server-side regardless of whether the field was visible (or even
// rendered) on the client.
//
// Validates: Requirements 1.2, 1.3, 1.7, 2.1, 2.2, 5.6, 9.1, 9.4, 13.5, 14.1

import { z } from "zod";
import { addDaysToISODate, getISTDateString } from "@/lib/dates/ist";

/** Maximum rupee amount accepted by any accommodation money field. */
export const MAX_STAY_AMOUNT = 9999999;

/** Maximum number of days before today an admin may backdate a stay start. */
export const MAX_BACKDATED_DAYS = 30;

/** Maximum number of days ahead of today a stay start may be scheduled. */
export const MAX_FORWARD_START_DAYS = 365;

/** Terse `superRefine` issue helper keeping the refine blocks readable. */
function addIssue(
  ctx: z.RefinementCtx,
  path: string,
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message,
  });
}

/**
 * Schema for accommodation-specific onboarding in the Quick_Onboard_Form.
 *
 * Includes conditional validation via superRefine:
 * - When `isSharedPayment` is true, `paymentHostMobile` is required.
 * - When `isSharedPayment` is false, both `totalStayAmount` and
 *   `advanceAmountPaid` are required, and the advance may not exceed the total.
 * - A past `startDate` requires `backdatedStayEnabled` and must fall within
 *   30 days before today (IST); with the toggle on, the date must be in the
 *   past; with it off, the date may not exceed today + 365 days.
 *
 * Validates: Requirements 1.2, 1.3, 1.7, 2.1, 2.2, 3.4, 3.5, 4.2, 4.3, 4.4
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
    /**
     * Legacy single payment amount. Superseded by `totalStayAmount` /
     * `advanceAmountPaid` (Req 4.1); retained as optional so existing callers
     * keep compiling. New code MUST use the total/advance pair.
     *
     * @deprecated Use `totalStayAmount` and `advanceAmountPaid`.
     */
    paymentAmount: z.coerce.number().min(1).max(MAX_STAY_AMOUNT).optional(),
    /** Backdated_Stay_Toggle — unlocks Past_Stay_Start selection (Req 1.1, 3.4). */
    backdatedStayEnabled: z.boolean().default(false),
    /** Total_Stay_Amount inclusive of 18% GST (Req 4.2). */
    totalStayAmount: z.coerce.number().min(1).max(MAX_STAY_AMOUNT).optional(),
    /** Advance_Amount collected at onboarding; 0 means "no advance" (Req 4.3). */
    advanceAmountPaid: z.coerce.number().min(0).max(MAX_STAY_AMOUNT).optional(),
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
    // OPTIONAL. `.optional()` alone only permits `undefined`, so an empty string
    // from an untouched dropdown would reach `.uuid()` and reject the whole
    // onboarding. Empty is normalised to "no dietitian" downstream.
    dietitianUserId: z
      .string()
      .uuid("Select a valid dietitian.")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    // ── Payment split (Req 4.2, 4.3, 4.4) ────────────────────────────────────
    // Enforced server-side even when the fields were hidden client-side.
    if (data.isSharedPayment) {
      if (!data.paymentHostMobile) {
        addIssue(
          ctx,
          "paymentHostMobile",
          "Payment host mobile number is required for shared payment.",
        );
      }
    } else {
      if (data.totalStayAmount == null) {
        addIssue(ctx, "totalStayAmount", "Total stay amount is required.");
      }
      if (data.advanceAmountPaid == null) {
        addIssue(
          ctx,
          "advanceAmountPaid",
          "Advance amount paid is required (enter 0 if none).",
        );
      }
      if (
        data.totalStayAmount != null &&
        data.advanceAmountPaid != null &&
        data.advanceAmountPaid > data.totalStayAmount
      ) {
        addIssue(
          ctx,
          "advanceAmountPaid",
          "Advance amount cannot exceed the total stay amount.",
        );
      }
    }

    // ── Start date ranges (Req 1.2, 1.3, 3.4, 3.5) ───────────────────────────
    const today = getISTDateString(0);

    if (data.startDate < today) {
      if (!data.backdatedStayEnabled) {
        addIssue(
          ctx,
          "startDate",
          "Backdated stay entry must be enabled to select a past start date.",
        );
      }
      if (data.startDate < addDaysToISODate(today, -MAX_BACKDATED_DAYS)) {
        addIssue(
          ctx,
          "startDate",
          "Start date exceeds the maximum 30-day backdated range.",
        );
      }
    } else if (data.backdatedStayEnabled) {
      addIssue(
        ctx,
        "startDate",
        "With backdated stay enabled, the start date must be in the past.",
      );
    } else if (
      data.startDate > addDaysToISODate(today, MAX_FORWARD_START_DAYS)
    ) {
      addIssue(
        ctx,
        "startDate",
        "Start date cannot be more than 365 days in the future.",
      );
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
 * Shape unchanged, but `paymentAmount` is now interpreted as the additional
 * cost folded into Total_Stay_Amount (Req 11.1), not as a payment received.
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

// The admin health log schema was removed along with the Accommodation tab's
// "Record Health Metrics" form. Staff readings are now captured only through the
// Dietitian's Health_Log form, which validates against `healthLogSchema` in
// `src/validations/dietitian/`. The `admin_health_logs` table is retained and
// still surfaced read-only via `v_health_log_timeline`.

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
// ─── Stay payment lifecycle ───────────────────────────────────────────────────
//
// The upper bound of every amount below is additionally constrained at write
// time by the row-locking RPC (remaining balance / refundable excess), which is
// the only authoritative source for those limits. These schemas cover the
// static ranges so no out-of-range value ever reaches the database.

/**
 * Schema for the Accommodation_Tab "Record Payment" form.
 *
 * Amount must be greater than zero; the comment is required (trimmed) and the
 * remark is optional, both capped at 500 characters. The amount ≤ remaining
 * balance check is enforced by `record_stay_payment_transaction`.
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.7
 */
export const recordStayPaymentSchema = z.object({
  amount: z.coerce
    .number()
    .gt(0, "Amount must be greater than zero.")
    .max(MAX_STAY_AMOUNT),
  comment: z.string().trim().min(1, "A comment is required.").max(500),
  remark: z.string().trim().max(500).optional(),
});

/** Inferred input type for recording a partial/balance payment. */
export type RecordStayPaymentInput = z.infer<typeof recordStayPaymentSchema>;

/**
 * Schema for the Accommodation_Tab "Record Refund" form.
 *
 * Mirrors Record Payment with the required/optional text fields swapped: the
 * remark describing how the refund was initiated is mandatory, the comment is
 * optional. The amount ≤ refundable excess check is enforced by
 * `record_stay_payment_transaction`.
 *
 * Validates: Requirements 12.9, 12.10
 */
export const recordStayRefundSchema = z.object({
  amount: z.coerce
    .number()
    .gt(0, "Refund amount must be greater than zero.")
    .max(MAX_STAY_AMOUNT),
  remark: z
    .string()
    .trim()
    .min(
      1,
      "A remark describing how the refund was initiated is required.",
    )
    .max(500),
  comment: z.string().trim().max(500).optional(),
});

/** Inferred input type for recording a refund. */
export type RecordStayRefundInput = z.infer<typeof recordStayRefundSchema>;

/**
 * Base schema for the Early_Checkout form.
 *
 * `actualNightsStayed` carries only its lower bound here; the upper bound
 * depends on the stay's currently booked total nights and is applied by
 * `createEarlyCheckoutSchema`.
 *
 * Validates: Requirements 12.3, 12.4
 */
export const earlyCheckoutSchema = z.object({
  actualNightsStayed: z.coerce.number().int().min(1),
  recalculatedStayAmount: z.coerce.number().min(1).max(MAX_STAY_AMOUNT),
});

/** Inferred input type for the early checkout form. */
export type EarlyCheckoutInput = z.infer<typeof earlyCheckoutSchema>;

/**
 * Builds an Early_Checkout schema bounded by the stay's currently booked total
 * nights: `actualNightsStayed` must be an integer in
 * `[1, bookedTotalNights − 1]`. Used on both the client and the server so the
 * bound holds regardless of client-side state.
 *
 * The upper bound is `bookedTotalNights − 1` with no floor applied: for a
 * one-night stay the range collapses to `[1, 0]`, which is deliberately empty —
 * a guest cannot have stayed fewer than one night, so *every* Early_Checkout
 * submission against a one-night stay must be rejected (Req 12.3). Flooring the
 * cap at 1 would make `actualNightsStayed = 1` satisfy both bounds and wrongly
 * accept a checkout that is not early at all. The message interpolates
 * `bookedTotalNights` itself (not the cap), so the admin is told which booked
 * night count the value has to fall below.
 *
 * Validates: Requirements 12.3, 12.5
 */
export const createEarlyCheckoutSchema = (bookedTotalNights: number) =>
  earlyCheckoutSchema.extend({
    actualNightsStayed: z.coerce
      .number()
      .int()
      .min(1)
      .max(
        bookedTotalNights - 1,
        `Actual nights stayed must be less than the currently booked ${bookedTotalNights} nights.`,
      ),
  });
