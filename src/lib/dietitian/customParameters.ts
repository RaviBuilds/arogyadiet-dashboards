// src/lib/dietitian/customParameters.ts
// Feature: dietitian-management — Custom_Parameter validation and JSONB
// serialization. Pure module: no I/O, no clock, no Supabase.
//
// A Custom_Parameter is an operator-defined health metric captured as a
// label / value / unit triple and stored on a Health_Log without a schema
// change. This module is the single gate every write path goes through, so the
// trimming rule, the length bounds, the 20-entry cap and the case-folded
// uniqueness rule cannot drift between the form, the Zod schema and the
// service.
//
// _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6_

import type { CustomParameter } from "@/types/dietitian";
import {
  CUSTOM_PARAMETER_LABEL_REQUIRED,
  CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE,
} from "@/lib/dietitian/messages";

// ─── Bounds ──────────────────────────────────────────────────────────────────

/** A Health_Log holds at most this many Custom_Parameters (Req 12.6). */
export const MAX_CUSTOM_PARAMETERS = 20;

/** Label length bounds, applied after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_LABEL_MIN_LENGTH = 1;
export const CUSTOM_PARAMETER_LABEL_MAX_LENGTH = 60;

/** Value length bounds, applied after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_VALUE_MIN_LENGTH = 1;
export const CUSTOM_PARAMETER_VALUE_MAX_LENGTH = 200;

/** Unit length bound, applied after trimming — the empty unit is valid (Req 12.3). */
export const CUSTOM_PARAMETER_UNIT_MAX_LENGTH = 20;

// ─── Messages that are not pinned by the requirements ────────────────────────
//
// Requirements 12.4 and 12.5 pin their messages; they are imported from
// `messages.ts`. The length and cap violations of Requirements 12.3 and 12.6
// have no pinned wording, so they are declared here — still in one place, so
// the UI and the tests can reference them by name.

/** A Custom_Parameter value that is empty after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_VALUE_REQUIRED =
  "Custom parameter value is required" as const;

/** A label longer than 60 characters after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_LABEL_TOO_LONG =
  `Custom parameter label must be ${CUSTOM_PARAMETER_LABEL_MAX_LENGTH} characters or fewer` as const;

/** A value longer than 200 characters after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_VALUE_TOO_LONG =
  `Custom parameter value must be ${CUSTOM_PARAMETER_VALUE_MAX_LENGTH} characters or fewer` as const;

/** A unit longer than 20 characters after trimming (Req 12.3). */
export const CUSTOM_PARAMETER_UNIT_TOO_LONG =
  `Custom parameter unit must be ${CUSTOM_PARAMETER_UNIT_MAX_LENGTH} characters or fewer` as const;

/** More than 20 entries in one submission (Req 12.6). */
export const TOO_MANY_CUSTOM_PARAMETERS =
  `A health log can hold at most ${MAX_CUSTOM_PARAMETERS} custom parameters` as const;

/** A list, or an entry inside it, that is not shaped like a Custom_Parameter. */
export const CUSTOM_PARAMETER_LIST_MALFORMED =
  "Custom parameters are malformed" as const;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * The outcome of validating a Custom_Parameter list. On success `value` holds
 * the normalized list — every field trimmed, order preserved (Req 12.2, 12.8).
 */
export type CustomParameterValidation =
  | { ok: true; value: CustomParameter[] }
  | { ok: false; error: string };

/** The comparison key of the uniqueness rule: trimmed then case folded (Req 12.5). */
export function customParameterLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one raw entry into a trimmed `CustomParameter`, or returns `null` when
 * the entry is not shaped like one. A missing or nullish `unit` normalizes to
 * the empty string, since the unit is optional (Req 12.3).
 */
function normalizeEntry(raw: unknown): CustomParameter | null {
  if (!isRecord(raw)) return null;

  const { label, value, unit } = raw;
  if (typeof label !== "string" || typeof value !== "string") return null;
  if (unit !== undefined && unit !== null && typeof unit !== "string") return null;

  return {
    label: label.trim(),
    value: value.trim(),
    unit: typeof unit === "string" ? unit.trim() : "",
  };
}

