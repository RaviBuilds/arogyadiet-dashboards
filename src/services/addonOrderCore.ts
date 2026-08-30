// src/services/addonOrderCore.ts
//
// UNGATED cores for the two Shop_Order (addon order) row operations offered by
// the shop-orders ledger: rescheduling an unshipped order, and marking one
// delivered offline (counter handover).
//
// WHY CORES: the admin actions
// `adminUpdateAddonOrderDeliveryDate` / `adminMarkAddonOrderDeliveredOffline`
// both open with `checkGroupManage("customers")`, which admits only
// ADMIN / MASTER_ADMIN, so a franchise caller is refused. That rejection is
// CORRECT and load-bearing — those two actions are also pinned by
// `customer-actions-authorization.pin.test.ts`, which asserts every mutating
// export of `customerActions.ts` consults that gate and returns its message
// verbatim. So unlike the KIT/shipping actions (which had no gate, or a gate that
// already admitted franchise callers), these must NOT gain a franchise branch:
// the franchise portal gets its own wrappers over these cores instead, exactly as
// `franchiseCustomerManagementActions.ts` does for the customer writes.
//
// EVERY CORE HERE IS UNAUTHORIZED AND UNTENANTED BY CONSTRUCTION. Callers are
// responsible for both. There is no database-level safety net: these use the
// service-role client.
//
// Bodies are carried over VERBATIM from `admin-actions/customerActions.ts` —
// same validation order, same messages, same audit payloads, same revalidations —
// so the admin portal's behaviour is unchanged.

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/logger";
import { getISTDateString } from "@/lib/dates/ist";
import {
  ADDON_STATUS_DELIVERED,
  FULFILLMENT_DELIVERED_OFFLINE,
} from "@/lib/shop/addonFulfillment";

export type AddonOrderActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Service-role client, built at module load to mirror
 * `admin-actions/customerActions.ts` exactly. RLS is bypassed, which is why the
 * caller's authorization and tenancy checks are the only boundary.
 */
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Reschedule an unshipped, paid Shop_Order to a different delivery date.
 *
 * The chosen date must be an ACTIVE (non-paused) day that already exists in the
 * customer's daily preferences. Because preferences only span the subscription
 * window, that single lookup enforces all three rules at once: not a paused day,
 * inside the subscription, and a real delivery day the order can ride along with.
 */
export async function updateAddonOrderDeliveryDateCore(
  addonOrderId: string,
  newDeliveryDate: string,
): Promise<AddonOrderActionResult> {
  const today = getISTDateString(0);
  if (newDeliveryDate <= today) {
    return { success: false, error: "Delivery date must be after today." };
  }

  const { data: order, error: fetchError } = await supabaseAdmin
    .from("addon_orders")
    .select("id, status, delivery_order_id, customer_profile_id")
    .eq("id", addonOrderId)
    .single();

  if (fetchError || !order) return { success: false, error: "Order not found." };
  if (order.status !== "PAID")
    return { success: false, error: "Only paid orders can be rescheduled." };
  if (order.delivery_order_id)
    return {
      success: false,
      error: "This order has already been scheduled and cannot be changed.",
    };

  const { data: pref, error: prefError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused")
    .eq("customer_profile_id", order.customer_profile_id)
    .eq("preference_date", newDeliveryDate)
    .maybeSingle();

  if (prefError) return { success: false, error: prefError.message };
  if (!pref) {
    return {
      success: false,
      error: "The selected date is outside the customer's subscription window.",
    };
  }
  if (pref.is_paused) {
    return {
      success: false,
      error:
        "The selected date is a paused day. Choose an active delivery day.",
    };
  }

  const { error: updateError } = await supabaseAdmin
    .from("addon_orders")
    .update({ target_delivery_date: newDeliveryDate })
    .eq("id", addonOrderId);

  if (updateError) return { success: false, error: updateError.message };

  await logAdminAction("UPDATE", "addon_order", addonOrderId, {
    target_delivery_date: newDeliveryDate,
  });
  revalidatePath("/admin/customers");
  revalidatePath("/admin/operations");
  revalidatePath("/shop/orders");
  return { success: true };
}

/**
 * Mark a Shop_Order delivered OFFLINE — e.g. collected at the clinic counter.
 *
 * This takes the order OUT of the meal-delivery routing pipeline: status becomes
 * DELIVERED (so the product-linking job, which only links PAID unlinked orders,
 * never touches it again), `fulfillment_status` is stamped DELIVERED_OFFLINE with
 * `delivered_at` = now, and any `delivery_order_id` is cleared so no rider
 * carries it.
 *
 * Valid for both unscheduled ("Purchased") and already-scheduled orders. A
 * PENDING (unpaid) or already-terminal order is rejected.
 */
export async function markAddonOrderDeliveredOfflineCore(
  addonOrderId: string,
): Promise<AddonOrderActionResult> {
  const { data: order, error: fetchError } = await supabaseAdmin
    .from("addon_orders")
    .select("id, status")
    .eq("id", addonOrderId)
    .single();

  if (fetchError || !order) return { success: false, error: "Order not found." };
  if (order.status === "PENDING")
    return {
      success: false,
      error: "This order is not paid yet and cannot be marked delivered.",
    };
  if (order.status !== "PAID")
    return {
      success: false,
      error: "Only a paid (undelivered) order can be marked delivered.",
    };

  const { error: updateError } = await supabaseAdmin
    .from("addon_orders")
    .update({
      status: ADDON_STATUS_DELIVERED,
      fulfillment_status: FULFILLMENT_DELIVERED_OFFLINE,
      delivered_at: new Date().toISOString(),
      delivery_order_id: null,
    })
    .eq("id", addonOrderId);

  if (updateError) return { success: false, error: updateError.message };

  await logAdminAction("UPDATE", "addon_order", addonOrderId, {
    fulfillment_status: FULFILLMENT_DELIVERED_OFFLINE,
    marked_delivered_offline: true,
  });
  revalidatePath("/admin/operations");
  revalidatePath("/admin/customers");
  revalidatePath("/shop/orders");
  return { success: true };
}
