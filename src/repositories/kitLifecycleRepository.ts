// src/repositories/kitLifecycleRepository.ts
// Data-access layer for the KIT lifecycle management feature.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for KIT lifecycle operations (expiration, new KIT creation, history, reports,
// receipt/start flows). It applies NO business validation (that lives in
// `src/services/KitLifecycleService.ts`) and contains NO `'use server'`
// wrappers (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring the customerOnboardingRepository pattern.
//
// Requirements: 1.2, 1.3, 2.1, 2.3, 8.2, 8.3, 11.5, 11.6, 11.7, 12.1

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a subscription row relevant to KIT lifecycle operations. */
export interface KitSubscriptionRow {
  id: string;
  customer_profile_id: string;
  customer_category: string;
  status: string;
  kit_product_id: string | null;
  kit_duration_days: number | null;
  kit_received_date: string | null;
  kit_tracker_end_date: string | null;
  kit_total_skipped_days: number;
  created_at: string;
}

/** Input for creating a new KIT subscription record. */
export interface CreateKitSubscriptionInput {
  customer_profile_id: string;
  customer_category: "KIT";
  status: "PENDING";
  kit_product_id: string;
  kit_duration_days: number;
}

/** Input for creating a kit_shipping_info record. */
export interface CreateShippingInfoInput {
  customer_profile_id: string;
  subscription_id: string;
  courier_partner: string;
  tracking_number: string;
  tracking_url?: string | null;
  shipped_at: string;
}

/** A kit_daily_logs row for report generation. */
export interface KitDailyLogRow {
  id: string;
  subscription_id: string;
  log_date: string;
  status: string;
  weight_kg: number | null;
  step_count: number | null;
  physical_activity_minutes: number | null;
  physical_activity_name: string | null;
  water_intake_liters: number | null;
  buttermilk_intake: string | null;
  fat_consumption: string | null;
  main_dish: string | null;
  protein_curry: string | null;
  veg_curry: string | null;
  soup_name_qty: string | null;
  eggs_count: number | null;
  salads_qty: string | null;
}

/** Cached report row from kit_report_cache. */
export interface KitReportCacheRow {
  id: string;
  subscription_id: string;
  pdf_data: Buffer;
  generated_at: string;
}

/** kit_shipping_info row. */
export interface KitShippingInfoRow {
  id: string;
  customer_profile_id: string;
  subscription_id: string;
  courier_partner: string;
  tracking_number: string;
  tracking_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

/** KIT history row with joined product, daily log counts, and shipping info. */
export interface KitHistoryRow {
  id: string;
  customer_profile_id: string;
  status: string;
  kit_product_id: string | null;
  kit_duration_days: number | null;
  kit_received_date: string | null;
  kit_tracker_end_date: string | null;
  kit_total_skipped_days: number;
  created_at: string;
  kit_products: { name: string } | null;
  kit_shipping_info: Array<{
    shipped_at: string | null;
    delivered_at: string | null;
  }>;
  kit_daily_logs: Array<{ status: string }>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Find all ACTIVE KIT subscriptions whose tracker period has ended.
 *
 * Selects subscriptions WHERE:
 *   - status = 'ACTIVE'
 *   - customer_category = 'KIT'
 *   - kit_received_date IS NOT NULL
 *   - kit_tracker_end_date < currentISTDate
 *
 * The kit_tracker_end_date is maintained by a trigger/service layer as:
 *   kit_received_date + (kit_duration_days - 1) + kit_total_skipped_days
 *
 * Req 1.2, 1.7, 12.1
 */
export async function findExpiredKitSubscriptions(
  currentISTDate: string
): Promise<KitSubscriptionRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, kit_product_id, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, created_at"
    )
    .eq("status", "ACTIVE")
    .eq("customer_category", "KIT")
    .not("kit_received_date", "is", null)
    .lt("kit_tracker_end_date", currentISTDate);

  if (error) {
    throw new Error(
      `Failed to find expired KIT subscriptions: ${error.message}`
    );
  }

  return (data ?? []) as KitSubscriptionRow[];
}

/**
 * Check if a customer has any PENDING or ACTIVE KIT subscription.
 *
 * Returns `true` if at least one exists. Used to enforce the at-most-one
 * active/pending constraint before creating a new KIT subscription.
 *
 * Req 11.2, 11.3, 11.4
 */
