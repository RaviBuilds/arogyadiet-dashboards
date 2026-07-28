"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { format, subDays, subWeeks, subMonths, subYears, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import type { DateWindow } from "@/types/dashboard";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface MasterCustomerRow {
  id: string;
  profileId: string;
  fullName: string;
  email: string;
  mobile: string | null;
  dietaryPreference: string | null;
  totalSubscriptions: number;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerKPIs {
  totalRegistered: number;
  activeCustomers: number;
  churnedCustomers: number;
  activeChurnRatio: number;
  averageLTV: number;
  profileCompletionRate: number;
}

// ═══════════════════════════════════════════════
// Data Fetchers
// ═══════════════════════════════════════════════

export async function getMasterCustomerKPIs(): Promise<CustomerKPIs> {
  const supabase = createAdminClient();

  // Total registered customers
  const { data: allProfiles } = await supabase
    .from("customer_profiles")
    .select("id, is_active, dietary_preference, date_of_birth, user_id");

  const totalRegistered = allProfiles?.length || 0;
  const activeCustomers = (allProfiles || []).filter((p) => p.is_active).length;
  const churnedCustomers = totalRegistered - activeCustomers;
  const activeChurnRatio = totalRegistered > 0
    ? Math.round((activeCustomers / totalRegistered) * 100)
    : 0;

  // Profile completion rate (has dietary_preference OR date_of_birth filled)
  const completedProfiles = (allProfiles || []).filter(
    (p) => p.dietary_preference || p.date_of_birth
  ).length;
  const profileCompletionRate = totalRegistered > 0
    ? Math.round((completedProfiles / totalRegistered) * 100)
    : 0;

  // Average LTV: sum of all successful payments / total customers
  const { data: payments } = await supabase
    .from("payments")
    .select("amount, status")
    .in("status", ["PAID", "SUCCESS", "CAPTURED"]);

  const totalRevenue = (payments || []).reduce(
    (sum, p) => sum + Number(p.amount || 0), 0
  );
  const averageLTV = totalRegistered > 0
    ? Math.round(totalRevenue / totalRegistered)
    : 0;

  return {
    totalRegistered,
    activeCustomers,
    churnedCustomers,
    activeChurnRatio,
    averageLTV,
    profileCompletionRate,
  };
}

export async function getMasterCustomerList(): Promise<MasterCustomerRow[]> {
  const supabase = createAdminClient();

  const { data: profiles, error } = await supabase
    .from("customer_profiles")
    .select(`
      id, is_active, dietary_preference, created_at,
      users!customer_profiles_user_id_fkey!inner ( id, full_name, email, mobile )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getMasterCustomerList error:", error);
    return [];
  }

  // Get subscription counts per customer_profile_id
  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("id, customer_profile_id");

  const subCountMap = new Map<string, number>();
  for (const sub of subscriptions || []) {
    const profileId = sub.customer_profile_id;
    subCountMap.set(profileId, (subCountMap.get(profileId) || 0) + 1);
  }

  return (profiles || []).map((profile: any) => ({
    id: profile.users?.id || "",
    profileId: profile.id,
    fullName: profile.users?.full_name || "N/A",
    email: profile.users?.email || "",
    mobile: profile.users?.mobile || null,
    dietaryPreference: profile.dietary_preference || null,
    totalSubscriptions: subCountMap.get(profile.id) || 0,
    isActive: profile.is_active ?? true,
    createdAt: profile.created_at,
  }));
}

// ═══════════════════════════════════════════════
// Report Export Data
// ═══════════════════════════════════════════════

export async function getCustomerReportData(window: DateWindow): Promise<MasterCustomerRow[]> {
  const supabase = createAdminClient();
  const { from } = getReportDateRange(window);

  const { data: profiles } = await supabase
    .from("customer_profiles")
    .select(`
      id, is_active, dietary_preference, created_at,
      users!customer_profiles_user_id_fkey!inner ( id, full_name, email, mobile )
    `)
    .gte("created_at", `${from}T00:00:00`)
    .order("created_at", { ascending: false });

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("id, customer_profile_id");

  const subCountMap = new Map<string, number>();
  for (const sub of subscriptions || []) {
    subCountMap.set(sub.customer_profile_id, (subCountMap.get(sub.customer_profile_id) || 0) + 1);
  }

  return (profiles || []).map((profile: any) => ({
    id: profile.users?.id || "",
    profileId: profile.id,
    fullName: profile.users?.full_name || "N/A",
    email: profile.users?.email || "",
    mobile: profile.users?.mobile || null,
    dietaryPreference: profile.dietary_preference || null,
    totalSubscriptions: subCountMap.get(profile.id) || 0,
    isActive: profile.is_active ?? true,
    createdAt: profile.created_at,
  }));
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
