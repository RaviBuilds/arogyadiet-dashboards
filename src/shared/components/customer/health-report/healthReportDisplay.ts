// src/shared/components/customer/health-report/healthReportDisplay.ts
//
// Pure display helpers for the customer Health Report — value formatting, and the
// grouping of the 28 Health_Log parameters into the sections a customer reads.
//
// Labels and units are never hardcoded here: they are read from `fieldByKey`
// (`src/lib/dietitian/fieldSets.ts`), the single declaration of the Health_Log
// field table, so a parameter reads the same on this page as it does in the
// dietitian's log form and in the exported PDF.
//
// Colour tones follow the customer dashboard's system: emerald for wellness and
// vitals, amber for nutrition, sky for activity, slate for neutral. The coral
// `--primary` is reserved for calls to action, never for data.

import { fieldByKey } from "@/lib/dietitian/fieldSets";
import type { ParameterValue } from "@/types/dietitian";

/** The parameters rendered as long-form prose rather than as a value cell. */
export const NARRATIVE_KEYS: readonly string[] = [
  "dietitian_doctor_remarks",
  "remarks_activity_description",
  "any_emergency_medication",
];

export type GroupTone = "emerald" | "amber" | "sky" | "slate";

/** One section of a day card. */
export interface ParameterGroup {
  id: string;
  title: string;
  tone: GroupTone;
  keys: readonly string[];
}

/**
 * The reading order of a day card. Every non-narrative key of the field table
 * belongs to exactly one group; anything unrecognised (an older row, a renamed
 * key) falls through to "Other measurements" so no recorded value is hidden.
 */
export const PARAMETER_GROUPS: readonly ParameterGroup[] = [
  {
    id: "vitals",
    title: "Vitals & measurements",
    tone: "emerald",
    keys: [
      "weight",
      "bp",
      "fasting_sugar",
      "pbs",
      "insulin_units",
      "bp_medication_in_use",
      "pcod",
    ],
  },
  {
    id: "nutrition",
    title: "Nutrition & supplements",
    tone: "amber",
    keys: [
      "meal_type",
      "fat_content_taken",
      "buttermilk_content",
      "soup",
      "water_intake",
      "multivitamin",
      "omega",
      "ayurcalvita",
      "triglycerides_soup",
      "vegetable_juice",
    ],
  },
  {
    id: "activity",
    title: "Activity & lifestyle",
    tone: "sky",
    keys: [
      "step_count",
      "sleep",
      "walk",
      "yoga",
      "zumba",
      "panchakarma",
      "physiotherapy",
      "evening_activities",
    ],
  },
];

const GROUPED_KEYS = new Set(PARAMETER_GROUPS.flatMap((group) => group.keys));

/** Recorded keys that belong to no declared group. */
export function ungroupedKeys(parameters: Record<string, ParameterValue>): string[] {
  return Object.keys(parameters).filter(
    (key) => !GROUPED_KEYS.has(key) && !NARRATIVE_KEYS.includes(key),
  );
}

/** The label for a storage key, falling back to the raw key. */
export function labelFor(key: string): string {
  return fieldByKey(key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Value shape
// ---------------------------------------------------------------------------

/** `true` when the value renders as a Yes/No chip rather than a measurement. */
export function isBooleanValue(value: ParameterValue): value is { value: boolean } {
  return !("systolic" in value) && typeof value.value === "boolean";
}

/**
 * Split a group's recorded keys into measurements (a number, a reading or a
 * choice — each gets its own cell) and flags (Yes/No — collapsed into a compact
 * chip row so fifteen checkboxes never outweigh a weight reading).
 */
export function partitionKeys(
  keys: readonly string[],
  parameters: Record<string, ParameterValue>,
): { measurements: string[]; flagsOn: string[]; flagsOff: string[] } {
  const measurements: string[] = [];
  const flagsOn: string[] = [];
  const flagsOff: string[] = [];

  for (const key of keys) {
    const value = parameters[key];
    if (value === undefined) continue;
    if (isBooleanValue(value)) {
      (value.value ? flagsOn : flagsOff).push(key);
    } else {
      measurements.push(key);
    }
  }

  return { measurements, flagsOn, flagsOff };
}

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

/**
 * A parameter value split into its number/text part and its unit, so the UI can
 * typeset the two differently. Mirrors `formatParameterValue` in
 * `DietitianReportTemplate.tsx` / `HealthLogTimeline.tsx`.
 */
export function splitValue(value: ParameterValue): { main: string; unit: string } {
  if ("systolic" in value) {
    return { main: `${value.systolic}/${value.diastolic}`, unit: value.unit };
  }
  if (typeof value.value === "boolean") {
    return { main: value.value ? "Yes" : "No", unit: "" };
  }
  if (typeof value.value === "number") {
    return { main: `${value.value}`, unit: value.unit ?? "" };
  }
  return { main: value.value, unit: "" };
}

/** The single-line form of a value, e.g. `120/80 mmHg`. */
export function formatValue(value: ParameterValue): string {
  const { main, unit } = splitValue(value);
  return unit ? `${main} ${unit}` : main;
}

/** The numeric reading of a parameter (systolic, for BP), or `null`. */
export function numericValue(value: ParameterValue | undefined): number | null {
  if (!value) return null;
  if ("systolic" in value) return value.systolic;
  return typeof value.value === "number" ? value.value : null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-07-27` → `27 Jul 2026`. */
export function formatDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `2026-07-27` → `Mon`. */
export function formatWeekday(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", { weekday: "short" });
}

/** An ISO 8601 submission timestamp, rendered in IST. */
export function formatSubmittedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** The first letter of a name, for the note avatar. */
export function initialOf(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "A";
}
