"use server";

// src/actions/admin-actions/accommodationCustomerActions.ts
//
// Server Actions for the admin Accommodation Customers tab.
// Provides bulk stay status fetching for the customer list view.
//
// Requirements: 12.2

import { createAdminClient } from "@/lib/supabase/admin";

export interface AccommodationCustomerStayInfo {
  customerProfileId: string;
  stayStatus: string | null;
  stayType: string | null;
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
      .select("customer_profile_id, status, stay_type, created_at")
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
        }
    );

    return { success: true, data: result };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch stay info";
    return { error: message };
  }
}
