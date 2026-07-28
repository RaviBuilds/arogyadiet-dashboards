// src/test/dietitian/arbitraries.ts
// Feature: dietitian-management — shared property-test arbitraries.
//
// Every property test for this feature draws its inputs from this module so the
// input space is described once and the edge cases called out in the design
// prework (whitespace-only strings, empty lists, null last-log dates, non-ASCII
// text, boundary values at each range endpoint, all-empty parameter maps,
// case/whitespace-variant duplicate labels) are folded into the generators
// rather than written as separate tests.
//
// The generators are deliberately *reference-side*: the field table, the cadence
// intervals and the scope shapes are re-declared here from the design document
// instead of being imported from the modules under test, so a generator can
// never inherit a bug from the implementation it is exercising. Where a test
// wants the shipped table instead (e.g. Property 15/16 over `fieldSetFor`), the
// parameter-map generators accept an explicit field list.
//
// _Requirements: 11.5, 12.5, 14.3, 17.6_

import * as fc from "fast-check";
import { addDaysToISODate } from "@/lib/dates/ist";
import {
  OPERATIONS_GROUPS,
  PERMISSION_LEVELS,
  type OperationsGroup,
  type PermissionLevel,
} from "@/lib/auth/adminAccessCore";
import type {
  CustomParameter,
  CustomerCategory,
  DietitianCustomerRow,
  ParameterValue,
} from "@/types/dietitian";

// ─── 1. IST calendar date helpers (pure) ─────────────────────────────────────
//
// Every date in this feature is a `YYYY-MM-DD` IST calendar date compared
// lexicographically, so the generators work on strings and never touch a clock.

/** Anchor the generated calendar around a fixed date for reproducibility. */
export const ANCHOR_IST_DATE = "2025-01-15";

/** Adds whole calendar days to a `YYYY-MM-DD` string. */
export function addDays(date: string, days: number): string {
  return addDaysToISODate(date, days);
}

/** Whole-day difference `to − from` between two `YYYY-MM-DD` strings. */
export function dayDiff(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * Every `YYYY-MM-DD` date from `start` to `end` inclusive; `[]` when `end` is
 * strictly before `start` (an empty Logging_Window).
 */
export function enumerateDates(start: string, end: string): string[] {
  if (end < start) return [];
  const out: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

/** An IST calendar date within roughly a year either side of the anchor. */
export const istDateArb: fc.Arbitrary<string> = fc
  .integer({ min: -400, max: 400 })
  .map((offset) => addDays(ANCHOR_IST_DATE, offset));

/** An IST calendar date at a bounded offset from `anchor`. */
export function istDateNearArb(
  anchor: string,
  minOffset = -30,
  maxOffset = 30,
): fc.Arbitrary<string> {
  return fc
    .integer({ min: minOffset, max: maxOffset })
    .map((offset) => addDays(anchor, offset));
}

// ─── 2. Customer categories, statuses and Logging_Windows ────────────────────

export const CUSTOMER_CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION"] as const;

/** Cadence_Interval per Customer_Category (design: 1 day ACC, 3 days MEAL/KIT). */
export const REFERENCE_CADENCE_INTERVALS: Record<CustomerCategory, number> = {
  ACCOMMODATION: 1,
  MEAL: 3,
  KIT: 3,
};

/**
 * Governing-subscription statuses. Anything other than `ACTIVE` must zero the
 * cadence counts, so the non-active values are generated too.
 */
export const SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "CANCELLED",
  "COMPLETED",
  "EXPIRED",
  "PENDING",
] as const;

export const customerCategoryArb: fc.Arbitrary<CustomerCategory> =
  fc.constantFrom(...CUSTOMER_CATEGORIES);

export const subscriptionStatusArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constant("ACTIVE"), weight: 4 },
  { arbitrary: fc.constantFrom(...SUBSCRIPTION_STATUSES), weight: 3 },
);

/**
 * A Logging_Window plus everything the Cadence_Engine needs. The field names
 * match `CadenceInput`, so a sample can be handed straight to `computeCadence`.
 */
export interface LoggingWindowSample {
  category: CustomerCategory;
  /** Logging_Window start (subscription `starts_on` / stay `start_date`). */
  windowStart: string;
  /** Logging_Window end before clamping to `today`. */
  windowEnd: string;
  /** The current IST calendar date, injected rather than read from a clock. */
  today: string;
  /** Paused IST dates — a subset of the window, possibly with stray dates. */
  pausedDates: string[];
  /** Most recent Dietitian_Log date, or `null` when none exists. */
  lastDietitianLogDate: string | null;
  subscriptionStatus: string;
}

