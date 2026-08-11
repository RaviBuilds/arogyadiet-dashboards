"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
  eachDayOfInterval,
  eachMonthOfInterval,
} from "date-fns";
import type {
  DateWindow,
  KPISummary,
  CustomerSegmentData,
  RetentionCohort,
  MealPreferenceBreakdown,
  PauseBehaviorStats,
  StatusCount,
  RiderSegmentData,
  PincodePerformance,
  FleetOverview,
  OperationsSegmentData,
  CutoffTimelinePoint,
  DailyDispatchPoint,
  OperationalHealth,
} from "@/types/dashboard";

// ═══════════════════════════════════════════════
// Date Window Helpers
// ═══════════════════════════════════════════════

function getDateRange(window: DateWindow): { from: string; to: string } {
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

function getPreviousDateRange(window: DateWindow): { from: string; to: string } {
  const now = new Date();

  switch (window) {
    case "today":
      const yesterday = subDays(now, 1);
      return { from: format(yesterday, "yyyy-MM-dd"), to: format(yesterday, "yyyy-MM-dd") };
    case "wow":
      const prevWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const prevWeekEnd = subDays(startOfWeek(now, { weekStartsOn: 1 }), 1);
      return { from: format(prevWeekStart, "yyyy-MM-dd"), to: format(prevWeekEnd, "yyyy-MM-dd") };
    case "mom":
      const prevMonthStart = startOfMonth(subMonths(now, 1));
      const prevMonthEnd = subDays(startOfMonth(now), 1);
      return { from: format(prevMonthStart, "yyyy-MM-dd"), to: format(prevMonthEnd, "yyyy-MM-dd") };
    case "yoy":
      const prevYearStart = startOfYear(subYears(now, 1));
      const prevYearEnd = subDays(startOfYear(now), 1);
      return { from: format(prevYearStart, "yyyy-MM-dd"), to: format(prevYearEnd, "yyyy-MM-dd") };
    default:
      return { from: format(subDays(now, 1), "yyyy-MM-dd"), to: format(subDays(now, 1), "yyyy-MM-dd") };
  }
}

// ═══════════════════════════════════════════════
// Phase 1: KPI Summary
// ═══════════════════════════════════════════════

export async function getKPISummary(window: DateWindow): Promise<KPISummary> {
  const supabase = createAdminClient();
  const { from, to } = getDateRange(window);
  const prev = getPreviousDateRange(window);

  // Revenue - current period (including PARTIALLY_PAID → amount_paid only)
  const [{ data: currentPayments }, { data: currentPartial }] = await Promise.all([
    supabase
      .from("payments")
      .select("amount, created_at")
      .in("status", ["PAID", "SUCCESS", "CAPTURED"])
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`),
    supabase
      .from("payments")
      .select("amount_paid, created_at")
      .eq("status", "PARTIALLY_PAID")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`),
  ]);

  const grossRevenue =
    (currentPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0), 0
    ) +
    (currentPartial || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid || 0), 0
    );

  // Revenue - previous period
  const [{ data: prevPayments }, { data: prevPartial }] = await Promise.all([
    supabase
      .from("payments")
      .select("amount")
      .in("status", ["PAID", "SUCCESS", "CAPTURED"])
      .gte("created_at", `${prev.from}T00:00:00`)
      .lte("created_at", `${prev.to}T23:59:59`),
    supabase
      .from("payments")
      .select("amount_paid")
      .eq("status", "PARTIALLY_PAID")
      .gte("created_at", `${prev.from}T00:00:00`)
      .lte("created_at", `${prev.to}T23:59:59`),
  ]);

  const prevRevenue =
    (prevPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0), 0
    ) +
    (prevPartial || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid || 0), 0
    );

  const revenueGrowthPercent = prevRevenue > 0
    ? Math.round(((grossRevenue - prevRevenue) / prevRevenue) * 100)
    : grossRevenue > 0 ? 100 : 0;

  // Revenue sparkline (last 7 data points)
  const sparklineDays = eachDayOfInterval({
    start: subDays(new Date(), 6),
    end: new Date(),
  });

  const revenueSparkline = sparklineDays.map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    return (currentPayments || [])
      .filter((p) => p.created_at?.startsWith(dayStr))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  });

  // Subscriptions
  const { data: activeSubs } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("status", "ACTIVE");

  const { data: pausedSubs } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("status", "PAUSED");

  const activeSubscriptions = activeSubs?.length || 0;
  const pausedSubscriptions = pausedSubs?.length || 0;
  const totalSubs = activeSubscriptions + pausedSubscriptions;
  const netActiveRate = totalSubs > 0 ? Math.round((activeSubscriptions / totalSubs) * 100) : 0;

  // Fleet utilization
  const { data: allRiders } = await supabase
    .from("rider_profiles")
    .select("id, is_active");

  const activeRiders = (allRiders || []).filter((r) => r.is_active).length;

  const { data: serviceAreas } = await supabase
    .from("rider_service_areas")
    .select("id, rider_id");

  const totalServiceAreas = serviceAreas?.length || 0;
  const unassignedAreas = (serviceAreas || []).filter((a) => !a.rider_id).length;
  const assignedAreas = totalServiceAreas - unassignedAreas;
  const fleetUtilization = totalServiceAreas > 0
    ? Math.round((assignedAreas / totalServiceAreas) * 100)
    : 0;

  // Fulfillment accuracy
  const { data: periodOrders } = await supabase
    .from("delivery_orders")
    .select("id, status")
    .gte("delivery_date", from)
    .lte("delivery_date", to);

  const totalOrders = periodOrders?.length || 0;
  const totalDelivered = (periodOrders || []).filter((o) => o.status === "DELIVERED").length;
  const totalCancelled = (periodOrders || []).filter(
    (o) => ["CANCELLED", "FAILED"].includes(o.status)
  ).length;
  const fulfillmentAccuracy = totalOrders > 0
    ? Math.round((totalDelivered / totalOrders) * 100)
    : 100;

  return {
    grossRevenue,
    revenueGrowthPercent,
    revenueSparkline,
    activeSubscriptions,
    pausedSubscriptions,
    netActiveRate,
    fleetUtilization,
    activeRiders,
    totalServiceAreas,
    unassignedAreas,
    fulfillmentAccuracy,
    totalDelivered,
    totalCancelled,
    totalOrders,
  };
}

