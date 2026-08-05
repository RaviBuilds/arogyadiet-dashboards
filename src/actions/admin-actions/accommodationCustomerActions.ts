"use server";

// src/actions/admin-actions/accommodationCustomerActions.ts
//
// Server Actions for the admin Accommodation Customers tab.
// Provides bulk stay status fetching for the customer list view.
//
// Requirements: 12.2

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAdminContext } from "@/lib/auth/adminAccess";

export interface AccommodationCustomerStayInfo {
  customerProfileId: string;
  stayStatus: string | null;
  stayType: string | null;
  startDate: string | null;
  totalNights: number | null;
}

/** An add-on wellness service request, as listed on the Accommodation tab. */
export interface AccommodationAddonRequest {
  id: string;
  customerProfileId: string;
  serviceType: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  requestedAt: string;
}

/**
 * Fetches the most recent stay entry (by created_at desc) for each
 * accommodation customer profile ID provided. Used by the admin
 * Accommodation Customers tab to show stay status and type columns.
 */
export async function getBulkAccommodationStayInfoAction(
  customerProfileIds: string[]
): Promise<{
  success: true;
  data: AccommodationCustomerStayInfo[];
} | { error: string }> {
  if (customerProfileIds.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const admin = createAdminClient();

    // For each customer, get the most recent stay entry
    // We query all stays for these customers and pick the latest per customer
    const { data, error } = await admin
      .from("stay_entries")
      .select("customer_profile_id, status, stay_type, start_date, total_nights, created_at")
      .in("customer_profile_id", customerProfileIds)
      .order("created_at", { ascending: false });

    if (error) {
      return { error: error.message };
    }

    // Group by customer_profile_id, take the first (most recent) entry
    const map = new Map<string, AccommodationCustomerStayInfo>();
    for (const row of data ?? []) {
      if (!map.has(row.customer_profile_id)) {
        map.set(row.customer_profile_id, {
          customerProfileId: row.customer_profile_id,
          stayStatus: row.status,
          stayType: row.stay_type,
          startDate: row.start_date ?? null,
          totalNights: row.total_nights ?? null,
        });
      }
    }

    // For customers without any stay entry, return null values
    const result: AccommodationCustomerStayInfo[] = customerProfileIds.map(
      (id) =>
        map.get(id) ?? {
          customerProfileId: id,
          stayStatus: null,
          stayType: null,
          startDate: null,
          totalNights: null,
        }
    );

    return { success: true, data: result };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch stay info";
    return { error: message };
  }
}

/**
 * Fetches the add-on wellness service requests belonging to the given
 * accommodation customer profile IDs, newest first.
 *
 * SCOPE: only requests tied to a currently ACTIVE stay are returned. This
 * panel is a live work queue for guests who are in-house right now — once a
 * guest checks out (stay FINISHED) or is marked a no-show (EXPIRED), their
 * requests drop off it entirely, because staff can no longer act on them.
 * The full per-customer audit trail lives on the Customer_360 Accommodation
 * tab via `getAdminAddonRequestHistoryAction`.
 *
 * The caller passes the customer IDs already visible on the Accommodation
 * Customers tab, so the result inherits that tab's franchise scoping — a
 * request can never surface for a customer the admin is not already looking at.
 * Only ADMIN / MASTER_ADMIN sessions may read it.
 */
export async function getAccommodationAddonRequestsAction(
  customerProfileIds: string[]
): Promise<{
  success: true;
  data: AccommodationAddonRequest[];
} | { error: string }> {
  if (customerProfileIds.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const { roleCode } = await getCurrentAdminContext();
    if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
      return { error: "Unauthorized" };
    }

    const admin = createAdminClient();

    // Resolve which of these customers currently have an ACTIVE stay, and
    // which stay rows those are — requests are filtered to those stays.
    const { data: activeStays, error: stayError } = await admin
      .from("stay_entries")
      .select("id")
      .in("customer_profile_id", customerProfileIds)
      .eq("status", "ACTIVE");

    if (stayError) {
      return { error: stayError.message };
    }

    const activeStayIds = (activeStays ?? []).map((s) => s.id as string);

    // Nobody is currently in-house, so there is nothing actionable.
    if (activeStayIds.length === 0) {
      return { success: true, data: [] };
    }

    const { data, error } = await admin
      .from("addon_service_requests")
      .select("id, customer_profile_id, service_type, status, requested_at")
      .in("customer_profile_id", customerProfileIds)
      .in("stay_entry_id", activeStayIds)
      .order("requested_at", { ascending: false });

    if (error) {
      return { error: error.message };
    }

    const requests: AccommodationAddonRequest[] = (data ?? []).map((row) => ({
      id: row.id as string,
      customerProfileId: row.customer_profile_id as string,
      serviceType: row.service_type as string,
      status: row.status as AccommodationAddonRequest["status"],
      requestedAt: row.requested_at as string,
    }));

    return { success: true, data: requests };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch add-on requests";
    return { error: message };
  }
}