export interface LoggingWindowOptions {
  categories?: readonly CustomerCategory[];
  statuses?: readonly string[];
  /** Upper bound on `windowEnd − windowStart` in days. */
  maxWindowLengthDays?: number;
}

/**
 * A paused subset of `windowDates`, biased towards the interesting cases: no
 * paused day at all, every day paused, and an arbitrary in-between subset.
 * `strayDates` (dates outside the window) are optionally mixed in, because
 * `subscription_daily_preferences` can carry paused days the window excludes.
 */
export function pausedSubsetArb(
  windowDates: readonly string[],
  strayDates: readonly string[] = [],
): fc.Arbitrary<string[]> {
  const inWindow: fc.Arbitrary<string[]> =
    windowDates.length === 0
      ? fc.constant<string[]>([])
      : fc.oneof(
          { arbitrary: fc.constant<string[]>([]), weight: 3 },
          { arbitrary: fc.constant<string[]>([...windowDates]), weight: 1 },
          {
            arbitrary: fc
              .subarray([...windowDates])
              .map((dates) => [...dates]),
            weight: 6,
          },
        );

  const strays: fc.Arbitrary<string[]> =
    strayDates.length === 0
      ? fc.constant<string[]>([])
      : fc.oneof(
          { arbitrary: fc.constant<string[]>([]), weight: 4 },
          {
            arbitrary: fc.subarray([...strayDates]).map((dates) => [...dates]),
            weight: 1,
          },
        );

  return fc
    .tuple(inWindow, strays)
    .map(([a, b]) => Array.from(new Set([...a, ...b])).sort());
}

/**
 * Last_Dietitian_Log_Date candidates: none at all (`null`, Req 14.6), the day
 * before the window start, today (Req 14.10), and any day inside the window.
 */
function lastDietitianLogDateArb(
  windowStart: string,
  today: string,
  windowDates: readonly string[],
): fc.Arbitrary<string | null> {
  return fc.oneof(
    { arbitrary: fc.constant<string | null>(null), weight: 3 },
    {
      arbitrary: fc.constant<string | null>(addDays(windowStart, -1)),
      weight: 1,
    },
    { arbitrary: fc.constant<string | null>(today), weight: 1 },
    {
      arbitrary:
        windowDates.length === 0
          ? fc.constant<string | null>(null)
          : fc.constantFrom<string | null>(...windowDates),
      weight: 4,
    },
  );
}

/**
 * A Logging_Window with a paused subset. Windows of length 0 (single day),
 * windows that have not started yet (`today` before `windowStart`) and windows
 * that ended before `today` are all in range.
 */
export function loggingWindowArb(
  options: LoggingWindowOptions = {},
): fc.Arbitrary<LoggingWindowSample> {
  const {
    categories = CUSTOMER_CATEGORIES,
    statuses = SUBSCRIPTION_STATUSES,
    maxWindowLengthDays = 45,
  } = options;

  return fc
    .record({
      category: fc.constantFrom(...categories),
      subscriptionStatus:
        statuses.length === 1
          ? fc.constant(statuses[0])
          : fc.oneof(
              { arbitrary: fc.constant("ACTIVE"), weight: 3 },
              { arbitrary: fc.constantFrom(...statuses), weight: 2 },
            ),
      windowStart: istDateArb,
      windowLength: fc.integer({ min: 0, max: maxWindowLengthDays }),
    })
    .chain((base) => {
      const windowEnd = addDays(base.windowStart, base.windowLength);
      return fc
        .integer({ min: -3, max: base.windowLength + 7 })
        .chain((todayOffset) => {
          const today = addDays(base.windowStart, todayOffset);
          const effectiveEnd = today < windowEnd ? today : windowEnd;
          const windowDates = enumerateDates(base.windowStart, effectiveEnd);
          const strays = [
            addDays(base.windowStart, -1),
            addDays(effectiveEnd, 1),
          ];
          return fc
            .record({
              pausedDates: pausedSubsetArb(windowDates, strays),
              lastDietitianLogDate: lastDietitianLogDateArb(
                base.windowStart,
                today,
                windowDates,
              ),
            })
            .map(({ pausedDates, lastDietitianLogDate }) => ({
              category: base.category,
              windowStart: base.windowStart,
              windowEnd,
              today,
              pausedDates,
              lastDietitianLogDate,
              subscriptionStatus: base.subscriptionStatus,
            }));
        });
    });
}

