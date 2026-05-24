"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function adminBulkUpdateMealPreferences(subscriptionId: string, updates: { date: string; categoryId: string | null; }[]) {
  const supabaseAdmin = createAdminClient();
  try {
    for (const update of updates) {
      const payload: any = {};
      if (update.categoryId !== undefined) payload.meal_category_id = update.categoryId;

      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update(payload)
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);
      if (error) throw error;
    }
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function adminBulkUpdatePausePreferences(subscriptionId: string, updates: { date: string; isPaused: boolean }[]) {
  const supabaseAdmin = createAdminClient();
  try {
    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({ is_paused: update.isPaused, pause_credit_used: update.isPaused })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);
      if (error) throw error;
    }

    // Recount exactly how many paused days exist
    const { count, error: countError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", subscriptionId)
      .eq("is_paused", true);

    if (countError) throw countError;

    if (count !== null) {
      const { error: subUpdateError } = await supabaseAdmin
        .from("subscriptions")
        .update({ pause_credits_used: count })
        .eq("id", subscriptionId);
      if (subUpdateError) throw subUpdateError;
    }

    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function adminBulkUpdateAddressPreferences(subscriptionId: string, updates: { date: string; addressId: string }[]) {
  const supabaseAdmin = createAdminClient();
  try {
    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({ delivery_address_id: update.addressId })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);
      if (error) throw error;
    }
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}