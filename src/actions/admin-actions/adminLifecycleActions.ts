"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { addDays, format, parseISO, startOfDay } from "date-fns";
import {
  cascadePendingSubscriptionDates,
  rebuildPendingSubscriptionPreferences,
} from "@/actions/manageMealActions";
import { notifySubscriptionStopped } from "@/lib/subscription/subscriptionNotifications";
import { checkGroupManage, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { getRecalculationEndDateRange } from "@/lib/onboarding/cutoff";
import { getISTDateString } from "@/lib/dates/ist";
import { recalculateSubscriptionTenure } from "@/repositories/subscriptionPaymentRepository";
import { syncInvoicePaymentProjection } from "@/services/SubscriptionPaymentService";
import { recalculateSubscriptionTenureSchema } from "@/validations/subscriptionPaymentSchema";

export async function managePendingSubscription(
  subscriptionId: string,
  payload: { starts_on?: string; status: string },
) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient();
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, customer_profile_id, status, starts_on, total_days, effective_end_on",
      )
      .eq("id", subscriptionId)
      .single();

    if (fetchError || !existing) {
      throw new Error("Subscription not found.");
    }

    if (existing.status !== "PENDING" && existing.status !== "QUEUED") {
      throw new Error("Only PENDING subscriptions can be managed here.");
    }

    const startsOnChanged =
      !!payload.starts_on && payload.starts_on !== existing.starts_on;

    const normalizedStatus =
      payload.status === "QUEUED" ? "PENDING" : payload.status;

    if (startsOnChanged && payload.starts_on) {
      const { data: activeSub } = await supabaseAdmin
        .from("subscriptions")
        .select("effective_end_on, ends_on")
        .eq("customer_profile_id", existing.customer_profile_id)
        .eq("status", "ACTIVE")
        .maybeSingle();

      if (activeSub) {
        const activeEnd = activeSub.effective_end_on ?? activeSub.ends_on;
        if (!activeEnd) {
          throw new Error("Active subscription has no end date.");
        }
        const minStart = addDays(startOfDay(parseISO(activeEnd)), 1);
        const requestedStart = startOfDay(parseISO(payload.starts_on));
        if (requestedStart < minStart) {
          throw new Error(
            `Start date must be on or after ${format(minStart, "yyyy-MM-dd")} to prevent overlap with the active subscription.`,
          );
        }
      }

      const oldStartsOn = existing.starts_on;
      const newStartsOnStr = payload.starts_on;
      const newEndsOn = addDays(parseISO(newStartsOnStr), existing.total_days - 1);
      const newEndsOnStr = format(newEndsOn, "yyyy-MM-dd");

      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          starts_on: newStartsOnStr,
          ends_on: newEndsOnStr,
          effective_end_on: newEndsOnStr,
          status: normalizedStatus,
        })
        .eq("id", subscriptionId);

      if (updateError) throw updateError;

      await rebuildPendingSubscriptionPreferences(
        subscriptionId,
        oldStartsOn,
        newStartsOnStr,
      );

      await cascadePendingSubscriptionDates(
        existing.customer_profile_id,
        newEndsOnStr,
        { afterSubscriptionId: subscriptionId },
      );

      await logAdminAction("UPDATE", "subscription", subscriptionId, {
        starts_on: newStartsOnStr,
        ends_on: newEndsOnStr,
        effective_end_on: newEndsOnStr,
        status: normalizedStatus,
      });
    } else {
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: normalizedStatus })
        .eq("id", subscriptionId);

      if (updateError) throw updateError;

      await logAdminAction("UPDATE", "subscription", subscriptionId, {
        status: normalizedStatus,
      });
    }

    if (normalizedStatus === "STOPPED") {
      await notifySubscriptionStopped(
        existing.customer_profile_id,
        subscriptionId,
      );
    }

    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    revalidatePath("/", "layout");

    return { success: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update subscription.";
    return { success: false, error: message };
  }
}

