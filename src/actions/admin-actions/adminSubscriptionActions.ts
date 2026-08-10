"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, format, startOfDay } from "date-fns";
import { sendEmail } from "@/services/emailService";
import {
  subscriptionConfirmationEmailHtml,
  subscriptionConfirmationSubject,
} from "@/emails/SubscriptionConfirmationEmail";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import {
  isValidPastStartDate,
  hasOverlap,
  validatePastDayStatuses,
  type ExistingSubscription,
} from "@/lib/subscriptions/overlap";
import { pastDayStatusBoundary } from "@/lib/onboarding/cutoff";
import { getISTDateString } from "@/lib/dates/ist";
import {
  generateDailyPreferences,
  RecordCountMismatchError,
} from "@/lib/onboarding/dailyPreferences";
import type { PastDayStatus } from "@/types/onboarding";
import { cascadePendingSubscriptionDates } from "@/actions/manageMealActions";
import { getOutstandingBalanceForCustomer } from "@/services/SubscriptionPaymentService";
import { OUTSTANDING_BALANCE_ADMIN_MESSAGE } from "@/types/subscriptionPayment";
import {
  MISC_CHARGE_MAX,
  MISC_CHARGE_LABEL_MAX_LENGTH,
} from "@/lib/onboarding/miscCharge";

// ─── helpers ────────────────────────────────────────────────────────────────

