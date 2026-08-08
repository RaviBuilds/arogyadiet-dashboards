// src/services/AccommodationPaymentHostService.ts
//
// Shared_Payment host resolution for accommodation stays.
//
// LAYERING: business logic. Reads through the service-role admin client and
// applies the Payment_Host eligibility rules; contains no `"use server"`
// wrapper (those live in `src/actions/*`) and performs no writes.
//
// EXTRACTED from `accommodationOnboardingActions.ts`, where it was a private
// helper. Two surfaces now create a Shared_Payment stay — the Quick_Onboard
// form (a brand-new customer) and the Customer_360 Accommodation tab's Add New
// Stay dialog (a returning guest) — and a host that is eligible on one must be
// eligible on the other, so the rules live in exactly one place.
//
// Requirements: 2.3, 2.4, 2.5

import { createAdminClient } from "@/lib/supabase/admin";

/** Successful resolution: the host's `customer_profiles.id`. */
export type PaymentHostResolution =
  | { success: true; paymentHostProfileId: string }
  | { error: string; fieldErrors: Record<string, string> };

/**
 * Resolves the mobile number of an EXISTING customer from their
 * `customer_profiles.id`.
 *
 * Needed only to feed {@link validatePaymentHost}'s self-reference check: the
 * Quick_Onboard flow already has the mobile in hand from the form, but the
 * Add-New-Stay dialog for a returning guest identifies the customer by profile
 * id alone. Returns `null` when the profile or its `users` row is missing.
 */
export async function resolveCustomerMobile(
  customerProfileId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customer_profiles")
    .select("id, users!customer_profiles_user_id_fkey(mobile)")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error || !data) return null;

  const users = data.users as
    | Array<{ mobile: string | null }>
    | { mobile: string | null }
    | null;
  const user = Array.isArray(users) ? users[0] : users;

  return user?.mobile ?? null;
}

/**
 * Validates that a payment host mobile belongs to an existing accommodation
 * customer with an ACTIVE or PENDING stay, and is not the same mobile as the
 * customer whose stay is being created (self-reference check).
 *
 * Returns the payment host's `customer_profile_id` on success, or an error
 * object carrying both a summary message and a `paymentHostMobile` field error.
 *
 * Every rejection below the self-reference check deliberately reports the same
 * generic "not found or not eligible" field message: whether a given mobile
 * belongs to a customer, and what state that customer's stay is in, is not
 * information this form should disclose.
 *
 * Req 2.3, 2.4, 2.5
 */
export async function validatePaymentHost(
  paymentHostMobile: string,
  customerMobile: string,
): Promise<PaymentHostResolution> {
  // Self-reference check (Req 2.5)
  if (paymentHostMobile === customerMobile) {
    return {
      error: "A customer cannot be their own payment host.",
      fieldErrors: {
        paymentHostMobile:
          "Payment host mobile cannot be the same as the customer's mobile number.",
      },
    };
  }

  const admin = createAdminClient();

  // Look up the payment host by mobile number via the users table
  const { data: hostUser, error: userError } = await admin
    .from("users")
    .select("id, mobile, customer_profiles!customer_profiles_user_id_fkey(id)")
    .eq("mobile", paymentHostMobile)
    .maybeSingle();

  if (userError) {
    return {
      error: "Failed to validate payment host. Please try again.",
      fieldErrors: { paymentHostMobile: "Unable to verify this mobile number." },
    };
  }

  if (!hostUser) {
    return {
      error: "Payment host not found.",
      fieldErrors: {
        paymentHostMobile: "No customer found with this mobile number.",
      },
    };
  }

  // Extract the customer profile from the host user
  const profiles = hostUser.customer_profiles as
    | Array<{ id: string }>
    | { id: string }
    | null;
  const hostProfile = Array.isArray(profiles) ? profiles[0] : profiles;

  if (!hostProfile?.id) {
    return {
      error: "Payment host does not have a customer profile.",
      fieldErrors: {
        paymentHostMobile:
          "The referenced customer is not found or not eligible.",
      },
    };
  }

  const hostProfileId = hostProfile.id;

  // Check if the host has an ACTIVE or PENDING stay (Req 2.3).
  // First confirm they are an accommodation customer at all.
  const { data: hostSubscription } = await admin
    .from("subscriptions")
    .select("id, customer_category")
    .eq("customer_profile_id", hostProfileId)
    .eq("customer_category", "ACCOMMODATION")
    .maybeSingle();

  if (!hostSubscription) {
    return {
      error: "Payment host is not an accommodation customer.",
      fieldErrors: {
        paymentHostMobile:
          "The referenced customer is not found or not eligible.",
      },
    };
  }

  const { data: hostStay } = await admin
    .from("stay_entries")
    .select("id, status")
    .eq("customer_profile_id", hostProfileId)
    .in("status", ["ACTIVE", "PENDING"])
    .limit(1)
    .maybeSingle();

  if (!hostStay) {
    return {
      error: "Payment host does not have an active or pending stay.",
      fieldErrors: {
        paymentHostMobile:
          "The referenced customer is not found or not eligible.",
      },
    };
  }

  return { success: true, paymentHostProfileId: hostProfileId };
}
