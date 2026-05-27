"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function managePendingSubscription(
  subscriptionId: string, 
  payload: { starts_on?: string; status: string; }
) {
  const supabaseAdmin = createAdminClient();
  try {
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update(payload)
      .eq("id", subscriptionId);

    if (error) throw error;
    await logAdminAction("UPDATE", "subscription", subscriptionId, payload);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateActiveSubscriptionDates(
  subscriptionId: string,
  payload: { starts_on: string; pause_credits_total: number; }
) {
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
  const supabaseAdmin = createAdminClient();
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status")
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

    await logAdminAction("UPDATE", "subscription", subscriptionId, {
      status: "STOPPED",
    });
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
