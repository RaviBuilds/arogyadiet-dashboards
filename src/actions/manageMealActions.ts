"use server";

import { createClient } from "@/lib/supabase/server";

export async function bulkUpdateMealPreferencesAction(
  subscriptionId: string,
  updates: {
    date: string;
    categoryId: string | null;
    isPaused?: boolean;
    addressId?: string;
  }[],
) {
  try {
    const supabase = await createClient();

    // We update row by row in a loop (Supabase REST API handles this efficiently)
    for (const update of updates) {
      const payload: any = {};
      if (update.categoryId !== undefined)
        payload.meal_category_id = update.categoryId;
      if (update.isPaused !== undefined) payload.is_paused = update.isPaused;
      if (update.addressId !== undefined)
        payload.delivery_address_id = update.addressId;

      await supabase
        .from("subscription_daily_preferences")
        .update(payload)
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);
    }

    return { success: true };
  } catch (error) {
    console.error("Bulk update error:", error);
    return { success: false, error: "Failed to update preferences." };
  }
}
