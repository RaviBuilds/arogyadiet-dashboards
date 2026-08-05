"use server";

// src/actions/addonServiceActions.ts
//
// Server Actions for add-on wellness service request management.
// Handles customer service requests and admin status updates.
//
// Requirements: 11.1, 11.2, 11.3, 11.4

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, buildPushPayload } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import * as addonServiceRepository from "@/repositories/addonServiceRepository";
import * as stayRepository from "@/repositories/stayRepository";
import {
  addonServiceRequestSchema,
} from "@/validations/accommodationSchema";
import type { AddonServiceRequestRow } from "@/repositories/addonServiceRepository";
import {
  OPEN_ADDON_SERVICE_STATUSES,
  type AddonServiceStatus,
} from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

/**
 * Admin access levels that must NOT be alerted about add-on service requests:
 * inventory-only admins and Dietitians have no part in fulfilling them.
 */
const ADDON_ALERT_EXCLUDED_ACCESS_LEVELS = ["inventory", "dietitian"] as const;

/** Display labels for the requestable service types (mirrors the customer UI). */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  THERAPY: "Therapy Session",
  MASSAGE: "Ayurvedic Massage",
  YOGA: "Private Yoga Session",
};

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

/**
 * Alert admins that a customer requested an add-on wellness service.
 *
 * Recipients exclude the `inventory` (inventory-only) and `dietitian` access
 * levels: neither fulfils add-on services, so the alert would be noise for
 * them. Never throws — a failed alert must not fail the request itself.
 */
