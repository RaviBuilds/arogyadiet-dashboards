// src/lib/dietitian/__tests__/fieldSets.test.ts
//
// Example-based unit tests for the Health_Log field table
// (`src/lib/dietitian/fieldSets.ts`).
//
// The expected table below is transcribed from the authoritative sources — the
// 28 parameters named in Requirement 11.1, the six exclusions named in
// Requirement 11.2, and the key/kind/unit rows of the design's field table —
// rather than read back from the implementation, so a drift in the shipped
// table shows up as a failure here instead of being mirrored by the test.
//
// Range metadata is asserted only for the bounds *pinned by requirements*
// (11.6–11.10); the remaining numeric bounds are design decisions and are
// covered by the property test in
// `src/test/dietitian/parameter-range.property.test.ts`.
//
// Requirements: 11.1, 11.2

import { describe, it, expect } from "vitest";

import {
  ACCOMMODATION_FIELD_SET,
  BP_RANGES,
  HEALTH_LOG_FIELDS,
  MEAL_KIT_FIELD_SET,
  MEAL_TYPE_OPTIONS,
  fieldByKey,
  fieldSetFor,
  type FieldDefinition,
  type FieldKind,
} from "@/lib/dietitian/fieldSets";
import type { CustomerCategory } from "@/types/dietitian";

/** The 28 parameters of Req 11.1, in the render order of the design table. */
const EXPECTED_TABLE: readonly {
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string;
}[] = [
  { key: "weight", label: "Weight", kind: "number", unit: "kg" },
  { key: "bp", label: "BP", kind: "bp", unit: "mmHg" },
  { key: "bp_medication_in_use", label: "BP medication in use", kind: "boolean" },
  { key: "fasting_sugar", label: "Fasting Sugar", kind: "number", unit: "mg/dL" },
  { key: "pbs", label: "PBS", kind: "number", unit: "mg/dL" },
  { key: "insulin_units", label: "Insulin units", kind: "number", unit: "units" },
  { key: "fat_content_taken", label: "Fat content taken", kind: "number", unit: "ml" },
  {
    key: "buttermilk_content",
    label: "Buttermilk content",
    kind: "number",
    unit: "litre",
  },
  { key: "soup", label: "Soup", kind: "number", unit: "litre" },
  { key: "multivitamin", label: "Multivitamin", kind: "boolean" },
  { key: "omega", label: "Omega", kind: "boolean" },
  { key: "ayurcalvita", label: "Ayurcalvita", kind: "boolean" },
  { key: "pcod", label: "PCOD", kind: "boolean" },
  { key: "meal_type", label: "Meal Type", kind: "enum" },
  { key: "triglycerides_soup", label: "Triglycerides Soup", kind: "boolean" },
  { key: "vegetable_juice", label: "Vegetable Juice", kind: "boolean" },
  { key: "walk", label: "Walk", kind: "boolean" },
  { key: "step_count", label: "Step count", kind: "number", unit: "steps" },
  { key: "yoga", label: "Yoga", kind: "boolean" },
  { key: "zumba", label: "Zumba", kind: "boolean" },
  { key: "water_intake", label: "Water Intake", kind: "number", unit: "litres" },
  { key: "sleep", label: "Sleep", kind: "number", unit: "hrs" },
  { key: "panchakarma", label: "Panchakarma", kind: "boolean" },
  { key: "physiotherapy", label: "Physiotherapy", kind: "boolean" },
  { key: "evening_activities", label: "Evening Activities", kind: "boolean" },
  {
    key: "remarks_activity_description",
    label: "Remarks activity description",
    kind: "text",
  },
  { key: "dietitian_doctor_remarks", label: "Dietitian/Doctor Remarks", kind: "text" },
  { key: "any_emergency_medication", label: "Any Emergency Medication", kind: "text" },
];

/** The six parameters Req 11.2 removes from the MEAL/KIT set. */
const EXPECTED_ACCOMMODATION_ONLY_KEYS = [
  "yoga",
  "zumba",
  "panchakarma",
  "physiotherapy",
  "evening_activities",
  "remarks_activity_description",
] as const;

