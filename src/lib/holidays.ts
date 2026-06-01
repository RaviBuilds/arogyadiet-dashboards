import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";

export type HolidaysByDate = Record<string, string>;

export type HolidayDayEntry = {
  date: string;
  name: string;
};

export function buildHolidaysMap(
  rows: { holiday_date: string; name: string }[],
): HolidaysByDate {
  return Object.fromEntries(
    rows.map((r) => [normalizeHolidayDateKey(r.holiday_date), r.name]),
  );
}

/** Normalize Postgres date / timestamptz strings to yyyy-MM-dd for lookup. */
export function normalizeHolidayDateKey(date: string): string {
  return date.slice(0, 10);
}

export function buildMonthDayEntries(
  year: number,
  month: number,
  holidayMap: Record<string, string> = {},
): HolidayDayEntry[] {
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  return eachDayOfInterval({ start: monthStart, end: monthEnd }).map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return { date: dateStr, name: holidayMap[dateStr] ?? "" };
  });
}

export function isMissingHolidaysTableError(error: {
  code?: string;
  message?: string;
}): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}
