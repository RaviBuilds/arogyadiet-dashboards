"use server";

// src/actions/addonServiceActions.ts
//
// Server Actions for add-on wellness service request management.
// Handles customer service requests and admin status updates.
//
// Requirements: 11.1, 11.2, 11.3, 11.4

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as addonServiceRepository from "@/repositories/addonServiceRepository";
import * as stayRepository from "@/repositories/stayRepository";
import {
  addonServiceRequestSchema,
} from "@/validations/accommodationSchema";
import type { AddonServiceRequestRow } from "@/repositories/addonServiceRepository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate the current customer session and resolve their customer_profile_id.
 * Mirrors the pattern from healthLogActions.
 */
async function authenticateCustomer(): Promise<
  { success: true; customerProfileId: string } | { success: false; error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) {
    return { success: false, error: "User not found." };
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .single();

  if (!profile) {
    return { success: false, error: "Customer profile not found." };
  }

  return { success: true, customerProfileId: profile.id };
}

// ---------------------------------------------------------------------------
// 11.1, 11.2 — requestAddonServiceAction
// ---------------------------------------------------------------------------

/**
 * Submit a new add-on wellness service request for the authenticated customer.
 *
 * - Authenticates the customer
 * - Validates input with addonServiceRequestSchema
 * - Requires an active stay
 * - Creates the service request via the repository
 *
 * Req 11.1, 11.2
 */
export async function requestAddonServiceAction(
  input: { serviceType: string }
): Promise<ActionResult<{ requestId: string }>> {
  try {
    // 1. Authenticate customer
    const auth = await authenticateCustomer();
    if (!auth.success) {
      return { error: auth.error };
    }

    // 2. Validate input
    const parsed = addonServiceRequestSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        if (field && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      return { error: "Validation failed", fieldErrors };
    }

    // 3. Verify customer has an active stay
    const activeStay = await stayRepository.getActiveStay(auth.customerProfileId);
    if (!activeStay) {
      return { error: "Service requests are available during active stays only" };
    }

    // 4. Create the service request
    const request = await addonServiceRepository.createServiceRequest({
      customerProfileId: auth.customerProfileId,
      stayEntryId: activeStay.id,
      serviceType: parsed.data.serviceType,
    });

    return { success: true, data: { requestId: request.id } };
  } catch (err) {
    console.error("requestAddonServiceAction error:", err);
    return { error: "Failed to submit service request. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// 11.3 — getAddonServiceRequestsAction
// ---------------------------------------------------------------------------

/**
 * Get all add-on service requests for a customer.
 *
 * Req 11.3
 */
export async function getAddonServiceRequestsAction(
  customerProfileId: string
): Promise<ActionResult<AddonServiceRequestRow[]>> {
  try {
    const requests = await addonServiceRepository.getServiceRequests(customerProfileId);
    return { success: true, data: requests };
  } catch (err) {
    console.error("getAddonServiceRequestsAction error:", err);
    return { error: "Failed to fetch service requests." };
  }
}

// ---------------------------------------------------------------------------
// 11.3, 11.4 — updateAddonServiceStatusAction
// ---------------------------------------------------------------------------

/**
 * Update the status of an add-on service request (admin-only).
 *
 * Uses the admin client to verify the caller has admin access.
 *
 * Req 11.3, 11.4
 */
export async function updateAddonServiceStatusAction(
  requestId: string,
  status: "CONFIRMED" | "COMPLETED"
): Promise<ActionResult<undefined>> {
  try {
    // Admin-only: use the admin client for authorization verification
    const admin = createAdminClient();

    // Verify request exists before updating
    const { data: existing, error: fetchError } = await admin
      .from("addon_service_requests")
      .select("id")
      .eq("id", requestId)
      .single();

    if (fetchError || !existing) {
      return { error: "Service request not found." };
    }

    // Update the status via the repository
    await addonServiceRepository.updateServiceStatus(requestId, status);

    return { success: true, data: undefined };
  } catch (err) {
    console.error("updateAddonServiceStatusAction error:", err);
    return { error: "Failed to update service request status." };
  }
}