export async function updateActiveSubscriptionDates(
  subscriptionId: string,
  payload: { starts_on: string; pause_credits_total: number },
) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient();
  try {
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", subscriptionId);

    if (error) throw error;
    await logAdminAction("UPDATE", "subscription", subscriptionId, payload);
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Permanently stops an ACTIVE subscription.
 * This is a one-way, irreversible action — the subscription will never
 * return to ACTIVE status after being stopped.
 */
export async function stopActiveSubscription(subscriptionId: string) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient();
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, customer_profile_id")
      .eq("id", subscriptionId)
      .single();

    if (fetchError || !existing) throw new Error("Subscription not found.");
    if (existing.status !== "ACTIVE") {
      throw new Error("Only ACTIVE subscriptions can be stopped.");
    }

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "STOPPED" })
      .eq("id", subscriptionId)
      .eq("status", "ACTIVE");

    if (error) throw error;

    await notifySubscriptionStopped(
      existing.customer_profile_id,
      subscriptionId,
    );

    await logAdminAction("UPDATE", "subscription", subscriptionId, {
      status: "STOPPED",
    });
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ─── Early Closure / Tenure Recalculation ───────────────────────────────────
//
// Feature: meal-subscription-early-closure
//
// Replaces the old "Stop Subscription" flow for the case where the customer is
// discontinuing before the plan's natural end date. Unlike stopActiveSubscription
// (a bare status flip with no payment settlement, still left in place above),
// this shortens the tenure, re-prices the invoice at the new duration, and
// leaves the resulting settlement (balance due or refund due) on the ledger via
// the existing Record Balance Payment / new refund flow — never generating a
// new invoice.
//
// STATUS IS DELIBERATELY NOT TOUCHED HERE. The subscription remains ACTIVE
// with its new (shortened) effective_end_on so deliveries the customer already
// paid for keep going out through the remaining days. It reaches EXPIRED via
// the SAME existing daily cron every other subscription uses
// (runSubscriptionActivation in FallbackAutomationService), just on the new,
// earlier date — no new status transition is invented here. This was a real
// defect in an earlier version of this action (it forced STOPPED immediately,
// which cut off already-paid-for deliveries); fixed by simply not writing
// status at all.

export type RecalculateTenureActionResult =
  | {
      success: true;
      newEndDate: string;
      newTotalPayable: number;
      totalPaid: number;
      /** Positive = still owed by the customer; negative = refund due; 0 = exact. */
      settlementAmount: number;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string>;
      minEndDate?: string;
      maxEndDate?: string;
    };

/**
 * Shorten an ACTIVE subscription's tenure, re-price it, and stop it — all in
 * one row-locked transaction (see recalculate_subscription_tenure RPC).
 *
 * @param subscriptionId the ACTIVE subscription being closed early
 * @param input           raw dialog input, re-validated here
 */
