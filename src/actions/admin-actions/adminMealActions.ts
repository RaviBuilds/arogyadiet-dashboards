"use server";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { format, addDays } from "date-fns";

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
    // 1. Update manually toggled dates
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

    // 2. Fetch core subscription limits and start date
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("starts_on, total_days, customer_profile_id")
      .eq("id", subscriptionId)
      .single();

    if (subError || !sub) throw new Error("Subscription not found");

    // Fetch customer\'s primary address to apply to any new days generated
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("addresses(id, is_primary)")
      .eq("id", sub.customer_profile_id)
      .single();
    const defaultAddressId = profile?.addresses?.find((a: any) => a.is_primary)?.id || profile?.addresses?.[0]?.id;

    // 3. Fetch all currently existing calendar days for this sub
    const { data: allPrefs, error: prefsErr } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .select("id, preference_date, is_paused")
      .eq("subscription_id", subscriptionId)
      .order("preference_date", { ascending: true });

    if (prefsErr) throw prefsErr;

    // 4. Rebuild the calendar iteratively
    let validDeliveryDaysCount = 0;
    let currentDate = new Date(sub.starts_on);
    
    const prefsMap = new Map(allPrefs?.map((p) => [p.preference_date, p]) || []);
    const requiredDates = new Set<string>();
    let newEffectiveEndOn = sub.starts_on; 

    while (validDeliveryDaysCount < sub.total_days) {
      const dateStr = format(currentDate, "yyyy-MM-dd");
      requiredDates.add(dateStr);
      
      const existingPref = prefsMap.get(dateStr);
      
      // If it\'s paused, we don\'t count it. The loop pushes further into the future.
      if (!existingPref?.is_paused) {
        validDeliveryDaysCount++;
        newEffectiveEndOn = dateStr;
      }
      
      currentDate = addDays(currentDate, 1);
    }

    // 5. Insert missing days at the end of the calendar
    const missingDates = Array.from(requiredDates).filter(date => !prefsMap.has(date));
    if (missingDates.length > 0) {
      const inserts = missingDates.map(date => ({
        subscription_id: subscriptionId,
        customer_profile_id: sub.customer_profile_id,
        preference_date: date,
        is_paused: false,
        pause_credit_used: false,
        delivery_address_id: defaultAddressId || null,
      }));
      await supabaseAdmin.from("subscription_daily_preferences").insert(inserts);
    }

    // 6. Delete cut-off days (if unpausing causes the calendar to shrink)
    const extraPrefs = allPrefs?.filter(p => !requiredDates.has(p.preference_date)) || [];
    if (extraPrefs.length > 0) {
      const extraIds = extraPrefs.map(p => p.id);
      await supabaseAdmin.from("subscription_daily_preferences").delete().in("id", extraIds);
    }

    // 7. Get exact pause usage count from source of truth
    const { count: pausedCount } = await supabaseAdmin
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", subscriptionId)
      .eq("is_paused", true);

    // 8. Update Subscription End Date and Usage
    await supabaseAdmin
      .from("subscriptions")
      .update({ 
        pause_credits_used: pausedCount || 0,
        effective_end_on: newEffectiveEndOn 
      })
      .eq("id", subscriptionId);

    await logAdminAction("UPDATE", "subscription_pause_preferences", subscriptionId, {
      dates_updated: updates.length,
    });
    revalidatePath("/", "layout"); // Ultimate Cache Buster
    return { success: true };
  } catch (error: any) {
    console.error("Admin Pause update error:", error);
    return { success: false, error: "Failed to update pause preferences." };
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
