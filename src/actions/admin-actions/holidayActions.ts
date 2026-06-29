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
import { checkGroupManage } from "@/lib/auth/adminAccess";

const SETUP_HINT =
  "Run scripts/create-holidays-table.sql in the Supabase SQL Editor, then reload this page.";

/**
 * Resolves the franchise scope value used by the admin Holiday Calendar UI
 * ("core" | franchise UUID) into a concrete franchise_id filter.
 * Returns null for core (franchise_id IS NULL), or the UUID for a franchise.
 */
function normalizeScope(scope?: string | null): string | null {
  if (!scope || scope === "core") return null;
  return scope;
}

/** Fetch holidays for customer meal planner / checkout — bypasses RLS via service role. */
export async function fetchHolidaysInRange(
  startDate: string,
  endDate: string,
  franchiseId?: string | null,
): Promise<HolidaysByDate> {
  const supabaseAdmin = createAdminClient();

  let query = supabaseAdmin
    .from("holidays")
    .select("holiday_date, name")
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate);

  query = franchiseId
    ? query.eq("franchise_id", franchiseId)
    : query.is("franchise_id", null);

  const { data, error } = await query;

  if (error) {
    console.error("fetchHolidaysInRange:", error.message);
    return {};
  }

  return buildHolidaysMap(data ?? []);
}

export async function getHolidaysForMonth(
  year: number,
  month: number,
  scope?: string | null,
): Promise<
  | { success: true; entries: HolidayDayEntry[]; warning?: string }
  | { success: false; error: string }
> {
  const supabaseAdmin = createAdminClient();
  const emptyEntries = buildMonthDayEntries(year, month);
  const franchiseId = normalizeScope(scope);

  try {
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const startStr = format(monthStart, "yyyy-MM-dd");
    const endStr = format(monthEnd, "yyyy-MM-dd");

    let holidaysQuery = supabaseAdmin
      .from("holidays")
      .select("holiday_date, name")
      .gte("holiday_date", startStr)
      .lte("holiday_date", endStr);

    holidaysQuery = franchiseId
      ? holidaysQuery.eq("franchise_id", franchiseId)
      : holidaysQuery.is("franchise_id", null);

    const { data: holidays, error } = await holidaysQuery;

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
  scope?: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const gate = await checkGroupManage("subscriptions");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient();
  const franchiseId = normalizeScope(scope);

  try {
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const startStr = format(monthStart, "yyyy-MM-dd");
    const endStr = format(monthEnd, "yyyy-MM-dd");

    let existingQuery = supabaseAdmin
      .from("holidays")
      .select("holiday_date")
      .gte("holiday_date", startStr)
      .lte("holiday_date", endStr);

    existingQuery = franchiseId
      ? existingQuery.eq("franchise_id", franchiseId)
      : existingQuery.is("franchise_id", null);

    const { data: existing, error: fetchError } = await existingQuery;

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
        franchise_id: franchiseId,
        updated_at: now,
      }));

    const toDelete = entries
      .filter((e) => e.name.trim().length === 0 && existingDates.has(e.date))
      .map((e) => e.date);

    // Scope-aware upsert: partial unique indexes (core vs franchise) make
    // onConflict targeting unreliable, so we delete the dates being written
    // within this scope, then insert fresh rows.
    if (toUpsert.length > 0) {
      const writeDates = toUpsert.map((row) => row.holiday_date);

      let clearQuery = supabaseAdmin
        .from("holidays")
        .delete()
        .in("holiday_date", writeDates);

      clearQuery = franchiseId
        ? clearQuery.eq("franchise_id", franchiseId)
        : clearQuery.is("franchise_id", null);

      const { error: clearError } = await clearQuery;
      if (clearError) {
        if (isMissingHolidaysTableError(clearError)) {
          return { success: false, error: SETUP_HINT };
        }
        return { success: false, error: clearError.message };
      }

      const { error: insertError } = await supabaseAdmin
        .from("holidays")
        .insert(toUpsert);

      if (insertError) {
        return { success: false, error: insertError.message };
      }
    }

    if (toDelete.length > 0) {
      let deleteQuery = supabaseAdmin
        .from("holidays")
        .delete()
        .in("holiday_date", toDelete);

      deleteQuery = franchiseId
        ? deleteQuery.eq("franchise_id", franchiseId)
        : deleteQuery.is("franchise_id", null);

      const { error: deleteError } = await deleteQuery;

      if (deleteError) {
        return { success: false, error: deleteError.message };
      }
    }

    const monthKey = format(monthStart, "yyyy-MM");
    await logAdminAction("UPDATE", "holiday", monthKey, {
      franchise_id: franchiseId,
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