export async function recalculateSubscriptionTenureAction(
  subscriptionId: string,
  input: unknown,
): Promise<RecalculateTenureActionResult> {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };

  const ctx = await getCurrentAdminContext();
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from("subscriptions")
    .select("id, status, customer_profile_id, starts_on, ends_on, effective_end_on")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { success: false, error: "Subscription not found." };
  }

  if (existing.status !== "ACTIVE") {
    return { success: false, error: "Only ACTIVE subscriptions can be recalculated." };
  }

  // ── Re-validate shape/bounds ─────────────────────────────────────────────
  const parsed = recalculateSubscriptionTenureSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the recalculation details.",
      fieldErrors,
    };
  }

  const { newEndDate, newBaseAmount, newDeliveryCharge } = parsed.data;

  // Re-check the end-date bounds against the live cutoff clock — the client's
  // copy of "today" or "the current end date" may be stale by submit time. The
  // RPC re-checks the shortening invariant too, under the row lock; this check
  // exists to return the friendlier, cutoff-aware bounds message.
  const currentEffectiveEnd = existing.effective_end_on ?? existing.ends_on;
  if (!currentEffectiveEnd) {
    return { success: false, error: "This subscription has no end date to recalculate." };
  }
  const { min, max } = getRecalculationEndDateRange(new Date(), currentEffectiveEnd);
  if (min > max) {
    return {
      success: false,
      error: "This subscription's end date is too close to recalculate any further.",
    };
  }
  if (newEndDate < min || newEndDate > max) {
    return {
      success: false,
      error: `Select an end date between ${min} and ${max}.`,
      minEndDate: min,
      maxEndDate: max,
      fieldErrors: { newEndDate: `Select an end date between ${min} and ${max}.` },
    };
  }

  // ── Row-locked recalculation ─────────────────────────────────────────────
  const result = await recalculateSubscriptionTenure(
    {
      subscriptionId,
      newEndDate,
      newBaseAmount,
      newDeliveryCharge,
      recalculatedOn: getISTDateString(0),
      createdBy: ctx.userId ?? null,
    },
    admin,
  );

  if (!result.ok) {
    switch (result.reason) {
      case "INVALID_END_DATE":
        return {
          success: false,
          error: `Select an end date between ${result.minEndDate} and ${result.maxEndDate}.`,
          minEndDate: result.minEndDate,
          maxEndDate: result.maxEndDate,
          fieldErrors: { newEndDate: "That end date is no longer valid." },
        };
      case "BASE_AMOUNT_NOT_LOWER":
        return {
          success: false,
          error: `The new subscription charge must be less than the current ₹${result.currentBaseAmount.toFixed(2)}.`,
          fieldErrors: {
            newBaseAmount: `Must be less than ₹${result.currentBaseAmount.toFixed(2)}.`,
          },
        };
      case "DELIVERY_CHARGE_NOT_LOWER":
        return {
          success: false,
          error: `The new delivery charge must be less than the current ₹${result.currentDeliveryCharge.toFixed(2)}.`,
          fieldErrors: {
            newDeliveryCharge: `Must be less than ₹${result.currentDeliveryCharge.toFixed(2)}.`,
          },
        };
      case "NOT_ACTIVE":
        return { success: false, error: "Only ACTIVE subscriptions can be recalculated." };
      case "NO_INVOICE":
        return { success: false, error: "No invoice was found for this subscription." };
      case "NOT_FOUND":
        return { success: false, error: "Subscription not found." };
      default:
        return {
          success: false,
          error: result.message ?? "The subscription could not be recalculated.",
        };
    }
  }

  // ── Project the new total_payable onto the invoice against the ledger ────
  // Deliberately AFTER the RPC and deliberately not transactional with it — a
  // projection failure must not roll back a re-pricing that already committed.
  await syncInvoicePaymentProjection(subscriptionId, admin);

  // NOTE: notifySubscriptionStopped is intentionally NOT called here. The
  // subscription is still ACTIVE (see the header note above) — it has a new,
  // shortened end date, not a stop. It will reach EXPIRED naturally via the
  // existing daily cron, which sends its own "Subscription Expired"
  // notification at that time. Sending a "stopped" notice today would tell the
  // customer their deliveries have ended when they have not.

  await logAdminAction("UPDATE", "subscription", subscriptionId, {
    action: "recalculate_tenure",
    newEndDate: result.newEndDate,
    newTotalPayable: result.newTotalPayable,
    settlementAmount: result.settlementAmount,
  });

  revalidatePath(`/admin/subscriptions/${subscriptionId}`);
  revalidatePath(`/admin/customers/${existing.customer_profile_id}`);
  revalidatePath(`/franchise/subscriptions/${subscriptionId}`);
  revalidatePath(`/franchise/customers/${existing.customer_profile_id}`);
  revalidatePath("/", "layout");

  return {
    success: true,
    newEndDate: result.newEndDate,
    newTotalPayable: result.newTotalPayable,
    totalPaid: result.totalPaid,
    settlementAmount: result.settlementAmount,
  };
}
