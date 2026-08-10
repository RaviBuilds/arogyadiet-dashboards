"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getOutstandingBalanceForCustomer } from "@/services/SubscriptionPaymentService";
import { OUTSTANDING_BALANCE_ADMIN_MESSAGE } from "@/types/subscriptionPayment";
import {
  MISC_CHARGE_MAX,
  MISC_CHARGE_LABEL_MAX_LENGTH,
} from "@/lib/onboarding/miscCharge";
import { getISTDateString } from "@/lib/dates/ist";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, format, startOfDay } from "date-fns";
import { sendEmail } from "@/services/emailService";
import {
  subscriptionConfirmationEmailHtml,
  subscriptionConfirmationSubject,
} from "@/emails/SubscriptionConfirmationEmail";

// ─── helpers ────────────────────────────────────────────────────────────────

function generateSubscriptionCode(): string {
  return `SUB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// ─── schemas ─────────────────────────────────────────────────────────────────

const baseSchema = z.object({
  customerProfileId: z.string().uuid(),
  mealCategoryId: z.string().uuid({ message: "Meal preference is required" }),
  deliveryAddressId: z.string().uuid({ message: "Delivery address is required" }),
  paymentStatus: z.enum(["Payment Collected", "Payment Pending"]),
  paymentReference: z.string().optional(),
  paymentNotes: z.string().optional(),
  startDate: z.string().refine((d) => !isNaN(new Date(d).getTime()), { message: "Invalid start date" }),
  franchiseId: z.string().uuid({ message: "Franchise ID is required" }),

  // ─── Extra charges + payment collection ──────────────────────────────────
  // Brought to parity with the admin action, because
  // `AdminAddSubscriptionForm` is SHARED between both portals and sends these
  // fields. Zod strips unknown keys, so without them a franchise admin's
  // delivery charge, miscellaneous charge and advance payment were silently
  // discarded — the subscription would be created at the wrong price.
  // (`deliveryCharge` was already being dropped this way before this feature.)
  deliveryCharge: z.number().min(0).max(999999999.99).optional().default(0),
  autoCalculatedDeliveryCharge: z.number().min(0).optional(),
  miscCharge: z.number().min(0).max(MISC_CHARGE_MAX).optional().default(0),
  miscChargeLabel: z
    .string()
    .max(MISC_CHARGE_LABEL_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
  customerPaidFullAmount: z.boolean().optional().default(true),
  advanceAmountPaid: z.number().min(0).max(9999999.99).optional(),
});

const existingPlanSchema = baseSchema.extend({
  planId: z.string().uuid({ message: "Please select a plan" }),
});

const customPlanSchema = baseSchema.extend({
  basePrice: z.number().positive(),
  taxPercent: z.number().min(0).max(100),
  taxAmount: z.number().min(0),
  totalAmount: z.number().positive(),
  pauseCredits: z.number().int().min(0),
  endDate: z.string().refine((d) => !isNaN(new Date(d).getTime()), { message: "Invalid end date" }),
});

type ActionResult = { success: boolean; error?: string; paymentId?: string };

/**
 * Add subscription for a franchise customer.
 * Same logic as admin addSubscription but stamps franchise_id on the subscription.
 */
export async function franchiseAddSubscription(
  // `z.input` rather than `z.infer` — see the note on the admin `addSubscription`.
  formData: z.input<typeof existingPlanSchema> | z.input<typeof customPlanSchema>,
  isCustomPlan: boolean,
): Promise<ActionResult> {
  const supabase = createAdminClient();

  const parsed = isCustomPlan
    ? customPlanSchema.safeParse(formData)
    : existingPlanSchema.safeParse(formData);

  if (!parsed.success) {
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
    franchiseId,
    deliveryCharge,
    miscCharge,
    miscChargeLabel,
    customerPaidFullAmount,
    advanceAmountPaid,
  } = parsed.data;

  try {
    // ─── Outstanding balance gate (meal-subscription-partial-payment, 5.3) ──
    // Mirrors the admin-side gate in `addSubscription`. Franchise users hit the
    // same rule: a customer with an unsettled balance cannot be sold a new
    // subscription. Ledger-derived, so pre-existing subscriptions never trip it.
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

    const start = startOfDay(new Date(startDate));
    const earliest = startOfDay(addDays(new Date(), 1));
    if (start < earliest) {
      return { success: false, error: "Start date cannot be today or in the past." };
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
      const latestEnd = activeSubscriptions.reduce((latest, s) => {
        const endRef = startOfDay(new Date(s.effective_end_on ?? s.ends_on!));
        return endRef > latest ? endRef : latest;
      }, new Date(0));
      const requiredStart = addDays(latestEnd, 1);
      if (start < requiredStart) {
        return { success: false, error: "Start date must be after the active subscription's end date." };
      }
    }

    // Resolve plan details
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

      if (planErr || !plan) return { success: false, error: "Subscription plan not found." };

      planDisplayName = plan.name ?? "Subscription Plan";

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
      if (end < start) return { success: false, error: "End date must be on or after the start date." };

      baseAmount = d.basePrice;
      taxPercent = d.taxPercent;
      taxAmount = d.taxAmount;
      totalAmount = d.totalAmount;
      totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      pauseCreditsTotal = d.pauseCredits;
      effectiveEndDate = end;
    }

    const startsOn = format(start, "yyyy-MM-dd");
    const endsOn = format(effectiveEndDate, "yyyy-MM-dd");
    const subCode = generateSubscriptionCode();

    // ─── Total_Payable + payment collection (mirrors the admin action) ──────
    // Resolved before any row is written, so a rejected advance leaves nothing
    // behind. For a custom plan the form's `totalAmount` already includes
    // delivery; for an existing plan it is the plan price alone.
    // The delivery charge must be ANSWERED, not defaulted — checked against the
    // RAW payload because the schema's `.default(0)` erases the difference
    // between "0 was entered" (free delivery) and "the field never arrived" (the
    // admin forgot). Mirrors the admin action.
    const rawDelivery = (formData as Record<string, unknown>).deliveryCharge;
    if (
      rawDelivery === undefined ||
      rawDelivery === null ||
      String(rawDelivery).trim() === ""
    ) {
      return {
        success: false,
        error: "Enter the delivery charge (enter 0 if delivery is free).",
      };
    }

    const miscChargeAmount = miscCharge ?? 0;
    const resolvedMiscLabel =
      miscChargeAmount > 0 ? (miscChargeLabel ?? "").trim() : "";
    if (miscChargeAmount > 0 && resolvedMiscLabel === "") {
      return {
        success: false,
        error: "Enter a name for the miscellaneous charge.",
      };
    }

    const planPlusDelivery = isCustomPlan
      ? totalAmount
      : parseFloat((totalAmount + deliveryCharge).toFixed(2));
    const totalPayable = parseFloat(
      (planPlusDelivery + miscChargeAmount).toFixed(2),
    );

    const isPaymentCollected = paymentStatus === "Payment Collected";
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
    // An advance covering the whole total IS a full payment; collapsing it keeps
    // the "no ledger ⇒ paid in full" invariant intact.
    const createsAdvanceLedgerRow =
      isPartialPayment && Math.round(balanceDue * 100) > 0;
    const resolvedPaymentStatus = !isPaymentCollected
      ? "PENDING"
      : Math.round(balanceDue * 100) > 0
        ? "PARTIALLY_PAID"
        : "PAID";

    // Insert subscription with franchise_id
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
        franchise_id: franchiseId,
        // meal-subscription-partial-payment (delivery_charge was previously
        // dropped here entirely).
        delivery_charge: deliveryCharge,
        misc_charge: miscChargeAmount,
        misc_charge_label: resolvedMiscLabel || null,
        total_payable: totalPayable,
      })
      .select("id")
      .single();

    if (subInsertErr || !newSub) {
      throw new Error(subInsertErr?.message ?? "Failed to create subscription");
    }

    // Generate daily preferences (must match the admin schema exactly)
    const dailyRows = [];
    for (let i = 0; i < totalDays; i++) {
      const date = format(addDays(start, i), "yyyy-MM-dd");
      dailyRows.push({
        subscription_id: newSub.id,
        customer_profile_id: customerProfileId,
        preference_date: date,
        meal_category_id: mealCategoryId,
        delivery_address_id: deliveryAddressId,
        is_paused: false,
        pause_credit_used: false,
      });
    }

    if (dailyRows.length > 0) {
      const { error: prefErr } = await supabase
        .from("subscription_daily_preferences")
        .insert(dailyRows);
      if (prefErr) {
        throw new Error(`Failed to create daily preferences: ${prefErr.message}`);
      }
    }

    // Insert payment record
    const isPaid = paymentStatus === "Payment Collected";

    const paymentRecord = {
      subscription_id: newSub.id,
      customer_profile_id: customerProfileId,
      // Total_Payable: plan + delivery + miscellaneous. Stays the FULL payable
      // even on a part payment so the invoice breakup reconciles; what was
      // actually collected lives in amount_paid / balance_due.
      amount: totalPayable,
      base_amount: baseAmount,
      tax_percent: taxPercent,
      tax_amount: taxAmount,
      discount_amount: 0,
      delivery_charge: deliveryCharge,
      misc_charge: miscChargeAmount,
      misc_charge_label: resolvedMiscLabel || null,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      payment_method: "MANUAL",
      status: resolvedPaymentStatus,
      paid_at: isPaid ? new Date().toISOString() : null,
      invoice_type: "SUBSCRIPTION",
      payment_reference: paymentReference || null,
      payment_notes: paymentNotes || null,
    };

    let { data: paymentData, error: payErr } = await supabase
      .from("payments")
      .insert(paymentRecord)
      .select("id")
      .single();

    // Fallback for environments where invoice breakdown columns are missing
    if (payErr && payErr.message.includes("column")) {
      ({ data: paymentData, error: payErr } = await supabase
        .from("payments")
        .insert({
          subscription_id: newSub.id,
          customer_profile_id: customerProfileId,
          amount: totalAmount,
          payment_method: "MANUAL",
          status: isPaid ? "PAID" : "PENDING",
          paid_at: isPaid ? new Date().toISOString() : null,
        })
        .select("id")
        .single());
    }

    if (payErr) console.error("Payment insert error:", payErr.message);

    // ─── ADVANCE ledger row (meal-subscription-partial-payment) ────────────
    // Only when a balance actually remains, and only after the invoice row, so a
    // failed payments insert cannot leave a ledger claiming money against a
    // subscription with no invoice. Mirrors the admin action.
    if (createsAdvanceLedgerRow && !payErr) {
      const { error: ledgerErr } = await supabase
        .from("subscription_payment_transactions")
        .insert({
          subscription_id: newSub.id,
          customer_profile_id: customerProfileId,
          transaction_type: "ADVANCE",
          amount: amountPaid,
          transaction_date: getISTDateString(0),
          payment_method: "MANUAL",
          payment_reference: paymentReference || null,
          comment: "Advance collected when the subscription was added",
        });

      if (ledgerErr) {
        throw new Error(`Failed to record the advance payment: ${ledgerErr.message}`);
      }
    }

    await logAdminAction("CREATE", "subscription", newSub.id, {
      customer_profile_id: customerProfileId,
      plan: planDisplayName,
      status: subscriptionStatus,
      franchise_id: franchiseId,
      total_payable: totalPayable,
      amount_paid: amountPaid,
      balance_due: balanceDue,
    });

    revalidatePath("/franchise/customers");
    revalidatePath("/franchise/subscriptions");

    return { success: true, paymentId: paymentData?.id };
  } catch (error: any) {
    console.error("franchiseAddSubscription error:", error);
    return { success: false, error: error.message || "Failed to add subscription." };
  }
}

// ─── Subscription 360 management (franchise-scoped) ──────────────────────────
//
// These wrap the existing admin subscription actions, but first verify that the
// target subscription belongs to the calling franchise admin's franchise.
// This lets the franchise portal reuse the shared Subscription360Dashboard.

import { resolveFranchiseContext } from "@/lib/franchise/context";
import {
  managePendingSubscription,
  updateActiveSubscriptionDates,
  stopActiveSubscription,
} from "@/actions/admin-actions/adminLifecycleActions";
import {
  adminBulkUpdatePausePreferences,
  adminBulkUpdateMealPreferences,
} from "@/actions/admin-actions/adminMealActions";
import { bulkUpdateAdminAddressPreferencesAction } from "@/actions/admin-actions/adminDeliveryActions";

type SubGuard =
  | { success: true; franchiseId: string }
  | { success: false; error: string };

/**
 * Resolves the calling franchise admin's franchise_id from their session,
 * then verifies the target subscription belongs to that franchise.
 */
async function guardSubscription(subscriptionId: string): Promise<SubGuard> {
  const ctx = await resolveFranchiseContext();

  if (!ctx) {
    return { success: false, error: "Unable to resolve franchise context." };
  }
  if (ctx.role !== "FRANCHISE_ADMIN") {
    return {
      success: false,
      error: "You are not authorized to perform franchise operations.",
    };
  }
  if (!ctx.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account." };
  }

  const supabase = createAdminClient();
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select("id, franchise_id")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!sub) return { success: false, error: "Subscription not found." };
  if (sub.franchise_id !== ctx.franchise_id) {
    return {
      success: false,
      error: "This subscription does not belong to your franchise.",
    };
  }

  return { success: true, franchiseId: ctx.franchise_id };
}

export async function franchiseManagePendingSubscription(
  subscriptionId: string,
  payload: { starts_on?: string; status: string },
) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return managePendingSubscription(subscriptionId, payload);
}

export async function franchiseUpdateActiveSubscriptionDates(
  subscriptionId: string,
  payload: { starts_on: string; pause_credits_total: number },
) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return updateActiveSubscriptionDates(subscriptionId, payload);
}

export async function franchiseStopActiveSubscription(subscriptionId: string) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return stopActiveSubscription(subscriptionId);
}

export async function franchiseBulkUpdatePausePreferences(
  subscriptionId: string,
  updates: { date: string; isPaused: boolean }[],
) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return adminBulkUpdatePausePreferences(subscriptionId, updates);
}

export async function franchiseBulkUpdateMealPreferences(
  subscriptionId: string,
  updates: { date: string; categoryId: string | null }[],
) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return adminBulkUpdateMealPreferences(subscriptionId, updates);
}

export async function franchiseBulkUpdateAddressPreferences(
  subscriptionId: string,
  updates: { date: string; addressId: string }[],
) {
  const guard = await guardSubscription(subscriptionId);
  if (!guard.success) return { success: false, error: guard.error };
  return bulkUpdateAdminAddressPreferencesAction(subscriptionId, updates);
}
