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
  formData: z.infer<typeof existingPlanSchema> | z.infer<typeof customPlanSchema>,
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
  } = parsed.data;

  try {
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
      })
      .select("id")
      .single();

    if (subInsertErr || !newSub) {
      throw new Error(subInsertErr?.message ?? "Failed to create subscription");
    }

    // Generate daily preferences
    const dailyRows = [];
    for (let i = 0; i < totalDays; i++) {
      const date = format(addDays(start, i), "yyyy-MM-dd");
      dailyRows.push({
        subscription_id: newSub.id,
        preference_date: date,
        meal_category_id: mealCategoryId,
        delivery_address_id: deliveryAddressId,
        status: "ACTIVE",
      });
    }

    if (dailyRows.length > 0) {
      const { error: prefErr } = await supabase
        .from("subscription_daily_preferences")
        .insert(dailyRows);
      if (prefErr) console.error("Daily prefs insert error:", prefErr.message);
    }

    // Insert payment record
    const paymentRecord = {
      subscription_id: newSub.id,
      customer_profile_id: customerProfileId,
      amount: totalAmount,
      base_amount: baseAmount,
      tax_percent: taxPercent,
      tax_amount: taxAmount,
      payment_method: "MANUAL",
      payment_status: paymentStatus === "Payment Collected" ? "PAID" : "PENDING",
      reference_id: paymentReference || null,
      notes: paymentNotes || null,
    };

    const { data: paymentData, error: payErr } = await supabase
      .from("payments")
      .insert(paymentRecord)
      .select("id")
      .single();

    if (payErr) console.error("Payment insert error:", payErr.message);

    await logAdminAction("CREATE", "subscription", newSub.id, {
      customer_profile_id: customerProfileId,
      plan: planDisplayName,
      status: subscriptionStatus,
      franchise_id: franchiseId,
    });

    revalidatePath("/franchise/customers");
    revalidatePath("/franchise/subscriptions");

    return { success: true, paymentId: paymentData?.id };
  } catch (error: any) {
    console.error("franchiseAddSubscription error:", error);
    return { success: false, error: error.message || "Failed to add subscription." };
  }
}
