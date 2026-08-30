"use server";

// src/actions/admin-actions/kitLifecycleActions.ts
//
// Admin-only Server Actions for KIT lifecycle management.
// Handles: Send New KIT, eligibility checks, and expired customer listing.
//
// LAYERING: These are `'use server'` orchestration entry points. They handle
// auth/authorization, Zod re-validation, and delegate business logic to
// KitLifecycleService and kitLifecycleRepository.
//
// Requirements: 4.9, 4.10, 4.11, 4.12, 3.1–3.6, 2.1, 2.3

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isFranchiseCaller,
  authorizeFranchiseCustomerAccess,
} from "@/lib/auth/sharedCustomerActor";
import {
  assertGroupAccess,
  GroupAccessDeniedError,
} from "@/lib/auth/adminAccess";
import { sendNewKitSchema } from "@/validations/kitLifecycleSchema";
import * as KitLifecycleService from "@/services/KitLifecycleService";
import type { KitEligibility, SendNewKitInput } from "@/types/kitLifecycle";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SendNewKitActionResult =
  | { success: true; subscriptionId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

export type CheckKitEligibilityActionResult =
  | { success: true; data: KitEligibility }
  | { success: false; error: string };

export interface ExpiredKitCustomer {
  customerProfileId: string;
  customerName: string;
  mobile: string;
  mostRecentSubscriptionId: string;
  expiredAt: string;
}

export type GetExpiredKitCustomersActionResult =
  | { success: true; data: ExpiredKitCustomer[] }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// sendNewKitAction
// ---------------------------------------------------------------------------

/**
 * Create a new KIT subscription for a customer via the admin Send New KIT form.
 *
 * Orchestration:
 *   1. Authorize: caller must have view access to "customers" group.
 *   2. Zod-validate the form payload server-side.
 *   3. Delegate to KitLifecycleService.createNewKit for business logic
 *      (duplicate check, subscription + shipping creation).
 *   4. Return success with the new subscription ID or error with field details.
 *
 * Validates: Requirements 4.9, 4.10, 4.11, 4.12
 */
export async function sendNewKitAction(
  customerProfileId: string,
  formData: unknown
): Promise<SendNewKitActionResult> {
  // (1) Authorization.
  //
  // The FRANCHISE branch is additive: `assertGroupAccess` admits only
  // ADMIN / MASTER_ADMIN, so a franchise user was refused outright and the KIT
  // tabs were unusable on that portal. A franchise caller now goes through the
  // franchise `customers` gate plus a tenancy check, so they may send a KIT to
  // their OWN customers and no one else's. The core path below is unchanged.
  if (await isFranchiseCaller()) {
    const gate = await authorizeFranchiseCustomerAccess(customerProfileId, "manage");
    if (!gate.ok) return { success: false, error: gate.error };
  } else {
    try {
      await assertGroupAccess("customers");
    } catch (err) {
      if (err instanceof GroupAccessDeniedError) {
        return { success: false, error: "You do not have permission to manage customers." };
      }
      throw err;
    }
  }

  // (2) Zod re-validate server-side — never trust the client
  const parsed = sendNewKitSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Some fields are invalid or missing. Please correct them and try again.",
      fieldErrors: zodFieldErrors(parsed.error.issues),
    };
  }

  const validatedData = parsed.data;

  // (3) Build the SendNewKitInput and delegate to service
  const input: SendNewKitInput = {
    customerProfileId,
    kitProductId: validatedData.kitProductId,
    kitDurationDays: validatedData.kitDurationDays,
    mealPreference: validatedData.mealPreference,
    addressId: validatedData.addressId,
    newAddress: validatedData.newAddress,
    courierPartner: validatedData.courierPartner,
    trackingNumber: validatedData.trackingNumber,
    trackingUrl: validatedData.trackingUrl,
  };

  const result = await KitLifecycleService.createNewKit(input);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, subscriptionId: result.subscriptionId };
}

// ---------------------------------------------------------------------------
// checkKitEligibilityAction
// ---------------------------------------------------------------------------

/**
 * Check if a customer is eligible for a new KIT to be sent.
 *
 * Used by the Customer 360 Dashboard to determine "Send New KIT" button visibility.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export async function checkKitEligibilityAction(
  customerProfileId: string
): Promise<CheckKitEligibilityActionResult> {
  // Authorization. This is a READ (it only decides whether the "Send New KIT"
  // button is offered), so the franchise branch asks for read access — a
  // view-only franchise user and a Franchise Dietitian may both see the badge.
  // The core path is unchanged.
  if (await isFranchiseCaller()) {
    const gate = await authorizeFranchiseCustomerAccess(customerProfileId, "read");
    if (!gate.ok) return { success: false, error: gate.error };
  } else {
    try {
      await assertGroupAccess("customers");
    } catch (err) {
      if (err instanceof GroupAccessDeniedError) {
        return { success: false, error: "You do not have permission to view customers." };
      }
      throw err;
    }
  }

  if (!customerProfileId || customerProfileId.trim().length === 0) {
    return { success: false, error: "Customer profile ID is required." };
  }

  try {
    const eligibility = await KitLifecycleService.checkEligibility(customerProfileId);
    return { success: true, data: eligibility };
  } catch (error) {
    console.error("checkKitEligibilityAction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to check eligibility.",
    };
  }
}

// ---------------------------------------------------------------------------
// getExpiredKitCustomersAction
// ---------------------------------------------------------------------------

/**
 * Fetch KIT customers whose most recent KIT subscription has status EXPIRED.
 *
 * Used by the KIT Customer List "Show Expired" toggle to display expired
 * customers separately from active/pending ones.
 *
 * Approach: Query all KIT subscriptions grouped by customer, find those whose
 * most recent subscription (by created_at) has status EXPIRED, then join
 * customer profile data for display.
 *
 * Validates: Requirements 2.1, 2.3
 */
