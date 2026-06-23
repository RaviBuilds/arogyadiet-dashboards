// src/lib/franchise/assignment-resolver.ts
// Resolves which franchise (or core) a pincode belongs to.
// Used during customer signup to assign them to the correct franchise.

import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISE_FEATURES_ENABLED } from "./constants";

export type PincodeResolution =
  | { type: "core"; franchise_id: null }
  | { type: "franchise"; franchise_id: string; franchise_name: string }
  | { type: "waitlist"; franchise_id: null };

/**
 * Resolves which entity a customer pincode belongs to.
 *
 * Logic:
 * 1. If franchise features are disabled → always returns "core"
 * 2. Check franchise_pincodes for an active franchise assignment
 * 3. Check rider_service_areas with NULL franchise_id (core operation pincodes)
 * 4. If no match found → "waitlist" (customer accepted but cannot place orders yet)
 *
 * @param pincode - 6-digit customer pincode
 */
export async function resolveCustomerFranchise(
  pincode: string
): Promise<PincodeResolution> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { type: "core", franchise_id: null };
  }

  const adminClient = createAdminClient();

  // 1. Check if pincode is assigned to an active franchise
  const { data: franchiseAssignment } = await adminClient
    .from("franchise_pincodes")
    .select("franchise_id, franchises(name, status)")
    .eq("pincode", pincode)
    .single();

  if (franchiseAssignment) {
    const franchise = franchiseAssignment.franchises as any;

    // Only resolve to franchise if it's active
    if (franchise?.status === "active") {
      return {
        type: "franchise",
        franchise_id: franchiseAssignment.franchise_id,
        franchise_name: franchise.name,
      };
    }

    // Franchise exists but not active → waitlist
    return { type: "waitlist", franchise_id: null };
  }

  // 2. Check if pincode is in core service areas
  const { data: coreArea } = await adminClient
    .from("rider_service_areas")
    .select("id")
    .eq("pincode", pincode)
    .is("franchise_id", null)
    .limit(1)
    .single();

  if (coreArea) {
    return { type: "core", franchise_id: null };
  }

  // 3. No match — customer goes to waitlist
  return { type: "waitlist", franchise_id: null };
}

/**
 * Batch assign waitlisted customers when pincodes are activated for a franchise.
 * Finds customers whose address pincode matches the newly assigned pincodes
 * and stamps them with the franchise_id.
 *
 * @param franchiseId - The franchise to assign customers to
 * @param pincodes - List of pincodes that were just assigned to this franchise
 * @returns Number of customers assigned
 */
export async function assignWaitlistedCustomers(
  franchiseId: string,
  pincodes: string[]
): Promise<{ assigned: number; error?: string }> {
  if (!FRANCHISE_FEATURES_ENABLED || pincodes.length === 0) {
    return { assigned: 0 };
  }

  const adminClient = createAdminClient();

  // Find customer_profiles that:
  // 1. Have NULL franchise_id (unassigned / waitlisted)
  // 2. Have an address with a matching pincode
  const { data: matchingAddresses } = await adminClient
    .from("addresses")
    .select("customer_profile_id")
    .in("pincode", pincodes)
    .is("franchise_id", null)
    .not("customer_profile_id", "is", null);

  if (!matchingAddresses || matchingAddresses.length === 0) {
    return { assigned: 0 };
  }

  // Get unique customer profile IDs
  const customerProfileIds = [
    ...new Set(matchingAddresses.map((a) => a.customer_profile_id).filter(Boolean)),
  ];

  // Only assign customers that are currently unassigned (NULL franchise_id)
  const { error: updateError, count } = await adminClient
    .from("customer_profiles")
    .update({ franchise_id: franchiseId }, { count: "exact" })
    .in("id", customerProfileIds)
    .is("franchise_id", null);

  if (updateError) {
    return { assigned: 0, error: updateError.message };
  }

  // Also stamp their addresses
  await adminClient
    .from("addresses")
    .update({ franchise_id: franchiseId })
    .in("customer_profile_id", customerProfileIds)
    .in("pincode", pincodes)
    .is("franchise_id", null);

  return { assigned: count ?? 0 };
}