export async function hasActiveOrPending(
  customerProfileId: string
): Promise<boolean> {
  const admin = createAdminClient();

  const { count, error } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .in("status", ["PENDING", "ACTIVE"]);

  if (error) {
    throw new Error(
      `Failed to check active/pending KIT for ${customerProfileId}: ${error.message}`
    );
  }

  return (count ?? 0) > 0;
}

/**
 * Fetch the most recent KIT subscription for a customer, ordered by created_at DESC.
 *
 * Returns `null` when no KIT subscriptions exist for the customer.
 *
 * Req 2.1, 3.1
 */
export async function getMostRecentKitSubscription(
  customerProfileId: string
): Promise<KitSubscriptionRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, kit_product_id, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, created_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get most recent KIT subscription for ${customerProfileId}: ${error.message}`
    );
  }

  return (data as KitSubscriptionRow) ?? null;
}

/**
 * Fetch a subscription with its customer_profile_id for authorization checks.
 *
 * Req 9.7 (PDF authorization)
 */
export async function getSubscriptionWithOwner(
  subscriptionId: string
): Promise<KitSubscriptionRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, kit_product_id, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, created_at"
    )
    .eq("id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get subscription ${subscriptionId}: ${error.message}`
    );
  }

  return (data as KitSubscriptionRow) ?? null;
}

/**
 * Fetch all KIT subscriptions for a customer with joined kit_products,
 * kit_daily_logs counts, and kit_shipping_info for the KIT History page.
 *
 * Ordered by created_at descending (newest first).
 *
 * Req 8.2, 8.3, 11.6, 11.7
 */
export async function getKitHistory(
  customerProfileId: string
): Promise<KitHistoryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      `id, customer_profile_id, status, kit_product_id, kit_duration_days,
       kit_received_date, kit_tracker_end_date, kit_total_skipped_days,
       created_at,
       kit_products(name),
       kit_shipping_info(shipped_at, delivered_at),
       kit_daily_logs(status)`
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get KIT history for ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;

    // kit_products is a to-one embed (via kit_product_id FK)
    const kitProduct = extractOne(record.kit_products) as {
      name: string;
    } | null;

    // kit_shipping_info is a to-many embed filtered by subscription_id
    const shippingInfo = Array.isArray(record.kit_shipping_info)
      ? (record.kit_shipping_info as Array<{
          shipped_at: string | null;
          delivered_at: string | null;
        }>)
      : [];

    // kit_daily_logs is a to-many embed — we need the array to count statuses
    const dailyLogs = Array.isArray(record.kit_daily_logs)
      ? (record.kit_daily_logs as Array<{ status: string }>)
      : [];

    return {
      id: record.id as string,
      customer_profile_id: record.customer_profile_id as string,
      status: record.status as string,
      kit_product_id: record.kit_product_id as string | null,
      kit_duration_days: record.kit_duration_days as number | null,
      kit_received_date: record.kit_received_date as string | null,
      kit_tracker_end_date: record.kit_tracker_end_date as string | null,
      kit_total_skipped_days: (record.kit_total_skipped_days as number) ?? 0,
      created_at: record.created_at as string,
      kit_products: kitProduct,
      kit_shipping_info: shippingInfo,
      kit_daily_logs: dailyLogs,
    };
  });
}

/**
 * Fetch all kit_daily_logs for a subscription ordered by log_date ascending.
 *
 * Used for PDF report generation to iterate day-by-day.
 *
 * Req 11.6
 */
export async function getDailyLogsForSubscription(
  subscriptionId: string
): Promise<KitDailyLogRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("kit_daily_logs")
    .select(
      "id, subscription_id, log_date, status, weight_kg, step_count, physical_activity_minutes, physical_activity_name, water_intake_liters, buttermilk_intake, fat_consumption, main_dish, protein_curry, veg_curry, soup_name_qty, eggs_count, salads_qty"
    )
    .eq("subscription_id", subscriptionId)
    .order("log_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get daily logs for subscription ${subscriptionId}: ${error.message}`
    );
  }

  return (data ?? []) as KitDailyLogRow[];
}

/**
 * Fetch the cached PDF report for an expired KIT subscription.
 *
 * Returns `null` when no cached report exists.
 *
 * Req 10.4
 */