export async function getExpiredKitCustomersAction(): Promise<GetExpiredKitCustomersActionResult> {
  // Authorization
  try {
    await assertGroupAccess("customers");
  } catch (err) {
    if (err instanceof GroupAccessDeniedError) {
      return { success: false, error: "You do not have permission to view customers." };
    }
    throw err;
  }

  try {
    const supabase = createAdminClient();

    // Step 1: Get all KIT customer profile IDs with their most recent subscription
    // We use a query that fetches the latest subscription per customer
    const { data: kitSubscriptions, error: subsError } = await supabase
      .from("subscriptions")
      .select("id, customer_profile_id, status, created_at")
      .eq("customer_category", "KIT")
      .order("created_at", { ascending: false });

    if (subsError) {
      console.error("getExpiredKitCustomersAction subs error:", subsError);
      return { success: false, error: "Failed to fetch KIT subscriptions." };
    }

    if (!kitSubscriptions || kitSubscriptions.length === 0) {
      return { success: true, data: [] };
    }

    // Step 2: Group by customer_profile_id and find those whose MOST RECENT is EXPIRED
    const customerMostRecent = new Map<
      string,
      { subscriptionId: string; status: string; createdAt: string }
    >();

    for (const sub of kitSubscriptions) {
      // Since we ordered by created_at DESC, the first entry per customer is the most recent
      if (!customerMostRecent.has(sub.customer_profile_id)) {
        customerMostRecent.set(sub.customer_profile_id, {
          subscriptionId: sub.id,
          status: sub.status,
          createdAt: sub.created_at,
        });
      }
    }

    // Filter to only expired
    const expiredCustomerIds: string[] = [];
    const expiredSubMap = new Map<
      string,
      { subscriptionId: string; createdAt: string }
    >();

    for (const [profileId, info] of customerMostRecent) {
      if (info.status === "EXPIRED") {
        expiredCustomerIds.push(profileId);
        expiredSubMap.set(profileId, {
          subscriptionId: info.subscriptionId,
          createdAt: info.createdAt,
        });
      }
    }

    if (expiredCustomerIds.length === 0) {
      return { success: true, data: [] };
    }

    // Step 3: Fetch customer profile data for the expired customers
    const { data: profiles, error: profilesError } = await supabase
      .from("customer_profiles")
      .select("id, user_id")
      .in("id", expiredCustomerIds);

    if (profilesError) {
      console.error("getExpiredKitCustomersAction profiles error:", profilesError);
      return { success: false, error: "Failed to fetch customer profiles." };
    }

    if (!profiles || profiles.length === 0) {
      return { success: true, data: [] };
    }

    // Step 4: Fetch user details (name, mobile) for these profiles
    const userIds = profiles
      .map((p: { id: string; user_id: string }) => p.user_id)
      .filter(Boolean);
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, full_name, mobile")
      .in("id", userIds);

    if (usersError) {
      console.error("getExpiredKitCustomersAction users error:", usersError);
      return { success: false, error: "Failed to fetch user details." };
    }

    // Build user lookup map
    const userMap = new Map<string, { fullName: string; mobile: string }>();
    for (const user of users ?? []) {
      userMap.set(user.id, {
        fullName: user.full_name ?? "Unknown",
        mobile: user.mobile ?? "",
      });
    }

    // Step 5: Build the result
    const result: ExpiredKitCustomer[] = [];

    for (const profile of profiles) {
      const subInfo = expiredSubMap.get(profile.id);
      const userInfo = userMap.get(profile.user_id);

      if (subInfo && userInfo) {
        result.push({
          customerProfileId: profile.id,
          customerName: userInfo.fullName,
          mobile: userInfo.mobile,
          mostRecentSubscriptionId: subInfo.subscriptionId,
          expiredAt: subInfo.createdAt,
        });
      }
    }

    return { success: true, data: result };
  } catch (error) {
    console.error("getExpiredKitCustomersAction unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred.",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Flatten Zod issues into a `{ field → message }` map so the form can flag
 * each invalid input in place.
 */
function zodFieldErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join(".") || "_";
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}
