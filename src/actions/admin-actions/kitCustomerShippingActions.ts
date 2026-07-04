"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertGroupAccess, GroupAccessDeniedError } from "@/lib/auth/adminAccess";

/**
 * Shipping status data for a KIT customer displayed in the KIT Customers directory.
 * Derives status from shipped_at / delivered_at timestamps in kit_shipping_info.
 */
export interface KitCustomerShippingStatus {
  customerProfileId: string;
  status: "Not Shipped" | "Shipped" | "Delivered";
  statusUpdatedAt: string | null; // ISO timestamp of when the status last changed
}

export type GetBulkShippingStatusResult =
  | { success: true; data: KitCustomerShippingStatus[] }
  | { success: false; error: string };

/**
 * Fetch shipping status for a batch of KIT customer profile IDs.
 * Returns an array of shipping statuses that the UI merges into the customer rows.
 *
 * Status logic:
 *   - No kit_shipping_info row → "Not Shipped" (statusUpdatedAt = null)
 *   - shipped_at is set, delivered_at is null → "Shipped" (statusUpdatedAt = shipped_at)
 *   - delivered_at is set → "Delivered" (statusUpdatedAt = delivered_at)
 */
export async function getBulkKitShippingStatusAction(
  customerProfileIds: string[]
): Promise<GetBulkShippingStatusResult> {
  try {
    await assertGroupAccess("customers");
  } catch (err) {
    if (err instanceof GroupAccessDeniedError) {
      return { success: false, error: "You do not have permission to view customers." };
    }
    throw err;
  }

  if (!customerProfileIds.length) {
    return { success: true, data: [] };
  }

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("kit_shipping_info")
      .select("customer_profile_id, shipped_at, delivered_at")
      .in("customer_profile_id", customerProfileIds);

    if (error) {
      console.error("getBulkKitShippingStatusAction error:", error);
      return { success: false, error: "Failed to fetch shipping statuses." };
    }

    // Build a map: customer_profile_id → latest shipping row
    // A customer may have multiple rows if they have multiple KIT subscriptions,
    // so pick the most recently created one (highest shipped_at or created row).
    const statusMap = new Map<string, KitCustomerShippingStatus>();

    for (const row of data ?? []) {
      const existing = statusMap.get(row.customer_profile_id);
      const newEntry = deriveStatus(row);

      // If there's already an entry, keep the one with the most recent status timestamp
      if (!existing || isMoreRecent(newEntry, existing)) {
        statusMap.set(row.customer_profile_id, newEntry);
      }
    }

    // Fill in "Not Shipped" for customer IDs that had no shipping info
    const result: KitCustomerShippingStatus[] = customerProfileIds.map((id) => {
      return statusMap.get(id) ?? {
        customerProfileId: id,
        status: "Not Shipped",
        statusUpdatedAt: null,
      };
    });

    return { success: true, data: result };
  } catch (error) {
    console.error("getBulkKitShippingStatusAction unexpected error:", error);
    return { success: false, error: "An unexpected error occurred." };
  }
}

function deriveStatus(row: {
  customer_profile_id: string;
  shipped_at: string | null;
  delivered_at: string | null;
}): KitCustomerShippingStatus {
  if (row.delivered_at) {
    return {
      customerProfileId: row.customer_profile_id,
      status: "Delivered",
      statusUpdatedAt: row.delivered_at,
    };
  }
  if (row.shipped_at) {
    return {
      customerProfileId: row.customer_profile_id,
      status: "Shipped",
      statusUpdatedAt: row.shipped_at,
    };
  }
  return {
    customerProfileId: row.customer_profile_id,
    status: "Not Shipped",
    statusUpdatedAt: null,
  };
}

function isMoreRecent(
  a: KitCustomerShippingStatus,
  b: KitCustomerShippingStatus
): boolean {
  if (!a.statusUpdatedAt) return false;
  if (!b.statusUpdatedAt) return true;
  return new Date(a.statusUpdatedAt).getTime() > new Date(b.statusUpdatedAt).getTime();
}
