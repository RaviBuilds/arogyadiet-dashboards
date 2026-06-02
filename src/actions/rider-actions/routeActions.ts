"use server";

import { createClient } from "@/lib/supabase/server";
import { tryCompleteDeliveryBatch } from "@/lib/delivery/batchCompletion";
import { FAILED_DELIVERY_REASONS } from "@/lib/delivery/failedDeliveryReasons";
import { revalidatePath } from "next/cache";

type ActionResult = { success: true } | { success: false; error: string };

function revalidateRiderOrderPaths(orderId: string) {
  revalidatePath("/route");
  revalidatePath(`/route/${orderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/rider/route");
  revalidatePath(`/rider/route/${orderId}`);
  revalidatePath("/rider/dashboard");
  revalidatePath("/admin/operations");
}

async function getCurrentRiderProfileId() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Please login again.");
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (appUserError || !appUser) {
    throw new Error("Rider account not found.");
  }

  const { data: riderProfile, error: riderProfileError } = await supabase
    .from("rider_profiles")
    .select("id")
    .eq("user_id", appUser.id)
    .single();

  if (riderProfileError || !riderProfile) {
    throw new Error("Rider profile not found.");
  }

  return riderProfile.id as string;
}

async function updateRiderOrderStatus(
  orderId: string,
  newStatus: "REACHING_TO_LOCATION" | "DELIVERED",
  note: string,
) {
  const supabase = await createClient();
  const riderProfileId = await getCurrentRiderProfileId();
  const updatePayload =
    newStatus === "DELIVERED"
      ? { status: newStatus, delivered_at: new Date().toISOString() }
      : { status: newStatus };

  const { data: updatedOrder, error: orderError } = await supabase
    .from("delivery_orders")
    .update(updatePayload)
    .eq("id", orderId)
    .eq("assigned_rider_id", riderProfileId)
    .select("id, batch_id, delivery_date")
    .maybeSingle();

  if (orderError) throw new Error(orderError.message);
  if (!updatedOrder) throw new Error("Delivery not found for this rider.");

  const { error: logError } = await supabase
    .from("delivery_status_logs")
    .insert({
      delivery_order_id: orderId,
      status: newStatus,
      note,
    });

  if (logError) {
    console.error("Failed to insert delivery status log:", {
      orderId,
      newStatus,
      error: logError.message,
    });
  }

  if (newStatus === "DELIVERED") {
    await tryCompleteDeliveryBatch(
      supabase,
      updatedOrder.batch_id,
      updatedOrder.delivery_date,
    );
  }

  revalidateRiderOrderPaths(orderId);

  return { success: true };
}

/**
 * Generic action to update order status and create an audit log
 */
export async function updateDeliveryStatusAction(
  orderId: string,
  newStatus: string,
  note?: string,
) {
  const supabase = await createClient();

  // 1. Update the main order status
  const { error: orderError } = await supabase
    .from("delivery_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (orderError) throw new Error(orderError.message);

  // 2. Insert into the audit log for the customer timeline
  const { error: logError } = await supabase
    .from("delivery_status_logs")
    .insert({
      delivery_order_id: orderId,
      status: newStatus,
      note: note || `Status updated to ${newStatus.replace("_", " ")}`,
    });

  if (logError) throw new Error(logError.message);

  revalidatePath("/route");
  revalidatePath("/dashboard");

  return { success: true };
}

export async function markOrderOnTheWayAction(orderId: string) {
  return updateRiderOrderStatus(
    orderId,
    "REACHING_TO_LOCATION",
    "Rider is reaching to location",
  );
}

export async function markOrderDeliveredAction(orderId: string) {
  return updateRiderOrderStatus(orderId, "DELIVERED", "Meal delivered");
}

function buildFailureLogNote(reason: string, remark?: string) {
  const trimmedRemark = remark?.trim();
  if (trimmedRemark) return `${reason} — ${trimmedRemark}`;
  return reason;
}

export async function getRiderDeliveryOrderStatusAction(
  orderId: string,
): Promise<{ success: true; status: string } | { success: false; error: string }> {
  let riderProfileId: string;
  try {
    riderProfileId = await getCurrentRiderProfileId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed.";
    return { success: false, error: message };
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("delivery_orders")
    .select("status")
    .eq("id", orderId)
    .eq("assigned_rider_id", riderProfileId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching delivery order status:", error);
    return { success: false, error: error.message };
  }

  if (!order) {
    return { success: false, error: "Delivery not found for this rider." };
  }

  return { success: true, status: order.status };
}

export async function requestFailedDeliveryAction(
  orderId: string,
  reason: string,
  remark?: string,
): Promise<ActionResult> {
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: "Please select a failure reason." };
  }

  if (
    !FAILED_DELIVERY_REASONS.includes(
      trimmedReason as (typeof FAILED_DELIVERY_REASONS)[number],
    )
  ) {
    return { success: false, error: "Invalid failure reason." };
  }

  let riderProfileId: string;
  try {
    riderProfileId = await getCurrentRiderProfileId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed.";
    return { success: false, error: message };
  }

  const supabase = await createClient();
  const newStatus = "PENDING_FAILURE_APPROVAL";
  const note = buildFailureLogNote(trimmedReason, remark);

  const { data: order, error: fetchError } = await supabase
    .from("delivery_orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("assigned_rider_id", riderProfileId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching delivery order:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!order) {
    return { success: false, error: "Delivery not found for this rider." };
  }

  if (order.status !== "REACHING_TO_LOCATION") {
    return {
      success: false,
      error: `Cannot request failed delivery from ${order.status}.`,
    };
  }

  const { data: updatedOrder, error: orderError } = await supabase
    .from("delivery_orders")
    .update({ status: newStatus })
    .eq("id", orderId)
    .eq("assigned_rider_id", riderProfileId)
    .select("id")
    .maybeSingle();

  if (orderError) {
    console.error("Error requesting failed delivery:", orderError);
    return { success: false, error: orderError.message };
  }

  if (!updatedOrder) {
    return { success: false, error: "Delivery not found for this rider." };
  }

  const { error: logError } = await supabase.from("delivery_status_logs").insert({
    delivery_order_id: orderId,
    status: newStatus,
    note,
  });

  if (logError) {
    console.error("Failed to insert delivery status log:", logError);
    return { success: false, error: logError.message };
  }

  revalidateRiderOrderPaths(orderId);
  return { success: true };
}

/**
 * Batch action for kitchen pickup
 */
export async function markBatchPickedUpAction(
  riderId: string,
  deliveryDate: string,
) {
  const supabase = await createClient();

  // Fetch orders that will be updated to create logs for them
  const { data: ordersToUpdate } = await supabase
    .from("delivery_orders")
    .select("id")
    .eq("assigned_rider_id", riderId)
    .eq("delivery_date", deliveryDate)
    .in("status", ["ASSIGNED", "MEAL_PREPARED", "ORDER_CREATED"]);

  // 1. Update the main status
  const { error } = await supabase
    .from("delivery_orders")
    .update({
      status: "OUT_FOR_DELIVERY",
      pickup_marked_at: new Date().toISOString(),
    })
    .eq("assigned_rider_id", riderId)
    .eq("delivery_date", deliveryDate)
    .in("status", ["ASSIGNED", "MEAL_PREPARED", "ORDER_CREATED"]);

  if (error) throw new Error(error.message);

  // 2. Create status logs for all updated orders
  if (ordersToUpdate && ordersToUpdate.length > 0) {
    const logs = ordersToUpdate.map((order) => ({
      delivery_order_id: order.id,
      status: "OUT_FOR_DELIVERY",
      note: "Batch picked up from central kitchen",
    }));

    await supabase.from("delivery_status_logs").insert(logs);
  }

  await supabase
    .from("delivery_batches")
    .update({ status: "IN_TRANSIT" })
    .eq("assigned_rider_id", riderId)
    .eq("delivery_date", deliveryDate)
    .eq("status", "PENDING");

  revalidatePath("/route");
  revalidatePath("/dashboard");
  revalidatePath("/admin/riders");
  revalidatePath("/admin/operations");

  return { success: true };
}