function generateSubscriptionCode(): string {
  return `SUB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

function getEarliestAllowedStartDate(): Date {
  return startOfDay(addDays(new Date(), 1));
}

// ─── past day status entry schema ────────────────────────────────────────────

const pastDayStatusEntrySchema = z.object({
  date: z.string(),
  mealStatus: z.enum(["Delivered", "Skipped"]),
  mealType: z.enum(["VEG", "EGG", "CHICKEN"]).nullable(),
  deliveryAddress: z.enum(["Primary", "Secondary"]).nullable(),
});

// ─── shared base schema ──────────────────────────────────────────────────────

const baseSchema = z.object({
  customerProfileId: z.string().uuid(),
  mealCategoryId: z.string().uuid({ message: "Meal preference is required" }),
  deliveryAddressId: z.string().uuid({ message: "Delivery address is required" }),
  paymentStatus: z.enum(["Payment Collected", "Payment Pending"]),
  paymentReference: z.string().optional(),
  paymentNotes: z.string().optional(),
  startDate: z
    .string()
    .refine((d) => !isNaN(new Date(d).getTime()), { message: "Invalid start date" }),
  pastDateEnabled: z.boolean().optional().default(false),
  pastDayStatuses: z.array(pastDayStatusEntrySchema).optional(),
  skipStartDateCheck: z.boolean().optional().default(false),
  /** Delivery charge for the subscription (Req 6.1–6.5) */
  deliveryCharge: z.number().min(0).max(999999999.99).optional().default(0),
  /** The system-calculated delivery charge, used for admin override audit (Req 12.4) */
  autoCalculatedDeliveryCharge: z.number().min(0).optional(),

  // ─── Extra charges + payment collection ──────────────────────────────────
  // meal-subscription-partial-payment: brings this form to parity with the
  // Quick Onboarding wizard, so adding a subscription to an already-onboarded
  // customer offers the same options as onboarding one.
  //
  // All default to "not charged / paid in full", so every existing caller —
  // bulk migration included — behaves exactly as before without being touched.

  /** Optional ad-hoc charge (additional products, one-off services). */
  miscCharge: z.number().min(0).max(MISC_CHARGE_MAX).optional().default(0),
  /** Admin-supplied name for `miscCharge`, printed verbatim on the invoice. */
  miscChargeLabel: z
    .string()
    .max(MISC_CHARGE_LABEL_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
  /** false ⇒ only an advance was collected and a balance remains. */
  customerPaidFullAmount: z.boolean().optional().default(true),
  /** The advance collected. Required when `customerPaidFullAmount` is false. */
  advanceAmountPaid: z.number().min(0).max(9999999.99).optional(),
});

// ─── mode-specific extensions ────────────────────────────────────────────────

const existingPlanSchema = baseSchema.extend({
  planId: z.string().uuid({ message: "Please select a plan" }),
});

const customPlanSchema = baseSchema.extend({
  basePrice: z.number().positive({ message: "Base price must be positive" }),
  taxPercent: z.number().min(0).max(100),
  taxAmount: z.number().min(0),
  totalAmount: z.number().positive(),
  pauseCredits: z.number().int().min(0),
  endDate: z
    .string()
    .refine((d) => !isNaN(new Date(d).getTime()), { message: "Invalid end date" }),
});

// ─── response type ───────────────────────────────────────────────────────────

type ActionResult = { success: boolean; error?: string; paymentId?: string };

// ─── options ──────────────────────────────────────────────────────────────────

export type AddSubscriptionOptions = {
  /** Skip the "start date must be tomorrow or later" check (used for bulk migration). */
  skipStartDateCheck?: boolean;
  /** Skip the overlap check against active subscriptions (used for bulk migration). */
  skipOverlapCheck?: boolean;
  /**
   * Skip the outstanding-balance gate (used for bulk migration).
   *
   * Migration replays historical subscriptions that predate the partial-payment
   * concept entirely, so enforcing the gate there would fail an import on data
   * that is not in arrears. Interactive admin/franchise callers never set this.
   */
  skipOutstandingBalanceCheck?: boolean;
};

// ─── main action ─────────────────────────────────────────────────────────────

export async function addSubscription(
  // `z.input`, not `z.infer`: this function PARSES `formData`, so its parameter is
  // the schema's input shape where fields carrying `.default()` are optional.
  // Using the output type made every defaulted field mandatory for callers, which
  // broke bulk migration the moment a new defaulted field was added.
  formData:
    | z.input<typeof existingPlanSchema>
    | z.input<typeof customPlanSchema>,
  isCustomPlan: boolean,
  options?: AddSubscriptionOptions,
): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabase = createAdminClient();

  const parsed = isCustomPlan
    ? customPlanSchema.safeParse(formData)
    : existingPlanSchema.safeParse(formData);

  if (!parsed.success) {
    console.error("Validation Error:", parsed.error.issues);
    return { success: false, error: parsed.error.issues[0].message };
  }

  const {
    customerProfileId,
    mealCategoryId,
    deliveryAddressId,
    paymentStatus,
    paymentReference,
    paymentNotes,
    startDate,
    pastDateEnabled,
    pastDayStatuses,
    skipStartDateCheck,
    deliveryCharge,
    autoCalculatedDeliveryCharge,
    miscCharge,
    miscChargeLabel,
    customerPaidFullAmount,
    advanceAmountPaid,
  } = parsed.data;

  // The delivery charge must be ANSWERED, not defaulted. Checked against the RAW
  // payload because the schema's `.default(0)` erases the difference between
  // "0 was entered" and "the field never arrived" — and those mean opposite
  // things: free delivery versus an admin who forgot to fill it in.
  //
  // Read from `formData` rather than `parsed.data` for the same reason. Bulk
  // migration always sends the field explicitly, so it is unaffected.
  {
    const rawDelivery = (formData as Record<string, unknown>).deliveryCharge;
    const deliveryProvided =
      rawDelivery !== undefined &&
      rawDelivery !== null &&
      String(rawDelivery).trim() !== "";

    if (!deliveryProvided) {
      return {
        success: false,
        error: "Enter the delivery charge (enter 0 if delivery is free).",
      };
    }
  }

  // A miscellaneous amount with no name has no invoice description, and the
  // chk_payments_misc_charge_label CHECK constraint would reject the row anyway.
  const miscChargeAmount = miscCharge ?? 0;
  const resolvedMiscLabel =
    miscChargeAmount > 0 ? (miscChargeLabel ?? "").trim() : "";
  if (miscChargeAmount > 0 && resolvedMiscLabel === "") {
    return {
      success: false,
      error: "Enter a name for the miscellaneous charge (e.g. Additional product charges).",
    };
  }

  try {
    // ─── Outstanding balance gate (meal-subscription-partial-payment, 5.3) ──
    // A customer who still owes money on an existing/previous subscription
    // cannot be given a new one until the balance is settled.
    //
    // Ledger-derived, so every subscription paid in full at onboarding (which is
    // all of them created before this feature) has no ledger rows and can never
    // trigger this.
    //
    // Bulk migration is exempted via `skipOutstandingBalanceCheck`: it replays
    // historical subscriptions that predate the concept, and blocking them would
    // make an import fail on data that is not actually in arrears.
    if (!options?.skipOutstandingBalanceCheck) {
      const outstanding = await getOutstandingBalanceForCustomer(
        customerProfileId,
        supabase,
      );
      if (outstanding.hasOutstanding) {
        return {
          success: false,
          error: `${OUTSTANDING_BALANCE_ADMIN_MESSAGE} Outstanding: ₹${outstanding.totalOutstanding.toFixed(2)}.`,
        };
      }
    }

    const start = startOfDay(new Date(startDate));

    if (!options?.skipStartDateCheck && !skipStartDateCheck && !pastDateEnabled) {
      const earliest = getEarliestAllowedStartDate();
      if (start < earliest) {
        return {
          success: false,
          error: "Start date cannot be today or in the past.",
        };
      }
    }

    // ─── Past-date server-side validation ──────────────────────────────────────
    if (pastDateEnabled) {
      const istToday = getISTDateString(0);

      // Get previous subscription's end date for this customer
      const { data: prevSubs, error: prevSubErr } = await supabase
        .from("subscriptions")
        .select("effective_end_on")
        .eq("customer_profile_id", customerProfileId)
        .neq("status", "ACTIVE")
        .neq("status", "CANCELLED")
        .order("effective_end_on", { ascending: false })
        .limit(1);

      if (prevSubErr) throw new Error(prevSubErr.message);

      const previousEndDate: string | null =
        prevSubs && prevSubs.length > 0
          ? prevSubs[0].effective_end_on
          : null;

      // Validate start date is within allowed range
      if (!isValidPastStartDate(startDate, istToday, previousEndDate)) {
        if (previousEndDate && startDate <= previousEndDate) {
          return {
            success: false,
            error: `Start date must be after previous subscription end date (${previousEndDate}).`,
          };
        }
        return {
          success: false,
          error: "Start date cannot be more than 30 days in the past.",
        };
      }

      // Compute end date for overlap check
      let computedEndDate: string;
      if (!isCustomPlan) {
        const d = parsed.data as z.infer<typeof existingPlanSchema>;
        const { data: planData, error: planLookupErr } = await supabase
          .from("subscription_plans")
          .select("duration_days")
          .eq("id", d.planId)
          .single();
        if (planLookupErr) throw new Error(planLookupErr.message);
        const endDate = addDays(start, planData.duration_days - 1);
        computedEndDate = format(endDate, "yyyy-MM-dd");
      } else {
        const d = parsed.data as z.infer<typeof customPlanSchema>;
        computedEndDate = d.endDate;
      }

      // Fetch all non-cancelled subscriptions for overlap check
      const { data: existingSubs, error: existingSubsErr } = await supabase
        .from("subscriptions")
        .select("starts_on, effective_end_on, status")
        .eq("customer_profile_id", customerProfileId)
        .neq("status", "CANCELLED");

      if (existingSubsErr) throw new Error(existingSubsErr.message);

      const existingSubsForOverlap: ExistingSubscription[] = (existingSubs ?? []).map(
        (s) => ({
          starts_on: s.starts_on,
          effective_end_on: s.effective_end_on,
          status: s.status,
        }),
      );

      if (hasOverlap(startDate, computedEndDate, existingSubsForOverlap)) {
        // Find the conflicting subscription to provide details
        const conflicting = existingSubsForOverlap.find(
          (sub) =>
            (sub.status === "ACTIVE" || sub.status === "PENDING") &&
            sub.starts_on <= computedEndDate &&
            sub.effective_end_on >= startDate,
        );
        const conflictDetail = conflicting
          ? ` (${conflicting.starts_on} — ${conflicting.effective_end_on})`
          : "";
        return {
          success: false,
          error: `Date range overlaps with existing subscription${conflictDetail}.`,
        };
      }

      // Validate past day statuses completeness
      if (pastDayStatuses && pastDayStatuses.length > 0) {
        const boundaryDate = pastDayStatusBoundary(new Date());
        const validationResult = validatePastDayStatuses(
          pastDayStatuses,
          startDate,
          boundaryDate,
        );
        if (!validationResult.valid) {
          // Determine which type of error to surface
          const reason = validationResult.reason;
          if (reason.includes("Missing entry") || reason.includes("Expected")) {
            return {
              success: false,
              error: `Delivery status is required for all days from ${startDate} to ${boundaryDate}.`,
            };
          }
          // Extract date from reason if possible for specific entry errors
          const dateMatch = reason.match(/\d{4}-\d{2}-\d{2}/);
          const errorDate = dateMatch ? dateMatch[0] : startDate;
          return {
            success: false,
            error: `Invalid delivery status entry for ${errorDate}: ${reason}`,
          };
        }
      } else {
        // Past day statuses are required when pastDateEnabled is true
        const boundaryDate = pastDayStatusBoundary(new Date());
        if (startDate <= boundaryDate) {
          return {
            success: false,
            error: `Delivery status is required for all days from ${startDate} to ${boundaryDate}.`,
          };
        }
      }
    }

    // Check for existing ACTIVE subscription
    const { data: activeSubscriptions, error: subCheckError } = await supabase
      .from("subscriptions")
      .select("id, effective_end_on, ends_on")
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "ACTIVE");

    if (subCheckError) throw new Error(subCheckError.message);

    let subscriptionStatus: "ACTIVE" | "PENDING" = "ACTIVE";

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      subscriptionStatus = "PENDING";

      if (!options?.skipOverlapCheck) {
        const latestEnd = activeSubscriptions.reduce((latest, s) => {
          const endRef = startOfDay(new Date(s.effective_end_on ?? s.ends_on!));
          return endRef > latest ? endRef : latest;
        }, new Date(0));

        const requiredStart = addDays(latestEnd, 1);
        if (start < requiredStart) {
          return {
            success: false,
            error: "Start date must be after the active subscription's end date.",
          };
        }
      }
    }

    // Resolve plan details and invoice breakdown
    let planId: string | null = null;
    let planDisplayName = "Custom Plan";
    let totalAmount: number;
    let baseAmount: number;
    let taxAmount: number;
    let taxPercent: number;
    let totalDays: number;
    let pauseCreditsTotal: number;
    let effectiveEndDate: Date;

    if (!isCustomPlan) {
      const d = parsed.data as z.infer<typeof existingPlanSchema>;
      planId = d.planId;

      const { data: plan, error: planErr } = await supabase
        .from("subscription_plans")
        .select("name, price, base_price, tax_amount, duration_days, pause_credits")
        .eq("id", planId)
        .single();

      if (planErr) throw new Error(planErr.message);
      if (!plan) return { success: false, error: "Subscription plan not found." };

      planDisplayName = plan.name ?? "Subscription Plan";

      // Use stored base_price / tax_amount from the plan if available,
      // otherwise treat plan.price as the total and reverse-calculate at 5%.
      if (plan.base_price != null && plan.tax_amount != null) {
        baseAmount = Number(plan.base_price);
        taxAmount = Number(plan.tax_amount);
        taxPercent = baseAmount > 0 ? (taxAmount / baseAmount) * 100 : 5;
        totalAmount = baseAmount + taxAmount;
      } else {
        totalAmount = Number(plan.price);
        baseAmount = totalAmount / 1.05;
        taxAmount = totalAmount - baseAmount;
        taxPercent = 5;
      }

      totalDays = plan.duration_days;
      pauseCreditsTotal = plan.pause_credits;
      effectiveEndDate = addDays(start, totalDays - 1);
    } else {
      const d = parsed.data as z.infer<typeof customPlanSchema>;
      const end = startOfDay(new Date(d.endDate));

      if (end < start) {
        return { success: false, error: "End date must be on or after the start date." };
      }

      baseAmount = d.basePrice;
      taxPercent = d.taxPercent;
      taxAmount = d.taxAmount;
      totalAmount = d.totalAmount;
      totalDays =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      pauseCreditsTotal = d.pauseCredits;
      effectiveEndDate = end;
    }

    const startsOn = format(start, "yyyy-MM-dd");
    const endsOn = format(effectiveEndDate, "yyyy-MM-dd");
    const subCode = generateSubscriptionCode();

    // ─── Total_Payable + payment collection ────────────────────────────────
    // meal-subscription-partial-payment. Resolved HERE, before any row is
    // written, so a rejected advance leaves nothing behind.
    //
    // `totalAmount` differs by mode: for an existing plan it was recomputed
    // server-side as the plan price and excludes delivery; for a custom plan it
    // came from the form and already includes delivery (see the two setValue
    // effects in AdminAddSubscriptionForm). Misc is added on top in both cases.
    const planPlusDelivery = isCustomPlan
      ? totalAmount
      : parseFloat((totalAmount + deliveryCharge).toFixed(2));
    const totalPayable = parseFloat(
      (planPlusDelivery + miscChargeAmount).toFixed(2),
    );

    const isPaymentCollected = paymentStatus === "Payment Collected";
    // A partial payment only means anything when money actually changed hands.
    const isPartialPayment =
      isPaymentCollected && customerPaidFullAmount === false;

    let amountPaid: number;
    if (!isPaymentCollected) {
      amountPaid = 0;
    } else if (isPartialPayment) {
      const advance = advanceAmountPaid ?? 0;

      if (!Number.isFinite(advance) || advance <= 0) {
        return {
          success: false,
          error: "Enter the advance amount collected from the customer.",
        };
      }
      // Compared in paise so an advance that exactly equals the total is accepted
      // rather than rejected on float drift.
      if (Math.round(advance * 100) > Math.round(totalPayable * 100)) {
        return {
          success: false,
          error: `The advance amount cannot exceed the total payable of ₹${totalPayable.toFixed(2)}.`,
        };
      }
      amountPaid = advance;
    } else {
      amountPaid = totalPayable;
    }

    const balanceDue = parseFloat((totalPayable - amountPaid).toFixed(2));
    // An advance covering the whole total IS a full payment. Collapsing it here
    // preserves the "no ledger ⇒ paid in full" invariant the outstanding-balance
    // gate depends on, instead of leaving a zero-balance ledger row behind.
    const createsAdvanceLedgerRow =
      isPartialPayment && Math.round(balanceDue * 100) > 0;

    const resolvedPaymentStatus = !isPaymentCollected
      ? "PENDING"
      : Math.round(balanceDue * 100) > 0
        ? "PARTIALLY_PAID"
        : "PAID";

    // Insert subscription row
    const { data: newSub, error: subInsertErr } = await supabase
      .from("subscriptions")
      .insert({
        customer_profile_id: customerProfileId,
        plan_id: planId,
        subscription_code: subCode,
        starts_on: startsOn,
        ends_on: endsOn,
        effective_end_on: endsOn,
        status: subscriptionStatus,
        total_days: totalDays,
        pause_credits_total: pauseCreditsTotal,
        pause_credits_used: 0,
        consumed_days: 0,
        delivery_charge: deliveryCharge,
        // meal-subscription-partial-payment
        misc_charge: miscChargeAmount,
        misc_charge_label: resolvedMiscLabel || null,
        total_payable: totalPayable,
      })
      .select("id")
      .single();

    if (subInsertErr) throw new Error(subInsertErr.message);

    // Generate subscription_daily_preferences rows
    const dailyPrefs = [];
    let cursor = start;

    if (
      pastDateEnabled &&
      pastDayStatuses &&
      pastDayStatuses.length > 0
    ) {
      // ─── Past-date daily preferences: use generateDailyPreferences ───────
      // Resolve meal category IDs for mapping mealType codes to UUIDs.
      const { data: mealCatsData } = await supabase
        .from("meal_categories")
        .select("id, code")
        .in("code", ["VEG", "EGG", "CHICKEN"]);

      const mealCategoryMap: Record<string, string> = {};
      if (mealCatsData) {
        for (const row of mealCatsData) {
          mealCategoryMap[row.code] = row.id;
        }
      }

      // Resolve address mapping: "Primary" → first address, "Secondary" → second address.
      // Fetch customer addresses ordered by creation (is_primary first).
      const { data: customerAddresses } = await supabase
        .from("addresses")
        .select("id, is_primary")
        .eq("customer_profile_id", customerProfileId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });

      const primaryAddressId = deliveryAddressId; // The form's selected address is the primary
      let secondaryAddressId: string | null = null;
      if (customerAddresses && customerAddresses.length > 1) {
        // Find the first address that isn't the primary (deliveryAddressId)
        const secondary = customerAddresses.find((a) => a.id !== deliveryAddressId);
        secondaryAddressId = secondary?.id ?? null;
      }

      // Compute boundary date for past/future separation.
      const boundaryDate = pastDayStatusBoundary(new Date());

      try {
        const prefsResult = generateDailyPreferences({
          subscriptionId: newSub.id,
          customerProfileId,
          startsOn,
          originalEndsOn: endsOn,
          totalDays,
          initialMealCategoryId: mealCategoryId,
          primaryAddressId,
          secondaryAddressId,
          mealCategoryMap,
          boundaryDate,
          pastDayStatuses: pastDayStatuses as PastDayStatus[],
        });

        const { error: prefsErr } = await supabase
          .from("subscription_daily_preferences")
          .insert(prefsResult.records);

        if (prefsErr) throw new Error(prefsErr.message);

        // Update subscription with adjusted effective_end_on and pause_credits_used
        // if there were skipped days.
        if (prefsResult.skippedCount > 0) {
          const { error: subUpdateErr } = await supabase
            .from("subscriptions")
            .update({
              effective_end_on: prefsResult.effectiveEndOn,
              pause_credits_used: prefsResult.skippedCount,
            })
            .eq("id", newSub.id);

          if (subUpdateErr) throw new Error(subUpdateErr.message);

          // Update the local endsOn reference for cascade logic downstream
          effectiveEndDate = new Date(prefsResult.effectiveEndOn);
        }
      } catch (err) {
        if (err instanceof RecordCountMismatchError) {
          return {
            success: false,
            error: err.message,
          };
        }
        throw err;
      }
    } else {
      // ─── Standard daily preferences (future-date subscription) ────────────
      for (let i = 0; i < totalDays; i++) {
        dailyPrefs.push({
          subscription_id: newSub.id,
          customer_profile_id: customerProfileId,
          preference_date: format(cursor, "yyyy-MM-dd"),
          meal_category_id: mealCategoryId,
          delivery_address_id: deliveryAddressId,
          is_paused: false,
          pause_credit_used: false,
        });
        cursor = addDays(cursor, 1);
      }

      const { error: prefsErr } = await supabase
        .from("subscription_daily_preferences")
        .insert(dailyPrefs);

      if (prefsErr) throw new Error(prefsErr.message);
    }

    // Cascade pending subscription dates after creation.
    // When the new sub is ACTIVE: use its effective_end_on so any existing PENDING subs shift after it.
    // When the new sub is PENDING: use the active subscription's effective_end_on as baseEndDate
    // to re-cascade all PENDING subs (including the newly created one) in order.
    const cascadeEndDate = format(effectiveEndDate, "yyyy-MM-dd");
    if (subscriptionStatus === "ACTIVE") {
      await cascadePendingSubscriptionDates(customerProfileId, cascadeEndDate);
    } else if (activeSubscriptions && activeSubscriptions.length > 0) {
      const latestActiveEnd = activeSubscriptions.reduce((latest, s) => {
        const endRef = new Date(s.effective_end_on ?? s.ends_on!);
        return endRef > latest ? endRef : latest;
      }, new Date(0));
      await cascadePendingSubscriptionDates(customerProfileId, latestActiveEnd);
    }

    // Always insert a payment/invoice row regardless of payment status.
    // status: PAID (collected) or PENDING (not yet collected).
    const isPaid = paymentStatus === "Payment Collected";

    // payments.amount = Total_Payable (plan + delivery + miscellaneous), resolved
    // above before any write. It stays the FULL payable even on a part payment, so
    // the invoice's itemised breakup still reconciles; how much was actually
    // collected lives in amount_paid / balance_due (design decision D3).
    const paymentAmount = totalPayable;

    const { data: newPayment, error: payErr } = await supabase
      .from("payments")
      .insert({
        customer_profile_id: customerProfileId,
        subscription_id: newSub.id,
        payment_method: "MANUAL",
        amount: paymentAmount,
        status: resolvedPaymentStatus,
        paid_at: isPaid ? new Date().toISOString() : null,
        // Invoice breakdown columns (added via migration)
        base_amount: baseAmount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        discount_amount: 0,
        delivery_charge: deliveryCharge,
        // meal-subscription-partial-payment
        misc_charge: miscChargeAmount,
        misc_charge_label: resolvedMiscLabel || null,
        amount_paid: amountPaid,
        balance_due: balanceDue,
        invoice_type: "SUBSCRIPTION",
        payment_reference: paymentReference ?? null,
        payment_notes: paymentNotes ?? null,
      })
      .select("id")
      .single();

    if (payErr) {
      // If the new columns don't exist yet (migration not run), fall back to minimal insert
      if (payErr.message.includes("column")) {
        const { data: fallbackPayment, error: fallbackErr } = await supabase
          .from("payments")
          .insert({
            customer_profile_id: customerProfileId,
            subscription_id: newSub.id,
            payment_method: "MANUAL",
            amount: totalAmount,
            status: isPaid ? "PAID" : "PENDING",
            paid_at: isPaid ? new Date().toISOString() : null,
          })
          .select("id")
          .single();

        if (fallbackErr) throw new Error(fallbackErr.message);

        revalidatePath(`/admin/customers/${customerProfileId}`);
        revalidatePath("/admin/customers");
        revalidatePath("/admin/subscriptions");

        await sendSubscriptionEmail(supabase, customerProfileId, {
          planDisplayName,
          startsOn,
          endsOn,
          totalDays,
          paymentStatus: isPaid ? "PAID" : "PENDING",
        });

        await logAdminAction("CREATE", "subscription", newSub.id, {
          customer_profile_id: customerProfileId,
          status: subscriptionStatus,
        });
        await notifyManualSubscriptionAdded(customerProfileId, planDisplayName);
        return { success: true, paymentId: fallbackPayment?.id };
      }
      throw new Error(payErr.message);
    }

    // ─── ADVANCE ledger row (meal-subscription-partial-payment) ────────────
    // Written only when a balance actually remains, and only AFTER the invoice
    // row has succeeded: if the payments insert had failed we would otherwise be
    // left with a ledger claiming money against a subscription that has no
    // invoice. (This action is a sequence of separate inserts rather than one
    // transaction — a pre-existing trait, not introduced here — so ordering is
    // the only lever available for consistency.)
    if (createsAdvanceLedgerRow) {
      const { error: ledgerErr } = await supabase
        .from("subscription_payment_transactions")
        .insert({
          subscription_id: newSub.id,
          customer_profile_id: customerProfileId,
          transaction_type: "ADVANCE",
          amount: amountPaid,
          transaction_date: getISTDateString(0),
          payment_method: "MANUAL",
          payment_reference: paymentReference ?? null,
          comment: "Advance collected when the subscription was added",
        });

      if (ledgerErr) throw new Error(ledgerErr.message);

      await logAdminAction("CREATE", "subscription_advance_payment", newSub.id, {
        customer_profile_id: customerProfileId,
        total_payable: totalPayable,
        amount_paid: amountPaid,
        balance_due: balanceDue,
        surface: "admin_add_subscription",
      });
    }

    await logAdminAction("CREATE", "subscription", newSub.id, {
      customer_profile_id: customerProfileId,
      status: subscriptionStatus,
    });

    // Log admin override audit entry if delivery charge was manually edited (Req 12.4)
    if (
      autoCalculatedDeliveryCharge !== undefined &&
      autoCalculatedDeliveryCharge !== null &&
      deliveryCharge !== autoCalculatedDeliveryCharge
    ) {
      await logAdminAction("UPDATE", "delivery_charge_override", newSub.id, {
        customer_profile_id: customerProfileId,
        system_calculated_amount: autoCalculatedDeliveryCharge,
        overridden_amount: deliveryCharge,
        subscription_id: newSub.id,
      });
    }

    revalidatePath(`/admin/customers/${customerProfileId}`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/subscriptions");

    await sendSubscriptionEmail(supabase, customerProfileId, {
      planDisplayName,
      startsOn,
      endsOn,
      totalDays,
      paymentStatus: isPaid ? "PAID" : "PENDING",
    });

    await notifyManualSubscriptionAdded(customerProfileId, planDisplayName);

    return { success: true, paymentId: newPayment?.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("addSubscription error:", msg);
    return { success: false, error: msg };
  }
}

// ─── email helper ────────────────────────────────────────────────────────────

async function notifyManualSubscriptionAdded(
  customerProfileId: string,
  planDisplayName: string,
) {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("user_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  const customerName = await getCustomerNameByProfileId(customerProfileId);

  if (profile?.user_id) {
    await sendNotificationToUser(profile.user_id, {
      title: "Subscription Started!",
      message:
        "Thanks for purchasing subscription. Know how to manage your subscription. Click here to view invoice.",
      actionUrl: "/customer/subscription/manage/planner",
      sendEmail: true,
    });
  }

  await notifyAdmins({
    title: "Subscription Started!",
    message: `Hi Admin, Subscription ${planDisplayName} purchased by ${customerName} customer.`,
    actionUrl: "/admin/subscriptions",
    sendEmail: true,
    emailStrategy: "shared",
  });
}

async function sendSubscriptionEmail(
  supabase: ReturnType<typeof createAdminClient>,
  customerProfileId: string,
  opts: {
    planDisplayName: string;
    startsOn: string;
    endsOn: string;
    totalDays: number;
    paymentStatus: string;
  },
) {
  try {
    const { data: profileData } = await supabase
      .from("customer_profiles")
      .select("users ( full_name, email )")
      .eq("id", customerProfileId)
      .single();

    const user = Array.isArray(profileData?.users)
      ? profileData.users[0]
      : (profileData?.users as any);

    if (!user?.email) return;

    await sendEmail(
      user.email,
      subscriptionConfirmationSubject(opts.planDisplayName),
      subscriptionConfirmationEmailHtml({
        name: user.full_name || "Valued Customer",
        planName: opts.planDisplayName,
        startDate: opts.startsOn,
        endDate: opts.endsOn,
        totalDays: opts.totalDays,
        paymentStatus: opts.paymentStatus,
      }),
    );
  } catch (err) {
    console.error("[sendSubscriptionEmail] Failed to send email:", err);
  }
}

// ─── mark manual payment as collected ────────────────────────────────────────

export async function markManualPaymentCollected(
  paymentId: string,
): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabase = createAdminClient();

  try {
    const { error } = await supabase
      .from("payments")
      .update({
        status: "PAID",
        paid_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
          .eq("payment_method", "MANUAL")
      .eq("status", "PENDING");

    if (error) throw new Error(error.message);

    await logAdminAction("UPDATE", "payment", paymentId, { status: "PAID" });

    revalidatePath("/admin/customers");
    revalidatePath("/admin/subscriptions");

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update payment.";
    console.error("markManualPaymentCollected error:", msg);
    return { success: false, error: msg };
  }
}
