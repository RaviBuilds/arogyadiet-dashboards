"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  format,
  addDays,
  startOfDay,
  differenceInCalendarDays,
  parseISO,
} from "date-fns";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

const supabaseAdmin = createSupabaseAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MEAL_PLANNER_NOTIFY_DEDUPE_MS = 2000;
const customerMealPlannerNotifyTimestamps = new Map<string, number>();

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

async function notifyCustomerMealPlannerUpdated(
  subscriptionId: string,
): Promise<void> {
  const dedupeKey = `customer-meal-planner:${subscriptionId}`;
  const now = Date.now();
  const lastSent = customerMealPlannerNotifyTimestamps.get(dedupeKey);
  if (
    lastSent !== undefined &&
    now - lastSent < MEAL_PLANNER_NOTIFY_DEDUPE_MS
  ) {
    return;
  }
  customerMealPlannerNotifyTimestamps.set(dedupeKey, now);

  const userId = await resolveUserIdFromSubscription(subscriptionId);
  if (userId) {
    await sendNotificationToUser(userId, {
      title: "Meal Planner Updated!",
      message:
        "You have successfully updated your meal planner for future dates.",
      actionUrl: "/customer/subscription/manage/planner",
      sendEmail: false,
    });
  }

  await notifyAdmins({
    title: "Meal Planner Updated!",
    message: "A customer updated their meal planner dates.",
    actionUrl: "/admin/customers",
    sendEmail: false,
  });
}

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

type PendingPrefRow = {
  preference_date: string;
  meal_category_id: string | null;
  delivery_address_id: string | null;
  is_paused: boolean;
  pause_credit_used: boolean;
};

async function _rebuildPendingSubscriptionPreferences(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  subscriptionId: string,
  customerProfileId: string,
  oldStartsOn: string,
  newStartsOn: string,
  totalDays: number,
) {
  const { data: existingPrefs, error: fetchErr } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select(
      "preference_date, meal_category_id, delivery_address_id, is_paused, pause_credit_used",
    )
    .eq("subscription_id", subscriptionId)
    .order("preference_date", { ascending: true });

  if (fetchErr) throw fetchErr;

  const oldStart = parseISO(oldStartsOn);
  const prefsByIndex = new Map<number, PendingPrefRow>();
  for (const pref of existingPrefs ?? []) {
    const index = differenceInCalendarDays(
      parseISO(pref.preference_date),
      oldStart,
    );
    if (index >= 0 && index < totalDays) {
      prefsByIndex.set(index, pref);
    }
  }

  const firstPref = existingPrefs?.[0];
  const { data: profile } = await supabaseAdmin
    .from("customer_profiles")
    .select("addresses(id, is_primary)")
    .eq("id", customerProfileId)
    .single();
  const defaultAddressId =
    profile?.addresses?.find((a: { is_primary?: boolean }) => a.is_primary)
      ?.id ||
    profile?.addresses?.[0]?.id ||
    null;

  const defaultMealCategoryId = firstPref?.meal_category_id ?? null;
  const defaultDeliveryAddressId =
    firstPref?.delivery_address_id ?? defaultAddressId;

  const { error: deleteErr } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .delete()
    .eq("subscription_id", subscriptionId);

  if (deleteErr) throw deleteErr;

  const inserts = [];
  let cursor = parseISO(newStartsOn);

  for (let i = 0; i < totalDays; i++) {
    const mapped = prefsByIndex.get(i);
    inserts.push({
      subscription_id: subscriptionId,
      customer_profile_id: customerProfileId,
      preference_date: format(cursor, "yyyy-MM-dd"),
      meal_category_id: mapped?.meal_category_id ?? defaultMealCategoryId,
      delivery_address_id:
        mapped?.delivery_address_id ?? defaultDeliveryAddressId,
      is_paused: mapped?.is_paused ?? false,
      pause_credit_used: mapped?.pause_credit_used ?? false,
    });
    cursor = addDays(cursor, 1);
  }

  if (inserts.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .insert(inserts);
    if (insertErr) throw insertErr;
  }
}

export async function rebuildPendingSubscriptionPreferences(
  subscriptionId: string,
  oldStartsOn: string,
  newStartsOn: string,
) {
  const supabaseAdmin = createAdminClient();

  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_profile_id, total_days")
    .eq("id", subscriptionId)
    .single();

  if (subError || !sub) throw new Error("Subscription not found");

  await _rebuildPendingSubscriptionPreferences(
    supabaseAdmin,
    subscriptionId,
    sub.customer_profile_id,
    oldStartsOn,
    newStartsOn,
    sub.total_days,
  );
}