/** Logging_Windows whose governing subscription is always `ACTIVE`. */
export const activeLoggingWindowArb: fc.Arbitrary<LoggingWindowSample> =
  loggingWindowArb({ statuses: ["ACTIVE"] });

/** The Eligible_Days of a sample: in-window, not after `today`, not paused. */
export function eligibleDaysOf(sample: LoggingWindowSample): string[] {
  const effectiveEnd =
    sample.today < sample.windowEnd ? sample.today : sample.windowEnd;
  const paused = new Set(sample.pausedDates);
  return enumerateDates(sample.windowStart, effectiveEnd).filter(
    (date) => !paused.has(date),
  );
}

// ─── 3. Customer_Records, Dietitian scopes and list rows ─────────────────────

/** Deterministic, valid-looking UUIDs so Zod `.uuid()` schemas accept fixtures. */
export function fixtureUuid(group: number, index: number): string {
  const tail = `${group}`.padStart(4, "0") + `${index}`.padStart(8, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

export const FRANCHISE_IDS = [fixtureUuid(22, 1), fixtureUuid(22, 2)] as const;

/** Two Core_Business Clinics (`franchise_id IS NULL`) and one Clinic per Franchise. */
export const CORE_CLINIC_IDS = [
  fixtureUuid(11, 1),
  fixtureUuid(11, 2),
] as const;

export const FRANCHISE_CLINIC_IDS = [
  fixtureUuid(11, 3),
  fixtureUuid(11, 4),
] as const;

export const CLINIC_IDS = [
  ...CORE_CLINIC_IDS,
  ...FRANCHISE_CLINIC_IDS,
] as const;

/** Clinic → owning Franchise (`null` for Core_Business). */
export const CLINIC_FRANCHISE: Record<string, string | null> = {
  [CORE_CLINIC_IDS[0]]: null,
  [CORE_CLINIC_IDS[1]]: null,
  [FRANCHISE_CLINIC_IDS[0]]: FRANCHISE_IDS[0],
  [FRANCHISE_CLINIC_IDS[1]]: FRANCHISE_IDS[1],
};

export const DIETITIAN_IDS = [
  fixtureUuid(33, 1),
  fixtureUuid(33, 2),
  fixtureUuid(33, 3),
] as const;

/**
 * The shape the pure scope predicate reads (`ScopableCustomer`) — snake_case,
 * because it mirrors the `customer_profiles` columns and the RLS predicate.
 */
export interface ScopableCustomerSample {
  clinic_id: string | null;
  franchise_id: string | null;
  dietitian_id: string | null;
}

/** A full Customer_Record fixture for list, scope and search properties. */
export interface CustomerRecordSample {
  customerProfileId: string;
  customerCode: string | null;
  name: string;
  mobile: string | null;
  category: CustomerCategory;
  clinicId: string | null;
  franchiseId: string | null;
  dietitianId: string | null;
}

/** Overlapping names so search properties see both hits and misses. */
export const NAME_POOL = [
  "Anita Rao",
  "anita raut",
  "Bhavesh Kumar",
  "Chandra Mohan",
  "Divya S",
  "Joshitha N",
  "Radhika Iyer",
  "Zoya Khan",
  "श्रुति शर्मा",
  "José Álvarez",
] as const;

export const customerNameArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom(...NAME_POOL), weight: 5 },
  { arbitrary: fc.string({ minLength: 1, maxLength: 24 }), weight: 1 },
);

export const mobileArb: fc.Arbitrary<string> = fc
  .integer({ min: 6_000_000_000, max: 9_999_999_999 })
  .map((n) => String(n));

export const customerCodeArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 999 })
  .map((n) => `AD-${String(n).padStart(4, "0")}`);

/**
 * Tenant placement of a Customer_Record: Core_Business with or without a
 * Clinic, or a Franchise customer whose Clinic belongs to that Franchise.
 */