export async function getCachedReport(
  subscriptionId: string
): Promise<KitReportCacheRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("kit_report_cache")
    .select("id, subscription_id, pdf_data, generated_at")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get cached report for subscription ${subscriptionId}: ${error.message}`
    );
  }

  return (data as KitReportCacheRow) ?? null;
}

/**
 * Fetch kit_shipping_info for a subscription.
 *
 * Returns `null` when no shipping record exists.
 *
 * Req 11.7
 */
export async function getShippingInfo(
  subscriptionId: string
): Promise<KitShippingInfoRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("kit_shipping_info")
    .select(
      "id, customer_profile_id, subscription_id, courier_partner, tracking_number, tracking_url, shipped_at, delivered_at, created_at"
    )
    .eq("subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get shipping info for subscription ${subscriptionId}: ${error.message}`
    );
  }

  return (data as KitShippingInfoRow) ?? null;
}

/**
 * Fetch all KIT subscriptions for a customer ordered by created_at DESC.
 *
 * Used for customer-facing display (KIT tracker state, dashboard).
 *
 * Req 2.1, 8.2
 */
export async function getCustomerKitSubscriptions(
  customerProfileId: string
): Promise<KitSubscriptionRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, kit_product_id, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, created_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get KIT subscriptions for ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as KitSubscriptionRow[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Atomically update all matching subscription IDs to a new status.
 *
 * Used by the expiration cron to batch-transition ACTIVE → EXPIRED.
 * The Supabase update with `.in()` applies to all matching rows in a single
 * database round-trip (single UPDATE statement = atomic at the DB level).
 *
 * Req 1.3
 */
export async function batchUpdateStatus(
  ids: string[],
  newStatus: string
): Promise<number> {
  if (ids.length === 0) return 0;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .update({ status: newStatus })
    .in("id", ids)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to batch update subscription status to ${newStatus}: ${error.message}`
    );
  }

  return data?.length ?? 0;
}

/**
 * Create a new KIT subscription with status PENDING.
 *
 * Returns the created subscription ID.
 *
 * Req 11.3, 11.5
 */
export async function createKitSubscription(
  input: CreateKitSubscriptionInput
): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .insert({
      customer_profile_id: input.customer_profile_id,
      customer_category: input.customer_category,
      status: input.status,
      kit_product_id: input.kit_product_id,
      kit_duration_days: input.kit_duration_days,
      kit_total_skipped_days: 0,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      `Failed to create KIT subscription: ${error.message}`
    );
  }

  return data.id as string;
}

/**
 * Create a kit_shipping_info record for a subscription.
 *
 * Req 11.7
 */
export async function createShippingInfo(
  input: CreateShippingInfoInput
): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("kit_shipping_info")
    .insert({
      customer_profile_id: input.customer_profile_id,
      subscription_id: input.subscription_id,
      courier_partner: input.courier_partner,
      tracking_number: input.tracking_number,
      tracking_url: input.tracking_url ?? null,
      shipped_at: input.shipped_at,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      `Failed to create shipping info: ${error.message}`
    );
  }

  return data.id as string;
}

/**
 * Insert or upsert a cached PDF report for a subscription.
 *
 * Uses upsert on the unique subscription_id constraint so repeated calls for
 * the same subscription overwrite the cached report rather than failing.
 *
 * Req 10.4
 */
export async function saveCachedReport(
  subscriptionId: string,
  pdfData: Buffer
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.from("kit_report_cache").upsert(
    {
      subscription_id: subscriptionId,
      pdf_data: pdfData,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "subscription_id" }
  );

  if (error) {
    throw new Error(
      `Failed to save cached report for subscription ${subscriptionId}: ${error.message}`
    );
  }
}

/**
 * Mark a KIT as delivered by setting delivered_at on the kit_shipping_info record.
 *
 * Req 6.1
 */
export async function markKitDelivered(subscriptionId: string): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("kit_shipping_info")
    .update({ delivered_at: new Date().toISOString() })
    .eq("subscription_id", subscriptionId);

  if (error) {
    throw new Error(
      `Failed to mark KIT delivered for subscription ${subscriptionId}: ${error.message}`
    );
  }
}

/**
 * Start a KIT subscription: set kit_received_date, kit_tracker_end_date, and
 * transition status to ACTIVE.
 *
 * Req 6.4
 */
export async function startKit(
  subscriptionId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("subscriptions")
    .update({
      kit_received_date: startDate,
      kit_tracker_end_date: endDate,
      status: "ACTIVE",
    })
    .eq("id", subscriptionId);

  if (error) {
    throw new Error(
      `Failed to start KIT subscription ${subscriptionId}: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a supabase-js embedded relation that may be returned as a single
 * object, a single-element array, or null/undefined into a single record (or
 * `null`). To-one embeds are sometimes typed/returned as arrays by the client.
 */
function extractOne(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}
