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
import { buildPushPayload, notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { notifyDeliveryAddressesUpdated } from "@/lib/customer/customerProfileNotifications";
import { getCustomerNameBySubscriptionId } from "@/lib/notifications/lookups";
import { isPastNextDayCutoff, getISTDateString } from "@/lib/dates/ist";
import { retargetUnlinkedAddonOrdersForPausedDates } from "@/lib/shop/retargetUnlinkedAddonOrders";
import type { CustomerCategory } from "@/lib/onboarding/category";

/**
 * 5:00 PM IST next-day cutoff guard (core-clinic-architecture, Requirement 11.2).
 *
 * Given the delivery dates a customer is attempting to edit (meal-planner edit,
 * pause, or address change), returns the first date that is LOCKED by the cutoff
 * — i.e. the attempt occurs at or after the 5:00 PM IST cutoff for that delivery
 * day (per the pure predicate `isPastNextDayCutoff`). Returns `null` when every
 * targeted date is still editable. Callers MUST invoke this BEFORE any mutation
 * so that a locked attempt leaves the affected data unchanged (Req 11.2).
 */
function findCutoffLockedDate(dates: string[]): string | null {
  const now = new Date();
  for (const date of dates) {
    if (isPastNextDayCutoff(now, date)) {
      return date;
    }
  }
  return null;
}

/** Error message returned when a customer edit is past the 5:00 PM IST cutoff. */
function cutoffPassedError(date: string): string {
  return `The 5:00 PM cutoff has passed for ${date}. This delivery day can no longer be changed.`;
}

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
  const customerName = await getCustomerNameBySubscriptionId(subscriptionId);

  if (userId) {
    const title = "Meal Planner Updated!";
    const message =
      "You have successfully updated meals planner for future dates.";

    await sendNotificationToUser(userId, {
      title,
      message,
      actionUrl: "/customer/subscription/manage/planner",
      sendEmail: false,
      ...buildPushPayload(title, message, `customer-meal-planner-${subscriptionId}`),
    });
  }

  const adminTitle = "Meal Planner Updated!";
  const adminMessage = `Hi Admin, Customer ${customerName}, updated the meal planner.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(
      adminTitle,
      adminMessage,
      `customer-meal-planner-admin-${subscriptionId}`,
    ),
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

/**
 * Validates that a subscription belongs to the MEAL category.
 * Throws an error if the subscription is not a MEAL subscription.
 * 
 * This prevents KIT customers from accessing meal subscription operations
 * like pause/resume, daily preferences, and delivery address changes.
 * 
 * Requirements: 7.2, 7.5
 */
async function assertMealSubscription(subscriptionId: string): Promise<void> {
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
    
    // Category validation: Prevent KIT customers from accessing meal operations (Req 7.2, 7.5)
    await assertMealSubscription(subscriptionId);

    // Enforce the 5:00 PM IST next-day cutoff (Req 11.2): reject the whole
    // operation before any write when any targeted delivery day is locked, so
    // the affected data is left unchanged.
    const lockedDate = findCutoffLockedDate(updates.map((u) => u.date));
    if (lockedDate) {
      return { success: false, error: cutoffPassedError(lockedDate) };
    }

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
    
    // Category validation: Prevent KIT customers from accessing meal operations (Req 7.2, 7.5)
    await assertMealSubscription(subscriptionId);

    // Enforce the 5:00 PM IST next-day cutoff (Req 11.2): reject the pause
    // operation before any write when any targeted delivery day is locked.
    const lockedDate = findCutoffLockedDate(updates.map((u) => u.date));
    if (lockedDate) {
      return { success: false, error: cutoffPassedError(lockedDate) };
    }

    const result = await processPausePreferenceUpdates(
      subscriptionId,
      updates,
    );

    await cascadePendingSubscriptionDates(
      result.customerProfileId,
      result.newEffectiveEndOn,
    );

    // Shop-product delivery linking fix — Defect #3 (Req 2.4): when a customer
    // pauses a day that is the target_delivery_date of an UNLINKED PAID shop
    // order, re-target that order to the customer's next active delivery day
    // immediately (rather than waiting for the nightly roll-forward). Strictly
    // scoped to this customer; linked orders are left untouched. Best-effort:
    // a failure here must not fail the pause, since roll-forward is a backstop.
    try {
      const pausedDates = updates
        .filter((u) => u.isPaused)
        .map((u) => u.date);
      await retargetUnlinkedAddonOrdersForPausedDates(
        supabaseAdmin,
        result.customerProfileId,
        pausedDates,
        getISTDateString(0),
      );
    } catch (retargetError) {
      console.error(
        "Failed to re-target unlinked addon orders after pause:",
        retargetError,
      );
    }

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
    
    // Category validation: Prevent KIT customers from accessing meal operations (Req 7.2, 7.5)
    await assertMealSubscription(subscriptionId);

    // Enforce the 5:00 PM IST next-day cutoff (Req 11.2): reject the address
    // change before any write when any targeted delivery day is locked.
    const lockedDate = findCutoffLockedDate(updates.map((u) => u.date));
    if (lockedDate) {
      return { success: false, error: cutoffPassedError(lockedDate) };
    }

    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("subscription_daily_preferences")
        .update({ delivery_address_id: update.addressId })
        .eq("subscription_id", subscriptionId)
        .eq("preference_date", update.date);

      if (error) throw error;
    }

    const userId = await resolveUserIdFromSubscription(subscriptionId);
    if (userId) {
      await notifyDeliveryAddressesUpdated(userId, subscriptionId);
    }

    revalidatePath("/dashboard");
    revalidatePath("/subscription/manage/address");
    return { success: true };
  } catch (error) {
    console.error("Address update error:", error);
    return { success: false, error: "Failed to update delivery addresses." };
  }
}