const tenantPlacementArb: fc.Arbitrary<{
  clinicId: string | null;
  franchiseId: string | null;
}> = fc.oneof(
  {
    arbitrary: fc
      .constantFrom(...CORE_CLINIC_IDS)
      .map((clinicId) => ({ clinicId, franchiseId: null })),
    weight: 4,
  },
  { arbitrary: fc.constant({ clinicId: null, franchiseId: null }), weight: 2 },
  {
    arbitrary: fc.constantFrom(...FRANCHISE_IDS).map((franchiseId) => ({
      clinicId:
        FRANCHISE_CLINIC_IDS[FRANCHISE_IDS.indexOf(franchiseId)] ?? null,
      franchiseId,
    })),
    weight: 3,
  },
  {
    // A Franchise customer whose Clinic has not been wired yet.
    arbitrary: fc
      .constantFrom(...FRANCHISE_IDS)
      .map((franchiseId) => ({ clinicId: null, franchiseId })),
    weight: 1,
  },
);

/** A Dietitian_Link that is empty as often as it is set (Req 6.2, 6.3). */
export const dietitianLinkArb: fc.Arbitrary<string | null> = fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: fc.constantFrom(...DIETITIAN_IDS), weight: 3 },
);

export const scopableCustomerArb: fc.Arbitrary<ScopableCustomerSample> = fc
  .tuple(tenantPlacementArb, dietitianLinkArb)
  .map(([placement, dietitianId]) => ({
    clinic_id: placement.clinicId,
    franchise_id: placement.franchiseId,
    dietitian_id: dietitianId,
  }));

/** Customer_Records across the three categories and every clinic/franchise/link mix. */
export const customerRecordArb: fc.Arbitrary<CustomerRecordSample> = fc
  .tuple(
    fc.integer({ min: 1, max: 9_999 }),
    customerNameArb,
    fc.option(mobileArb, { nil: null }),
    fc.option(customerCodeArb, { nil: null }),
    customerCategoryArb,
    tenantPlacementArb,
    dietitianLinkArb,
  )
  .map(
    ([
      seq,
      name,
      mobile,
      customerCode,
      category,
      placement,
      dietitianId,
    ]): CustomerRecordSample => ({
      customerProfileId: fixtureUuid(44, seq),
      customerCode,
      name,
      mobile,
      category,
      clinicId: placement.clinicId,
      franchiseId: placement.franchiseId,
      dietitianId,
    }),
  );

export function customerRecordsArb(
  options: { minLength?: number; maxLength?: number } = {},
): fc.Arbitrary<CustomerRecordSample[]> {
  const { minLength = 0, maxLength = 12 } = options;
  return fc.uniqueArray(customerRecordArb, {
    minLength,
    maxLength,
    selector: (record) => record.customerProfileId,
  });
}

/** Projects a record onto the shape the scope predicate reads. */
export function toScopable(
  record: CustomerRecordSample,
): ScopableCustomerSample {
  return {
    clinic_id: record.clinicId,
    franchise_id: record.franchiseId,
    dietitian_id: record.dietitianId,
  };
}

/** The three Dietitian scopes, including a Core Dietitian with no Clinic. */
export type DietitianScopeSample =
  | { kind: "core"; dietitianUserId: string; clinicId: string | null }
  | { kind: "franchise"; dietitianUserId: string; franchiseId: string };

export const dietitianScopeArb: fc.Arbitrary<DietitianScopeSample> = fc.oneof(
  {
    arbitrary: fc
      .tuple(fc.constantFrom(...DIETITIAN_IDS), fc.constantFrom(...CLINIC_IDS))
      .map(
        ([dietitianUserId, clinicId]): DietitianScopeSample => ({
          kind: "core",
          dietitianUserId,
          clinicId,
        }),
      ),
    weight: 3,
  },
  {
    // Core Dietitian with an empty Dietitian_Clinic_Link (Req 4.4).
    arbitrary: fc.constantFrom(...DIETITIAN_IDS).map(
      (dietitianUserId): DietitianScopeSample => ({
        kind: "core",
        dietitianUserId,
        clinicId: null,
      }),
    ),
    weight: 2,
  },
  {
    arbitrary: fc
      .tuple(fc.constantFrom(...DIETITIAN_IDS), fc.constantFrom(...FRANCHISE_IDS))
      .map(
        ([dietitianUserId, franchiseId]): DietitianScopeSample => ({
          kind: "franchise",
          dietitianUserId,
          franchiseId,
        }),
      ),
    weight: 3,
  },
);

/**
 * A Dietitian customer-list row with coherent cadence values: a `null`
 * `lastDietitianLogDate` (Req 17.6) is generated as often as a real date, and
 * `pendingLogCount` always equals `floor(daysNotLogged / cadenceInterval)`.
 */
