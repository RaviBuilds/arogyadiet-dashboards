// src/lib/franchise/queries.ts
// Franchise-aware data query helpers.
//
// These are NEW helper functions — existing queries continue to work unchanged.
// Used by both Admin oversight and later by the Franchise portal.

import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISE_FEATURES_ENABLED } from "./constants";

/**
 * Query options for franchise-scoped data fetching.
 *
 * When franchise_id is:
 * - null/undefined → returns ALL records (existing behavior for core admin)
 * - a UUID string → filters to that franchise's records only
 * - "core" → filters to records where franchise_id IS NULL (core operation only)
 */
export interface FranchiseQueryOptions {
  franchise_id?: string | null;
}

/**
 * Applies franchise_id filter to a Supabase query builder.
 * Returns the query with the appropriate filter applied.
 *
 * @param query - Supabase query builder (from .from().select())
 * @param options - Franchise query options
 * @returns Modified query with franchise filter applied
 */
export function applyFranchiseFilter<T extends { eq: any; is: any }>(
  query: T,
  options?: FranchiseQueryOptions
): T {
  if (!FRANCHISE_FEATURES_ENABLED || !options?.franchise_id) {
    // No filtering — return all records (existing behavior)
    return query;
  }

  if (options.franchise_id === "core") {
    // Core operation only — records with NULL franchise_id
    return query.is("franchise_id", null);
  }

  // Franchise-scoped — records matching the franchise_id
  return query.eq("franchise_id", options.franchise_id);
}

/**
 * Get customer profiles with optional franchise scoping.
 */
export async function getCustomerProfiles(options?: FranchiseQueryOptions) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("customer_profiles")
    .select("*, users(full_name, email, mobile)");

  query = applyFranchiseFilter(query, options);

  const { data, error } = await query.order("created_at", { ascending: false });

  return { data: data ?? [], error };
}

/**
 * Get active subscriptions with optional franchise scoping.
 */
export async function getSubscriptions(options?: FranchiseQueryOptions) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("subscriptions")
    .select("*, customer_profiles(*, users(full_name, email)), subscription_plans(name, code)");

  query = applyFranchiseFilter(query, options);

  const { data, error } = await query.order("created_at", { ascending: false });

  return { data: data ?? [], error };
}

/**
 * Get delivery orders for a date with optional franchise scoping.
 */
export async function getDeliveryOrders(
  date: string,
  options?: FranchiseQueryOptions
) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("delivery_orders")
    .select("*, customer_profiles(*, users(full_name)), rider_profiles(*, users(full_name)), addresses(*)")
    .eq("delivery_date", date);

  query = applyFranchiseFilter(query, options);

  const { data, error } = await query.order("route_sequence", { ascending: true });

  return { data: data ?? [], error };
}

/**
 * Get rider profiles with optional franchise scoping.
 */
export async function getRiderProfiles(options?: FranchiseQueryOptions) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("rider_profiles")
    .select("*, users(full_name, email, mobile)");

  query = applyFranchiseFilter(query, options);

  const { data, error } = await query.order("created_at", { ascending: false });

  return { data: data ?? [], error };
}

/**
 * Get delivery batches for a date with optional franchise scoping.
 */
export async function getDeliveryBatches(
  date: string,
  options?: FranchiseQueryOptions
) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("delivery_batches")
    .select("*, rider_profiles(*, users(full_name))")
    .eq("delivery_date", date);

  query = applyFranchiseFilter(query, options);

  const { data, error } = await query;

  return { data: data ?? [], error };
}

/**
 * Get franchise-scoped metrics summary.
 * Returns counts of subscriptions, riders, and today's deliveries for a franchise.
 */
export async function getFranchiseMetrics(franchiseId: string) {
  const adminClient = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  const [subsResult, ridersResult, deliveriesResult] = await Promise.allSettled([
    adminClient
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("status", "ACTIVE"),
    adminClient
      .from("rider_profiles")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("is_active", true),
    adminClient
      .from("delivery_orders")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("delivery_date", today),
  ]);

  return {
    activeSubscriptions:
      subsResult.status === "fulfilled" ? (subsResult.value.count ?? 0) : 0,
    activeRiders:
      ridersResult.status === "fulfilled" ? (ridersResult.value.count ?? 0) : 0,
    todayDeliveries:
      deliveriesResult.status === "fulfilled" ? (deliveriesResult.value.count ?? 0) : 0,
  };
}
