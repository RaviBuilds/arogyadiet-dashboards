"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

const supabaseAdmin = createSupabaseAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PreferenceUpdatePayload = {
  meal_category_id?: string | null;
  is_paused?: boolean;
  pause_credit_used?: boolean;
  delivery_address_id?: string;
};

async function assertOwnsSubscription(subscriptionId: string) {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) throw new Error("Unauthorized");

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (appUserError || !appUser) throw new Error("User profile not found");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", appUser.id)
    .single();

  if (profileError || !profile) throw new Error("Customer profile not found");

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("id", subscriptionId)
    .eq("customer_profile_id", profile.id)
    .single();

  if (subscriptionError || !subscription) {
    throw new Error("Subscription not found for this customer");
  }
}

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
    await assertOwnsSubscription(subscriptionId);

    // We update row by row in a loop (Supabase REST API handles this efficiently)
    for (const update of updates) {
      const payload: PreferenceUpdatePayload = {};
      if (update.categoryId !== undefined)
        payload.meal_category_id = update.categoryId;
      if (update.isPaused !== undefined) {
        payload.is_paused = update.isPaused;
        payload.pause_credit_used = update.isPaused;
      }
      if (update.addressId !== undefined)
        payload.delivery_address_id = update.addressId;

      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update(payload)
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date)
        .select("id");

      if (updateError) throw updateError;
      if (!updatedRows?.length) {
        throw new Error(`No daily preference found for ${update.date}`);
      }
    }

    revalidatePath("/dashboard");
    revalidatePath("/subscription");
    revalidatePath("/subscription/manage/planner");

    return { success: true };
  } catch (error) {
    console.error("Bulk update error:", error);
    return { success: false, error: "Failed to update preferences." };
  }
}

export async function bulkUpdatePausePreferencesAction(
  subscriptionId: string,
  updates: { date: string; isPaused: boolean }[],
) {
  try {
    await assertOwnsSubscription(subscriptionId);

    // 1. Update the daily preferences on the calendar
    for (const update of updates) {
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({
          is_paused: update.isPaused,
          pause_credit_used: update.isPaused,
        })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date)
        .select("id");

      if (updateError) throw updateError;
      if (!updatedRows?.length) {
        throw new Error(`No daily preference found for ${update.date}`);
      }
    }

    const { error: normalizePausedError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .update({ pause_credit_used: true })
      .eq("subscription_id", subscriptionId)
      .eq("is_paused", true);

    if (normalizePausedError) throw normalizePausedError;

    const { error: normalizeActiveError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .update({ pause_credit_used: false })
      .eq("subscription_id", subscriptionId)
      .eq("is_paused", false);

    if (normalizeActiveError) throw normalizeActiveError;

    // 2. BULLETPROOF FIX: Recount the exact number of paused days directly from the source of truth
    const { count, error: countError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", subscriptionId)
      .eq("is_paused", true);

    if (countError) throw countError;

    // 3. Update the subscription tally so the Dashboard is always perfectly synced
    if (count !== null) {

      const { data: updatedSubscription, error: subUpdateError } =
        await supabaseAdmin
          .from("subscriptions")
          .update({ pause_credits_used: count })
          .eq("id", subscriptionId)
          .select("id, pause_credits_used")
          .single();

      if (subUpdateError) {
        console.error("SERVER ERROR:", subUpdateError);
        throw subUpdateError;
      }


      revalidatePath("/dashboard");
      revalidatePath("/subscription");
      revalidatePath("/subscription/manage/pause");
      revalidatePath("/subscription/manage/planner");
    }

    return { success: true };
  } catch (error) {
    console.error("Pause update error:", error);
    return { success: false, error: "Failed to update pause preferences." };
  }
}

export async function bulkUpdateAddressPreferencesAction(
  subscriptionId: string,
  updates: { date: string; addressId: string }[],
) {
  try {
    // 1. Run the same security check you use for Pauses and Meals
    await assertOwnsSubscription(subscriptionId);

    // 2. Use the admin client to ensure the update goes through cleanly
    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({ delivery_address_id: update.addressId })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);

      if (error) throw error;
    }

    revalidatePath("/dashboard");
    revalidatePath("/subscription/manage/address");
    return { success: true };
  } catch (error) {
    console.error("Address update error:", error);
    return { success: false, error: "Failed to update delivery addresses." };
  }
}