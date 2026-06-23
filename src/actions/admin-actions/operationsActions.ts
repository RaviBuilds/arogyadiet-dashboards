"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import {
  getAdminNextStatusTransition,
  PRE_PICKUP_ORDER_STATUSES,
} from "@/lib/delivery/adminOrderStatusTransitions";
import {
  reconcileDeliveryBatchStatuses,
  tryCompleteDeliveryBatch,
} from "@/lib/delivery/batchCompletion";
import {
  notifyDelivered,
  notifyFailedDeliveryApproved,
  notifyFailedDeliveryRejected,
  notifyOutForDeliveryForBatch,
  notifyReachingToLocation,
} from "@/lib/delivery/deliveryStatusNotifications";
import { getFailureReasonFromLogs } from "@/lib/delivery/failureApproval";
import { getISTDateString } from "@/lib/dates/ist";
import { revalidatePath } from "next/cache";

type ActionResult = { success: true } | { success: false; error: string };

export type AutomationLogRow = {
  automation_type: string;
  target_date: string;
  run_count: number | null;
  last_run_at: string | null;
  latest_stats: unknown;
};

export type PendingFailureApprovalRow = {
  orderId: string;
  customerName: string;
  riderName: string;
  reason: string;
};

function revalidateOrderStatusPaths(orderId: string) {
  revalidatePath("/admin/operations");
  revalidatePath("/route");
  revalidatePath(`/route/${orderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/rider/route");
  revalidatePath(`/rider/route/${orderId}`);
  revalidatePath("/rider/dashboard");
}

function revalidateBatchPickupPaths() {
  revalidatePath("/route");
  revalidatePath("/dashboard");
  revalidatePath("/admin/riders");
  revalidatePath("/admin/operations");
  revalidatePath("/rider/route");
  revalidatePath("/rider/dashboard");
}

export async function fetchRosterData(startDate: string, endDate: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("subscription_daily_preferences")
    .select(
      `
      id,
      preference_date,
      is_paused,
      subscriptions ( subscription_code ),
      customer_profiles ( users ( full_name ) ),
      meal_categories ( name ),
      addresses ( pincode )
    `,
    )
    .gte("preference_date", startDate)
    .lte("preference_date", endDate)
    .order("preference_date", { ascending: true });
  if (error) {
    console.error("Error fetching roster data:", error);
    return [];
  }

  return data || [];
}

export async function getAutomationLogs(
  startDate: string,
  endDate: string,
): Promise<AutomationLogRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("automation_logs")
    .select("automation_type, target_date, run_count, last_run_at, latest_stats")
    .gte("target_date", startDate)
    .lte("target_date", endDate)
    .order("target_date", { ascending: false })
    .order("last_run_at", { ascending: false });

  if (error) {
    console.error("Error fetching automation logs:", error);
    return [];
  }

  return (data || []) as AutomationLogRow[];
}

/**
 * Fetch pending failed-delivery approval requests.
 *
 * Scope:
 * - "core" (default) → only CORE business riders (franchise_id IS NULL).
 *   The head-office admin must NEVER receive failure requests raised by
 *   franchise riders — those are routed to the franchise owner instead.
 * - <franchise uuid> → only that franchise's riders. Used by the franchise
 *   portal so the franchise owner handles their own riders' requests.
 */
export async function fetchPendingFailureApprovals(
  scope: "core" | string = "core",
): Promise<PendingFailureApprovalRow[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("delivery_orders")
    .select(
      `
      id,
      franchise_id,
      customer_profiles ( users ( full_name ) ),
      rider_profiles ( users ( full_name ) ),
      delivery_status_logs ( note, status, created_at )
    `,
    )
    .eq("status", "PENDING_FAILURE_APPROVAL");

  // Core admin sees only core (NULL franchise) failures; a franchise sees only its own.
  query =
    scope === "core"
      ? query.is("franchise_id", null)
      : query.eq("franchise_id", scope);

  const { data: rawPendingFailures, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    console.error("Error fetching pending failure approvals:", error);
    return [];
  }

  return (rawPendingFailures || []).map((order) => {
    const customerProfile = Array.isArray(order.customer_profiles)
      ? order.customer_profiles[0]
      : order.customer_profiles;
    const customerUser = Array.isArray(customerProfile?.users)
      ? customerProfile?.users[0]
      : customerProfile?.users;

    const riderProfile = Array.isArray(order.rider_profiles)
      ? order.rider_profiles[0]
      : order.rider_profiles;
    const riderUser = Array.isArray(riderProfile?.users)
      ? riderProfile?.users[0]
      : riderProfile?.users;

    const logs = Array.isArray(order.delivery_status_logs)
      ? order.delivery_status_logs
      : order.delivery_status_logs
        ? [order.delivery_status_logs]
        : [];

    return {
      orderId: order.id,
      customerName: customerUser?.full_name || "Unknown",
      riderName: riderUser?.full_name || "Unassigned",
      reason: getFailureReasonFromLogs(logs),
    };
  });
}

export async function reconcileDeliveryBatchStatusesAction(): Promise<{
  batchesCompleted: number;
}> {
  const supabase = createAdminClient();
  const today = getISTDateString();
  const tomorrow = getISTDateString(1);
  return reconcileDeliveryBatchStatuses(supabase, [today, tomorrow]);
}

export async function revalidateOperationsPage() {
  await reconcileDeliveryBatchStatusesAction();
  revalidatePath("/admin/operations");
}

export async function markAdminOrderOnTheWayAction(
  orderId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const newStatus = "REACHING_TO_LOCATION";
  const note = "Rider is reaching to location";

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery order not found." };
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    return {
      success: false,
      error: `Cannot mark on the way from ${order.status}.`,
    };
  }

  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error updating delivery order status:", updateError);
    return { success: false, error: updateError.message };
  }

  const { error: logError } = await supabase.from("delivery_status_logs").insert({
    delivery_order_id: orderId,
    status: newStatus,
    note,
  });

  if (logError) {
    console.error("Error inserting delivery status log:", logError);
    return { success: false, error: logError.message };
  }

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    from: order.status,
    to: newStatus,
    action: "mark_on_the_way",
  });

  await notifyReachingToLocation(orderId);

  revalidateOrderStatusPaths(orderId);
  return { success: true };
}

export async function markAdminOrderDeliveredAction(
  orderId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const newStatus = "DELIVERED";
  const note = "Meal delivered";

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status, batch_id, delivery_date")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery order not found." };
  }

  if (order.status !== "REACHING_TO_LOCATION") {
    return {
      success: false,
      error: `Cannot mark delivered from ${order.status}.`,
    };
  }

  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({
      status: newStatus,
      delivered_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error updating delivery order status:", updateError);
    return { success: false, error: updateError.message };
  }

  const { error: logError } = await supabase.from("delivery_status_logs").insert({
    delivery_order_id: orderId,
    status: newStatus,
    note,
  });

  if (logError) {
    console.error("Error inserting delivery status log:", logError);
    return { success: false, error: logError.message };
  }

  await tryCompleteDeliveryBatch(supabase, order.batch_id, order.delivery_date);

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    from: order.status,
    to: newStatus,
    action: "mark_delivered",
  });

  await notifyDelivered(orderId);

  revalidateOrderStatusPaths(orderId);
  revalidateBatchPickupPaths();
  return { success: true };
}

export async function approveFailedDeliveryAction(
  orderId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const newStatus = "FAILED";
  const note = "Failed delivery approved by admin";

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status, batch_id, delivery_date")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery order not found." };
  }

  if (order.status !== "PENDING_FAILURE_APPROVAL") {
    return {
      success: false,
      error: `Cannot approve failed delivery from ${order.status}.`,
    };
  }

  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error approving failed delivery:", updateError);
    return { success: false, error: updateError.message };
  }

  const { error: logError } = await supabase.from("delivery_status_logs").insert({
    delivery_order_id: orderId,
    status: newStatus,
    note,
  });

  if (logError) {
    console.error("Error inserting delivery status log:", logError);
    return { success: false, error: logError.message };
  }

  await tryCompleteDeliveryBatch(supabase, order.batch_id, order.delivery_date);

  await notifyFailedDeliveryApproved(orderId);

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    from: order.status,
    to: newStatus,
    action: "approve_failed_delivery",
  });

  revalidateOrderStatusPaths(orderId);
  revalidateBatchPickupPaths();
  return { success: true };
}

export async function rejectFailedDeliveryAction(
  orderId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const newStatus = "REACHING_TO_LOCATION";
  const note = "Failed delivery request rejected by admin";

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery order not found." };
  }

  if (order.status !== "PENDING_FAILURE_APPROVAL") {
    return {
      success: false,
      error: `Cannot reject failed delivery from ${order.status}.`,
    };
  }

  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error rejecting failed delivery:", updateError);
    return { success: false, error: updateError.message };
  }

  const { error: logError } = await supabase.from("delivery_status_logs").insert({
    delivery_order_id: orderId,
    status: newStatus,
    note,
  });

  if (logError) {
    console.error("Error inserting delivery status log:", logError);
    return { success: false, error: logError.message };
  }

  await notifyFailedDeliveryRejected(orderId);

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    from: order.status,
    to: newStatus,
    action: "reject_failed_delivery",
  });

  revalidateOrderStatusPaths(orderId);
  return { success: true };
}

export async function updateAdminOrderStatusAction(orderId: string) {
  const supabase = createAdminClient();

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery order not found." };
  }

  const transition = getAdminNextStatusTransition(order.status);
  if (!transition) {
    return {
      success: false,
      error: `Cannot update status from ${order.status}.`,
    };
  }

  if (transition.next === "REACHING_TO_LOCATION") {
    return markAdminOrderOnTheWayAction(orderId);
  }

  return markAdminOrderDeliveredAction(orderId);
}

export async function markAdminBatchPickedUpAction(
  batchId: string,
  deliveryDate: string,
) {
  const supabase = createAdminClient();

  if (!batchId || batchId === "UNBATCHED") {
    return { success: false, error: "Invalid batch." };
  }

  const { data: batch, error: batchError } = await supabase
    .from("delivery_batches")
    .select("id, status, assigned_rider_id")
    .eq("id", batchId)
    .maybeSingle();

  if (batchError) {
    console.error("Error fetching delivery batch:", batchError);
    return { success: false, error: batchError.message };
  }

  if (!batch) {
    return { success: false, error: "Batch not found." };
  }

  if (batch.status !== "PENDING") {
    return { success: false, error: "Batch has already been picked up." };
  }

  const { data: ordersToUpdate, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id")
    .eq("batch_id", batchId)
    .eq("delivery_date", deliveryDate)
    .in("status", [...PRE_PICKUP_ORDER_STATUSES]);

  if (fetchError) {
    console.error("Error fetching batch orders:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!ordersToUpdate?.length) {
    return { success: false, error: "No orders eligible for batch pickup." };
  }

  const { error: updateError } = await supabase
    .from("delivery_orders")
    .update({
      status: "OUT_FOR_DELIVERY",
      pickup_marked_at: new Date().toISOString(),
    })
    .eq("batch_id", batchId)
    .eq("delivery_date", deliveryDate)
    .in("status", [...PRE_PICKUP_ORDER_STATUSES]);

  if (updateError) {
    console.error("Error updating batch orders:", updateError);
    return { success: false, error: updateError.message };
  }

  const logs = ordersToUpdate.map((order) => ({
    delivery_order_id: order.id,
    status: "OUT_FOR_DELIVERY",
    note: "Batch picked up from central kitchen",
  }));

  const { error: logError } = await supabase
    .from("delivery_status_logs")
    .insert(logs);

  if (logError) {
    console.error("Error inserting batch pickup logs:", logError);
    return { success: false, error: logError.message };
  }

  await supabase
    .from("delivery_batches")
    .update({ status: "IN_TRANSIT" })
    .eq("id", batchId)
    .eq("status", "PENDING");

  await logAdminAction("UPDATE", "delivery_batch", batchId, {
    action: "batch_pickup",
    delivery_date: deliveryDate,
    orders_updated: ordersToUpdate.length,
  });

  if (batch.assigned_rider_id) {
    await notifyOutForDeliveryForBatch(
      batch.assigned_rider_id,
      ordersToUpdate.map((order) => order.id),
    );
  }

  revalidateBatchPickupPaths();

  return { success: true, ordersUpdated: ordersToUpdate.length };
}

