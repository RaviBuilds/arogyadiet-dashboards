"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  format,
  subWeeks,
  subMonths,
  subYears,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachWeekOfInterval,
  eachMonthOfInterval,
  eachYearOfInterval,
  parseISO,
} from "date-fns";
import type {
  ReportRequest,
  ReportResult,
  ReportTrendPoint,
} from "@/types/bi-dashboard";

/**
 * Report Engine - Generate trend data based on segment + timeframe
 */
export async function generateReport(
  request: ReportRequest
): Promise<ReportResult> {
  const supabase = createAdminClient();
  const now = new Date();

  let trendData: ReportTrendPoint[] = [];
  let totalRecords = 0;

  switch (request.segment) {
    case "customers":
      ({ trendData, totalRecords } = await generateCustomerTrend(
        supabase,
        request,
        now
      ));
      break;
    case "subscriptions":
      ({ trendData, totalRecords } = await generateSubscriptionTrend(
        supabase,
        request,
        now
      ));
      break;
    case "finance":
      ({ trendData, totalRecords } = await generateFinanceTrend(
        supabase,
        request,
        now
      ));
      break;
    case "inventory":
      ({ trendData, totalRecords } = await generateInventoryTrend(
        supabase,
        request,
        now
      ));
      break;
  }

  return {
    trendData,
    totalRecords,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════
// Segment Generators
// ═══════════════════════════════════════════════

async function generateCustomerTrend(
  supabase: ReturnType<typeof createAdminClient>,
  request: ReportRequest,
  now: Date
): Promise<{ trendData: ReportTrendPoint[]; totalRecords: number }> {
  const periods = getPeriods(request.timeframe, now);

  const { data: profiles } = await supabase
    .from("customer_profiles")
    .select("id, created_at")
    .gte("created_at", `${periods[0].start}T00:00:00`);

  let totalRecords = profiles?.length || 0;

  const trendData: ReportTrendPoint[] = periods.map((period) => {
    const count = (profiles || []).filter(
      (p) =>
        p.created_at?.split("T")[0] >= period.start &&
        p.created_at?.split("T")[0] <= period.end
    ).length;

    return { period: period.label, value: count, label: "New Customers" };
  });

  return { trendData, totalRecords };
}

async function generateSubscriptionTrend(
  supabase: ReturnType<typeof createAdminClient>,
  request: ReportRequest,
  now: Date
): Promise<{ trendData: ReportTrendPoint[]; totalRecords: number }> {
  const periods = getPeriods(request.timeframe, now);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, created_at")
    .gte("created_at", `${periods[0].start}T00:00:00`);

  let totalRecords = subs?.length || 0;

  const trendData: ReportTrendPoint[] = periods.map((period) => {
    const count = (subs || []).filter(
      (s) =>
        s.created_at?.split("T")[0] >= period.start &&
        s.created_at?.split("T")[0] <= period.end
    ).length;

    return { period: period.label, value: count, label: "New Subscriptions" };
  });

  return { trendData, totalRecords };
}

async function generateFinanceTrend(
  supabase: ReturnType<typeof createAdminClient>,
  request: ReportRequest,
  now: Date
): Promise<{ trendData: ReportTrendPoint[]; totalRecords: number }> {
  const periods = getPeriods(request.timeframe, now);

  const { data: payments } = await supabase
    .from("payments")
    .select("amount, created_at")
    .in("status", ["PAID", "SUCCESS", "CAPTURED"])
    .gte("created_at", `${periods[0].start}T00:00:00`);

  let totalRecords = payments?.length || 0;

  const trendData: ReportTrendPoint[] = periods.map((period) => {
    const revenue = (payments || [])
      .filter(
        (p) =>
          p.created_at?.split("T")[0] >= period.start &&
          p.created_at?.split("T")[0] <= period.end
      )
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return { period: period.label, value: revenue, label: "Revenue (₹)" };
  });

  return { trendData, totalRecords };
}

async function generateInventoryTrend(
  supabase: ReturnType<typeof createAdminClient>,
  request: ReportRequest,
  now: Date
): Promise<{ trendData: ReportTrendPoint[]; totalRecords: number }> {
  const periods = getPeriods(request.timeframe, now);

  const { data: mfgOrders } = await supabase
    .from("manufacturing_orders")
    .select("finished_qty, created_at")
    .eq("status", "COMPLETED")
    .gte("created_at", `${periods[0].start}T00:00:00`);

  let totalRecords = mfgOrders?.length || 0;

  const trendData: ReportTrendPoint[] = periods.map((period) => {
    const produced = (mfgOrders || [])
      .filter(
        (o) =>
          o.created_at?.split("T")[0] >= period.start &&
          o.created_at?.split("T")[0] <= period.end
      )
      .reduce((sum, o) => sum + Number(o.finished_qty || 0), 0);

    return {
      period: period.label,
      value: produced,
      label: "Units Produced",
    };
  });

  return { trendData, totalRecords };
}

// ═══════════════════════════════════════════════
// Period Helpers (True Chronological Arrays)
// ═══════════════════════════════════════════════

interface Period {
  start: string;
  end: string;
  label: string;
}

function getPeriods(timeframe: ReportRequest["timeframe"], now: Date): Period[] {
  switch (timeframe) {
    case "wow":
      // Last 12 weeks
      return getWeekPeriods(now, 12);
    case "mom":
      // Last 12 months
      return getMonthPeriods(now, 12);
    case "yoy":
      // Last 3 years
      return getYearPeriods(now, 3);
    case "custom":
    default:
      // Default to last 12 months
      return getMonthPeriods(now, 12);
  }
}

function getWeekPeriods(now: Date, count: number): Period[] {
  const start = startOfWeek(subWeeks(now, count - 1), { weekStartsOn: 1 });
  const weeks = eachWeekOfInterval({ start, end: now }, { weekStartsOn: 1 });

  return weeks.map((weekStart) => {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    return {
      start: format(weekStart, "yyyy-MM-dd"),
      end: format(weekEnd, "yyyy-MM-dd"),
      label: `W${format(weekStart, "ww")} ${format(weekStart, "dd MMM")}`,
    };
  });
}

function getMonthPeriods(now: Date, count: number): Period[] {
  const start = startOfMonth(subMonths(now, count - 1));
  const months = eachMonthOfInterval({ start, end: now });

  return months.map((monthStart) => {
    const monthEnd = endOfMonth(monthStart);
    return {
      start: format(monthStart, "yyyy-MM-dd"),
      end: format(monthEnd, "yyyy-MM-dd"),
      label: format(monthStart, "MMM yyyy"),
    };
  });
}

function getYearPeriods(now: Date, count: number): Period[] {
  const start = startOfYear(subYears(now, count - 1));
  const years = eachYearOfInterval({ start, end: now });

  return years.map((yearStart) => {
    const yearEnd = endOfYear(yearStart);
    return {
      start: format(yearStart, "yyyy-MM-dd"),
      end: format(yearEnd, "yyyy-MM-dd"),
      label: format(yearStart, "yyyy"),
    };
  });
}
