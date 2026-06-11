"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  DietaryPieSlice,
  PlanPopularityBar,
  PauseCreditRadial,
} from "@/types/bi-dashboard";

/**
 * Growth & Subs - Dietary Preferences Pie Chart
 */
export async function getDietaryPreferenceSplit(
  startDate?: string,
  endDate?: string
): Promise<DietaryPieSlice[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("customer_profiles")
    .select("dietary_preference, created_at")
    .eq("is_active", true);

  if (startDate && endDate) {
    query = query
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`);
  }

  const { data: profiles } = await query;

  const countMap = new Map<string, number>();
  for (const p of profiles || []) {
    const pref = p.dietary_preference || "Not Set";
    countMap.set(pref, (countMap.get(pref) || 0) + 1);
  }

  return Array.from(countMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Growth & Subs - Plan Popularity Bar Chart
 */
export async function getPlanPopularity(
  startDate?: string,
  endDate?: string
): Promise<PlanPopularityBar[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("subscriptions")
    .select("subscription_plans(name), created_at")
    .in("status", ["ACTIVE", "PAUSED"]);

  if (startDate && endDate) {
    query = query
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`);
  }

  const { data: subs } = await query;

  const countMap = new Map<string, number>();
  for (const sub of subs || []) {
    const planName = (sub.subscription_plans as any)?.name || "Custom Plan";
    countMap.set(planName, (countMap.get(planName) || 0) + 1);
  }

  return Array.from(countMap.entries())
    .map(([plan, count]) => ({ plan, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Growth & Subs - Pause Credit Utilization Radial
 */
export async function getPauseCreditUtilization(
  startDate?: string,
  endDate?: string
): Promise<PauseCreditRadial> {
  const supabase = createAdminClient();

  let query = supabase
    .from("subscriptions")
    .select("pause_credits_used, subscription_plans(pause_credits), created_at")
    .in("status", ["ACTIVE", "PAUSED"]);

  if (startDate && endDate) {
    query = query
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`);
  }

  const { data: subs } = await query;

  let allocated = 0;
  let consumed = 0;

  for (const sub of subs || []) {
    allocated += Number((sub.subscription_plans as any)?.pause_credits || 0);
    consumed += Number(sub.pause_credits_used || 0);
  }

  const utilizationPercent =
    allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;

  return { allocated, consumed, utilizationPercent };
}
