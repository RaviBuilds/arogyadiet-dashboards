"use server";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import {
  cascadePendingSubscriptionDates,
  processPausePreferenceUpdates,
} from "@/actions/manageMealActions";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";

// Use raw admin client to match the customer portal\'s elevated transaction permissions
const supabaseAdmin = createSupabaseAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function adminBulkUpdateMealPreferences(subscriptionId: string, updates: { date: string; categoryId: string | null; }[]) {
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
    
    await logAdminAction("UPDATE", "subscription_meal_preferences", subscriptionId, {
      dates_updated: updates.length,
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function adminBulkUpdatePausePreferences(subscriptionId: string, updates: { date: string; isPaused: boolean }[]) {
  try {
    const result = await processPausePreferenceUpdates(
      subscriptionId,
      updates,
    );

    await cascadePendingSubscriptionDates(
      result.customerProfileId,
      result.newEffectiveEndOn,
    );

    await logAdminAction("UPDATE", "subscription_pause_preferences", subscriptionId, {
      dates_updated: updates.length,
      pause_credits_used: result.pauseCreditsUsed,
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error: unknown) {
    console.error("Admin Pause update error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update pause preferences.";
    return { success: false, error: message };
  }
}

export async function adminBulkUpdateAddressPreferences(subscriptionId: string, updates: { date: string; addressId: string }[]) {
  try {
    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({ delivery_address_id: update.addressId })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);
        
      if (error) throw error;
    }
    
    await logAdminAction("UPDATE", "subscription_address_preferences", subscriptionId, {
      dates_updated: updates.length,
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
