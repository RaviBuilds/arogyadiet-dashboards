// src/lib/clinic/reassignment.ts
// Customer auto-reassignment when a pincode is moved between clinics
// (core-clinic-architecture, Requirement 7).
//
// Mirrors the batch-assignment pattern established by `assignWaitlistedCustomers`
// in src/lib/franchise/assignment-resolver.ts (Req 7.4).
//
// IMPORTANT (Req 19.4): this module updates ONLY the customer clinic stamps on
// `customer_profiles` and `addresses`. It MUST NOT touch
// `delivery_orders.clinic_id` or `delivery_batches.clinic_id` — order/batch
// stamps are immutable history recorded at creation time.
//
// This is designed to run inside the move transaction (the move RPC in Task 4.2
// invokes it within the transaction context), so on failure all affected
// `clinic_id` values remain unchanged (Req 7.5). It surfaces an error string
// rather than partially applying when possible; the transactional guarantee
// itself is provided by the caller.
//
// RECONCILIATION WITH THE MOVE RPC (Task 4.2, Req 7.5): the Postgres function
// `move_pincode_and_reassign` (scripts/create-move-pincode-rpc.sql), invoked by
// `movePincode` in serviceAreaActions.ts, is the AUTHORITATIVE atomic path for
// the transactional move + reassignment — a single DB transaction is the only
// way to truly guarantee all-or-nothing semantics across the service-area move
// and the customer/address re-stamping. This JS module SUPERSEDED by the RPC
// for the live move path; it is retained as the testable, side-effect-scoped
// mirror of the same selection logic (which customers/addresses move) so the
// behavior can be unit/property-tested without a live transaction. Like the
// RPC, it writes ONLY `customer_profiles`/`addresses` and never the immutable
// `delivery_orders`/`delivery_batches` clinic stamps (Req 19.4).

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reassigns every customer whose stamped address pincode equals the moved
 * pincode AND whose matching address is currently stamped to `fromClinicId`,
 * moving both the customer's stamped `clinic_id` and the matching address's
 * `clinic_id` to `toClinicId` (Req 7.1, 7.2).
 *
 * @param params.pincode      The pincode that was moved between clinics.
 * @param params.fromClinicId The clinic the pincode was moved away from.
 * @param params.toClinicId   The clinic the pincode was moved to.
 * @returns The number of customers reassigned (0 when none match, Req 7.3), and
 *          an `error` string when the batch operation fails (Req 7.5).
 */
export async function reassignCustomersOnPincodeMove(params: {
  pincode: string;
  fromClinicId: string;
  toClinicId: string;
}): Promise<{ reassigned: number; error?: string }> {
  const { pincode, fromClinicId, toClinicId } = params;

  // Nothing to do when the move is a no-op.
  if (fromClinicId === toClinicId) {
    return { reassigned: 0 };
  }

  const adminClient = createAdminClient();

  // 1. Find addresses that:
  //    - have the moved pincode
  //    - are currently stamped to the source clinic (fromClinicId)
  //    - belong to a customer profile
  const { data: matchingAddresses, error: lookupError } = await adminClient
    .from("addresses")
    .select("customer_profile_id")
    .eq("pincode", pincode)
    .eq("clinic_id", fromClinicId)
    .not("customer_profile_id", "is", null);

  if (lookupError) {
    return { reassigned: 0, error: lookupError.message };
  }

  if (!matchingAddresses || matchingAddresses.length === 0) {
    return { reassigned: 0 };
  }

  // Unique set of affected customer profile IDs.
  const customerProfileIds = [
    ...new Set(
      matchingAddresses
        .map((a) => a.customer_profile_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (customerProfileIds.length === 0) {
    return { reassigned: 0 };
  }

  // 2. Re-stamp the affected customer profiles to the destination clinic.
  //    Scoped to the source clinic so only genuinely-affected customers move.
  const { error: profileError, count } = await adminClient
    .from("customer_profiles")
    .update({ clinic_id: toClinicId }, { count: "exact" })
    .in("id", customerProfileIds)
    .eq("clinic_id", fromClinicId);

  if (profileError) {
    return { reassigned: 0, error: profileError.message };
  }

  // 3. Re-stamp the matching address records to the destination clinic.
  //    Scoped to the moved pincode + source clinic so other addresses owned by
  //    the same customers are left untouched.
  const { error: addressError } = await adminClient
    .from("addresses")
    .update({ clinic_id: toClinicId })
    .in("customer_profile_id", customerProfileIds)
    .eq("pincode", pincode)
    .eq("clinic_id", fromClinicId);

  if (addressError) {
    return { reassigned: 0, error: addressError.message };
  }

  return { reassigned: count ?? 0 };
}
