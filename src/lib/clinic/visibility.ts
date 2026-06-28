// src/lib/clinic/visibility.ts
// Pure, side-effect-free helpers backing clinic visibility, table filters, and
// the clinic-selector-first operational views (core-clinic-architecture,
// Requirements 16 and 17). This module performs NO Supabase / React / network /
// IO work, so it can be unit- and property-tested in isolation (Properties
// 31-35). The UI layers (Rider List, Rider Activity, Customer tables, Live
// Routing Board, Live Tracking, Sandbox) call these functions over rows they
// have already loaded.
//
// Property number mapping (this spec): 34 clinicDisplayName, 35 clinic filter,
// 36/37 selector-first gating, 38 authorized selector.

/**
 * Render the display name for a Clinic association.
 *
 * Returns the clinic's name when it is present and non-empty after trimming;
 * otherwise returns `placeholder`. Used to render the "Clinic" column/field for
 * Riders and Customers, showing a placeholder (default "Unassigned") instead of
 * a blank cell when the Rider/Customer is not linked to any Clinic.
 *
 * Pure. No IO.
 *
 * Validates: Requirements 16.3, 16.7 (Property 34).
 *
 * @param clinicName the linked clinic's name, or `null`/`undefined` when unlinked
 * @param placeholder text shown when there is no linked clinic (default "Unassigned")
 */
export function clinicDisplayName(
  clinicName: string | null | undefined,
  placeholder: string = "Unassigned"
): string {
  if (clinicName != null && clinicName.trim().length > 0) {
    return clinicName;
  }
  return placeholder;
}

/**
 * Sentinel filter value meaning "All Clinics" — show every row regardless of
 * its linked Clinic (Requirement 16.6).
 */
export const ALL_CLINICS = "all" as const;

/**
 * A Clinic filter selection. `null` or {@link ALL_CLINICS} both mean
 * "All Clinics" (no filtering); any other string is a specific `clinic_id` to
 * match against.
 */
export type ClinicFilterSelection = string | null;

/**
 * Predicate deciding whether a row passes the Clinic filter control.
 *
 * Returns `true` for every row when `selection` is `null` or {@link ALL_CLINICS}
 * (the "All Clinics" / cleared state — Requirement 16.6). Otherwise returns
 * `true` only when the row's `clinic_id` strictly equals the selected clinic
 * (Requirement 16.5).
 *
 * Pure. No IO.
 *
 * Validates: Requirements 16.5, 16.6 (Property 35).
 *
 * @param row a record carrying its linked `clinic_id` (or `null` when unlinked)
 * @param selection the active Clinic filter selection
 */
export function matchesClinicFilter(
  row: { clinic_id: string | null },
  selection: ClinicFilterSelection
): boolean {
  if (selection === null || selection === ALL_CLINICS) {
    return true;
  }
  return row.clinic_id === selection;
}

/**
 * Apply {@link matchesClinicFilter} to a list of rows, preserving order.
 *
 * Returns all rows when `selection` is `null` or {@link ALL_CLINICS}; otherwise
 * returns only the rows whose `clinic_id` equals the selected clinic.
 *
 * Pure. No IO.
 *
 * Validates: Requirements 16.5, 16.6 (Property 35).
 *
 * @param rows the loaded Rider/Customer rows
 * @param selection the active Clinic filter selection
 */
export function filterRowsByClinic<T extends { clinic_id: string | null }>(
  rows: T[],
  selection: ClinicFilterSelection
): T[] {
  return rows.filter((row) => matchesClinicFilter(row, selection));
}

/**
 * Compute the Riders to display in a clinic-selector-first operational view
 * (Live Routing Board, Live Tracking, Sandbox).
 *
 * Selector-first gating: when `selection` is `null` or empty (no Clinic
 * selected yet), returns `[]` so no Rider data is shown until a Clinic is
 * chosen (Requirements 17.1, 17.3, 17.5). Once a Clinic is selected, returns
 * ONLY the Riders whose `clinic_id` equals that selection, excluding every
 * other Clinic's Riders (Requirements 17.2, 17.4, 17.6). Because the result is
 * derived solely from the current `selection`, changing the selection inherently
 * retains none of a prior selection's Riders (Requirement 17.7); an empty result
 * for a selected Clinic represents the no-Riders empty state (Requirement 17.8).
 *
 * Pure. No IO.
 *
 * Validates: Requirements 17.1-17.8 (Properties 36, 37).
 *
 * @param selection the selected `clinic_id`, or `null`/empty when none is selected
 * @param riders the loaded Riders, each carrying its linked `clinic_id`
 */
export function ridersForSelectedClinic<T extends { clinic_id: string | null }>(
  selection: string | null,
  riders: T[]
): T[] {
  if (selection === null || selection.length === 0) {
    return [];
  }
  return riders.filter((rider) => rider.clinic_id === selection);
}

/**
 * Restrict the Clinic selector to the Clinics the authenticated Admin may
 * access (Requirement 17.9).
 *
 * When `authorizedClinicIds` is the sentinel `"all"`, the user may select any
 * Clinic and `allClinics` is returned unchanged. Otherwise returns only the
 * Clinics whose `id` is in the authorized set, preserving the order of
 * `allClinics`.
 *
 * Pure. No IO.
 *
 * Validates: Requirement 17.9 (Property 38).
 *
 * @param allClinics every Clinic that exists, each carrying its `id`
 * @param authorizedClinicIds the ids the user may access, or `"all"` for unrestricted
 */
export function authorizedClinicOptions<T extends { id: string }>(
  allClinics: T[],
  authorizedClinicIds: string[] | "all"
): T[] {
  if (authorizedClinicIds === "all") {
    return allClinics;
  }
  const authorized = new Set(authorizedClinicIds);
  return allClinics.filter((clinic) => authorized.has(clinic.id));
}
