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
import { checkGroupManage } from "@/lib/auth/adminAccess";

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