export async function cascadePendingSubscriptionDates(
  customerProfileId: string,
  baseEndDate: string | Date,
  options?: { afterSubscriptionId?: string },
) {
  const supabaseAdmin = createAdminClient();

  const { data: pendingSubs, error: fetchError } = await supabaseAdmin
    .from("subscriptions")
    .select("id, total_days, starts_on")
    .eq("customer_profile_id", customerProfileId)
    .in("status", ["PENDING"])
    .order("created_at", { ascending: true });

  if (fetchError) throw fetchError;
  if (!pendingSubs?.length) return;

  let currentStartDate = addDays(startOfDay(new Date(baseEndDate)), 1);
  let processing = !options?.afterSubscriptionId;

  for (const sub of pendingSubs) {
    if (!processing) {
      if (sub.id === options?.afterSubscriptionId) {
        processing = true;
      }
      continue;
    }

    const oldStartsOn = sub.starts_on;
    const newStartsOnStr = format(currentStartDate, "yyyy-MM-dd");
    const newEndsOn = addDays(currentStartDate, sub.total_days - 1);
    const newEndsOnStr = format(newEndsOn, "yyyy-MM-dd");

    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        starts_on: newStartsOnStr,
        ends_on: newEndsOnStr,
        effective_end_on: newEndsOnStr,
      })
      .eq("id", sub.id);

    if (updateError) throw updateError;

    await _rebuildPendingSubscriptionPreferences(
      supabaseAdmin,
      sub.id,
      customerProfileId,
      oldStartsOn,
      newStartsOnStr,
      sub.total_days,
    );

    currentStartDate = addDays(newEndsOn, 1);
  }
}

// --- MEAL UPDATES (UNTOUCHED / PROTECTED) ---
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

    await notifyCustomerMealPlannerUpdated(subscriptionId);

    revalidatePath("/dashboard");
    revalidatePath("/subscription");
    revalidatePath("/subscription/manage/planner");

    return { success: true };
  } catch (error) {
    console.error("Bulk update error:", error);
    return { success: false, error: "Failed to update preferences." };
  }
}

type PauseReconcileResult = {
  newEffectiveEndOn: string;
  customerProfileId: string;
  pauseCreditsUsed: number;
};

