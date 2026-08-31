"use server";

// src/actions/admin-actions/customerHistoryActions.ts
//
// Server Actions backing the Customer_360 history tab (Subscription History /
// KIT History / Accommodation History). Each returns the same per-record rows
// the customer sees on their own history page, so the admin table and the
// customer table can never disagree.
//
// Authorization: the admin portal's own page/layout guards already gate the
// Customer_360 page. These actions add a role check of their own as
// defence-in-depth, mirroring `guardAdminPage`'s role rule without redirecting
// (an action returns an error result instead).

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import {
  isFranchiseCaller,
  authorizeFranchiseCustomerAccess,
} from "@/lib/auth/sharedCustomerActor";
import {
  getMealSubscriptionsForCustomer,
  getStaysForCustomer,
  type MealSubscriptionRow,
  type StayReportRow,
} from "@/repositories/healthReportRepository";
import * as addonServiceRepository from "@/repositories/addonServiceRepository";
import * as KitLifecycleService from "@/services/KitLifecycleService";
import type { KitHistoryEntry } from "@/types/kitLifecycle";
import type { AddonServiceStatus } from "@/types/accommodation";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * A stay row for the Accommodation History tab, plus the number of add-on
 * wellness services actually DELIVERED during that stay (COMPLETED requests).
 * Pending / confirmed / cancelled requests are excluded — they were never
 * delivered, so they would overstate what the guest received.
 */
export type AdminStayHistoryRow = StayReportRow & {
  completedAddonCount: number;
};

/** One add-on service request in a customer's full request history. */
export interface AdminAddonRequestHistoryRow {
  id: string;
  stayEntryId: string;
  serviceType: string;
  status: AddonServiceStatus;
  requestedAt: string;
  updatedAt: string;
}

/** Role codes permitted to read a customer's history. Dietitians carry ADMIN/FRANCHISE_ADMIN. */
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN", "FRANCHISE_ADMIN"]);

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { roleCode } = await getCurrentAdminContext();
  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return { ok: false, error: "You do not have access to this customer's history." };
  }
  return { ok: true };
}

/**
 * Authorize the caller for ONE customer's history.
 *
 * `ALLOWED_ROLES` admits `FRANCHISE_ADMIN`, but until now nothing checked that
 * the named customer belonged to the caller's franchise — so a franchise admin
 * could read any tenant's history by passing its `customerProfileId`. A franchise
 * caller now goes through `authorizeFranchiseCustomerAccess`, which adds tenancy
 * and, for a Franchise Dietitian, the Dietitian_Link.
 *
 * The CORE branch is `assertAdmin()` exactly as before: Core_Business behaviour
 * on the admin dashboard is unchanged, including for a core Dietitian (whose
 * role is ADMIN and who must keep reading the history of customers assigned to
 * them).
 */
async function assertHistoryAccess(
  customerProfileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isFranchiseCaller()) {
    return authorizeFranchiseCustomerAccess(customerProfileId, "read");
  }
  return assertAdmin();
}

/** MEAL subscriptions for the Subscription History tab, newest first. */
export async function getAdminMealSubscriptionHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<MealSubscriptionRow[]>> {
  const auth = await assertHistoryAccess(customerProfileId);
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    return { success: true, data: await getMealSubscriptionsForCustomer(customerProfileId) };
  } catch (err) {
    console.error("[customerHistoryActions] meal history error", err);
    return { success: false, error: "Unable to load subscription history." };
  }
}

/** KIT subscriptions for the KIT History tab — the same rows the customer sees. */
export async function getAdminKitHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<KitHistoryEntry[]>> {
  const auth = await assertHistoryAccess(customerProfileId);
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    return { success: true, data: await KitLifecycleService.getKitHistory(customerProfileId) };
  } catch (err) {
    console.error("[customerHistoryActions] kit history error", err);
    return { success: false, error: "Unable to load KIT history." };
  }
}

/**
 * Stays for the Accommodation History tab, newest first, each carrying the
 * count of add-on wellness services delivered (COMPLETED) during that stay.
 */
export async function getAdminStayHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<AdminStayHistoryRow[]>> {
  // Accommodation is not a franchise product, so no franchise caller has a
  // legitimate reason to reach this. It is routed through the same gate anyway:
  // the tenancy check is what refuses them, rather than relying on the UI never
  // rendering the tab.
  const auth = await assertHistoryAccess(customerProfileId);
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const stays = await getStaysForCustomer(customerProfileId);

    // One grouped count query for every stay rather than one per row.
    const completedByStay = await addonServiceRepository.getCompletedCountByStay(
      stays.map((stay) => stay.id),
    );

    return {
      success: true,
      data: stays.map((stay) => ({
        ...stay,
        completedAddonCount: completedByStay[stay.id] ?? 0,
      })),
    };
  } catch (err) {
    console.error("[customerHistoryActions] stay history error", err);
    return { success: false, error: "Unable to load accommodation history." };
  }
}

/**
 * The complete add-on service request history for one customer — every status
 * (PENDING / CONFIRMED / COMPLETED / CANCELLED), newest first.
 *
 * Unlike the Accommodation tab's live queue, this is deliberately unfiltered:
 * it is the audit trail of everything the guest ever asked for.
 */
export async function getAdminAddonRequestHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<AdminAddonRequestHistoryRow[]>> {
  const auth = await assertHistoryAccess(customerProfileId);
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const rows = await addonServiceRepository.getServiceRequests(customerProfileId);

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        stayEntryId: row.stay_entry_id,
        serviceType: row.service_type,
        status: row.status as AddonServiceStatus,
        requestedAt: row.requested_at,
        updatedAt: row.updated_at,
      })),
    };
  } catch (err) {
    console.error("[customerHistoryActions] addon request history error", err);
    return { success: false, error: "Unable to load add-on service history." };
  }
}
