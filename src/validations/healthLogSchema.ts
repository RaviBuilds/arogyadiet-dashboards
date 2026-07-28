// src/validations/healthLogSchema.ts
// Feature: dietitian-management — the Health_Log validation schema factory.
//
// `healthLogSchemaFor(category)` is built FROM `fieldSetFor(category)`, so the
// set of accepted parameters, their kinds, units and ranges are read from the
// same table the log form renders (`src/lib/dietitian/fieldSets.ts`). Rendering
// and validation therefore cannot drift: adding a parameter to the table adds
// it to both surfaces at once.
//
// Shape notes:
// - `parameters` is a sparse record keyed by `FieldDefinition.key`. An absent
//   key means the Dietitian entered no value, and a blank submitted value is
//   normalized to an absent key — so a log in which every parameter except the
//   Closing_Comment is empty is valid (Req 11.5).
// - A numeric value is normalized to `{ value, unit }` with the unit taken from
//   the field table, so the stored unit can never disagree with the parameter
//   (Req 11.12); an absent parameter carries no unit at all (Req 11.13).
// - Out-of-range messages are generated from the field table through
//   `outOfRangeMessage`, so they always name the parameter and its permitted
//   range (Req 11.11).
// - The Custom_Parameter list is delegated to `validateCustomParameters` rather
//   than re-implemented here.
//
// _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 13.2, 13.3_

import { z } from "zod";

import {
  BP_RANGES,
  fieldSetFor,
  type FieldDefinition,
} from "@/lib/dietitian/fieldSets";
import { validateCustomParameters } from "@/lib/dietitian/customParameters";
import {
  CLOSING_COMMENT_REQUIRED,
  outOfRangeMessage,
} from "@/lib/dietitian/messages";
import type {
  CustomParameter,
  CustomerCategory,
  ParameterValue,
} from "@/types/dietitian";

// ─── Bounds and messages ─────────────────────────────────────────────────────

/** Closing_Comment length bounds, applied after trimming (Req 13.3). */
export const CLOSING_COMMENT_MIN_LENGTH = 1;
export const CLOSING_COMMENT_MAX_LENGTH = 2000;

/** A Closing_Comment longer than 2000 characters after trimming (Req 13.3). */
export const CLOSING_COMMENT_TOO_LONG =
  `A closing comment cannot exceed ${CLOSING_COMMENT_MAX_LENGTH} characters` as const;

/** `parameters` submitted as something other than a keyed record. */
export const PARAMETERS_MALFORMED = "Parameters are malformed" as const;

/** `log_date` that is not an IST calendar date in `YYYY-MM-DD` form. */
export const LOG_DATE_MALFORMED = "Log date must be in YYYY-MM-DD format" as const;

/** A missing or malformed Customer_Record reference. */
export const CUSTOMER_REQUIRED = "Select a customer" as const;

/** A `bp` value carrying only one of its two halves (Req 11.7). */
export const BP_REQUIRES_BOTH_VALUES =
  "BP requires both a systolic and a diastolic value" as const;

/** A parameter key that is not in the category's field set. */
export function unknownParameterMessage(key: string): string {
  return `${key} is not a parameter for this customer category`;
}

/** A non-numeric value submitted for a numeric parameter. */
export function mustBeNumberMessage(label: string): string {
  return `${label} must be a number`;
}

/** A non-boolean value submitted for a Yes/No parameter. */
export function mustBeYesOrNoMessage(label: string): string {
  return `${label} must be Yes or No`;
}

/** A value outside the option list of an `enum` parameter. */
export function mustBeOneOfMessage(label: string, options: readonly string[]): string {
  return `${label} must be one of ${options.join(", ")}`;
}

/** A `text` parameter longer than its declared maximum. */
export function textTooLongMessage(label: string, maxLength: number): string {
  return `${label} must be ${maxLength} characters or fewer`;
}

// ─── The validated input shape ───────────────────────────────────────────────

/** The payload a Health_Log submission carries (design section 8). */
export interface HealthLogInput {
  customerProfileId: string;
  /** IST calendar date the log applies to, `YYYY-MM-DD`. */
  logDate: string;
  /** Sparse map keyed by `FieldDefinition.key` — an absent key means no value. */
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  /** 1 to 2000 characters after trimming (Req 13.2, 13.3). */
  closingComment: string;
}

/** The category-specific Health_Log schema returned by the factory. */
export type HealthLogSchema = z.ZodType<HealthLogInput, unknown>;

// ─── Raw-value helpers ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a submitted value carries nothing: `undefined`, `null`, a
 * whitespace-only string, or a `{ value }` / `{ systolic, diastolic }` wrapper
 * whose own members are all blank. Blank values become absent keys (Req 11.5).
 */
