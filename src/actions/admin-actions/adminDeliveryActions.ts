"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import type { CustomerCategory } from "@/lib/onboarding/category";

/**
 * Validates that a subscription belongs to the MEAL category.
 * Throws an error if the subscription is not a MEAL subscription.
 * 
 * This prevents KIT customers from accessing meal subscription operations
 * like pause/resume, daily preferences, and delivery address changes.
 * 
 * Requirements: 7.2, 7.5
 */
async function assertMealSubscription(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  subscriptionId: string
): Promise<void> {
  const { data: subscription, error } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_category")
    .eq("id", subscriptionId)
    .single();

  if (error || !subscription) {
    throw new Error("Subscription not found");
  }

  const category = subscription.customer_category as CustomerCategory;
  
  if (category !== "MEAL") {
    throw new Error("This operation is only available for meal subscriptions");
  }
}

export async function bulkUpdateAdminAddressPreferencesAction(
  subscriptionId: string,
  updates: { date: string; addressId: string }[],
) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient();

  try {
    // Category validation: Prevent KIT customers from accessing meal operations (Req 7.2, 7.5)
    await assertMealSubscription(supabaseAdmin, subscriptionId);
    
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
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update delivery addresses.";
    return { success: false, error: message };
  }
}
