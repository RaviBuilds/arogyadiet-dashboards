"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  format,
  subDays,
  eachDayOfInterval,
  startOfMonth,
  parseISO,
  differenceInDays,
} from "date-fns";
import type { OverviewKPIs, RevenueGrowthPoint } from "@/types/bi-dashboard";

/**
 * Overview Command Center - KPI Ribbon
 */
export async function getOverviewKPIs(
  startDate?: string,
  endDate?: string
): Promise<OverviewKPIs> {
  const supabase = createAdminClient();
  const now = new Date();

  // Use provided range or default to current month
  const rangeStart = startDate || format(startOfMonth(now), "yyyy-MM-dd");
  const rangeEnd = endDate || format(now, "yyyy-MM-dd");

  // Calculate previous period for growth comparison
  const rangeDays = differenceInDays(parseISO(rangeEnd), parseISO(rangeStart)) + 1;
  const prevEnd = format(subDays(parseISO(rangeStart), 1), "yyyy-MM-dd");
  const prevStart = format(subDays(parseISO(rangeStart), rangeDays), "yyyy-MM-dd");

  const thisMonthStart = rangeStart;
  const today = rangeEnd;
  const prevMonthStart = prevStart;
  const prevMonthEnd = prevEnd;

  // MRR - current month revenue (+ PARTIALLY_PAID → amount_paid only)
  const [{ data: currentPayments }, { data: currentPartialPayments }] =
    await Promise.all([
      supabase
        .from("payments")
        .select("amount")
        .in("status", ["PAID", "SUCCESS", "CAPTURED"])
        .gte("created_at", `${thisMonthStart}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`),
      supabase
        .from("payments")
        .select("amount_paid")
        .eq("status", "PARTIALLY_PAID")
        .gte("created_at", `${thisMonthStart}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`),
    ]);

  const mrr =
    (currentPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    ) +
    (currentPartialPayments || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid || 0),
      0,
    );

  // Previous month revenue for growth %
  const [{ data: prevPayments }, { data: prevPartialPayments }] =
    await Promise.all([
      supabase
        .from("payments")
        .select("amount")
        .in("status", ["PAID", "SUCCESS", "CAPTURED"])
        .gte("created_at", `${prevMonthStart}T00:00:00`)
        .lte("created_at", `${prevMonthEnd}T23:59:59`),
      supabase
        .from("payments")
        .select("amount_paid")
        .eq("status", "PARTIALLY_PAID")
        .gte("created_at", `${prevMonthStart}T00:00:00`)
        .lte("created_at", `${prevMonthEnd}T23:59:59`),
    ]);

  const prevMrr =
    (prevPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    ) +
    (prevPartialPayments || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid || 0),
      0,
    );

  const mrrGrowthPercent =
    prevMrr > 0
      ? Math.round(((mrr - prevMrr) / prevMrr) * 100)
      : mrr > 0
        ? 100
        : 0;

  // Active fleet
  const { data: allRiders } = await supabase
    .from("rider_profiles")
    .select("id, is_active");

  const activeFleetSize = (allRiders || []).filter((r) => r.is_active).length;

  // Active vs Paused subs
  const { count: activeCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "ACTIVE");

  const { count: pausedCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "PAUSED");

  const activeSubscriptions = activeCount || 0;
  const pausedSubscriptions = pausedCount || 0;
  const total = activeSubscriptions + pausedSubscriptions;
  const activeVsPausedRatio =
    total > 0 ? Math.round((activeSubscriptions / total) * 100) : 0;

  // Kitchen load in range (or today if default)
  let kitchenLoadQuery = supabase
    .from("delivery_orders")
    .select("id", { count: "exact", head: true });

  if (startDate) {
    kitchenLoadQuery = kitchenLoadQuery
      .gte("delivery_date", rangeStart)
      .lte("delivery_date", rangeEnd);
  } else {
    kitchenLoadQuery = kitchenLoadQuery.eq("delivery_date", format(now, "yyyy-MM-dd"));
  }

  const { count: todayOrders } = await kitchenLoadQuery;

  return {
    mrr,
    mrrGrowthPercent,
    activeFleetSize,
    activeVsPausedRatio,
    activeSubscriptions,
    pausedSubscriptions,
    todayKitchenLoad: todayOrders || 0,
  };
}

/**
 * Overview Command Center - Revenue + Subscription Growth (Date-filtered)
 */
export async function getRevenueGrowthTrend(
  startDate?: string,
  endDate?: string
): Promise<RevenueGrowthPoint[]> {
  const supabase = createAdminClient();
  const now = new Date();

  const rangeEnd = endDate ? parseISO(endDate) : now;
  const rangeStart = startDate ? parseISO(startDate) : subDays(now, 29);

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  // Get all payments in range (+ PARTIALLY_PAID → amount_paid)
  const [{ data: payments }, { data: partialPayments }] = await Promise.all([
    supabase
      .from("payments")
      .select("amount, created_at")
      .in("status", ["PAID", "SUCCESS", "CAPTURED"])
      .gte("created_at", `${format(rangeStart, "yyyy-MM-dd")}T00:00:00`)
      .lte("created_at", `${format(rangeEnd, "yyyy-MM-dd")}T23:59:59`),
    supabase
      .from("payments")
      .select("amount_paid, created_at")
      .eq("status", "PARTIALLY_PAID")
      .gte("created_at", `${format(rangeStart, "yyyy-MM-dd")}T00:00:00`)
      .lte("created_at", `${format(rangeEnd, "yyyy-MM-dd")}T23:59:59`),
  ]);

  // Get all subscriptions created in range
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, created_at")
    .gte("created_at", `${format(rangeStart, "yyyy-MM-dd")}T00:00:00`)
    .lte("created_at", `${format(rangeEnd, "yyyy-MM-dd")}T23:59:59`);

  return days.map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");

    const dayRevenue =
      (payments || [])
        .filter((p) => p.created_at?.startsWith(dayStr))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0) +
      (partialPayments || [])
        .filter((p: any) => p.created_at?.startsWith(dayStr))
        .reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);

    const daySubs = (subs || []).filter((s) =>
      s.created_at?.startsWith(dayStr)
    ).length;

    return {
      date: format(day, "dd MMM"),
      revenue: dayRevenue,
      subscriptions: daySubs,
    };
  });
}