async function notifyAddonServiceRequested(
  customerProfileId: string,
  serviceType: string,
  requestId: string,
): Promise<void> {
  try {
    const customerName = await getCustomerNameByProfileId(customerProfileId);
    const serviceLabel = SERVICE_TYPE_LABELS[serviceType] ?? serviceType;

    const title = "New add-on service request!";
    const message = `Hi Admin, Customer ${customerName} has requested ${serviceLabel}.`;

    await notifyAdmins({
      title,
      message,
      actionUrl: "/admin/customers",
      sendEmail: false,
      excludeAccessLevels: ADDON_ALERT_EXCLUDED_ACCESS_LEVELS,
      ...buildPushPayload(title, message, `addon-service-request-${requestId}`),
    });
  } catch (err) {
    console.error("notifyAddonServiceRequested failed:", err);
  }
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

    // 3. Verify customer has an active stay — once checked out (FINISHED) or
    //    a no-show (EXPIRED), add-on services are no longer offered.
    const activeStay = await stayRepository.getActiveStay(auth.customerProfileId);
    if (!activeStay) {
      return { error: "Service requests are available during active stays only" };
    }

    // 4. Block a duplicate request for THIS service while one is still open.
    //    This is what stops the "clicked Ayurvedic Massage 3 times" bug. The
    //    gate is per service type, not global: a pending Therapy Session must
    //    not stop the customer from also requesting a Massage or Yoga session.
    const existingRequests = await addonServiceRepository.getServiceRequests(
      auth.customerProfileId
    );
    const hasOpenRequestForService = existingRequests.some(
      (r) =>
        r.service_type === parsed.data.serviceType &&
        OPEN_ADDON_SERVICE_STATUSES.includes(r.status as AddonServiceStatus)
    );
    if (hasOpenRequestForService) {
      const serviceLabel =
        SERVICE_TYPE_LABELS[parsed.data.serviceType] ?? parsed.data.serviceType;
      return {
        error: `You already have a ${serviceLabel} request in progress. It must be completed before you can request it again.`,
      };
    }

    // 5. Create the service request
    const request = await addonServiceRepository.createServiceRequest({
      customerProfileId: auth.customerProfileId,
      stayEntryId: activeStay.id,
      serviceType: parsed.data.serviceType,
    });

    // 6. Alert the admins who act on these requests. Inventory-only and
    //    Dietitian admins are skipped — the request is outside their remit.
    await notifyAddonServiceRequested(
      auth.customerProfileId,
      parsed.data.serviceType,
      request.id,
    );

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
 * Get all add-on service requests for the authenticated customer.
 *
 * SECURITY: this reads through the service-role client, so it must never
 * serve an arbitrary caller-supplied profile id. The `customerProfileId`
 * argument is accepted for call-site clarity but is verified against the
 * session — a mismatch is rejected rather than honoured. Admin surfaces use
 * the separately gated actions in `customerHistoryActions` /
 * `accommodationCustomerActions` instead.
 *
 * Req 11.3
 */
export async function getAddonServiceRequestsAction(
  customerProfileId: string
): Promise<ActionResult<AddonServiceRequestRow[]>> {
  try {
    const auth = await authenticateCustomer();
    if (!auth.success) {
      return { error: auth.error };
    }

    if (customerProfileId !== auth.customerProfileId) {
      return { error: "Unauthorized" };
    }

    const requests = await addonServiceRepository.getServiceRequests(
      auth.customerProfileId
    );
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
 * Gated on manage access to the `customers` operations group, which is the
 * group that owns the Accommodation Customers tab this is called from. That
 * also keeps inventory-only and Dietitian admins out of the write path, in
 * line with the alert exclusion.
 *
 * Req 11.3, 11.4
 */
export async function updateAddonServiceStatusAction(
  requestId: string,
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED"
): Promise<ActionResult<undefined>> {
  try {
    const gate = await checkGroupManage("customers");
    if (!gate.ok) {
      return { error: gate.error };
    }

    const admin = createAdminClient();

    // Verify request exists before updating
    const { data: existing, error: fetchError } = await admin
      .from("addon_service_requests")
      .select("id, status")
      .eq("id", requestId)
      .single();

    if (fetchError || !existing) {
      return { error: "Service request not found." };
    }

    // A delivered service is terminal — it cannot be walked back to
    // cancelled, which would erase the fact that it happened.
    if (existing.status === "COMPLETED") {
      return { error: "This request is already completed." };
    }
    if (existing.status === "CANCELLED") {
      return { error: "This request is already cancelled." };
    }

    // Update the status via the repository
    await addonServiceRepository.updateServiceStatus(requestId, status);

    return { success: true, data: undefined };
  } catch (err) {
    console.error("updateAddonServiceStatusAction error:", err);
    return { error: "Failed to update service request status." };
  }
}

// ---------------------------------------------------------------------------
// cancelAddonServiceRequestAction
// ---------------------------------------------------------------------------

/**
 * Lets the authenticated customer withdraw their OWN add-on service
 * request, as long as it is still open (PENDING or CONFIRMED).
 *
 * A COMPLETED request can no longer be cancelled — the service already
 * happened. Ownership is enforced by comparing `customer_profile_id`
 * against the authenticated session, so a customer can never cancel
 * another customer's request.
 */
export async function cancelAddonServiceRequestAction(
  requestId: string
): Promise<ActionResult<undefined>> {
  try {
    const auth = await authenticateCustomer();
    if (!auth.success) {
      return { error: auth.error };
    }

    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from("addon_service_requests")
      .select("id, customer_profile_id, status")
      .eq("id", requestId)
      .single();

    if (fetchError || !existing) {
      return { error: "Service request not found." };
    }

    if (existing.customer_profile_id !== auth.customerProfileId) {
      return { error: "Unauthorized" };
    }

    if (!OPEN_ADDON_SERVICE_STATUSES.includes(
      existing.status as AddonServiceStatus
    )) {
      return { error: "Only a pending or confirmed request can be cancelled." };
    }

    await addonServiceRepository.updateServiceStatus(requestId, "CANCELLED");

    return { success: true, data: undefined };
  } catch (err) {
    console.error("cancelAddonServiceRequestAction error:", err);
    return { error: "Failed to cancel service request." };
  }
}
