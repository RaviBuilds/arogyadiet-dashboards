"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrderClinicStamp } from "@/lib/clinic/order-stamp";

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
      subscriptions!inner ( status, franchise_id )
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
    .map((pref) => {
      // Stamp the order with the subscription's franchise_id.
      // Core subscriptions have NULL franchise_id → core orders stay NULL
      // (unchanged behavior). Only franchise subscriptions produce
      // franchise-attributed orders, keeping core and franchise data isolated.
      const sub = Array.isArray(pref.subscriptions)
        ? pref.subscriptions[0]
        : pref.subscriptions;

      return {
        customer_profile_id: pref.customer_profile_id,
        meal_category_id: pref.meal_category_id,
        delivery_address_id: pref.delivery_address_id,
        delivery_date: targetDate,
        status: "ORDER_CREATED" as const,
        franchise_id: (sub as { franchise_id?: string | null })?.franchise_id ?? null,
      };
    });

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

  // Stamp each order's clinic_id at creation time (Req 19.2, 19.8). The order
  // stamp is the clinic already resolved for the order's delivery address —
  // persisted on `addresses.clinic_id` at signup/address-update (Task 5). Look
  // up that stamp for every distinct delivery address in one query, then pass
  // it through `resolveOrderClinicStamp` (null when the address resolved to no
  // clinic). A null stamp does NOT block order creation (Req 19.8). The stamp
  // is set exactly once here, at insert, and is immutable thereafter.
  const distinctAddressIds = [
    ...new Set(
      ordersToInsert
        .map((order) => order.delivery_address_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const addressClinicMap = new Map<string, string | null>();
  if (distinctAddressIds.length > 0) {
    const { data: addressRows, error: addressError } = await supabaseAdmin
      .from("addresses")
      .select("id, clinic_id")
      .in("id", distinctAddressIds);

    if (addressError) {
      console.error("Error fetching address clinic stamps:", addressError);
      return { success: false, error: addressError.message, targetDate };
    }

    for (const row of addressRows ?? []) {
      addressClinicMap.set(
        (row as { id: string }).id,
        (row as { clinic_id?: string | null }).clinic_id ?? null,
      );
    }
  }

  const stampedOrdersToInsert = ordersToInsert.map((order) => ({
    ...order,
    clinic_id: resolveOrderClinicStamp(
      addressClinicMap.get(order.delivery_address_id) ?? null,
    ),
  }));

  const { error: insertError } = await supabaseAdmin
    .from("delivery_orders")
    .insert(stampedOrdersToInsert);

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
