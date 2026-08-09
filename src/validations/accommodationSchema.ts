// src/validations/accommodationSchema.ts
//
// Zod validation schemas for the Accommodation Customer Flow feature.
// Covers onboarding, stay management, health logging, and add-on services.
//
// The accommodation-payment-lifecycle feature extends this file with the
// backdated-stay toggle, the total/advance onboarding payment split, and the
// Record Payment / Record Refund / Recalculate Stay schemas. Every range here is
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
 * Inclusive night count between two YYYY-MM-DD dates: `end − start + 1`, so a
 * stay that starts and ends on the same date is exactly 1 night.
 *
 * The pure JS counterpart of `computeEndDate`'s inverse and of the
 * `save_stay_details()` RPC's `(p_recalculated_end_date - v_stay.start_date) + 1`.
 * Defined here rather than imported from `@/lib/accommodation/backdatedStay`
 * because that module imports this one — the arithmetic is plain UTC day
 * subtraction, so there is no behavioural fork.
 *
 * Exported so the Add-New-Stay dialog can display the very same derived night
 * count that this file validates.
 */
export function nightsBetweenInclusive(
  startDate: string,
  endDate: string,
): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Shape shared by the accommodation onboarding form and the Add-New-Stay
 * dialog: the Total_Stay_Amount / Advance_Amount split, gated behind the
 * Shared_Payment toggle.
 */
interface StayPaymentSplitFields {
  isSharedPayment: boolean;
  paymentHostMobile?: string;
  totalStayAmount?: number;
  advanceAmountPaid?: number;
}

/**
 * Payment-split refinement shared by every surface that creates a Stay_Entry
 * (Req 4.2, 4.3, 4.4).
 *
 * Shared payment on  → `paymentHostMobile` is required and the money fields are
 *                      irrelevant (a Shared_Payment stay carries no
 *                      Total_Stay_Amount and no ledger at all).
 * Shared payment off → both amounts are required and the advance may not exceed
 *                      the total.
 *
 * Enforced server-side regardless of whether the field was visible — or even
 * rendered — on the client.
 */
