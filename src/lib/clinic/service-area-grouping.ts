// src/lib/clinic/service-area-grouping.ts
//
// Pure, IO-free helper for grouping Service_Area records by their Clinic.
//
// Service Areas are displayed grouped under their associated Clinic, with each
// pincode appearing under exactly one Clinic (Requirement 5.1). Because the
// one-pincode-one-clinic invariant is enforced upstream (DB unique constraint
// `uq_service_area_pincode`), the input is assumed to have unique pincodes.
//
// Grouping a set of records by clinic must produce a partition:
//   - the union of all clinic groups equals the input set (every row preserved
//     exactly once), and
//   - the groups are pairwise disjoint (no pincode appears under two clinics).
//
// `null` clinic_id (an unassociated/orphan pincode) is a valid group key and is
// treated as its own bucket.

/** Minimal shape of a Service_Area row needed for clinic grouping. */
export interface ServiceAreaRow {
  pincode: string;
  clinic_id: string | null;
}

/**
 * Group Service_Area rows by their `clinic_id`.
 *
 * Pure and IO-free. Preserves every input row exactly once across the produced
 * groups (the concatenation of all groups is a permutation of the input), and
 * the groups are pairwise disjoint (each clinic key maps to a distinct bucket).
 *
 * Insertion order of rows within each group is preserved.
 *
 * @param rows Service_Area records (assumed to have unique pincodes upstream).
 * @returns A Map keyed by `clinic_id` (including `null`) to that clinic's rows.
 */
export function groupServiceAreasByClinic<T extends ServiceAreaRow>(
  rows: T[]
): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();

  for (const row of rows) {
    const key = row.clinic_id;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return groups;
}
