"use server";

import { createAdminClient } from "@/lib/supabase/admin";

type GenerateOrdersResult = {
  success: boolean;
  inserted?: number;
  skipped?: number;
  targetDate?: string;
  error?: string;
};

/**
 * Creates delivery_orders for active, non-paused subscription preferences on the target date.
 * Mirrors the 5:15 PM order-generation SQL and skips rows that already have an order.
 */
export async function generateDailyOrders(
  targetDate: string,
): Promise<GenerateOrdersResult> {
  const supabaseAdmin = createAdminClient();

  const { data: preferences, error: prefsError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select(
      `
      customer_profile_id,
      meal_category_id,
      delivery_address_id,
      preference_date,
      subscriptions!inner ( status )
    `,
    )
    .eq("preference_date", targetDate)
    .eq("is_paused", false)
    .eq("subscriptions.status", "ACTIVE");

  if (prefsError) {
    console.error("Error fetching subscription preferences:", prefsError);
    return { success: false, error: prefsError.message, targetDate };
  }

  if (!preferences?.length) {
    return { success: true, inserted: 0, skipped: 0, targetDate };
  }

  const { data: existingOrders, error: existingError } = await supabaseAdmin
    .from("delivery_orders")
    .select("customer_profile_id, meal_category_id")
    .eq("delivery_date", targetDate);

  if (existingError) {
    console.error("Error checking existing delivery orders:", existingError);
    return { success: false, error: existingError.message, targetDate };
  }

  const existingKeys = new Set(
    (existingOrders ?? []).map(
      (order) => `${order.customer_profile_id}:${order.meal_category_id}`,
    ),
  );

  const ordersToInsert = preferences
    .filter(
      (pref) =>
        !existingKeys.has(
          `${pref.customer_profile_id}:${pref.meal_category_id}`,
        ),
    )
    .map((pref) => ({
      customer_profile_id: pref.customer_profile_id,
      meal_category_id: pref.meal_category_id,
      delivery_address_id: pref.delivery_address_id,
      delivery_date: targetDate,
      status: "ORDER_CREATED" as const,
    }));

  if (ordersToInsert.length === 0) {
    return {
      success: true,
      inserted: 0,
      skipped: preferences.length,
      targetDate,
    };
  }

  const { error: insertError } = await supabaseAdmin
    .from("delivery_orders")
    .insert(ordersToInsert);

  if (insertError) {
    console.error("Error inserting delivery orders:", insertError);
    return { success: false, error: insertError.message, targetDate };
  }

  return {
    success: true,
    inserted: ordersToInsert.length,
    skipped: preferences.length - ordersToInsert.length,
    targetDate,
  };
}
