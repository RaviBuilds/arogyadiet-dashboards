"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import {
  getAdminNextStatusTransition,
  PRE_PICKUP_ORDER_STATUSES,
} from "@/lib/delivery/adminOrderStatusTransitions";
import { revalidatePath } from "next/cache";

type ActionResult = { success: true } | { success: false; error: string };

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

export async function revalidateOperationsPage() {
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

  await logAdminAction("UPDATE", "delivery_order", orderId, {
    from: order.status,
    to: newStatus,
    action: "mark_delivered",
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
    .select("id, status")
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

  revalidateBatchPickupPaths();

  return { success: true, ordersUpdated: ordersToUpdate.length };
}
