// src/lib/clinic/pincode-resolver.ts
// Resolves which clinic a pincode belongs to, based on rider_service_areas.
// Used during customer signup / address update to stamp customers with the
// correct clinic_id (core-clinic-architecture, Requirement 6).
//
// Mirrors the conventions of src/lib/franchise/assignment-resolver.ts: a pure
// discriminated-union result, an async resolver backed by createAdminClient
// (service role, bypasses RLS — this runs in signup/address background flows).

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Outcome of resolving a pincode to a clinic.
 *
 * - `resolved`  — exactly one clinic owns the pincode.
 * - `none`      — no service-area row, or the matching row has no clinic_id.
 * - `ambiguous` — more than one distinct clinic_id maps to the pincode. This is
 *                 defensive only: the DB unique constraint `uq_service_area_pincode`
 *                 makes it effectively unreachable, but the resolver models it so
 *                 callers can leave the customer's clinic unchanged (Req 6.6).
 */
export type ClinicResolution =
  | { type: "resolved"; clinic_id: string }
  | { type: "none"; clinic_id: null }
  | { type: "ambiguous"; clinic_id: null };

/**
 * Resolves the clinic that owns the given pincode.
 *
 * Logic:
 * 1. Look up every `rider_service_areas` row for the pincode.
 * 2. Collect the distinct non-null `clinic_id` values.
 *    - exactly one  → `resolved`
 *    - zero         → `none` (no row, or no clinic_id on the row)
 *    - more than one → `ambiguous` (defensive; unreachable under the unique
 *                      pincode constraint)
 *
 * @param pincode - the 6-digit pincode to resolve
 */
export async function resolveClinicForPincode(
  pincode: string
): Promise<ClinicResolution> {
  const adminClient = createAdminClient();

  const { data: serviceAreas } = await adminClient
    .from("rider_service_areas")
    .select("clinic_id")
    .eq("pincode", pincode);

  if (!serviceAreas || serviceAreas.length === 0) {
    return { type: "none", clinic_id: null };
  }

  // Distinct, non-null clinic ids associated with this pincode.
  const distinctClinicIds = [
    ...new Set(
      serviceAreas
        .map((area) => area.clinic_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (distinctClinicIds.length === 0) {
    // Row(s) exist but none carries a clinic_id.
    return { type: "none", clinic_id: null };
  }

  if (distinctClinicIds.length === 1) {
    return { type: "resolved", clinic_id: distinctClinicIds[0] };
  }

  // Defensive: unique pincode constraint should prevent this.
  return { type: "ambiguous", clinic_id: null };
}