export const dietitianCustomerRowArb: fc.Arbitrary<DietitianCustomerRow> = fc
  .tuple(
    customerRecordArb,
    fc.option(istDateArb, { nil: null }),
    fc.integer({ min: 0, max: 60 }),
    fc.integer({ min: 0, max: 30 }),
    fc.integer({ min: 0, max: 30 }),
    fc.integer({ min: 0, max: 30 }),
    fc.option(fc.constantFrom(...NAME_POOL), { nil: null }),
  )
  .map(
    ([
      record,
      lastDietitianLogDate,
      daysNotLogged,
      pausedDaysCount,
      skippedSelfLogCount,
      datesWithoutSelfLogCount,
      assignedDietitianName,
    ]): DietitianCustomerRow => ({
      customerProfileId: record.customerProfileId,
      customerCode: record.customerCode,
      name: record.name,
      mobile: record.mobile,
      category: record.category,
      assignedDietitianName,
      lastDietitianLogDate,
      daysNotLogged,
      pendingLogCount: Math.floor(
        daysNotLogged / REFERENCE_CADENCE_INTERVALS[record.category],
      ),
      pausedDaysCount,
      skippedSelfLogCount:
        record.category === "KIT" ? skippedSelfLogCount : 0,
      datesWithoutSelfLogCount:
        record.category === "KIT" ? datesWithoutSelfLogCount : 0,
    }),
  );

export function dietitianCustomerRowsArb(
  options: { minLength?: number; maxLength?: number } = {},
): fc.Arbitrary<DietitianCustomerRow[]> {
  const { minLength = 0, maxLength = 15 } = options;
  return fc.uniqueArray(dietitianCustomerRowArb, {
    minLength,
    maxLength,
    selector: (row) => row.customerProfileId,
  });
}

/** Search queries: fragments of the name pool, digit runs, empty and noise. */
export const searchQueryArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom("", " ", "ani", "Anita", "AD-", "9", "zoya"), weight: 4 },
  { arbitrary: fc.string({ maxLength: 6 }), weight: 2 },
);

// ─── 4. Health_Log parameters ────────────────────────────────────────────────

export type TestFieldKind = "number" | "boolean" | "enum" | "text" | "bp";

/** Reference field spec, declared from the design's field table. */
export interface TestFieldSpec {
  key: string;
  label: string;
  kind: TestFieldKind;
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly string[];
  maxLength?: number;
  /** Excluded from the MEAL/KIT field set (Req 11.2). */
  accommodationOnly?: boolean;
}

/**
 * The 28-parameter Accommodation field set. `MEAL`/`KIT` is this table minus the
 * six `accommodationOnly` entries, yielding 22 (Req 11.1, 11.2).
 */
export const REFERENCE_HEALTH_LOG_FIELDS: readonly TestFieldSpec[] = [
  { key: "weight", label: "Weight", kind: "number", unit: "kg", min: 20, max: 300 },
  { key: "bp", label: "BP", kind: "bp", unit: "mmHg" },
  { key: "bp_medication_in_use", label: "BP medication in use", kind: "boolean" },
  { key: "fasting_sugar", label: "Fasting Sugar", kind: "number", unit: "mg/dL", min: 30, max: 600 },
  { key: "pbs", label: "PBS", kind: "number", unit: "mg/dL", min: 30, max: 600 },
  { key: "insulin_units", label: "Insulin units", kind: "number", unit: "units", min: 0, max: 1000 },
  { key: "fat_content_taken", label: "Fat content taken", kind: "number", unit: "ml", min: 0, max: 5000 },
  { key: "buttermilk_content", label: "Buttermilk content", kind: "number", unit: "litre", min: 0, max: 20 },
  { key: "soup", label: "Soup", kind: "number", unit: "litre", min: 0, max: 20 },
  { key: "multivitamin", label: "Multivitamin", kind: "boolean" },
  { key: "omega", label: "Omega", kind: "boolean" },
  { key: "ayurcalvita", label: "Ayurcalvita", kind: "boolean" },
  { key: "pcod", label: "PCOD", kind: "boolean" },
  {
    key: "meal_type",
    label: "Meal Type",
    kind: "enum",
    options: ["Veg", "Non-veg", "Eggetarian"],
  },
  { key: "triglycerides_soup", label: "Triglycerides Soup", kind: "boolean" },
  { key: "vegetable_juice", label: "Vegetable Juice", kind: "boolean" },
  { key: "walk", label: "Walk", kind: "boolean" },
  { key: "step_count", label: "Step count", kind: "number", unit: "steps", min: 0, max: 100000 },
  { key: "yoga", label: "Yoga", kind: "boolean", accommodationOnly: true },
  { key: "zumba", label: "Zumba", kind: "boolean", accommodationOnly: true },
  { key: "water_intake", label: "Water Intake", kind: "number", unit: "litres", min: 0, max: 15 },
  { key: "sleep", label: "Sleep", kind: "number", unit: "hrs", min: 0, max: 24 },
  { key: "panchakarma", label: "Panchakarma", kind: "boolean", accommodationOnly: true },
  { key: "physiotherapy", label: "Physiotherapy", kind: "boolean", accommodationOnly: true },
  { key: "evening_activities", label: "Evening Activities", kind: "boolean", accommodationOnly: true },
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

/** Systolic and diastolic ranges for the composite BP parameter (Req 11.7). */
export const BP_RANGES = {
  systolic: { min: 60, max: 250 },
  diastolic: { min: 40, max: 150 },
} as const;

/** The reference field set for a Customer_Category (28 / 22). */
export function referenceFieldSetFor(
  category: CustomerCategory,
): readonly TestFieldSpec[] {
  return category === "ACCOMMODATION"
    ? REFERENCE_HEALTH_LOG_FIELDS
    : REFERENCE_HEALTH_LOG_FIELDS.filter((field) => !field.accommodationOnly);
}

/** A number in `[min, max]` at one-decimal resolution, biased to the endpoints. */
function boundedNumberArb(min: number, max: number): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.constantFrom(min, max), weight: 1 },
    {
      arbitrary: fc
        .integer({ min: Math.round(min * 10), max: Math.round(max * 10) })
        .map((n) => Number((n / 10).toFixed(1))),
      weight: 4,
    },
  );
}

