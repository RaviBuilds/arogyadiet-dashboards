// src/lib/address/customerServiceability.ts
//
// Decides whether a customer's saved addresses must be validated against the
// service-area pincodes, or whether the serviceability check should be skipped.
//
// KIT customers receive their package by courier (not local daily delivery),
// so — mirroring the admin `validateAddressForCategory` KIT rule — a KIT-only
// customer can save an address with any valid 6-digit pincode regardless of
// service area. MEAL and ACCOMMODATION customers still require a deliverable
// pincode. If the customer has any MEAL/ACCOMMODATION subscription, or no
// subscriptions at all, serviceability is enforced (the safe default).

import type { SupabaseClient } from "@supabase/supabase-js";

const SERVICEABILITY_CATEGORIES = ["MEAL", "ACCOMMODATION"] as const;

/**
 * Returns true when the customer's addresses must pass the service-area
 * pincode check. Returns false only when the customer is KIT-only.
 */
export async function customerRequiresServiceablePincode(
  supabase: SupabaseClient,
  customerProfileId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("customer_category")
    .eq("customer_profile_id", customerProfileId)
    .in("status", ["ACTIVE", "PENDING"]);

  // On any read failure, or with no active/pending subscriptions, fall back to
  // enforcing serviceability so MEAL delivery is never silently weakened.
  if (error || !data || data.length === 0) return true;

  const categories = data.map((row) => row.customer_category);

  // Enforce serviceability if ANY subscription needs local delivery.
  const hasDeliveryCategory = categories.some((category) =>
    (SERVICEABILITY_CATEGORIES as readonly string[]).includes(category),
  );
  if (hasDeliveryCategory) return true;

  // At this point every active/pending subscription is KIT — bypass.
  const isKitOnly = categories.every((category) => category === "KIT");
  return !isKitOnly;
}
