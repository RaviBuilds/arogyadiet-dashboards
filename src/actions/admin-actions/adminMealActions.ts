"use server";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import {
  cascadePendingSubscriptionDates,
  processPausePreferenceUpdates,
} from "@/actions/manageMealActions";
import { logAdminAction } from "@/lib/logger";
import { buildPushPayload, notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { getCustomerNameBySubscriptionId } from "@/lib/notifications/lookups";
import { revalidatePath } from "next/cache";
import { checkGroupManage } from "@/lib/auth/adminAccess";

// Use raw admin client to match the customer portal\'s elevated transaction permissions
const supabaseAdmin = createSupabaseAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MEAL_PLANNER_NOTIFY_DEDUPE_MS = 2000;
const adminMealPlannerNotifyTimestamps = new Map<string, number>();

async function resolveUserIdFromSubscription(
  subscriptionId: string,
): Promise<string | null> {
  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_profile_id")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subError || !sub?.customer_profile_id) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .select("user_id")
    .eq("id", sub.customer_profile_id)
    .maybeSingle();

  if (profileError || !profile?.user_id) return null;
  return profile.user_id;
}

async function notifyAdminMealPlannerUpdated(
  subscriptionId: string,
): Promise<void> {
  const dedupeKey = `admin-meal-planner:${subscriptionId}`;
  const now = Date.now();
  const lastSent = adminMealPlannerNotifyTimestamps.get(dedupeKey);
  if (
    lastSent !== undefined &&
    now - lastSent < MEAL_PLANNER_NOTIFY_DEDUPE_MS
  ) {
    return;
  }
  adminMealPlannerNotifyTimestamps.set(dedupeKey, now);

  const userId = await resolveUserIdFromSubscription(subscriptionId);
  const customerName = await getCustomerNameBySubscriptionId(subscriptionId);

  if (userId) {
    const title = "Meal Planner Updated!";
    const message = "Admin successfully updated meals planner.";
    await sendNotificationToUser(userId, {
      title,
      message,
      actionUrl: "/customer/subscription/manage/planner",
      sendEmail: false,
      ...buildPushPayload(title, message, `admin-meal-planner-${subscriptionId}`),
    });
  }

  const adminTitle = "Meal Planner Updated!";
  const adminMessage = `Meal Planner updated for customer ${customerName}.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(
      adminTitle,
      adminMessage,
      `admin-meal-planner-admin-${subscriptionId}`,
    ),
  });
}

export async function adminBulkUpdateMealPreferences(subscriptionId: string, updates: { date: string; categoryId: string | null; }[]) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
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
    await notifyAdminMealPlannerUpdated(subscriptionId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function adminBulkUpdatePausePreferences(subscriptionId: string, updates: { date: string; isPaused: boolean }[]) {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
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
    await notifyAdminMealPlannerUpdated(subscriptionId);
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
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
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
