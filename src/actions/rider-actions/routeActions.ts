"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
    .select("id")
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

  revalidatePath("/route");
  revalidatePath(`/route/${orderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/rider/route");
  revalidatePath(`/rider/route/${orderId}`);
  revalidatePath("/rider/dashboard");

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

  revalidatePath("/route");
  revalidatePath("/dashboard");

  return { success: true };
}
