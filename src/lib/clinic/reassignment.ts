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
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";

/**
 * Reassigns every customer whose PRIMARY address (`is_primary = true`) pincode
 * equals the moved pincode AND whose matching primary address is currently
 * stamped to `fromClinicId`, moving both the customer's stamped `clinic_id` and
 * that customer's matching primary address `clinic_id` to `toClinicId`
 * (Req 7.1, 7.2). Selection is keyed on the Primary_Address only — secondary
 * addresses and customers stamped to a different clinic are left untouched.
 *
 * WAITLIST PROMOTION (multi-tenant-franchise, Req 14.7): pass `fromClinicId =
 * null` to select customers currently in Waitlist_State (`clinic_id IS NULL`)
 * whose Primary_Address pincode just became served by `toClinicId`. This reuses
 * the exact same batch-selection pattern to stamp them onto the now-serving
 * clinic and clear the waitlist.
 *
 * FRANCHISE CARRY (multi-tenant-franchise, Req 14.7): when franchise features
 * are enabled, pass the destination clinic's `toFranchiseId` so the customer's
 * (and primary address') `franchise_id` is stamped alongside `clinic_id` — the
 * customer's tenant association always follows the clinic now serving their
 * Primary_Address (NULL for a Core Clinic). When the flag is off, `toFranchiseId`
 * is ignored and the `franchise_id` column is never written, preserving Core
 * behavior exactly.
 *
 * @param params.pincode       The pincode that was moved / newly served.
 * @param params.fromClinicId  The clinic the pincode was moved away from, or
 *                             `null` to promote waitlisted (unstamped) customers.
 * @param params.toClinicId    The clinic the pincode was moved / assigned to.
 * @param params.toFranchiseId The destination clinic's franchise_id to carry
 *                             (NULL for a Core Clinic). Only written when the
 *                             franchise feature flag is on.
 * @returns The number of customers reassigned (0 when none match, Req 7.3), and
 *          an `error` string when the batch operation fails (Req 7.5).
 */
export async function reassignCustomersOnPincodeMove(params: {
  pincode: string;
  fromClinicId: string | null;
  toClinicId: string;
  toFranchiseId?: string | null;
}): Promise<{ reassigned: number; error?: string }> {
  const { pincode, fromClinicId, toClinicId, toFranchiseId } = params;

  // Nothing to do when the move is a no-op.
  if (fromClinicId === toClinicId) {
    return { reassigned: 0 };
  }

  const adminClient = createAdminClient();

  // Whether to also carry franchise_id on the re-stamp. Gated by the flag so the
  // Core path never reads or writes the franchise_id column.
  const carryFranchise = FRANCHISE_FEATURES_ENABLED;

  // 1. Find PRIMARY addresses that:
  //    - are the customer's primary address (is_primary = true)
  //    - have the moved / newly-served pincode
  //    - are currently stamped to the source clinic (or unstamped for waitlist)
  //    - belong to a customer profile
  let lookupQuery = adminClient
    .from("addresses")
    .select("customer_profile_id")
    .eq("is_primary", true)
    .eq("pincode", pincode)
    .not("customer_profile_id", "is", null);
  // Source-clinic filter: exact match for a move, or IS NULL to select
  // waitlisted (unstamped) customers being promoted (Req 14.7).
  lookupQuery =
    fromClinicId === null
      ? lookupQuery.is("clinic_id", null)
      : lookupQuery.eq("clinic_id", fromClinicId);

  const { data: matchingAddresses, error: lookupError } = await lookupQuery;

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

  // Re-stamp payloads. franchise_id is included ONLY when the flag is on, so the
  // Core write stays byte-for-byte identical to the pre-franchise behavior.
  const profileUpdate: Record<string, string | null> = { clinic_id: toClinicId };
  const addressUpdate: Record<string, string | null> = { clinic_id: toClinicId };
  if (carryFranchise) {
    profileUpdate.franchise_id = toFranchiseId ?? null;
    addressUpdate.franchise_id = toFranchiseId ?? null;
  }

  // 2. Re-stamp the affected customer profiles to the destination clinic.
  //    Scoped to the source clinic (or unstamped) so only genuinely-affected
  //    customers move.
  let profileQuery = adminClient
    .from("customer_profiles")
    .update(profileUpdate, { count: "exact" })
    .in("id", customerProfileIds);
  profileQuery =
    fromClinicId === null
      ? profileQuery.is("clinic_id", null)
      : profileQuery.eq("clinic_id", fromClinicId);

  const { error: profileError, count } = await profileQuery;

  if (profileError) {
    return { reassigned: 0, error: profileError.message };
  }

  // 3. Re-stamp the matching PRIMARY address records to the destination clinic.
  //    Scoped to primary + the moved pincode + source clinic so secondary
  //    addresses owned by the same customers are left untouched.
  let addressQuery = adminClient
    .from("addresses")
    .update(addressUpdate)
    .in("customer_profile_id", customerProfileIds)
    .eq("is_primary", true)
    .eq("pincode", pincode);
  addressQuery =
    fromClinicId === null
      ? addressQuery.is("clinic_id", null)
      : addressQuery.eq("clinic_id", fromClinicId);

  const { error: addressError } = await addressQuery;

  if (addressError) {
    return { reassigned: 0, error: addressError.message };
  }

  return { reassigned: count ?? 0 };
}
