"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { format, addDays, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import type { DateWindow } from "@/types/dashboard";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface MasterSubscriptionRow {
  id: string;
  subscriptionCode: string;
  customerName: string;
  planName: string;
  startsOn: string;
  effectiveEndOn: string | null;
  endsOn: string;
  pauseCreditsTotal: number;
  pauseCreditsUsed: number;
  pauseCreditsRemaining: number;
  status: string;
  createdAt: string;
}

export interface SubscriptionKPIs {
  activeSubscriptions: number;
  pauseCreditsUsedThisMonth: number;
  revenueLocked: number;
  upcomingRenewals: number;
}

// ═══════════════════════════════════════════════
// Data Fetchers
// ═══════════════════════════════════════════════

export async function getMasterSubscriptionKPIs(): Promise<SubscriptionKPIs> {
  const supabase = createAdminClient();
  const now = new Date();
  const thisMonthStr = format(now, "yyyy-MM");
  const next7Days = format(addDays(now, 7), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");

  // Active subscriptions
  const { count: activeCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "ACTIVE");

  // Pause credits used this month
  const { data: pausedPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select("id")
    .eq("pause_credit_used", true)
    .like("preference_date", `${thisMonthStr}%`);

  const pauseCreditsUsedThisMonth = pausedPrefs?.length || 0;

  // Revenue locked (sum of plan prices for all ACTIVE subscriptions)
  const { data: activeSubs } = await supabase
    .from("subscriptions")
    .select("subscription_plans(price)")
    .eq("status", "ACTIVE");

  const revenueLocked = (activeSubs || []).reduce(
    (sum, s) => sum + Number((s.subscription_plans as any)?.price || 0), 0
  );

  // Upcoming renewals (subscriptions ending in next 7 days)
  const { count: renewalCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "ACTIVE")
    .gte("effective_end_on", today)
    .lte("effective_end_on", next7Days);

  return {
    activeSubscriptions: activeCount || 0,
    pauseCreditsUsedThisMonth,
    revenueLocked,
    upcomingRenewals: renewalCount || 0,
  };
}

export async function getMasterSubscriptionList(): Promise<MasterSubscriptionRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(`
      id, subscription_code, starts_on, ends_on, effective_end_on,
      status, pause_credits_used, created_at,
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name ) ),
      subscription_plans ( name, pause_credits )
    `)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("getMasterSubscriptionList error:", error);
    return [];
  }

  return (data || []).map((sub: any) => {
    const pauseCreditsTotal = Number(sub.subscription_plans?.pause_credits || 0);
    const pauseCreditsUsed = Number(sub.pause_credits_used || 0);

    return {
      id: sub.id,
      subscriptionCode: sub.subscription_code || "N/A",
      customerName: sub.customer_profiles?.users?.full_name || "N/A",
      planName: sub.subscription_plans?.name || "N/A",
      startsOn: sub.starts_on,
      effectiveEndOn: sub.effective_end_on,
      endsOn: sub.ends_on,
      pauseCreditsTotal,
      pauseCreditsUsed,
      pauseCreditsRemaining: Math.max(0, pauseCreditsTotal - pauseCreditsUsed),
      status: sub.status,
      createdAt: sub.created_at,
    };
  });
}

// ═══════════════════════════════════════════════
// Report Export Data
// ═══════════════════════════════════════════════

export async function getSubscriptionReportData(window: DateWindow): Promise<MasterSubscriptionRow[]> {
  const supabase = createAdminClient();
  const { from } = getReportDateRange(window);

  const { data } = await supabase
    .from("subscriptions")
    .select(`
      id, subscription_code, starts_on, ends_on, effective_end_on,
      status, pause_credits_used, created_at,
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name ) ),
      subscription_plans ( name, pause_credits )
    `)
    .gte("created_at", `${from}T00:00:00`)
    .order("created_at", { ascending: false });

  return (data || []).map((sub: any) => {
    const pauseCreditsTotal = Number(sub.subscription_plans?.pause_credits || 0);
    const pauseCreditsUsed = Number(sub.pause_credits_used || 0);

    return {
      id: sub.id,
      subscriptionCode: sub.subscription_code || "N/A",
      customerName: sub.customer_profiles?.users?.full_name || "N/A",
      planName: sub.subscription_plans?.name || "N/A",
      startsOn: sub.starts_on,
      effectiveEndOn: sub.effective_end_on,
      endsOn: sub.ends_on,
      pauseCreditsTotal,
      pauseCreditsUsed,
      pauseCreditsRemaining: Math.max(0, pauseCreditsTotal - pauseCreditsUsed),
      status: sub.status,
      createdAt: sub.created_at,
    };
  });
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function getReportDateRange(window: DateWindow): { from: string; to: string } {
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");

  switch (window) {
    case "today":
      return { from: today, to: today };
    case "wow":
      return { from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: today };
    case "mom":
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: today };
    case "yoy":
      return { from: format(startOfYear(now), "yyyy-MM-dd"), to: today };
    default:
      return { from: today, to: today };
  }
}