async function trimExcessPauseCredits(
  subscriptionId: string,
  pauseCreditsTotal: number,
) {
  const { count: pausedCount, error: countError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId)
    .eq("is_paused", true);

  if (countError) throw countError;
  const used = pausedCount ?? 0;
  if (used <= pauseCreditsTotal) return;

  const excess = used - pauseCreditsTotal;
  const { data: oldestPaused, error: fetchError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("is_paused", true)
    .order("preference_date", { ascending: true })
    .limit(excess);

  if (fetchError) throw fetchError;

  const idsToUnpause = oldestPaused?.map((row) => row.id) ?? [];
  if (idsToUnpause.length === 0) return;

  const { error: updateError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .update({ is_paused: false, pause_credit_used: false })
    .in("id", idsToUnpause);

  if (updateError) throw updateError;
}

async function executePauseReconciliationEngine(
  subscriptionId: string,
): Promise<PauseReconcileResult> {
  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "starts_on, total_days, customer_profile_id, pause_credits_total",
    )
    .eq("id", subscriptionId)
    .single();

  if (subError || !sub) throw new Error("Subscription not found");

  await trimExcessPauseCredits(subscriptionId, sub.pause_credits_total ?? 0);

  const { data: profile } = await supabaseAdmin
    .from("customer_profiles")
    .select("addresses(id, is_primary)")
    .eq("id", sub.customer_profile_id)
    .single();
  const defaultAddressId =
    profile?.addresses?.find((a: { is_primary?: boolean }) => a.is_primary)
      ?.id ||
    profile?.addresses?.[0]?.id;

  const { data: allPrefs, error: prefsErr } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("id, preference_date, is_paused")
    .eq("subscription_id", subscriptionId)
    .order("preference_date", { ascending: true });

  if (prefsErr) throw prefsErr;

  let validDeliveryDaysCount = 0;
  let currentDate = new Date(sub.starts_on);

  const prefsMap = new Map(allPrefs?.map((p) => [p.preference_date, p]) || []);
  const requiredDates = new Set<string>();
  let newEffectiveEndOn = sub.starts_on;

  while (validDeliveryDaysCount < sub.total_days) {
    const dateStr = format(currentDate, "yyyy-MM-dd");
    requiredDates.add(dateStr);

    const existingPref = prefsMap.get(dateStr);

    if (!existingPref?.is_paused) {
      validDeliveryDaysCount++;
      newEffectiveEndOn = dateStr;
    }

    currentDate = addDays(currentDate, 1);
  }

  const missingDates = Array.from(requiredDates).filter(
    (date) => !prefsMap.has(date),
  );
  if (missingDates.length > 0) {
    const inserts = missingDates.map((date) => ({
      subscription_id: subscriptionId,
      customer_profile_id: sub.customer_profile_id,
      preference_date: date,
      is_paused: false,
      pause_credit_used: false,
      delivery_address_id: defaultAddressId || null,
    }));
    const { error: insertError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .insert(inserts);
    if (insertError) throw insertError;
  }

  const extraPrefs =
    allPrefs?.filter((p) => !requiredDates.has(p.preference_date)) || [];
  if (extraPrefs.length > 0) {
    const extraIds = extraPrefs.map((p) => p.id);
    const { error: deleteError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .delete()
      .in("id", extraIds);
    if (deleteError) throw deleteError;
  }

  const { count: pausedCount, error: pausedCountError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId)
    .eq("is_paused", true);

  if (pausedCountError) throw pausedCountError;

  const pauseCreditsUsed = pausedCount ?? 0;
  const cappedPauseCreditsUsed = Math.min(
    pauseCreditsUsed,
    sub.pause_credits_total ?? pauseCreditsUsed,
  );

  const { error: subUpdateError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      pause_credits_used: cappedPauseCreditsUsed,
      effective_end_on: newEffectiveEndOn,
    })
    .eq("id", subscriptionId);

  if (subUpdateError) throw subUpdateError;

  return {
    newEffectiveEndOn,
    customerProfileId: sub.customer_profile_id,
    pauseCreditsUsed: cappedPauseCreditsUsed,
  };
}

/** Repairs legacy rows where pause_credits_used exceeds pause_credits_total. */
export async function repairOverLimitPauseCredits(subscriptionId: string) {
  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_profile_id, pause_credits_total")
    .eq("id", subscriptionId)
    .single();

  if (subError || !sub) return;

  const { count: pausedCount, error: countError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId)
    .eq("is_paused", true);

  if (countError) throw countError;

  const total = sub.pause_credits_total ?? 0;
  if ((pausedCount ?? 0) <= total) return;

  const result = await executePauseReconciliationEngine(subscriptionId);
  await cascadePendingSubscriptionDates(
    result.customerProfileId,
    result.newEffectiveEndOn,
  );
}

export async function processPausePreferenceUpdates(
  subscriptionId: string,
  updates: { date: string; isPaused: boolean }[],
) {
  for (const update of updates) {
    const { error: updateError } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .update({
        is_paused: update.isPaused,
        pause_credit_used: update.isPaused,
      })
      .eq("subscription_id", subscriptionId)
      .eq("preference_date", update.date);

    if (updateError) throw updateError;
  }

  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("pause_credits_total")
    .eq("id", subscriptionId)
    .single();

  if (subError || !sub) throw new Error("Subscription not found");

  const pauseCreditsTotal = sub.pause_credits_total ?? 0;
  const netNewPauses =
    updates.filter((u) => u.isPaused).length -
    updates.filter((u) => !u.isPaused).length;

  const { count: pausedAfterUpdates, error: countError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId)
    .eq("is_paused", true);

  if (countError) throw countError;

  const totalPaused = pausedAfterUpdates ?? 0;
  if (totalPaused > pauseCreditsTotal && netNewPauses > 0) {
    throw new Error(
      `Pause credit limit reached. This plan allows up to ${pauseCreditsTotal} pause days.`,
    );
  }

  return executePauseReconciliationEngine(subscriptionId);
}

// --- PAUSE UPDATES (RECONCILIATION ENGINE ADDED) ---
export async function bulkUpdatePausePreferencesAction(
  subscriptionId: string,
  updates: { date: string; isPaused: boolean }[],
) {
  try {
    await assertOwnsSubscription(subscriptionId);

    const result = await processPausePreferenceUpdates(
      subscriptionId,
      updates,
    );

    await cascadePendingSubscriptionDates(
      result.customerProfileId,
      result.newEffectiveEndOn,
    );

    await notifyCustomerMealPlannerUpdated(subscriptionId);

    revalidatePath("/dashboard");
    revalidatePath("/subscription");
    revalidatePath("/subscription/manage/planner");
    revalidatePath("/", "layout");

    return { success: true };
  } catch (error) {
    console.error("Pause update error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update pause preferences.";
    return { success: false, error: message };
  }
}

// --- ADDRESS UPDATES (UNTOUCHED / PROTECTED) ---
export async function bulkUpdateAddressPreferencesAction(
  subscriptionId: string,
  updates: { date: string; addressId: string }[],
) {
  try {
    await assertOwnsSubscription(subscriptionId);

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