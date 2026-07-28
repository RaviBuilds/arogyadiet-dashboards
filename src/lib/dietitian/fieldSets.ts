// src/lib/dietitian/fieldSets.ts
// The single declaration of the Health_Log field table. Rendering (the log
// form), validation (`healthLogSchemaFor`), persistence (unit storage) and the
// Report_Card all read this one table, so a parameter's label, unit and range
// can never drift between the layer that shows it and the layer that checks it.
//
// Pure module: no I/O, no framework imports, deterministic exports.
//
// `MEAL_KIT_FIELD_SET` is derived from `HEALTH_LOG_FIELDS` by dropping the six
// `accommodationOnly` entries, so the 28/22 relationship of Req 11.2 is
// structural rather than a second hand-maintained list.
//
// Requirements: 11.1, 11.2, 11.6, 11.7, 11.8, 11.9, 11.10

import type { CustomerCategory } from "@/types/dietitian";

/**
 * How a parameter is captured and validated.
 *
 * - `number` — a single numeric value, stored with its `unit` when present
 * - `boolean` — a Yes/No parameter
 * - `enum` — one of `options`
 * - `text` — free text bounded by `maxLength`
 * - `bp` — the composite blood-pressure parameter (systolic + diastolic)
 */
export type FieldKind = "number" | "boolean" | "enum" | "text" | "bp";

/** One entry of the Health_Log field table. */
export interface FieldDefinition {
  /** Stable storage key used in the sparse `parameters` map, e.g. `weight`. */
  key: string;
  /** UI label, also used in the out-of-range message (Req 11.11). */
  label: string;
  kind: FieldKind;
  /** Persisted alongside the value when a value is present (Req 11.12, 11.13). */
  unit?: string;
  /** Inclusive lower bound — `number` only. */
  min?: number;
  /** Inclusive upper bound — `number` only. */
  max?: number;
  /** Allowed values — `enum` only. */
  options?: readonly string[];
  /** Maximum character count — `text` only. */
  maxLength?: number;
  /** Excluded from the MEAL/KIT set (Req 11.2). */
  accommodationOnly?: boolean;
}

/**
 * Systolic and diastolic ranges for the composite `bp` parameter (Req 11.7).
 * Kept separate because a `bp` value carries two numbers and so cannot be
 * described by the single `min`/`max` pair used by `number` fields.
 */
export const BP_RANGES = {
  systolic: { min: 60, max: 250 },
  diastolic: { min: 40, max: 150 },
} as const;

/** The allowed values of the `meal_type` enum parameter. */
export const MEAL_TYPE_OPTIONS = ["Veg", "Non-veg", "Eggetarian"] as const;

/**
 * The 28-parameter Accommodation field set, in form-render order (Req 11.1).
 *
 * Ranges for Weight, BP, Fasting Sugar, PBS, Step count, Water Intake and Sleep
 * are pinned by Req 11.6–11.10. The remaining numeric bounds and the text
 * lengths are design decisions — generous physiological sanity limits declared
 * here so no numeric field accepts unbounded or negative input.
 */