/**
 * Validates and normalizes a submitted Custom_Parameter list.
 *
 * Accepts `null`/`undefined` as the empty list, so a submission that carries no
 * Custom_Parameters is valid. Every field is trimmed before it is measured;
 * entries are then checked in order and the first violation is returned, so the
 * caller always gets exactly one message:
 *
 * - non-array input, or an entry that is not a label/value/unit record → `CUSTOM_PARAMETER_LIST_MALFORMED`
 * - more than `MAX_CUSTOM_PARAMETERS` entries → `TOO_MANY_CUSTOM_PARAMETERS` (Req 12.6)
 * - empty label → `Custom parameter label is required` (Req 12.4)
 * - over-long label / value / unit, or empty value → the matching length message (Req 12.3)
 * - two labels equal after trimming and case folding → `Custom parameter labels must be unique` (Req 12.5)
 *
 * The 20-entry cap is checked before the per-entry rules so an oversized list
 * reports the cap rather than an incidental field problem further down.
 */
export function validateCustomParameters(raw: unknown): CustomParameterValidation {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: CUSTOM_PARAMETER_LIST_MALFORMED };

  if (raw.length > MAX_CUSTOM_PARAMETERS) {
    return { ok: false, error: TOO_MANY_CUSTOM_PARAMETERS };
  }

  const normalized: CustomParameter[] = [];
  const seenLabelKeys = new Set<string>();

  for (const entry of raw) {
    const parameter = normalizeEntry(entry);
    if (parameter === null) {
      return { ok: false, error: CUSTOM_PARAMETER_LIST_MALFORMED };
    }

    if (parameter.label.length < CUSTOM_PARAMETER_LABEL_MIN_LENGTH) {
      return { ok: false, error: CUSTOM_PARAMETER_LABEL_REQUIRED };
    }
    if (parameter.label.length > CUSTOM_PARAMETER_LABEL_MAX_LENGTH) {
      return { ok: false, error: CUSTOM_PARAMETER_LABEL_TOO_LONG };
    }
    if (parameter.value.length < CUSTOM_PARAMETER_VALUE_MIN_LENGTH) {
      return { ok: false, error: CUSTOM_PARAMETER_VALUE_REQUIRED };
    }
    if (parameter.value.length > CUSTOM_PARAMETER_VALUE_MAX_LENGTH) {
      return { ok: false, error: CUSTOM_PARAMETER_VALUE_TOO_LONG };
    }
    if (parameter.unit.length > CUSTOM_PARAMETER_UNIT_MAX_LENGTH) {
      return { ok: false, error: CUSTOM_PARAMETER_UNIT_TOO_LONG };
    }

    const key = customParameterLabelKey(parameter.label);
    if (seenLabelKeys.has(key)) {
      return { ok: false, error: CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE };
    }
    seenLabelKeys.add(key);

    normalized.push(parameter);
  }

  return { ok: true, value: normalized };
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Renders a validated list into the JSONB form persisted on a Health_Log: a
 * plain array of `{ label, value, unit }` objects in the submitted order
 * (Req 12.2, 12.8). Returns a fresh array, so the caller's list cannot be
 * mutated through the serialized value.
 */
export function serializeCustomParameters(
  list: readonly CustomParameter[],
): { label: string; value: string; unit: string }[] {
  return list.map(({ label, value, unit }) => ({ label, value, unit }));
}

/**
 * Reads the persisted JSONB form back into a `CustomParameter[]`, preserving
 * order (Req 12.7, 12.8).
 *
 * Reading is deliberately lenient — a `null` column, a non-array value or an
 * entry that is not shaped like a Custom_Parameter yields the empty list or is
 * skipped, so one malformed legacy row can never break a timeline read. Writes
 * stay strict: they go through `validateCustomParameters`.
 */
export function deserializeCustomParameters(raw: unknown): CustomParameter[] {
  const source = typeof raw === "string" ? safeParseJson(raw) : raw;
  if (!Array.isArray(source)) return [];

  const out: CustomParameter[] = [];
  for (const entry of source) {
    const parameter = normalizeEntry(entry);
    if (parameter !== null && parameter.label.length > 0) out.push(parameter);
  }
  return out;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
