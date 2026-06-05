"use server";

import { createAdminClient } from "@/lib/supabase/admin";

type GenerateOrdersResult = {
  success: boolean;
  inserted?: number;
  skipped?: number;
  targetDate?: string;
  affectedCustomerProfileIds?: string[];
  error?: string;
};

async function logOrderGenerationRun({
  supabaseAdmin,
  targetDate,
  totalPreferencesFound,
  ordersInserted,
}: {
  supabaseAdmin: ReturnType<typeof createAdminClient>;
  targetDate: string;
  totalPreferencesFound: number;
  ordersInserted: number;
}) {
  const statsPayload = {
    totalPreferencesFound,
    ordersInserted,
    skippedExisting: totalPreferencesFound - ordersInserted,
  };

  try {
    const { data: existingLog, error: existingLogError } = await supabaseAdmin
      .from("automation_logs")
      .select("run_count")
      .eq("automation_type", "ORDER_GEN")
      .eq("target_date", targetDate)
      .maybeSingle();

    if (existingLogError) {
      console.error("Error fetching order generation log:", existingLogError);
      return;
    }

    const { error: upsertError } = await supabaseAdmin
      .from("automation_logs")
      .upsert(
        {
          automation_type: "ORDER_GEN",
          target_date: targetDate,
          run_count: (existingLog?.run_count ?? 0) + 1,
          last_run_at: new Date().toISOString(),
          latest_stats: statsPayload,
        },
        { onConflict: "automation_type,target_date" },
      );

    if (upsertError) {
      console.error("Error upserting order generation log:", upsertError);
    }
  } catch (error) {
    console.error("Unexpected error logging order generation run:", error);
  }
}

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
    await logOrderGenerationRun({
      supabaseAdmin,
      targetDate,
      totalPreferencesFound: 0,
      ordersInserted: 0,
    });

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
    await logOrderGenerationRun({
      supabaseAdmin,
      targetDate,
      totalPreferencesFound: preferences.length,
      ordersInserted: 0,
    });

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

  await logOrderGenerationRun({
    supabaseAdmin,
    targetDate,
    totalPreferencesFound: preferences.length,
    ordersInserted: ordersToInsert.length,
  });

  return {
    success: true,
    inserted: ordersToInsert.length,
    skipped: preferences.length - ordersToInsert.length,
    targetDate,
    affectedCustomerProfileIds: [
      ...new Set(ordersToInsert.map((order) => order.customer_profile_id)),
    ],
  };
}