export const HEALTH_LOG_FIELDS: readonly FieldDefinition[] = [
  { key: "weight", label: "Weight", kind: "number", unit: "kg", min: 20, max: 300 },
  { key: "bp", label: "BP", kind: "bp", unit: "mmHg" },
  { key: "bp_medication_in_use", label: "BP medication in use", kind: "boolean" },
  {
    key: "fasting_sugar",
    label: "Fasting Sugar",
    kind: "number",
    unit: "mg/dL",
    min: 30,
    max: 600,
  },
  { key: "pbs", label: "PBS", kind: "number", unit: "mg/dL", min: 30, max: 600 },
  {
    key: "insulin_units",
    label: "Insulin units",
    kind: "number",
    unit: "units",
    min: 0,
    max: 1000,
  },
  {
    key: "fat_content_taken",
    label: "Fat content taken",
    kind: "number",
    unit: "ml",
    min: 0,
    max: 5000,
  },
  {
    key: "buttermilk_content",
    label: "Buttermilk content",
    kind: "number",
    unit: "litre",
    min: 0,
    max: 20,
  },
  { key: "soup", label: "Soup", kind: "number", unit: "litre", min: 0, max: 20 },
  { key: "multivitamin", label: "Multivitamin", kind: "boolean" },
  { key: "omega", label: "Omega", kind: "boolean" },
  { key: "ayurcalvita", label: "Ayurcalvita", kind: "boolean" },
  { key: "pcod", label: "PCOD", kind: "boolean" },
  {
    key: "meal_type",
    label: "Meal Type",
    kind: "enum",
    options: MEAL_TYPE_OPTIONS,
  },
  { key: "triglycerides_soup", label: "Triglycerides Soup", kind: "boolean" },
  { key: "vegetable_juice", label: "Vegetable Juice", kind: "boolean" },
  { key: "walk", label: "Walk", kind: "boolean" },
  {
    key: "step_count",
    label: "Step count",
    kind: "number",
    unit: "steps",
    min: 0,
    max: 100000,
  },
  { key: "yoga", label: "Yoga", kind: "boolean", accommodationOnly: true },
  { key: "zumba", label: "Zumba", kind: "boolean", accommodationOnly: true },
  {
    key: "water_intake",
    label: "Water Intake",
    kind: "number",
    unit: "litres",
    min: 0,
    max: 15,
  },
  { key: "sleep", label: "Sleep", kind: "number", unit: "hrs", min: 0, max: 24 },
  { key: "panchakarma", label: "Panchakarma", kind: "boolean", accommodationOnly: true },
  {
    key: "physiotherapy",
    label: "Physiotherapy",
    kind: "boolean",
    accommodationOnly: true,
  },
  {
    key: "evening_activities",
    label: "Evening Activities",
    kind: "boolean",
    accommodationOnly: true,
  },
  {
    key: "remarks_activity_description",
    label: "Remarks activity description",
    kind: "text",
    maxLength: 1000,
    accommodationOnly: true,
  },
  {
    key: "dietitian_doctor_remarks",
    label: "Dietitian/Doctor Remarks",
    kind: "text",
    maxLength: 2000,
  },
  {
    key: "any_emergency_medication",
    label: "Any Emergency Medication",
    kind: "text",
    maxLength: 1000,
  },
];

/** The Accommodation field set — all 28 parameters (Req 11.1, 11.3). */
export const ACCOMMODATION_FIELD_SET: readonly FieldDefinition[] = HEALTH_LOG_FIELDS;

/**
 * The MEAL and KIT field set — the Accommodation set minus Yoga, Zumba,
 * Panchakarma, Physiotherapy, Evening Activities and Remarks activity
 * description, yielding 22 parameters (Req 11.2, 11.4).
 */
export const MEAL_KIT_FIELD_SET: readonly FieldDefinition[] = HEALTH_LOG_FIELDS.filter(
  (field) => !field.accommodationOnly,
);

/** The field set that applies to a Customer_Category — 28 or 22 entries. */
export function fieldSetFor(category: CustomerCategory): readonly FieldDefinition[] {
  return category === "ACCOMMODATION" ? ACCOMMODATION_FIELD_SET : MEAL_KIT_FIELD_SET;
}

/** Index over the full table so `fieldByKey` stays O(1) for every caller. */
const FIELDS_BY_KEY: ReadonlyMap<string, FieldDefinition> = new Map(
  HEALTH_LOG_FIELDS.map((field) => [field.key, field]),
);

/**
 * The field definition for a storage key, or `undefined` when the key is not a
 * fixed Health_Log parameter (a Custom_Parameter label, or an unknown key read
 * from an older row).
 */
export function fieldByKey(key: string): FieldDefinition | undefined {
  return FIELDS_BY_KEY.get(key);
}
