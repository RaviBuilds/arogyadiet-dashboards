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
};

// ─── main action ─────────────────────────────────────────────────────────────

export async function addSubscription(
  formData:
    | z.infer<typeof existingPlanSchema>
    | z.infer<typeof customPlanSchema>,
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
  } = parsed.data;

  try {
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

    // payments.amount = Total_Payable (plan amount + delivery charge) (Req 6.2)
    // For existing plans: totalAmount is the plan price (computed server-side), add delivery.
    // For custom plans: totalAmount from the form already includes delivery charge.
    const paymentAmount = isCustomPlan
      ? totalAmount  // custom mode: form's totalAmount already = base + tax + delivery
      : parseFloat((totalAmount + deliveryCharge).toFixed(2)); // existing: plan price + delivery

    const { data: newPayment, error: payErr } = await supabase
      .from("payments")
      .insert({
        customer_profile_id: customerProfileId,
        subscription_id: newSub.id,
        payment_method: "MANUAL",
        amount: paymentAmount,
        status: isPaid ? "PAID" : "PENDING",
        paid_at: isPaid ? new Date().toISOString() : null,
        // Invoice breakdown columns (added via migration)
        base_amount: baseAmount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        discount_amount: 0,
        delivery_charge: deliveryCharge,
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
