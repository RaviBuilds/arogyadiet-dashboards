"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  format,
  subWeeks,
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  eachDayOfInterval,
  subDays,
  parseISO,
} from "date-fns";
import type {
  PincodeDensityBar,
  WoWDeliveryPoint,
  LogisticsKPIs,
  RiderOption,
  RiderDailyPerformancePoint,
  RiderPerformanceSummary,
} from "@/types/bi-dashboard";

/**
 * Logistics - Pincode Density (Horizontal Bar Chart)
 */
export async function getPincodeDensity(
  startDate?: string,
  endDate?: string
): Promise<PincodeDensityBar[]> {
  const supabase = createAdminClient();
  const today = endDate || format(new Date(), "yyyy-MM-dd");
  const weekAgo = startDate || format(subDays(new Date(), 7), "yyyy-MM-dd");

  // Get service areas
  const { data: serviceAreas } = await supabase
    .from("rider_service_areas")
    .select("pincode, area_name");

  // Get delivery volume by address pincode (last 7 days)
  const { data: orders } = await supabase
    .from("delivery_orders")
    .select("id, delivery_address_id, addresses(pincode)")
    .gte("delivery_date", weekAgo)
    .lte("delivery_date", today);

  const volumeMap = new Map<string, number>();
  for (const order of orders || []) {
    const pincode = (order.addresses as any)?.pincode;
    if (pincode) {
      volumeMap.set(pincode, (volumeMap.get(pincode) || 0) + 1);
    }
  }

  // Map area names from service areas
  const areaNameMap = new Map<string, string>();
  for (const area of serviceAreas || []) {
    areaNameMap.set(area.pincode, area.area_name || area.pincode);
  }

  return Array.from(volumeMap.entries())
    .map(([pincode, volume]) => ({
      pincode,
      areaName: areaNameMap.get(pincode) || pincode,
      volume,
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 15);
}

/**
 * Logistics - WoW Delivery Success Rate (Date-filtered)
 */
export async function getWoWDeliveryTrend(
  startDate?: string,
  endDate?: string
): Promise<WoWDeliveryPoint[]> {
  const supabase = createAdminClient();
  const now = endDate ? parseISO(endDate) : new Date();
  const twelveWeeksAgo = startDate
    ? startOfWeek(parseISO(startDate), { weekStartsOn: 1 })
    : startOfWeek(subWeeks(now, 11), { weekStartsOn: 1 });

  const weeks = eachWeekOfInterval(
    { start: twelveWeeksAgo, end: now },
    { weekStartsOn: 1 }
  );

  // Fetch all delivery orders in range
  const { data: allOrders } = await supabase
    .from("delivery_orders")
    .select("delivery_date, status")
    .gte("delivery_date", format(twelveWeeksAgo, "yyyy-MM-dd"))
    .lte("delivery_date", format(now, "yyyy-MM-dd"));

  return weeks.map((weekStart) => {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const weekStartStr = format(weekStart, "yyyy-MM-dd");
    const weekEndStr = format(weekEnd, "yyyy-MM-dd");

    const weekOrders = (allOrders || []).filter(
      (o) => o.delivery_date >= weekStartStr && o.delivery_date <= weekEndStr
    );

    const assigned = weekOrders.length;
    const delivered = weekOrders.filter(
      (o) => o.status === "DELIVERED"
    ).length;
    const successRate =
      assigned > 0 ? Math.round((delivered / assigned) * 100) : 0;

    return {
      week: `W${format(weekStart, "ww")} (${format(weekStart, "dd MMM")})`,
      assigned,
      delivered,
      successRate,
    };
  });
}

/**
 * Logistics - KPIs
 */
export async function getLogisticsKPIs(
  startDate?: string,
  endDate?: string
): Promise<LogisticsKPIs> {
  const supabase = createAdminClient();
  const today = endDate || format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = startDate || format(subDays(new Date(), 30), "yyyy-MM-dd");

  // Rider fleet overview
  const { data: riders } = await supabase
    .from("rider_profiles")
    .select("id, is_active");

  const totalRiders = riders?.length || 0;
  const activeRiders = (riders || []).filter((r) => r.is_active).length;

  // Average payout per order (from delivery_batches)
  const { data: batches } = await supabase
    .from("delivery_batches")
    .select("total_distance_km, expected_payout")
    .gte("delivery_date", thirtyDaysAgo)
    .lte("delivery_date", today);

  const totalPayout = (batches || []).reduce(
    (sum, b) => sum + Number(b.expected_payout || 0),
    0
  );
  const totalDistanceKm = (batches || []).reduce(
    (sum, b) => sum + Number(b.total_distance_km || 0),
    0
  );

  // Count orders in period for avg
  const { count: orderCount } = await supabase
    .from("delivery_orders")
    .select("id", { count: "exact", head: true })
    .gte("delivery_date", thirtyDaysAgo)
    .lte("delivery_date", today)
    .eq("status", "DELIVERED");

  const avgPayoutPerOrder =
    orderCount && orderCount > 0 ? Math.round(totalPayout / orderCount) : 0;

  return {
    avgPayoutPerOrder,
    totalRiders,
    activeRiders,
    totalDistanceKm: Math.round(totalDistanceKm),
  };
}

/**
 * Logistics - Rider Roster (for performance dropdown)
 * Returns active riders first, then inactive, alphabetical by name.
 */
export async function getRidersForLogistics(): Promise<RiderOption[]> {
  const supabase = createAdminClient();

  const { data: riders } = await supabase
    .from("rider_profiles")
    .select(
      `
      id,
      employee_code,
      is_active,
      users!rider_profiles_user_id_fkey ( full_name )
    `
    )
    .order("is_active", { ascending: false });

  return (riders || [])
    .map((r) => {
      const fullName = (r.users as any)?.full_name || "Unnamed Rider";
      return {
        id: r.id as string,
        name: fullName as string,
        employeeCode: (r.employee_code as string | null) ?? null,
        isActive: Boolean(r.is_active),
      };
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Logistics - Per-Rider Daily Performance (date-filtered)
 * Returns one point per day in the range with assigned/delivered/failed counts
 * and success rate, plus an aggregate summary.
 */
export async function getRiderDailyPerformance(
  riderId: string,
  startDate?: string,
  endDate?: string
): Promise<{
  series: RiderDailyPerformancePoint[];
  summary: RiderPerformanceSummary;
}> {
  const empty: {
    series: RiderDailyPerformancePoint[];
    summary: RiderPerformanceSummary;
  } = {
    series: [],
    summary: {
      totalAssigned: 0,
      totalDelivered: 0,
      totalFailed: 0,
      avgSuccessRate: 0,
      perfectDays: 0,
      activeDays: 0,
    },
  };

  if (!riderId) return empty;

  const supabase = createAdminClient();
  const fromDate = startDate
    ? parseISO(startDate)
    : subDays(new Date(), 29);
  const toDate = endDate ? parseISO(endDate) : new Date();
  const fromStr = format(fromDate, "yyyy-MM-dd");
  const toStr = format(toDate, "yyyy-MM-dd");

  const { data: orders } = await supabase
    .from("delivery_orders")
    .select("delivery_date, status")
    .eq("assigned_rider_id", riderId)
    .gte("delivery_date", fromStr)
    .lte("delivery_date", toStr);

  // Bucket by date
  const buckets = new Map<
    string,
    { assigned: number; delivered: number; failed: number }
  >();
  for (const o of orders || []) {
    const d = o.delivery_date as string;
    if (!d) continue;
    const b =
      buckets.get(d) || { assigned: 0, delivered: 0, failed: 0 };
    b.assigned += 1;
    if (o.status === "DELIVERED") b.delivered += 1;
    else if (o.status === "FAILED") b.failed += 1;
    buckets.set(d, b);
  }

  // Build a continuous series (one entry per day in the range)
  const days = eachDayOfInterval({ start: fromDate, end: toDate });
  const series: RiderDailyPerformancePoint[] = days.map((d) => {
    const iso = format(d, "yyyy-MM-dd");
    const b = buckets.get(iso) || {
      assigned: 0,
      delivered: 0,
      failed: 0,
    };
    const successRate =
      b.assigned > 0 ? Math.round((b.delivered / b.assigned) * 100) : 0;
    return {
      date: iso,
      label: format(d, "dd MMM"),
      assigned: b.assigned,
      delivered: b.delivered,
      failed: b.failed,
      successRate,
    };
  });

  // Aggregate summary
  const totalAssigned = series.reduce((s, p) => s + p.assigned, 0);
  const totalDelivered = series.reduce((s, p) => s + p.delivered, 0);
  const totalFailed = series.reduce((s, p) => s + p.failed, 0);
  const activeDays = series.filter((p) => p.assigned > 0).length;
  const perfectDays = series.filter(
    (p) => p.assigned > 0 && p.delivered === p.assigned
  ).length;
  const avgSuccessRate =
    totalAssigned > 0
      ? Math.round((totalDelivered / totalAssigned) * 100)
      : 0;

  return {
    series,
    summary: {
      totalAssigned,
      totalDelivered,
      totalFailed,
      avgSuccessRate,
      perfectDays,
      activeDays,
    },
  };
}
