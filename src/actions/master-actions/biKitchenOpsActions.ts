"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { format, subDays, eachDayOfInterval, parseISO } from "date-fns";
import type {
  DailyMealCategoryStack,
  CutoffMetrics,
  AutomationLogEntry,
} from "@/types/bi-dashboard";

/**
 * Kitchen Ops - Daily Meal Category Distribution (Stacked Bar - date-filtered)
 */
export async function getDailyMealCategoryDistribution(
  startDate?: string,
  endDate?: string
): Promise<DailyMealCategoryStack[]> {
  const supabase = createAdminClient();
  const now = new Date();
  const rangeEnd = endDate ? parseISO(endDate) : now;
  const rangeStart = startDate ? parseISO(startDate) : subDays(now, 13);
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  // Fetch preferences with category names
  const { data: prefs } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, meal_categories(name)")
    .eq("is_paused", false)
    .gte("preference_date", format(rangeStart, "yyyy-MM-dd"))
    .lte("preference_date", format(rangeEnd, "yyyy-MM-dd"));

  // Aggregate by date and category
  const dayMap = new Map<string, Map<string, number>>();
  for (const day of days) {
    dayMap.set(format(day, "yyyy-MM-dd"), new Map());
  }

  const allCategories = new Set<string>();

  for (const pref of prefs || []) {
    const category = (pref.meal_categories as any)?.name || "Unknown";
    allCategories.add(category);
    const dateMap = dayMap.get(pref.preference_date);
    if (dateMap) {
      dateMap.set(category, (dateMap.get(category) || 0) + 1);
    }
  }

  return days.map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const dateMap = dayMap.get(dayStr) || new Map();

    const point: DailyMealCategoryStack = { date: format(day, "dd MMM") };
    for (const cat of allCategories) {
      point[cat] = dateMap.get(cat) || 0;
    }
    return point;
  });
}

/**
 * Kitchen Ops - 5 PM Cutoff Metrics
 */
export async function getCutoffMetrics(
  startDate?: string,
  endDate?: string
): Promise<CutoffMetrics> {
  const supabase = createAdminClient();
  const today = format(new Date(), "yyyy-MM-dd");

  let query = supabase
    .from("delivery_orders")
    .select("id, created_at");

  if (startDate && endDate) {
    query = query.gte("delivery_date", startDate).lte("delivery_date", endDate);
  } else {
    query = query.eq("delivery_date", today);
  }

  const { data: todayOrders } = await query;

  const totalToday = todayOrders?.length || 0;

  // Orders placed before 5 PM vs after
  let lockedBeforeCutoff = 0;
  let scheduledAfterCutoff = 0;

  for (const order of todayOrders || []) {
    if (order.created_at) {
      const hour = new Date(order.created_at).getHours();
      if (hour < 17) {
        lockedBeforeCutoff++;
      } else {
        scheduledAfterCutoff++;
      }
    }
  }

  const cutoffCompliancePercent =
    totalToday > 0
      ? Math.round((lockedBeforeCutoff / totalToday) * 100)
      : 100;

  return {
    lockedBeforeCutoff,
    scheduledAfterCutoff,
    totalToday,
    cutoffCompliancePercent,
  };
}

/**
 * Kitchen Ops - Automation Health Log
 */
export async function getAutomationHealthLog(
  startDate?: string,
  endDate?: string
): Promise<AutomationLogEntry[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("automation_logs")
    .select("id, automation_type, status, executed_at, details")
    .order("executed_at", { ascending: false })
    .limit(50);

  if (startDate && endDate) {
    query = query
      .gte("executed_at", `${startDate}T00:00:00`)
      .lte("executed_at", `${endDate}T23:59:59`);
  }

  const { data: logs } = await query;

  return (logs || []).map((log) => ({
    id: log.id,
    automationType: log.automation_type,
    status: log.status as "SUCCESS" | "FAILURE" | "RUNNING",
    executedAt: log.executed_at,
    details:
      typeof log.details === "string"
        ? log.details
        : log.details
          ? JSON.stringify(log.details)
          : null,
  }));
}
