import { subMonths } from "date-fns";
import { getISTDateString } from "@/lib/dates/ist";

export type YearMonth = { year: number; month: number };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Three completed calendar months before the current IST month (e.g. Mar–May when current is June). */
export function getLast3PaidMonthsWindow(): YearMonth[] {
  const [y, m] = getISTDateString().split("-").map(Number);
  const anchor = new Date(y, m - 1, 1);
  return [3, 2, 1].map((monthsBack) => {
    const d = subMonths(anchor, monthsBack);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

export function yearMonthKey({ year, month }: YearMonth): string {
  return `${year}-${month}`;
}

export function formatPaidMonthsWindowLabel(window: YearMonth[]): string {
  const sorted = [...window].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  if (sorted.length === 0) return "";
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return `${MONTH_NAMES[first.month - 1]} - ${MONTH_NAMES[last.month - 1]}`;
}

export function formatRiderLeaderboardName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  if (parts.length === 1) return parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${parts[0]} ${lastInitial}.`;
}
