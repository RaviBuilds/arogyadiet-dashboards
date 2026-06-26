// src/lib/clinic/rider-warnings.ts
// Pure, side-effect-free helper for the pincode-move rider-mismatch warning
// (core-clinic-architecture, Requirement 9.4). This module performs NO
// Supabase / network / IO work so it can be unit- and property-tested in
// isolation.
//
// When an Admin moves a pincode to a destination Clinic, every Rider whose
// service area maps that pincode but who is NOT linked to the destination
// Clinic is now inconsistent: the rider would serve a pincode outside their
// linked clinic boundary. For each such rider the System surfaces a warning
// that identifies the affected rider and the affected pincode and prompts the
// Admin to fix the rider's Clinic linkage and remove the rider's service-area
// association for that pincode.
//
// Fetching which riders map a pincode (and their linked clinic) is the
// caller's responsibility (Task 4.2 / the move action). This helper only
// computes the warnings from that already-fetched data, keeping it PURE.

/**
 * A rider that maps the moved pincode, as supplied by the caller. The caller
 * is responsible for fetching these rows (e.g. from `rider_service_areas`
 * joined with `rider_profiles`) before invoking {@link buildRiderClinicWarnings}.
 */
export interface PincodeRiderMapping {
  /** The affected rider's id. */
  riderId: string;
  /** Optional human-readable rider name/label for display in the warning. */
  riderName?: string;
  /**
   * The clinic the rider is currently linked to, or `null` when the rider has
   * no linked clinic. Either case is a mismatch against a non-null
   * destination clinic.
   */
  clinicId: string | null;
}

/**
 * A warning produced when a moved pincode lands on a Clinic that a Rider
 * mapping that pincode is not linked to (Requirement 9.4). Identifies the
 * affected rider and the affected pincode, and carries a prompt to fix the
 * rider's clinic linkage and remove the rider's service-area association for
 * that pincode.
 */
export interface RiderClinicWarning {
  /** The affected rider's id. */
  riderId: string;
  /** The affected rider's name/label, when known. */
  riderName?: string;
  /** The moved pincode that triggered the mismatch. */
  pincode: string;
  /** The rider's clinic at the time of the move (`null` when unlinked). */
  currentClinicId: string | null;
  /** The Clinic the pincode was moved to. */
  destinationClinicId: string;
  /** Human-readable prompt describing how the Admin should resolve the mismatch. */
  message: string;
}

/**
 * Build the rider-clinic mismatch warnings for a pincode move.
 *
 * Pure. Given the destination Clinic id, the moved pincode, and the list of
 * riders that map that pincode (each with their linked clinic id), returns one
 * {@link RiderClinicWarning} for every rider whose linked clinic differs from
 * the destination Clinic. A rider with no linked clinic (`clinicId === null`)
 * always mismatches a real destination clinic and therefore yields a warning.
 * Riders already linked to the destination Clinic produce no warning.
 *
 * The data-fetching of which riders map the pincode is the caller's
 * responsibility; this function does no IO.
 *
 * Validates: Requirement 9.4.
 *
 * @param destinationClinicId the Clinic the pincode was moved to
 * @param pincode the moved pincode
 * @param mappingRiders riders whose service area maps `pincode`
 */
export function buildRiderClinicWarnings(
  destinationClinicId: string,
  pincode: string,
  mappingRiders: readonly PincodeRiderMapping[]
): RiderClinicWarning[] {
  const warnings: RiderClinicWarning[] = [];

  for (const rider of mappingRiders) {
    if (rider.clinicId === destinationClinicId) {
      // Rider is already linked to the destination clinic — no mismatch.
      continue;
    }

    warnings.push({
      riderId: rider.riderId,
      riderName: rider.riderName,
      pincode,
      currentClinicId: rider.clinicId,
      destinationClinicId,
      message: buildWarningMessage(rider, pincode),
    });
  }

  return warnings;
}

/**
 * Compose the human-readable prompt for a single rider mismatch. Identifies
 * the affected rider and pincode and prompts the Admin to fix the rider's
 * clinic linkage and remove the rider's service-area association for that
 * pincode (Requirement 9.4).
 */
function buildWarningMessage(
  rider: PincodeRiderMapping,
  pincode: string
): string {
  const who = rider.riderName?.trim()
    ? `${rider.riderName.trim()} (${rider.riderId})`
    : `Rider ${rider.riderId}`;

  return (
    `${who} maps pincode ${pincode}, which now belongs to a clinic the rider ` +
    `is not linked to. Fix the rider's clinic linkage and remove the rider's ` +
    `service-area association for pincode ${pincode}.`
  );
}
