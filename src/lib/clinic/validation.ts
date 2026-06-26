// src/lib/clinic/validation.ts
// Pure, side-effect-free validators for the City → Kitchen → Clinic hierarchy
// (core-clinic-architecture). These functions perform NO Supabase / network /
// IO work so they can be unit- and property-tested in isolation.
//
// They mirror the franchise domain conventions (snake_case fields, small
// discriminated result shapes) and back the master-portal Core Clinic
// Management actions and forms.
//
// Bound layering (Requirements 3 vs 14):
//   - Requirement 3 (canonical create bounds): name 1..120, address 1..255.
//   - Requirement 14 (master-portal form bounds): name 1..200, address 1..500.
// `validateClinicInput` is parameterized with explicit max lengths so each
// surface can validate against its own declared bound while the persisted
// column widths use the widest declared bound.

import type { Clinic, ClinicCreateInput } from "@/types/clinic";

/** Latitude bounds (inclusive), per Requirements 3.6 / 14.2. */
export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;

/** Longitude bounds (inclusive), per Requirements 3.6 / 14.2. */
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/** Maximum length for a city name (Requirement 1.1). */
export const CITY_NAME_MAX = 100;

/**
 * Canonical create bounds (Requirement 3.5/3.7) — the stricter domain bounds.
 */
export const CLINIC_CREATE_BOUNDS: ClinicLengthBounds = {
  nameMax: 120,
  addressMax: 255,
};

/**
 * Master-portal form bounds (Requirement 14.2) — the widest declared bounds.
 */
export const CLINIC_FORM_BOUNDS: ClinicLengthBounds = {
  nameMax: 200,
  addressMax: 500,
};

/**
 * The per-field, per-reason failures returned by {@link validateClinicInput}.
 * Every offending field is reported (Requirements 3.6, 3.7, 14.3).
 */
export type ClinicValidationError =
  | { field: "name"; reason: "empty" | "too_long" }
  | { field: "address"; reason: "empty" | "too_long" }
  | { field: "latitude"; reason: "missing" | "out_of_range" }
  | { field: "longitude"; reason: "missing" | "out_of_range" }
  | { field: "kitchen_id"; reason: "missing" };

/** Explicit max lengths supplied per surface (create vs master form). */
export interface ClinicLengthBounds {
  nameMax: number;
  addressMax: number;
}

/**
 * Loose input shape accepted by the validator. Coordinates and the kitchen
 * reference may be absent/blank before validation, hence the wider types than
 * {@link ClinicCreateInput}.
 */
export interface ClinicValidatableInput {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  kitchen_id?: string | null;
}

/**
 * Validate a clinic create/edit input against the supplied length bounds.
 *
 * Pure. Returns `[]` when the input is valid, otherwise returns one
 * {@link ClinicValidationError} per offending field. A clinic is valid iff:
 *   - name is non-empty and at most `bounds.nameMax` characters,
 *   - address is non-empty and at most `bounds.addressMax` characters,
 *   - latitude is present and within [-90, 90],
 *   - longitude is present and within [-180, 180],
 *   - kitchen_id is present.
 *
 * Validates: Requirements 3.5, 3.6, 3.7, 14.2, 14.3.
 */
export function validateClinicInput(
  input: ClinicValidatableInput,
  bounds: ClinicLengthBounds = CLINIC_CREATE_BOUNDS
): ClinicValidationError[] {
  const errors: ClinicValidationError[] = [];

  const name = (input.name ?? "").trim();
  if (name.length === 0) {
    errors.push({ field: "name", reason: "empty" });
  } else if (name.length > bounds.nameMax) {
    errors.push({ field: "name", reason: "too_long" });
  }

  const address = (input.address ?? "").trim();
  if (address.length === 0) {
    errors.push({ field: "address", reason: "empty" });
  } else if (address.length > bounds.addressMax) {
    errors.push({ field: "address", reason: "too_long" });
  }

  if (!isPresentNumber(input.latitude)) {
    errors.push({ field: "latitude", reason: "missing" });
  } else if (input.latitude < LATITUDE_MIN || input.latitude > LATITUDE_MAX) {
    errors.push({ field: "latitude", reason: "out_of_range" });
  }

  if (!isPresentNumber(input.longitude)) {
    errors.push({ field: "longitude", reason: "missing" });
  } else if (
    input.longitude < LONGITUDE_MIN ||
    input.longitude > LONGITUDE_MAX
  ) {
    errors.push({ field: "longitude", reason: "out_of_range" });
  }

  if (!input.kitchen_id || input.kitchen_id.trim().length === 0) {
    errors.push({ field: "kitchen_id", reason: "missing" });
  }

  return errors;
}

/** Result of {@link validateCityName}. */
export type CityNameValidationResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "too_long" | "duplicate" };

/**
 * Validate a candidate city name for case-insensitive uniqueness.
 *
 * Pure. The candidate is accepted iff it is non-empty, at most
 * {@link CITY_NAME_MAX} characters, and not a case-insensitive duplicate of any
 * OTHER existing name. When editing, pass the record's own current name
 * (lowercased) as `currentNameLower` so a self-rename (no change, or a
 * case-only change to itself) is allowed.
 *
 * @param name candidate city name
 * @param existingNamesLower set of all existing city names, lowercased
 * @param currentNameLower the editing record's current name, lowercased
 *        (omit when creating)
 *
 * Validates: Requirements 1.1, 1.3, 1.4.
 */
export function validateCityName(
  name: string,
  existingNamesLower: Set<string>,
  currentNameLower?: string
): CityNameValidationResult {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > CITY_NAME_MAX) {
    return { ok: false, reason: "too_long" };
  }

  const lower = trimmed.toLowerCase();

  // Editing to the record's own current name is always allowed (self-rename).
  if (currentNameLower !== undefined && lower === currentNameLower) {
    return { ok: true };
  }

  if (existingNamesLower.has(lower)) {
    return { ok: false, reason: "duplicate" };
  }

  return { ok: true };
}

/**
 * True iff `value` is a valid Indian 6-digit pincode (exactly six numeric
 * digits, no spaces or other characters).
 *
 * Validates: Requirement 5.4.
 */
export function isValidPincode(value: string): boolean {
  return /^[0-9]{6}$/.test(value);
}

/**
 * Classify a clinic as a Core Clinic.
 *
 * Pure, side-effect-free. A clinic is a Core Clinic if and only if its
 * `franchise_id` is `null` (i.e. it is not associated with any franchise).
 * The check is strict (`=== null`) so that a defined franchise id of any value
 * is never treated as Core.
 *
 * Validates: Requirements 3.4, 18.1.
 */
export function isCoreClinic(clinic: Pick<Clinic, "franchise_id">): boolean {
  return clinic.franchise_id === null;
}

/** Internal: a finite, present number (rejects null/undefined/NaN/Infinity). */
function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Re-exported for callers constructing a validated create payload.
export type { ClinicCreateInput };
