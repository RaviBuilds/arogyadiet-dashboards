// src/lib/dietitian/kitSelfLog.ts
// Feature: dietitian-management — the KIT Self_Log day timeline (pure).
//
// A KIT customer logs their own day from the Customer_Portal ("food taken" with
// the day's measurements, or "meal skipped"), while the Dietitian logs the same
// customer every 3rd day from the Log Customer page. This module turns the
// customer's sparse `kit_daily_logs` rows into the dense, one-entry-per-day
// timeline the Dietitian sees beside their own Log_Slots, so a day the customer
// never updated is visible as a gap rather than simply absent (Req 16.3, 25.6).
//
// The module is PURE: dates are `YYYY-MM-DD` IST strings compared
// lexicographically and `today` is injected by the caller, exactly like
// `src/lib/dietitian/cadence.ts` and `src/lib/dietitian/logSlots.ts`.

import { addDaysToISODate } from "@/lib/dates/ist";

/** One `kit_daily_logs` row in domain shape (camelCase, numbers coerced). */
export interface KitSelfLogEntry {
  logDate: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  weightKg: number | null;
  stepCount: number | null;
  activityMinutes: number | null;
  activityName: string | null;
  waterIntakeLiters: number | null;
  buttermilkIntake: string | null;
  fatConsumption: string | null;
  mainDish: string | null;
  proteinCurry: string | null;
  vegCurry: string | null;
  soupNameQty: string | null;
  eggsCount: number | null;
  saladsQty: string | null;
}

/**
 * The raw `kit_daily_logs` row shape this module maps from, declared
 * structurally so `src/lib` keeps its no-dependency-on-repositories rule.
 * `numeric` columns arrive as either a number or a string depending on the
 * client, hence the union.
 */
