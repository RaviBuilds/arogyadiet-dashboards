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
  getMealSubscriptionsForCustomer,
  getStaysForCustomer,
  type MealSubscriptionRow,
  type StayReportRow,
} from "@/repositories/healthReportRepository";
import * as KitLifecycleService from "@/services/KitLifecycleService";
import type { KitHistoryEntry } from "@/types/kitLifecycle";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/** Role codes permitted to read a customer's history. Dietitians carry ADMIN/FRANCHISE_ADMIN. */
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN", "FRANCHISE_ADMIN"]);

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { roleCode } = await getCurrentAdminContext();
  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return { ok: false, error: "You do not have access to this customer's history." };
  }
  return { ok: true };
}

/** MEAL subscriptions for the Subscription History tab, newest first. */
export async function getAdminMealSubscriptionHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<MealSubscriptionRow[]>> {
  const auth = await assertAdmin();
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
  const auth = await assertAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    return { success: true, data: await KitLifecycleService.getKitHistory(customerProfileId) };
  } catch (err) {
    console.error("[customerHistoryActions] kit history error", err);
    return { success: false, error: "Unable to load KIT history." };
  }
}

/** Stays for the Accommodation History tab, newest first. */
export async function getAdminStayHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<StayReportRow[]>> {
  const auth = await assertAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    return { success: true, data: await getStaysForCustomer(customerProfileId) };
  } catch (err) {
    console.error("[customerHistoryActions] stay history error", err);
    return { success: false, error: "Unable to load accommodation history." };
  }
}