/** Bounds and units pinned by Req 11.6, 11.8, 11.9, 11.10. */
const PINNED_NUMERIC_RANGES = [
  { key: "weight", unit: "kg", min: 20, max: 300 },
  { key: "fasting_sugar", unit: "mg/dL", min: 30, max: 600 },
  { key: "pbs", unit: "mg/dL", min: 30, max: 600 },
  { key: "step_count", unit: "steps", min: 0, max: 100000 },
  { key: "water_intake", unit: "litres", min: 0, max: 15 },
  { key: "sleep", unit: "hrs", min: 0, max: 24 },
] as const;

function keysOf(fields: readonly FieldDefinition[]): string[] {
  return fields.map((field) => field.key);
}

describe("HEALTH_LOG_FIELDS — the 28-parameter Accommodation table (Req 11.1)", () => {
  it("declares exactly 28 parameters", () => {
    expect(HEALTH_LOG_FIELDS).toHaveLength(28);
  });

  it("declares the keys, labels and kinds of Req 11.1 in design order", () => {
    expect(
      HEALTH_LOG_FIELDS.map((field) => ({
        key: field.key,
        label: field.label,
        kind: field.kind,
        ...(field.unit === undefined ? {} : { unit: field.unit }),
      })),
    ).toEqual(EXPECTED_TABLE);
  });

  it("uses unique storage keys", () => {
    const keys = keysOf(HEALTH_LOG_FIELDS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares units only on the numeric and BP parameters", () => {
    for (const field of HEALTH_LOG_FIELDS) {
      if (field.kind === "number" || field.kind === "bp") {
        expect(field.unit, `${field.key} should carry a unit`).toBeTruthy();
      } else {
        expect(field.unit, `${field.key} should not carry a unit`).toBeUndefined();
      }
    }
  });

  it("bounds every numeric parameter so none accepts unbounded or negative input", () => {
    for (const field of HEALTH_LOG_FIELDS.filter((f) => f.kind === "number")) {
      expect(typeof field.min, `${field.key} min`).toBe("number");
      expect(typeof field.max, `${field.key} max`).toBe("number");
      expect(field.min!).toBeGreaterThanOrEqual(0);
      expect(field.max!).toBeGreaterThan(field.min!);
    }
  });

  it("bounds every text parameter with a maxLength", () => {
    for (const field of HEALTH_LOG_FIELDS.filter((f) => f.kind === "text")) {
      expect(field.maxLength, `${field.key} maxLength`).toBeGreaterThan(0);
    }
  });

  it("exposes ACCOMMODATION_FIELD_SET as the full 28-entry table (Req 11.3)", () => {
    expect(ACCOMMODATION_FIELD_SET).toHaveLength(28);
    expect(keysOf(ACCOMMODATION_FIELD_SET)).toEqual(keysOf(HEALTH_LOG_FIELDS));
  });
});

describe("MEAL_KIT_FIELD_SET — the 22-entry derivation (Req 11.2)", () => {
  it("marks exactly the six accommodation-only parameters", () => {
    const flagged = HEALTH_LOG_FIELDS.filter((field) => field.accommodationOnly).map(
      (field) => field.key,
    );
    expect(flagged).toHaveLength(6);
    expect(new Set(flagged)).toEqual(new Set(EXPECTED_ACCOMMODATION_ONLY_KEYS));
  });

  it("yields 22 parameters", () => {
    expect(MEAL_KIT_FIELD_SET).toHaveLength(22);
  });

  it("excludes the six named parameters and keeps every other one in order", () => {
    const expectedKeys = EXPECTED_TABLE.filter(
      (row) =>
        !(EXPECTED_ACCOMMODATION_ONLY_KEYS as readonly string[]).includes(row.key),
    ).map((row) => row.key);

    expect(keysOf(MEAL_KIT_FIELD_SET)).toEqual(expectedKeys);
    for (const excluded of EXPECTED_ACCOMMODATION_ONLY_KEYS) {
      expect(keysOf(MEAL_KIT_FIELD_SET)).not.toContain(excluded);
    }
  });

  it("is derived from HEALTH_LOG_FIELDS rather than hand-maintained", () => {
    // Same object identities, so the two lists cannot drift in metadata.
    expect(MEAL_KIT_FIELD_SET).toEqual(
      HEALTH_LOG_FIELDS.filter((field) => !field.accommodationOnly),
    );
    for (const field of MEAL_KIT_FIELD_SET) {
      expect(HEALTH_LOG_FIELDS).toContain(field);
    }
  });

  it("accounts for all 28 entries across the derivation split", () => {
    expect(MEAL_KIT_FIELD_SET.length + EXPECTED_ACCOMMODATION_ONLY_KEYS.length).toBe(
      HEALTH_LOG_FIELDS.length,
    );
  });
});

describe("fieldSetFor (Req 11.3, 11.4)", () => {
  it("returns the 28-entry Accommodation set for ACCOMMODATION", () => {
    expect(fieldSetFor("ACCOMMODATION")).toBe(ACCOMMODATION_FIELD_SET);
    expect(fieldSetFor("ACCOMMODATION")).toHaveLength(28);
  });

  it.each<CustomerCategory>(["MEAL", "KIT"])(
    "returns the 22-entry MEAL/KIT set for %s",
    (category) => {
      expect(fieldSetFor(category)).toBe(MEAL_KIT_FIELD_SET);
      expect(fieldSetFor(category)).toHaveLength(22);
    },
  );

  it("returns the same set for MEAL and KIT", () => {
    expect(keysOf(fieldSetFor("MEAL"))).toEqual(keysOf(fieldSetFor("KIT")));
  });
});

describe("fieldByKey", () => {
  it("round-trips every key of the full table", () => {
    for (const field of HEALTH_LOG_FIELDS) {
      const found = fieldByKey(field.key);
      expect(found, `fieldByKey(${field.key})`).toBeDefined();
      expect(found).toEqual(field);
      expect(found!.key).toBe(field.key);
    }
  });

  it("resolves accommodation-only keys even though they are absent from MEAL/KIT", () => {
    for (const key of EXPECTED_ACCOMMODATION_ONLY_KEYS) {
      expect(fieldByKey(key)?.accommodationOnly).toBe(true);
    }
  });

  it.each(["", "custom_label", "Weight", "unknown_key"])(
    "returns undefined for the non-parameter key %o",
    (key) => {
      expect(fieldByKey(key)).toBeUndefined();
    },
  );
});

describe("range and unit metadata pinned by requirements", () => {
  it.each(PINNED_NUMERIC_RANGES)(
    "declares $key as $min–$max $unit",
    ({ key, unit, min, max }) => {
      const field = fieldByKey(key);
      expect(field?.kind).toBe("number");
      expect(field?.unit).toBe(unit);
      expect(field?.min).toBe(min);
      expect(field?.max).toBe(max);
    },
  );

  it("declares BP as a composite mmHg parameter with systolic and diastolic bounds (Req 11.7)", () => {
    const bp = fieldByKey("bp");
    expect(bp?.kind).toBe("bp");
    expect(bp?.unit).toBe("mmHg");
    // A composite value cannot be described by a single min/max pair.
    expect(bp?.min).toBeUndefined();
    expect(bp?.max).toBeUndefined();
    expect(BP_RANGES.systolic).toEqual({ min: 60, max: 250 });
    expect(BP_RANGES.diastolic).toEqual({ min: 40, max: 150 });
  });

  it("declares the Meal Type options as Veg / Non-veg / Eggetarian (Req 11.1)", () => {
    expect(MEAL_TYPE_OPTIONS).toEqual(["Veg", "Non-veg", "Eggetarian"]);
    const mealType = fieldByKey("meal_type");
    expect(mealType?.kind).toBe("enum");
    expect(mealType?.options).toEqual(MEAL_TYPE_OPTIONS);
  });

  it("keeps the pinned metadata identical in the MEAL/KIT set", () => {
    for (const { key, unit, min, max } of PINNED_NUMERIC_RANGES) {
      const field = MEAL_KIT_FIELD_SET.find((f) => f.key === key);
      expect(field, `${key} should be in the MEAL/KIT set`).toBeDefined();
      expect(field).toMatchObject({ unit, min, max });
    }
  });
});