// ═══════════════════════════════════════════════
// Phase 2: Customer Segment
// ═══════════════════════════════════════════════

export async function getCustomerSegmentData(): Promise<CustomerSegmentData> {
  const supabase = createAdminClient();

  // Retention cohorts (last 6 months)
  const months = eachMonthOfInterval({
    start: subMonths(new Date(), 5),
    end: new Date(),
  });

  const retentionCohorts: RetentionCohort[] = [];

  for (const month of months) {
    const monthStr = format(month, "yyyy-MM");
    const nextMonthStr = format(subDays(startOfMonth(subMonths(month, -1)), 0), "yyyy-MM");

    const { data: monthSubs } = await supabase
      .from("subscriptions")
      .select("id, status")
      .like("starts_on", `${monthStr}%`);

    const total = monthSubs?.length || 0;
    const churned = (monthSubs || []).filter(
      (s) => ["CANCELLED", "EXPIRED"].includes(s.status)
    ).length;
    const retained = total - churned;

    retentionCohorts.push({
      month: format(month, "MMM yyyy"),
      totalCustomers: total,
      retained,
      churned,
      retentionRate: total > 0 ? Math.round((retained / total) * 100) : 0,
    });
  }

  // Meal preference breakdown
  const { data: preferences } = await supabase
    .from("subscription_daily_preferences")
    .select("meal_category_id, meal_categories(name)")
    .eq("is_paused", false)
    .gte("preference_date", format(subDays(new Date(), 30), "yyyy-MM-dd"));

  const categoryCount = new Map<string, number>();
  for (const pref of preferences || []) {
    const name = (pref.meal_categories as any)?.name || "Unknown";
    categoryCount.set(name, (categoryCount.get(name) || 0) + 1);
  }

  const totalPrefs = (preferences || []).length;
  const mealPreferences: MealPreferenceBreakdown[] = Array.from(categoryCount.entries())
    .map(([category, count]) => ({
      category,
      count,
      percentage: totalPrefs > 0 ? Math.round((count / totalPrefs) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Pause behavior stats
  const { data: allActiveSubs } = await supabase
    .from("subscriptions")
    .select("pause_credits_used, subscription_plans(pause_credits)")
    .in("status", ["ACTIVE", "PAUSED"]);

  let totalPauseCreditsUsed = 0;
  let totalPauseCreditsAvailable = 0;
  for (const sub of allActiveSubs || []) {
    totalPauseCreditsUsed += Number(sub.pause_credits_used || 0);
    totalPauseCreditsAvailable += Number((sub.subscription_plans as any)?.pause_credits || 0);
  }

  const { count: pausedCustomerCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "PAUSED");

  const pauseBehavior: PauseBehaviorStats = {
    totalPauseCreditsUsed,
    totalPauseCreditsAvailable,
    avgPauseUtilization: totalPauseCreditsAvailable > 0
      ? Math.round((totalPauseCreditsUsed / totalPauseCreditsAvailable) * 100)
      : 0,
    customersCurrentlyPaused: pausedCustomerCount || 0,
  };

  // Subscription status breakdown
  const { data: allSubs } = await supabase
    .from("subscriptions")
    .select("status");

  const statusMap = new Map<string, number>();
  for (const sub of allSubs || []) {
    statusMap.set(sub.status, (statusMap.get(sub.status) || 0) + 1);
  }

  const subscriptionStatusBreakdown: StatusCount[] = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    retentionCohorts,
    mealPreferences,
    pauseBehavior,
    subscriptionStatusBreakdown,
  };
}

// ═══════════════════════════════════════════════
// Phase 2: Rider/Fleet Segment
// ═══════════════════════════════════════════════

export async function getRiderSegmentData(): Promise<RiderSegmentData> {
  const supabase = createAdminClient();

  // Pincode performance
  const { data: serviceAreas } = await supabase
    .from("rider_service_areas")
    .select("id, pincode, area_name, rider_id, rider_profiles(users(full_name))");

  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  // Get delivery volume per pincode (last 7 days)
  const { data: recentOrders } = await supabase
    .from("delivery_orders")
    .select("id, delivery_address_id, addresses(pincode)")
    .gte("delivery_date", weekAgo)
    .lte("delivery_date", today);

  const pincodeVolume = new Map<string, number>();
  for (const order of recentOrders || []) {
    const pincode = (order.addresses as any)?.pincode;
    if (pincode) {
      pincodeVolume.set(pincode, (pincodeVolume.get(pincode) || 0) + 1);
    }
  }

  const pincodePerformance: PincodePerformance[] = (serviceAreas || []).map((area) => {
    const volume = pincodeVolume.get(area.pincode) || 0;
    const riderName = (area.rider_profiles as any)?.users?.full_name || null;

    let capacityStatus: PincodePerformance["capacityStatus"] = "optimized";
    if (!area.rider_id) capacityStatus = "unassigned";
    else if (volume > 20) capacityStatus = "critical";
    else if (volume > 12) capacityStatus = "warning";

    return {
      pincode: area.pincode,
      areaName: area.area_name || area.pincode,
      assignedRider: riderName,
      deliveryVolume: volume,
      capacityStatus,
    };
  }).sort((a, b) => b.deliveryVolume - a.deliveryVolume);

  // Fleet overview
  const { data: allRiders } = await supabase
    .from("rider_profiles")
    .select("id, is_active, is_online");

  const totalRiders = allRiders?.length || 0;
  const activeRiders = (allRiders || []).filter((r) => r.is_active).length;
  const onlineNow = (allRiders || []).filter((r) => r.is_online).length;

  const { data: weekBatches } = await supabase
    .from("delivery_batches")
    .select("total_distance_km, assigned_rider_id")
    .gte("delivery_date", weekAgo)
    .lte("delivery_date", today);

  const totalDistanceKm = (weekBatches || []).reduce(
    (sum, b) => sum + Number(b.total_distance_km || 0), 0
  );

  const weekDeliveries = (recentOrders || []).length;
  const avgDeliveriesPerRider = activeRiders > 0
    ? Math.round(weekDeliveries / activeRiders)
    : 0;

  const fleetOverview: FleetOverview = {
    totalRiders,
    activeRiders,
    onlineNow,
    avgDeliveriesPerRider,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
  };

  return { pincodePerformance, fleetOverview };
}

// ═══════════════════════════════════════════════
// Phase 2: Operations Segment
// ═══════════════════════════════════════════════

export async function getOperationsSegmentData(): Promise<OperationsSegmentData> {
  const supabase = createAdminClient();
  const today = format(new Date(), "yyyy-MM-dd");

  // 5 PM Cutoff timeline - hourly order creation distribution for today
  const { data: todayOrders } = await supabase
    .from("delivery_orders")
    .select("id, created_at, status")
    .eq("delivery_date", today);

  const hourBuckets = new Map<number, number>();
  for (let h = 0; h < 24; h++) hourBuckets.set(h, 0);

  for (const order of todayOrders || []) {
    if (order.created_at) {
      const hour = new Date(order.created_at).getHours();
      hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
    }
  }

  let cumulative = 0;
  const cutoffTimeline: CutoffTimelinePoint[] = [];
  for (let h = 5; h <= 21; h++) {
    const count = hourBuckets.get(h) || 0;
    cumulative += count;
    cutoffTimeline.push({
      hour: `${h.toString().padStart(2, "0")}:00`,
      ordersPlaced: count,
      cumulativeOrders: cumulative,
    });
  }

  // Daily dispatch summary (last 14 days)
  const twoWeeksAgo = format(subDays(new Date(), 13), "yyyy-MM-dd");
  const { data: recentDispatch } = await supabase
    .from("delivery_orders")
    .select("delivery_date, status")
    .gte("delivery_date", twoWeeksAgo)
    .lte("delivery_date", today);

  const dayMap = new Map<string, { dispatched: number; delivered: number; cancelled: number }>();
  const days = eachDayOfInterval({ start: subDays(new Date(), 13), end: new Date() });
  for (const d of days) {
    dayMap.set(format(d, "yyyy-MM-dd"), { dispatched: 0, delivered: 0, cancelled: 0 });
  }

  for (const order of recentDispatch || []) {
    const day = dayMap.get(order.delivery_date);
    if (day) {
      day.dispatched++;
      if (order.status === "DELIVERED") day.delivered++;
      if (["CANCELLED", "FAILED"].includes(order.status)) day.cancelled++;
    }
  }

  const dailyDispatchSummary: DailyDispatchPoint[] = Array.from(dayMap.entries()).map(
    ([date, data]) => ({ date: format(new Date(date), "dd MMM"), ...data })
  );

  // Operational health (today)
  const todayTotal = todayOrders?.length || 0;
  const todayDelivered = (todayOrders || []).filter((o) => o.status === "DELIVERED").length;
  const todayInTransit = (todayOrders || []).filter(
    (o) => ["OUT_FOR_DELIVERY", "REACHING"].includes(o.status)
  ).length;
  const todayCancelled = (todayOrders || []).filter(
    (o) => ["CANCELLED", "FAILED"].includes(o.status)
  ).length;
  const todayPending = (todayOrders || []).filter(
    (o) => ["ORDER_CREATED", "ASSIGNED", "PENDING"].includes(o.status)
  ).length;

  const operationalHealth: OperationalHealth = {
    todayTotal,
    todayDelivered,
    todayInTransit,
    todayCancelled,
    todayPending,
    avgDeliveryTime: null,
  };

  return { cutoffTimeline, dailyDispatchSummary, operationalHealth };
}