/** An in-range `ParameterValue` for one field, with its unit (Req 11.12). */
export function parameterValueArb(
  field: TestFieldSpec,
): fc.Arbitrary<ParameterValue> {
  switch (field.kind) {
    case "number":
      return boundedNumberArb(field.min ?? 0, field.max ?? 1000).map(
        (value): ParameterValue => ({ value, unit: field.unit ?? null }),
      );
    case "boolean":
      return fc.boolean().map((value): ParameterValue => ({ value }));
    case "enum":
      return fc
        .constantFrom(...(field.options ?? ["Veg"]))
        .map((value): ParameterValue => ({ value }));
    case "text":
      return fc
        .string({ minLength: 1, maxLength: 40 })
        .map((value): ParameterValue => ({ value }));
    case "bp":
      return fc
        .tuple(
          fc.integer(BP_RANGES.systolic),
          fc.integer(BP_RANGES.diastolic),
        )
        .map(
          ([systolic, diastolic]): ParameterValue => ({
            systolic,
            diastolic,
            unit: "mmHg",
          }),
        );
  }
}

/** A value that violates the field's validated range (Req 11.11). */
export function outOfRangeParameterValueArb(
  field: TestFieldSpec,
): fc.Arbitrary<ParameterValue> {
  if (field.kind === "bp") {
    return fc
      .tuple(
        fc.constantFrom(
          BP_RANGES.systolic.min - 1,
          BP_RANGES.systolic.max + 1,
        ),
        fc.constantFrom(
          BP_RANGES.diastolic.min - 1,
          BP_RANGES.diastolic.max + 1,
        ),
      )
      .map(
        ([systolic, diastolic]): ParameterValue => ({
          systolic,
          diastolic,
          unit: "mmHg",
        }),
      );
  }
  if (field.kind !== "number") {
    // Only numeric parameters carry a validated range.
    return parameterValueArb(field);
  }
  const min = field.min ?? 0;
  const max = field.max ?? 1000;
  return fc
    .constantFrom(min - 1, max + 1, min - 1000, max + 1000)
    .map((value): ParameterValue => ({ value, unit: field.unit ?? null }));
}

export interface ParameterMapOptions {
  /** Field list to draw from; defaults to the reference set for the category. */
  fields?: readonly TestFieldSpec[];
  /** Set false to always generate at least one filled parameter. */
  allowEmpty?: boolean;
}

/**
 * A sparse parameter map — an absent key means the Dietitian entered no value,
 * so no unit is stored either (Req 11.13). The all-empty map is generated
 * explicitly because a log with only a Closing_Comment must be accepted
 * (Req 11.5).
 */
