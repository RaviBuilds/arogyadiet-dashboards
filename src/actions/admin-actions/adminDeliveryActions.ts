"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function bulkUpdateAdminAddressPreferencesAction(
  subscriptionId: string,
  updates: { date: string; addressId: string }[],
) {
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

    await logAdminAction("UPDATE", "subscription_address_preferences", subscriptionId, {
      dates_updated: updates.length,
    });
    revalidatePath("/admin/subscriptions");
    revalidatePath("/admin/subscriptions/[id]/delivery-routing");
    revalidatePath("/", "layout"); // Ultimate Cache Buster

    return { success: true };
  } catch (error) {
    console.error("Admin Address update error:", error);
    return { success: false, error: "Failed to update delivery addresses." };
  }
}
