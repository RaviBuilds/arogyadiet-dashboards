"use server";

// src/actions/franchise-actions/franchiseShopOrderActions.ts
//
// Franchise_Portal Server Actions for the Shop_Orders ledger
// (`/franchise/customers/shop-orders`).
//
// LAYERING: Action layer ONLY. Authorization + tenancy here; the business logic
// lives in the ungated cores in `@/services/addonOrderCore`.
//
// WHY WRAPPERS RATHER THAN A FRANCHISE BRANCH IN THE ADMIN ACTIONS:
// `adminUpdateAddonOrderDeliveryDate` and `adminMarkAddonOrderDeliveredOffline`
// both open with `checkGroupManage("customers")`, which admits only
// ADMIN / MASTER_ADMIN. Unlike the KIT/shipping actions — which either had NO gate
// at all or one that already admitted franchise callers — that rejection here is
// CORRECT and is pinned by `customer-actions-authorization.pin.test.ts`, which
// asserts every mutating export of `customerActions.ts` consults that gate and
// returns its message verbatim. Adding a franchise branch would break those pins
// for no reason, so the franchise portal gets its own gated wrappers instead,
// exactly as `franchiseCustomerManagementActions.ts` does for customer writes.
//
// TENANCY ANCHOR: `addon_orders.franchise_id`, NOT the customer profile's.
// A walk-in counter sale has `customer_profile_id IS NULL` (enforced by
// `addon_orders_buyer_identity_check`), so resolving the tenant through the
// profile would silently exclude every walk-in — which is exactly the bug in the
// franchise shop-products page's inline "Recent Orders" tab.

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkFranchiseGroupManage } from "@/lib/auth/adminAccess";
import {
  updateAddonOrderDeliveryDateCore,
  markAddonOrderDeliveredOfflineCore,
  type AddonOrderActionResult,
} from "@/services/addonOrderCore";

/** Refused when the order is absent or belongs to another tenant. */
const NOT_YOUR_ORDER = "This order does not belong to your franchise.";

/**
 * Establish that the caller may manage `customers` for their own Franchise AND
 * that the named Shop_Order belongs to it.
 *
 * Permission is checked BEFORE the row lookup so a view-only caller learns
 * nothing about whether a given order id exists. Absent and out-of-tenant then
 * return the SAME message, so the response cannot be used to probe for valid
 * order ids either.
 */
async function guardOrder(
  addonOrderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await checkFranchiseGroupManage("customers");
  if (!gate.ok) return { ok: false, error: gate.error };

  const trimmed = addonOrderId?.trim() ?? "";
  if (trimmed.length === 0) {
    return { ok: false, error: "Order id is required." };
  }

  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("addon_orders")
    .select("id, franchise_id")
    .eq("id", trimmed)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!order) return { ok: false, error: NOT_YOUR_ORDER };
  if ((order.franchise_id as string | null) !== gate.ctx.franchiseId) {
    return { ok: false, error: NOT_YOUR_ORDER };
  }

  return { ok: true };
}

/** Revalidate the franchise surfaces that display Shop_Orders. */
function revalidateFranchiseShopOrders() {
  revalidatePath("/franchise/customers/shop-orders");
  revalidatePath("/franchise/shop-products");
  revalidatePath("/franchise/operations");
}

/**
 * Reschedule one of this franchise's unshipped, paid Shop_Orders.
 */
export async function franchiseUpdateAddonOrderDeliveryDate(
  addonOrderId: string,
  newDeliveryDate: string,
): Promise<AddonOrderActionResult> {
  const guard = await guardOrder(addonOrderId);
  if (!guard.ok) return { success: false, error: guard.error };

  const result = await updateAddonOrderDeliveryDateCore(
    addonOrderId,
    newDeliveryDate,
  );
  if (result.success) revalidateFranchiseShopOrders();
  return result;
}

/**
 * Mark one of this franchise's Shop_Orders delivered offline (counter handover).
 */
export async function franchiseMarkAddonOrderDeliveredOffline(
  addonOrderId: string,
): Promise<AddonOrderActionResult> {
  const guard = await guardOrder(addonOrderId);
  if (!guard.ok) return { success: false, error: guard.error };

  const result = await markAddonOrderDeliveredOfflineCore(addonOrderId);
  if (result.success) revalidateFranchiseShopOrders();
  return result;
}