export function sparseParameterMapArb(
  category: CustomerCategory,
  options: ParameterMapOptions = {},
): fc.Arbitrary<Record<string, ParameterValue>> {
  const { fields = referenceFieldSetFor(category), allowEmpty = true } = options;
  const selection = allowEmpty
    ? fc.oneof(
        { arbitrary: fc.constant<TestFieldSpec[]>([]), weight: 1 },
        { arbitrary: fc.subarray([...fields]), weight: 5 },
      )
    : fc.subarray([...fields], { minLength: 1 });

  return selection.chain((selected) => {
    if (selected.length === 0) {
      return fc.constant<Record<string, ParameterValue>>({});
    }
    const spec: Record<string, fc.Arbitrary<ParameterValue>> = {};
    for (const field of selected) spec[field.key] = parameterValueArb(field);
    return fc.record(spec);
  });
}

/** The all-empty parameter map (Req 11.5). */
export const emptyParameterMapArb: fc.Arbitrary<
  Record<string, ParameterValue>
> = fc.constant({});

/** A sparse map in which exactly one numeric parameter is out of range. */
export function outOfRangeParameterMapArb(
  category: CustomerCategory,
  options: ParameterMapOptions = {},
): fc.Arbitrary<{
  parameters: Record<string, ParameterValue>;
  offendingField: TestFieldSpec;
}> {
  const fields = (options.fields ?? referenceFieldSetFor(category)).filter(
    (field) => field.kind === "number" || field.kind === "bp",
  );
  return fc
    .constantFrom(...fields)
    .chain((offendingField) =>
      fc
        .tuple(
          sparseParameterMapArb(category, options),
          outOfRangeParameterValueArb(offendingField),
        )
        .map(([parameters, badValue]) => ({
          parameters: { ...parameters, [offendingField.key]: badValue },
          offendingField,
        })),
    );
}

// ─── 5. Custom_Parameters ────────────────────────────────────────────────────

export const MAX_CUSTOM_PARAMETERS = 20;

/** Labels that survive trimming: 1–60 characters, ASCII and non-ASCII. */
export const customParameterLabelArb: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "HbA1c",
      "Vitamin D",
      "Thyroid TSH",
      "Waist circumference",
      "गतिविधि",
      "Créatinine",
    ),
    weight: 4,
  },
  {
    arbitrary: fc
      .string({ minLength: 1, maxLength: 60 })
      .map((s) => s.trim())
      .filter((s) => s.length >= 1 && s.length <= 60),
    weight: 2,
  },
);

export const customParameterValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 200 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1 && s.length <= 200);

/** Units are optional — the empty string is a valid unit (0–20 characters). */
export const customParameterUnitArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom("", "mg/dL", "ng/mL", "cm", "%"), weight: 4 },
  {
    arbitrary: fc
      .string({ maxLength: 20 })
      .map((s) => s.trim())
      .filter((s) => s.length <= 20),
    weight: 1,
  },
);

export const customParameterArb: fc.Arbitrary<CustomParameter> = fc.record({
  label: customParameterLabelArb,
  value: customParameterValueArb,
  unit: customParameterUnitArb,
});

/** The comparison key the uniqueness rule uses: trimmed and case-folded (Req 12.5). */
export function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * A valid Custom_Parameter list: at most 20 entries, no two labels equal after
 * trimming and case folding. The empty list is in range.
 */
export function uniqueCustomParameterListArb(
  options: { minLength?: number; maxLength?: number } = {},
): fc.Arbitrary<CustomParameter[]> {
  const { minLength = 0, maxLength = MAX_CUSTOM_PARAMETERS } = options;
  return fc.uniqueArray(customParameterArb, {
    minLength,
    maxLength,
    selector: (parameter) => labelKey(parameter.label),
  });
}

/** Case- and whitespace-variant spellings of one label — all the same key. */
export function labelVariants(label: string): string[] {
  const trimmed = label.trim();
  return Array.from(
    new Set([
      trimmed,
      trimmed.toUpperCase(),
      trimmed.toLowerCase(),
      `  ${trimmed}`,
      `${trimmed}   `,
      `\t${trimmed}\n`,
    ]),
  );
}

/**
 * A list containing two entries whose labels differ only by case and/or
 * surrounding whitespace, so the duplicate-label rule must reject it (Req 12.5).
 */
export const duplicateLabelCustomParameterListArb: fc.Arbitrary<
  CustomParameter[]