export interface KitSelfLogRowLike {
  log_date: string;
  status: string;
  weight_kg?: number | string | null;
  step_count?: number | string | null;
  physical_activity_minutes?: number | string | null;
  physical_activity_name?: string | null;
  water_intake_liters?: number | string | null;
  buttermilk_intake?: string | null;
  fat_consumption?: string | null;
  main_dish?: string | null;
  protein_curry?: string | null;
  veg_curry?: string | null;
  soup_name_qty?: string | null;
  eggs_count?: number | string | null;
  salads_qty?: string | null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Maps one raw `kit_daily_logs` row into the domain-shaped entry. */
export function toKitSelfLogEntry(row: KitSelfLogRowLike): KitSelfLogEntry {
  return {
    logDate: row.log_date,
    status: row.status === "FOOD_SKIPPED" ? "FOOD_SKIPPED" : "FOOD_TAKEN",
    weightKg: toNumber(row.weight_kg),
    stepCount: toNumber(row.step_count),
    activityMinutes: toNumber(row.physical_activity_minutes),
    activityName: row.physical_activity_name ?? null,
    waterIntakeLiters: toNumber(row.water_intake_liters),
    buttermilkIntake: row.buttermilk_intake ?? null,
    fatConsumption: row.fat_consumption ?? null,
    mainDish: row.main_dish ?? null,
    proteinCurry: row.protein_curry ?? null,
    vegCurry: row.veg_curry ?? null,
    soupNameQty: row.soup_name_qty ?? null,
    eggsCount: toNumber(row.eggs_count),
    saladsQty: row.salads_qty ?? null,
  };
}

/**
 * One day of the tracker window:
 * - `taken`    — the customer logged the day as `FOOD_TAKEN`.
 * - `skipped`  — the customer logged the day as `FOOD_SKIPPED`.
 * - `missing`  — the day has passed with no Self_Log at all (the gap the
 *                Dietitian needs to chase).
 * - `upcoming` — the day is still in the future, so nothing is expected yet.
 */
export type KitSelfLogDayStatus = "taken" | "skipped" | "missing" | "upcoming";

export interface KitSelfLogDay {
  /** 1-based day number inside the tracker window. */
  index: number;
  date: string;
  status: KitSelfLogDayStatus;
  /** The customer's row for this date, or `null` for `missing`/`upcoming`. */
  entry: KitSelfLogEntry | null;
}

export interface KitSelfLogSummary {
  totalDays: number;
  takenCount: number;
  skippedCount: number;
  missingCount: number;
  upcomingCount: number;
  /** Days the customer was expected to log (window start through today). */
  expectedCount: number;
}

export interface KitSelfLogTimelineInput {
  /** Tracker start — `subscriptions.kit_received_date`, or `null` if unconfirmed. */
  receivedDate: string | null;
  /** Tracker end — `subscriptions.kit_tracker_end_date`, or `null` if unconfirmed. */
  trackerEndDate: string | null;
  /** Current IST calendar date, YYYY-MM-DD. */
  today: string;
  entries: readonly KitSelfLogEntry[];
}

/** Max days rendered, guarding against a corrupt tracker end date. */
const MAX_TIMELINE_DAYS = 400;

/**
 * The dense day-by-day timeline of the KIT tracker window.
 *
 * Empty when the customer has not confirmed receipt yet (no `receivedDate`) —
 * the tracker has not started, so no day is missing. The window runs to
 * `trackerEndDate`, or to `today` when the tracker end date is not yet known
 * or already behind the recorded logs.
 */
export function buildKitSelfLogDays(
  input: KitSelfLogTimelineInput,
): KitSelfLogDay[] {
  if (!input.receivedDate) return [];

  const byDate = new Map<string, KitSelfLogEntry>();
  let latestEntryDate = input.receivedDate;
  for (const entry of input.entries) {
    byDate.set(entry.logDate, entry);
    if (entry.logDate > latestEntryDate) latestEntryDate = entry.logDate;
  }

  // Never truncate a day the customer actually logged, even if it sits past the
  // tracker end date (possible after a category/duration correction).
  let windowEnd = input.trackerEndDate ?? input.today;
  if (latestEntryDate > windowEnd) windowEnd = latestEntryDate;
  if (windowEnd < input.receivedDate) windowEnd = input.receivedDate;

  const days: KitSelfLogDay[] = [];
  let index = 0;
  for (
    let date = input.receivedDate;
    date <= windowEnd && index < MAX_TIMELINE_DAYS;
    date = addDaysToISODate(date, 1)
  ) {
    index += 1;
    const entry = byDate.get(date) ?? null;
    const status: KitSelfLogDayStatus = entry
      ? entry.status === "FOOD_TAKEN"
        ? "taken"
        : "skipped"
      : date <= input.today
        ? "missing"
        : "upcoming";

    days.push({ index, date, status, entry });
  }

  return days;
}

/** Counts per status, plus how many days the customer was expected to log. */
export function summarizeKitSelfLogDays(
  days: readonly KitSelfLogDay[],
): KitSelfLogSummary {
  let takenCount = 0;
  let skippedCount = 0;
  let missingCount = 0;
  let upcomingCount = 0;

  for (const day of days) {
    if (day.status === "taken") takenCount += 1;
    else if (day.status === "skipped") skippedCount += 1;
    else if (day.status === "missing") missingCount += 1;
    else upcomingCount += 1;
  }

  return {
    totalDays: days.length,
    takenCount,
    skippedCount,
    missingCount,
    upcomingCount,
    expectedCount: takenCount + skippedCount + missingCount,
  };
}

/** The measurement fields the customer fills in on a "food taken" day. */
export const KIT_SELF_LOG_FIELDS: ReadonlyArray<{
  label: string;
  value: (entry: KitSelfLogEntry) => string | number | null;
}> = [
  { label: "Weight", value: (e) => (e.weightKg != null ? `${e.weightKg} kg` : null) },
  {
    label: "Activity",
    value: (e) =>
      e.activityMinutes != null
        ? `${e.activityMinutes} min${e.activityName ? ` — ${e.activityName}` : ""}`
        : e.activityName,
  },
  { label: "Steps", value: (e) => e.stepCount },
  {
    label: "Water",
    value: (e) => (e.waterIntakeLiters != null ? `${e.waterIntakeLiters} L` : null),
  },
  { label: "Buttermilk", value: (e) => e.buttermilkIntake },
  { label: "Fat consumption", value: (e) => e.fatConsumption },
  { label: "Main dish", value: (e) => e.mainDish },
  { label: "Protein curry", value: (e) => e.proteinCurry },
  { label: "Veg curry", value: (e) => e.vegCurry },
  { label: "Soup & qty", value: (e) => e.soupNameQty },
  { label: "Eggs", value: (e) => e.eggsCount },
  { label: "Salads qty", value: (e) => e.saladsQty },
];

/** Only the fields the customer actually filled in for one day. */
export function filledKitSelfLogFields(
  entry: KitSelfLogEntry,
): Array<{ label: string; value: string }> {
  return KIT_SELF_LOG_FIELDS.map((field) => ({
    label: field.label,
    value: field.value(entry),
  }))
    .filter(
      (field) =>
        field.value !== null &&
        field.value !== undefined &&
        String(field.value).trim() !== "",
    )
    .map((field) => ({ label: field.label, value: String(field.value) }));
}
