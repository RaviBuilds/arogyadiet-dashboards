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

// ─── helpers ────────────────────────────────────────────────────────────────

function generateSubscriptionCode(): string {
  return `SUB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

function getEarliestAllowedStartDate(): Date {
  return startOfDay(addDays(new Date(), 1));
}

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
  } = parsed.data;

  try {
    const start = startOfDay(new Date(startDate));

    if (!options?.skipStartDateCheck) {
      const earliest = getEarliestAllowedStartDate();
      if (start < earliest) {
        return {
          success: false,
          error: "Start date cannot be today or in the past.",
        };
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
      })
      .select("id")
      .single();

    if (subInsertErr) throw new Error(subInsertErr.message);

    // Generate subscription_daily_preferences rows
    const dailyPrefs = [];
    let cursor = start;

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

    // Always insert a payment/invoice row regardless of payment status.
    // status: PAID (collected) or PENDING (not yet collected).
    const isPaid = paymentStatus === "Payment Collected";

    const { data: newPayment, error: payErr } = await supabase
      .from("payments")
      .insert({
        customer_profile_id: customerProfileId,
        subscription_id: newSub.id,
        payment_method: "MANUAL",
        amount: totalAmount,
        status: isPaid ? "PAID" : "PENDING",
        paid_at: isPaid ? new Date().toISOString() : null,
        // Invoice breakdown columns (added via migration)
        base_amount: baseAmount,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        discount_amount: 0,
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