> = fc
  .tuple(
    uniqueCustomParameterListArb({ minLength: 1, maxLength: 8 }),
    customParameterValueArb,
    customParameterUnitArb,
    fc.nat(),
    fc.nat(),
  )
  .map(([base, value, unit, variantPick, insertPick]) => {
    const source = base[variantPick % base.length];
    const variants = labelVariants(source.label);
    const duplicate: CustomParameter = {
      label: variants[variantPick % variants.length],
      value,
      unit,
    };
    const out = [...base];
    out.splice(insertPick % (out.length + 1), 0, duplicate);
    return out;
  });

/** Lists that must be rejected: empty label, over-long fields, over the cap. */
export const invalidCustomParameterListArb: fc.Arbitrary<CustomParameter[]> =
  fc.oneof(
    // Whitespace-only (i.e. empty after trimming) label — Req 12.4.
    fc
      .tuple(
        uniqueCustomParameterListArb({ maxLength: 5 }),
        fc.constantFrom("", " ", "   ", "\t", "\n "),
        customParameterValueArb,
        customParameterUnitArb,
      )
      .map(([base, label, value, unit]) => [...base, { label, value, unit }]),
    // Duplicate labels — Req 12.5.
    duplicateLabelCustomParameterListArb,
    // More than 20 entries — Req 12.6.
    uniqueCustomParameterListArb({
      minLength: MAX_CUSTOM_PARAMETERS + 1,
      maxLength: MAX_CUSTOM_PARAMETERS + 5,
    }),
    // Field lengths past their bounds — Req 12.3.
    fc
      .tuple(
        fc.constantFrom(
          { label: "x".repeat(61), value: "v", unit: "" },
          { label: "over-long value", value: "v".repeat(201), unit: "" },
          { label: "over-long unit", value: "v", unit: "u".repeat(21) },
        ),
        uniqueCustomParameterListArb({ maxLength: 4 }),
      )
      .map(([bad, base]) => [...base, bad]),
  );

// ─── 6. Access configurations ────────────────────────────────────────────────

/** The four Access_Levels after this feature (Req 1.1). */
export const TEST_ACCESS_LEVELS = [
  "inventory",
  "operations",
  "inventory_operations",
  "dietitian",
] as const;

export type TestAccessLevel = (typeof TEST_ACCESS_LEVELS)[number];

/** Structurally identical to `AccessConfiguration`, widened to include `dietitian`. */
export interface AccessConfigurationSample {
  level: TestAccessLevel;
  groups: Partial<Record<OperationsGroup, PermissionLevel>>;
}

export const accessLevelArb: fc.Arbitrary<TestAccessLevel> = fc.constantFrom(
  ...TEST_ACCESS_LEVELS,
);

/** A per-group permission map, possibly empty, over the six operations groups. */
export const operationsGroupsArb: fc.Arbitrary<
  Partial<Record<OperationsGroup, PermissionLevel>>
> = fc
  .subarray([...OPERATIONS_GROUPS])
  .chain((groups) =>
    groups.length === 0
      ? fc.constant<Partial<Record<OperationsGroup, PermissionLevel>>>({})
      : fc
          .tuple(
            ...groups.map(() => fc.constantFrom(...PERMISSION_LEVELS)),
          )
          .map((permissions) =>
            Object.fromEntries(
              groups.map((group, index) => [group, permissions[index]]),
            ),
          ),
  );

/**
 * A resolved access configuration across all four levels. `groups` is populated
 * only for `operations`, which is exactly what `resolveAccessConfiguration`
 * guarantees — `dietitian` resolves to an empty group map (Req 1.5).
 */
export const accessConfigurationArb: fc.Arbitrary<AccessConfigurationSample> =
  fc
    .tuple(accessLevelArb, operationsGroupsArb)
    .map(([level, groups]) => ({
      level,
      groups: level === "operations" ? groups : {},
    }));

/**
 * Raw `users.admin_access_level` values as they arrive from the database,
 * including the unrecognised and non-string cases that must coerce to
 * `inventory_operations` (Req 1.4).
 */
export const rawAccessLevelArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.constantFrom<unknown>(...TEST_ACCESS_LEVELS), weight: 4 },
  {
    arbitrary: fc.constantFrom<unknown>(
      null,
      undefined,
      "",
      "DIETITIAN",
      "Dietitian",
      "dietician",
      "admin",
      0,
      1,
      true,
      {},
      [],
    ),
    weight: 3,
  },
  { arbitrary: fc.string(), weight: 1 },
);
