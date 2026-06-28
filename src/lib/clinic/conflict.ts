// src/lib/clinic/conflict.ts
// Pure, side-effect-free conflict detection for the Conflict Clinic flow
// (core-clinic-architecture, Requirement 22). This module performs NO
// Supabase / network / IO work so it can be unit- and property-tested in
// isolation.
//
// When a Customer selects a Delivery_Address for a delivery day that resolves
// to a Clinic different from (or absent for) the Clinic of their Primary_Address,
// the system raises a per-day Clinic_Conflict. The Customer always stays
// anchored to their Primary_Address clinic — detecting (or clearing) a conflict
// NEVER changes the Customer's stamped `clinic_id` (Req 22.2, 22.8). Only that
// day's order is stamped/dispatched from the delivery-address clinic
// (Req 19.2 / 22.3); the conflict is a derived, read-only flag.

/**
 * The outcome of comparing a Customer's Primary_Address clinic against the
 * clinic their selected Delivery_Address resolves to for a given delivery day.
 *
 *   - `none`       — the delivery address resolves to the same clinic as the
 *                    primary address (or there is no resolved primary clinic to
 *                    conflict against); no conflict is raised (Req 22.4).
 *   - `mismatch`   — both clinics are known (non-null) and differ; the order is
 *                    served from `deliveryClinicId` while the customer stays
 *                    anchored to `primaryClinicId` (Req 22.2).
 *   - `unresolved` — the delivery address resolves to no clinic; a
 *                    needs-attention entry. Order `clinic_id` is left null and
 *                    creation is not blocked (Req 22.5, 19.8).
 */
export type ClinicConflict =
  | { type: "none" }
  | { type: "mismatch"; primaryClinicId: string; deliveryClinicId: string }
  | { type: "unresolved"; primaryClinicId: string | null; deliveryClinicId: null };

/**
 * The read-model row surfaced in the admin Conflict_Clinic_List for a given
 * delivery day. Each entry corresponds to a Customer whose delivery-address
 * order stamp differs from (or is absent against) their Primary_Address clinic
 * (Req 22.7). The presence of an entry never implies the Customer was moved —
 * `primaryClinicId` remains the Customer's anchored clinic.
 */
export interface ConflictClinicEntry {
  customerId: string;
  customerName: string;
  primaryClinicId: string | null;
  primaryClinicName: string | null;
  /** `null` = the delivery address resolved to no clinic (needs attention). */
  deliveryClinicId: string | null;
  deliveryClinicName: string | null;
  /** ISO date (YYYY-MM-DD) of the delivery day this conflict applies to. */
  deliveryDate: string;
  reason: "mismatch" | "unresolved";
}

/**
 * Detect a Clinic_Conflict for one delivery day by comparing the Customer's
 * Primary_Address clinic against the clinic their selected Delivery_Address
 * resolves to.
 *
 * Pure. This function only classifies the comparison — it NEVER alters the
 * Customer's stamped `clinic_id` (Req 22.8). The decision tree follows the
 * design's documented semantics, in order:
 *
 *   1. `deliveryClinicId === null` → `unresolved`: the delivery address resolves
 *      to no clinic. The day's order stamp is left null and creation is not
 *      blocked; the Customer is surfaced for admin review (Req 22.5).
 *   2. both non-null and `deliveryClinicId !== primaryClinicId` → `mismatch`:
 *      the delivery address resolves to a different clinic than the primary
 *      address (Req 22.2).
 *   3. otherwise → `none`: the delivery address resolves to the same clinic as
 *      the primary address, so the conflict is omitted from the
 *      Conflict_Clinic_List (Req 22.4).
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.5, 22.8.
 *
 * @param primaryClinicId the Customer's stamped (Primary_Address) clinic, or
 *   `null` when the customer is not anchored to any clinic
 * @param deliveryClinicId the clinic the selected Delivery_Address resolves to,
 *   or `null` when the delivery address resolves to no clinic
 */
export function detectClinicConflict(
  primaryClinicId: string | null,
  deliveryClinicId: string | null
): ClinicConflict {
  // (1) The delivery address resolves to no clinic — needs-attention (Req 22.5).
  if (deliveryClinicId === null) {
    return { type: "unresolved", primaryClinicId, deliveryClinicId: null };
  }

  // (2) Both clinics are known and differ — mismatch (Req 22.2). The "both
  // non-null" guard is explicit: a conflict is only a mismatch when there is a
  // concrete Primary_Address clinic to compare against.
  if (primaryClinicId !== null && deliveryClinicId !== primaryClinicId) {
    return { type: "mismatch", primaryClinicId, deliveryClinicId };
  }

  // (3) Same clinic as the primary address (or no anchored primary clinic to
  // conflict against) — no conflict (Req 22.4).
  return { type: "none" };
}
