"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import {
  buildHolidaysMap,
  buildMonthDayEntries,
  isMissingHolidaysTableError,
  type HolidayDayEntry,
  type HolidaysByDate,
} from "@/lib/holidays";
import { revalidatePath } from "next/cache";
import { endOfMonth, format, startOfMonth } from "date-fns";

const SETUP_HINT =
  "Run scripts/create-holidays-table.sql in the Supabase SQL Editor, then reload this page.";

/** Fetch holidays for customer meal planner / checkout — bypasses RLS via service role. */
export async function fetchHolidaysInRange(
  startDate: string,
  endDate: string,
): Promise<HolidaysByDate> {
  const supabaseAdmin = createAdminClient();

  const { data, error } = await supabaseAdmin
    .from("holidays")
    .select("holiday_date, name")
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate);

  if (error) {
    console.error("fetchHolidaysInRange:", error.message);
    return {};
  }

  return buildHolidaysMap(data ?? []);
}

export async function getHolidaysForMonth(
  year: number,
  month: number,
): Promise<
  | { success: true; entries: HolidayDayEntry[]; warning?: string }
  | { success: false; error: string }
> {
  const supabaseAdmin = createAdminClient();
  const emptyEntries = buildMonthDayEntries(year, month);

  try {
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const startStr = format(monthStart, "yyyy-MM-dd");
    const endStr = format(monthEnd, "yyyy-MM-dd");

    const { data: holidays, error } = await supabaseAdmin
      .from("holidays")
      .select("holiday_date, name")
      .gte("holiday_date", startStr)
      .lte("holiday_date", endStr);

    if (error) {
      if (isMissingHolidaysTableError(error)) {
        return {
          success: true,
          entries: emptyEntries,
          warning: SETUP_HINT,
        };
      }
      return { success: false, error: error.message };
    }

    const holidayMap = buildHolidaysMap(holidays ?? []);

    return {
      success: true,
      entries: buildMonthDayEntries(year, month, holidayMap),
    };
  } catch (error: unknown) {
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Failed to load holidays";
    return { success: false, error: message };
  }
}

export async function saveHolidaysForMonth(
  year: number,
  month: number,
  entries: HolidayDayEntry[],
): Promise<{ success: true } | { success: false; error: string }> {
  const supabaseAdmin = createAdminClient();

  try {
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const startStr = format(monthStart, "yyyy-MM-dd");
    const endStr = format(monthEnd, "yyyy-MM-dd");

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("holidays")
      .select("holiday_date")
      .gte("holiday_date", startStr)
      .lte("holiday_date", endStr);

    if (fetchError) {
      if (isMissingHolidaysTableError(fetchError)) {
        return { success: false, error: SETUP_HINT };
      }
      return { success: false, error: fetchError.message };
    }

    const existingDates = new Set((existing ?? []).map((h) => h.holiday_date));
    const now = new Date().toISOString();

    const toUpsert = entries
      .filter((e) => e.name.trim().length > 0)
      .map((e) => ({
        holiday_date: e.date,
        name: e.name.trim(),
        updated_at: now,
      }));

    const toDelete = entries
      .filter((e) => e.name.trim().length === 0 && existingDates.has(e.date))
      .map((e) => e.date);

    if (toUpsert.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("holidays")
        .upsert(toUpsert, { onConflict: "holiday_date" });

      if (upsertError) {
        return { success: false, error: upsertError.message };
      }
    }

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from("holidays")
        .delete()
        .in("holiday_date", toDelete);

      if (deleteError) {
        return { success: false, error: deleteError.message };
      }
    }

    const monthKey = format(monthStart, "yyyy-MM");
    await logAdminAction("UPDATE", "holiday", monthKey, {
      upserted: toUpsert.length,
      deleted: toDelete.length,
    });
    revalidatePath("/subscriptions");

    return { success: true };
  } catch (error: unknown) {
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Failed to save holidays";
    return { success: false, error: message };
  }
}