function isBlank(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === "string") return raw.trim().length === 0;
  if (isRecord(raw)) {
    const members = ["value", "systolic", "diastolic"].filter((k) => k in raw);
    if (members.length === 0) return false;
    return members.every((k) => isBlank(raw[k]));
  }
  return false;
}

/** Unwraps `{ value: x }` to `x`, leaving any other shape untouched. */
function unwrapValue(raw: unknown): unknown {
  return isRecord(raw) && "value" in raw ? raw.value : raw;
}

/** Reads a finite number from a number or a non-blank numeric string. */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const TRUE_TOKENS = new Set(["true", "yes", "y", "1"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "0"]);

/** Reads a boolean from a boolean, a Yes/No token or 1/0. */
function toBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return null;
  }
  if (typeof raw === "string") {
    const token = raw.trim().toLowerCase();
    if (TRUE_TOKENS.has(token)) return true;
    if (FALSE_TOKENS.has(token)) return false;
  }
  return null;
}

// ─── Per-field validation ────────────────────────────────────────────────────

type IssueSink = (key: string, message: string) => void;

/**
 * Validates one non-blank raw value against its field definition and returns
 * the canonical `ParameterValue`, or `null` when an issue was reported.
 */
function readParameter(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  switch (field.kind) {
    case "number":
      return readNumber(field, raw, addIssue);
    case "bp":
      return readBloodPressure(field, raw, addIssue);
    case "boolean":
      return readBoolean(field, raw, addIssue);
    case "enum":
      return readEnum(field, raw, addIssue);
    case "text":
      return readText(field, raw, addIssue);
  }
}

function readNumber(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  const value = toFiniteNumber(unwrapValue(raw));
  if (value === null) {
    addIssue(field.key, mustBeNumberMessage(field.label));
    return null;
  }

  // Ranges come from the field table, so the message always matches the bound
  // that was actually applied (Req 11.6, 11.8, 11.9, 11.10, 11.11).
  if (
    field.min !== undefined &&
    field.max !== undefined &&
    (value < field.min || value > field.max)
  ) {
    addIssue(
      field.key,
      outOfRangeMessage({
        label: field.label,
        min: field.min,
        max: field.max,
        unit: field.unit,
      }),
    );
    return null;
  }

  return { value, unit: field.unit ?? null };
}

/**
 * The composite BP parameter: both halves are required together and each is
 * range-checked against `BP_RANGES` (Req 11.7). Accepts either
 * `{ systolic, diastolic }` or the `"120/80"` shorthand.
 */
function readBloodPressure(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  let systolicRaw: unknown;
  let diastolicRaw: unknown;

  if (isRecord(raw)) {
    systolicRaw = raw.systolic;
    diastolicRaw = raw.diastolic;
  } else if (typeof raw === "string" && raw.includes("/")) {
    const [first, second] = raw.split("/");
    systolicRaw = first;
    diastolicRaw = second;
  } else {
    addIssue(field.key, BP_REQUIRES_BOTH_VALUES);
    return null;
  }

  if (isBlank(systolicRaw) || isBlank(diastolicRaw)) {
    addIssue(field.key, BP_REQUIRES_BOTH_VALUES);
    return null;
  }

  const systolic = toFiniteNumber(systolicRaw);
  const diastolic = toFiniteNumber(diastolicRaw);
  if (systolic === null || diastolic === null) {
    addIssue(field.key, mustBeNumberMessage(field.label));
    return null;
  }

  const halves = [
    { label: `${field.label} systolic`, value: systolic, range: BP_RANGES.systolic },
    { label: `${field.label} diastolic`, value: diastolic, range: BP_RANGES.diastolic },
  ] as const;

  let outOfRange = false;
  for (const half of halves) {
    if (half.value < half.range.min || half.value > half.range.max) {
      addIssue(
        field.key,
        outOfRangeMessage({
          label: half.label,
          min: half.range.min,
          max: half.range.max,
          unit: field.unit,
        }),
      );
      outOfRange = true;
    }
  }
  if (outOfRange) return null;

  return { systolic, diastolic, unit: "mmHg" };
}

function readBoolean(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  const value = toBoolean(unwrapValue(raw));
  if (value === null) {
    addIssue(field.key, mustBeYesOrNoMessage(field.label));
    return null;
  }
  return { value };
}

function readEnum(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  const options = field.options ?? [];
  const candidate = unwrapValue(raw);
  const value = typeof candidate === "string" ? candidate.trim() : null;
  if (value === null || !options.includes(value)) {
    addIssue(field.key, mustBeOneOfMessage(field.label, options));
    return null;
  }
  return { value };
}