function refineStayPaymentSplit(
  data: StayPaymentSplitFields,
  ctx: z.RefinementCtx,
): void {
  if (data.isSharedPayment) {
    if (!data.paymentHostMobile) {
      addIssue(
        ctx,
        "paymentHostMobile",
        "Payment host mobile number is required for shared payment.",
      );
    }
    return;
  }

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

/**
 * Start-date range refinement shared by every surface that creates a
 * Stay_Entry (Req 1.2, 1.3, 3.4, 3.5).
 *
 * Toggle ON  → the date must be in the past, no earlier than
 *              `MAX_BACKDATED_DAYS` before today (IST).
 * Toggle OFF → the date must not be in the past, and no later than
 *              `MAX_FORWARD_START_DAYS` ahead of today.
 *
 * Lexicographic comparison is correct for YYYY-MM-DD strings.
 */
function refineStayStartDate(
  data: { startDate: string; backdatedStayEnabled: boolean },
  ctx: z.RefinementCtx,
): void {
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
  } else if (data.startDate > addDaysToISODate(today, MAX_FORWARD_START_DAYS)) {
    addIssue(
      ctx,
      "startDate",
      "Start date cannot be more than 365 days in the future.",
    );
  }
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
    refineStayPaymentSplit(data, ctx);

    // ── Start date ranges (Req 1.2, 1.3, 3.4, 3.5) ───────────────────────────
    refineStayStartDate(data, ctx);
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

/** Maximum nights a single stay may run for. */
export const MAX_STAY_NIGHTS = 365;

/**
 * Schema for creating a new stay entry for a RETURNING accommodation guest,
 * from the Customer_360 Accommodation tab's Add New Stay dialog.
 *
 * Deliberately mirrors {@link accommodationOnboardingSchema} field-for-field on
 * everything that describes a *stay* — it shares the very same
 * {@link refineStayPaymentSplit} and {@link refineStayStartDate} refinements —
 * and carries none of the fields that describe a *customer* (name, mobile,
 * gender, temp PIN, medical history), because the customer already exists. The
 * one shape difference from onboarding is deliberate:
 *
 * - `endDate` REPLACES `totalNights`. The admin picks the stay's inclusive last
 *   night on a calendar and the night count is DERIVED (`end − start + 1`), so
 *   there is no second number that can disagree with the dates. This matches
 *   both the Current Stay card's "End Date" and `recalculateStaySchema`, and is
 *   the exact value `computeEndDate` reproduces from the persisted
 *   `total_nights`.
 *
 * The legacy single `paymentAmount` field is GONE, replaced by the
 * `totalStayAmount` / `advanceAmountPaid` split plus the Shared_Payment and
 * Backdated_Stay toggles.
 *
 * Validates: Requirements 1.2, 1.3, 2.1, 3.4, 3.5, 4.2, 4.3, 4.4, 13.5
 */
export const createStaySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid start date."),
    /** Inclusive last night of the stay; total nights is derived from it. */
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid end date."),
    stayType: z.enum(["AC Villa", "Village Style Hut"]),
    occupancyType: z.enum(["Single", "Double"]),
    mealPreference: z.enum(["VEG", "EGG", "CHICKEN"]),
    /** Backdated_Stay_Toggle — unlocks Past_Stay_Start selection (Req 1.1, 3.4). */
    backdatedStayEnabled: z.boolean().default(false),
    /** Total_Stay_Amount inclusive of 18% GST (Req 4.2). */
    totalStayAmount: z.coerce.number().min(1).max(MAX_STAY_AMOUNT).optional(),
    /** Advance_Amount collected now; 0 means "no advance" (Req 4.3). */
    advanceAmountPaid: z.coerce.number().min(0).max(MAX_STAY_AMOUNT).optional(),
    isSharedPayment: z.boolean().default(false),
    // `.optional()` alone only permits `undefined`, but the dialog's default
    // value for an untouched (non-shared-payment) field is `""` — matching
    // `accommodationOnboardingSchema.paymentHostMobile`'s same fix. Without the
    // `.or(z.literal(""))`, every submission with Shared_Payment off fails this
    // regex on the base object schema before `superRefine` ever runs, and since
    // the field isn't rendered in that case, the resulting error is invisible:
    // `zodResolver` blocks the submit client-side with no toast and no network
    // request at all.
    paymentHostMobile: z
      .string()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.")
      .optional()
      .or(z.literal("")),
    /**
     * Optional Dietitian_Link. A Stay_Entry has no dietitian of its own — this
     * updates the CUSTOMER's `dietitian_id`, so leaving it empty keeps whoever
     * is already assigned. Empty string is normalised to "unchanged" downstream.
     */
    dietitianUserId: z
      .string()
      .uuid("Select a valid dietitian.")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    refineStayPaymentSplit(data, ctx);
    refineStayStartDate(data, ctx);

    // ── End date / derived nights ────────────────────────────────────────────
    // The start date itself is selectable and yields exactly 1 night, so the
    // lower bound is inclusive.
    if (data.endDate < data.startDate) {
      addIssue(
        ctx,
        "endDate",
        "End date must be on or after the start date; selecting the start date itself gives a 1-night stay.",
      );
      return;
    }

    const nights = nightsBetweenInclusive(data.startDate, data.endDate);
    if (nights > MAX_STAY_NIGHTS) {
      addIssue(
        ctx,
        "endDate",
        `A stay cannot run longer than ${MAX_STAY_NIGHTS} nights (this one is ${nights}).`,
      );
    }
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
 * Base schema for the Recalculate_Stay form's "Save Stay Details" submission.
 *
 * REPLACES the retired `earlyCheckoutSchema` / `createEarlyCheckoutSchema`. The
 * night count is gone from the payload entirely — Recalculated_Total_Nights is
 * DERIVED from `recalculatedEndDate` server-side, so there is no second number
 * that could disagree with the calendar.
 *
 * `recalculatedEndDate` carries only its shape here; the inclusive
 * `[startDate, bookedEndDate]` bounds depend on the stay and are applied by
 * `createRecalculateStaySchema`.
 *
 * Validates: Requirements 12.3, 12.4
 */
export const recalculateStaySchema = z.object({
  recalculatedEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid end date."),
  recalculatedStayAmount: z.coerce
    .number()
    .int("Recalculated total stay amount must be a whole number.")
    .min(1, "Recalculated total stay amount must be at least ₹1.")
    .max(
      MAX_STAY_AMOUNT,
      "Recalculated total stay amount cannot exceed ₹9,999,999.",
    ),
});

/** Inferred input type for a Save_Stay_Details submission. */
export type RecalculateStayInput = z.infer<typeof recalculateStaySchema>;

/**
 * Builds a Recalculate_Stay schema bounded by the stay itself: `startDate` is
 * the lower bound and `bookedEndDate` the stay's *currently booked*
 * Computed_End_Date. Used on both the client and the server so acceptance is
 * identical either side (Req 12.5).
 *
 * Both bounds are inclusive and selectable (Req 12.3), which is why the
 * comparisons are `<` and `>` rather than `<=` / `>=`. Selecting the start date
 * itself is valid and yields exactly 1 night — the minimum stay length — so the
 * range is never empty: for a 1-night stay it collapses to the single date
 * `startDate === bookedEndDate`. No unchanged-date carve-out is needed either:
 * the current end date lies inside `[startDate, bookedEndDate]` by
 * construction, so a no-op submission passes the plain bounds check (Req 12.6).
 *
 * Lexicographic comparison is correct for YYYY-MM-DD strings, matching the
 * convention already used by `markStayCheckedOutAction`'s date gate.
 *
 * Validates: Requirements 12.3, 12.5, 12.6
 */
export const createRecalculateStaySchema = (
  startDate: string,
  bookedEndDate: string,
) =>
  recalculateStaySchema.superRefine((data, ctx) => {
    if (data.recalculatedEndDate < startDate) {
      addIssue(
        ctx,
        "recalculatedEndDate",
        `End date must be on or after the stay's start date ${startDate}; selecting the start date itself gives a 1-night stay.`,
      );
    }
    if (data.recalculatedEndDate > bookedEndDate) {
      addIssue(
        ctx,
        "recalculatedEndDate",
        `End date cannot be later than the currently booked ${bookedEndDate}. Use Extend Stay to lengthen the stay.`,
      );
    }
  });