function readText(
  field: FieldDefinition,
  raw: unknown,
  addIssue: IssueSink,
): ParameterValue | null {
  const candidate = unwrapValue(raw);
  if (typeof candidate !== "string") {
    addIssue(field.key, textTooLongMessage(field.label, field.maxLength ?? 0));
    return null;
  }

  const value = candidate.trim();
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    addIssue(field.key, textTooLongMessage(field.label, field.maxLength));
    return null;
  }
  return { value };
}

// ─── The sparse parameter record ─────────────────────────────────────────────

/**
 * Normalizes a submitted parameter map against the category's field set.
 *
 * Blank values are dropped so an absent key always means "no value entered";
 * a key that is not in the field set is dropped when blank and rejected when it
 * carries a value, so an Accommodation-only parameter can never be smuggled
 * into a MEAL or KIT log.
 */
function readParameters(
  raw: unknown,
  fields: readonly FieldDefinition[],
  addIssue: IssueSink,
): Record<string, ParameterValue> | null {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    addIssue("", PARAMETERS_MALFORMED);
    return null;
  }

  const allowed = new Map(fields.map((field) => [field.key, field]));
  const parameters: Record<string, ParameterValue> = {};
  let failed = false;

  for (const [key, value] of Object.entries(raw)) {
    const field = allowed.get(key);
    if (field === undefined) {
      if (isBlank(value)) continue;
      addIssue(key, unknownParameterMessage(key));
      failed = true;
      continue;
    }

    if (isBlank(value)) continue; // absent key = no value (Req 11.5, 11.13)

    const parameter = readParameter(field, value, addIssue);
    if (parameter === null) {
      failed = true;
      continue;
    }
    parameters[key] = parameter;
  }

  return failed ? null : parameters;
}

// ─── The schema factory ──────────────────────────────────────────────────────

/**
 * The fixed part of the payload. `parameters` and `customParameters` are read
 * as `unknown` here and validated in the object-level transform, because their
 * rules depend on the Customer_Category's field set and on
 * `validateCustomParameters` respectively.
 */
const baseHealthLogSchema = z.object({
  customerProfileId: z.string().uuid(CUSTOMER_REQUIRED),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, LOG_DATE_MALFORMED),
  parameters: z.unknown(),
  customParameters: z.unknown(),
  // A missing or null comment is read as empty so it reports the pinned
  // "required" message rather than a type error (Req 13.2).
  closingComment: z.preprocess(
    (value) => (value === undefined || value === null ? "" : value),
    z
      .string()
      .trim()
      .min(CLOSING_COMMENT_MIN_LENGTH, CLOSING_COMMENT_REQUIRED)
      .max(CLOSING_COMMENT_MAX_LENGTH, CLOSING_COMMENT_TOO_LONG),
  ),
});

function buildHealthLogSchema(category: CustomerCategory): HealthLogSchema {
  const fields = fieldSetFor(category);

  return baseHealthLogSchema.transform((input, ctx): HealthLogInput => {
    let failed = false;

    const parameters = readParameters(input.parameters, fields, (key, message) => {
      failed = true;
      ctx.addIssue({
        code: "custom",
        message,
        path: key ? ["parameters", key] : ["parameters"],
      });
    });

    const custom = validateCustomParameters(input.customParameters);
    if (!custom.ok) {
      failed = true;
      ctx.addIssue({
        code: "custom",
        message: custom.error,
        path: ["customParameters"],
      });
    }

    if (failed || parameters === null || !custom.ok) return z.NEVER;

    return {
      customerProfileId: input.customerProfileId,
      logDate: input.logDate,
      parameters,
      customParameters: custom.value,
      closingComment: input.closingComment,
    };
  });
}

/** One schema instance per Customer_Category — the field set never changes. */
const SCHEMA_CACHE = new Map<CustomerCategory, HealthLogSchema>();

/**
 * The Health_Log schema for a Customer_Category, built from
 * `fieldSetFor(category)`: 28 parameters for `ACCOMMODATION`, 22 for `MEAL` and
 * `KIT` (Req 11.1–11.4). Every submission is accepted with all parameters empty
 * provided the Closing_Comment is present (Req 11.5, 13.2).
 */
export function healthLogSchemaFor(category: CustomerCategory): HealthLogSchema {
  const cached = SCHEMA_CACHE.get(category);
  if (cached !== undefined) return cached;

  const schema = buildHealthLogSchema(category);
  SCHEMA_CACHE.set(category, schema);
  return schema;
}
