import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

async function resolveCustomerUserId(
  customerProfileId: string,
): Promise<string | null> {
  const supabaseAdmin = createAdminClient();
  const { data: profile, error } = await supabaseAdmin
    .from("customer_profiles")
    .select("user_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error || !profile?.user_id) return null;
  return profile.user_id;
}

async function resolveRiderUserId(
  riderProfileId: string,
): Promise<string | null> {
  const supabaseAdmin = createAdminClient();
  const { data: rider, error } = await supabaseAdmin
    .from("rider_profiles")
    .select("user_id")
    .eq("id", riderProfileId)
    .maybeSingle();

  if (error || !rider?.user_id) return null;
  return rider.user_id;
}

async function resolveOrderContext(orderId: string) {
  const supabaseAdmin = createAdminClient();
  const { data: order, error } = await supabaseAdmin
    .from("delivery_orders")
    .select("id, customer_profile_id, assigned_rider_id")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) return null;
  return order;
}

export async function notifyOutForDeliveryForBatch(
  riderProfileId: string,
  orderIds: string[],
): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();

    await notifyAdmins({
      title: "Meal Out for delivery",
      message: "Rider picked the batch.",
      actionUrl: "/admin/operations",
      sendEmail: false,
    });

    const riderUserId = await resolveRiderUserId(riderProfileId);
    if (riderUserId) {
      await sendNotificationToUser(riderUserId, {
        title: "Meal Out for delivery",
        message: "Meal picked and out for delivery.",
        actionUrl: "/rider/dashboard",
        sendEmail: false,
      });
    }

    if (orderIds.length === 0) return;

    const { data: orders, error } = await supabaseAdmin
      .from("delivery_orders")
      .select("customer_profile_id")
      .in("id", orderIds);

    if (error || !orders?.length) return;

    const notifiedCustomers = new Set<string>();
    for (const order of orders) {
      if (!order.customer_profile_id) continue;
      if (notifiedCustomers.has(order.customer_profile_id)) continue;
      notifiedCustomers.add(order.customer_profile_id);

      const customerUserId = await resolveCustomerUserId(
        order.customer_profile_id,
      );
      if (customerUserId) {
        await sendNotificationToUser(customerUserId, {
          title: "Meal Out for delivery",
          message: "Your meal is picked by rider and out for delivery.",
          actionUrl: "/customer/meals",
          sendEmail: false,
        });
      }
    }
  } catch (err) {
    console.error("notifyOutForDeliveryForBatch failed:", err);
  }
}

export async function notifyReachingToLocation(orderId: string): Promise<void> {
  try {
    const order = await resolveOrderContext(orderId);
    if (!order) return;

    if (order.customer_profile_id) {
      const customerUserId = await resolveCustomerUserId(
        order.customer_profile_id,
      );
      if (customerUserId) {
        await sendNotificationToUser(customerUserId, {
          title: "Rider is approaching!",
          message: "Rider is near your location.",
          actionUrl: "/customer/meals",
          sendEmail: false,
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        await sendNotificationToUser(riderUserId, {
          title: "Marked Reaching to location.",
          message: "Marked Reaching to location.",
          actionUrl: "/rider/dashboard",
          sendEmail: false,
        });
      }
    }
  } catch (err) {
    console.error("notifyReachingToLocation failed:", err);
  }
}

export async function notifyDelivered(orderId: string): Promise<void> {
  try {
    const order = await resolveOrderContext(orderId);
    if (!order) return;

    await notifyAdmins({
      title: "Your order delivered!",
      message: "Meal has been delivered.",
      actionUrl: "/admin/operations",
      sendEmail: false,
    });

    if (order.customer_profile_id) {
      const customerUserId = await resolveCustomerUserId(
        order.customer_profile_id,
      );
      if (customerUserId) {
        await sendNotificationToUser(customerUserId, {
          title: "Your order delivered!",
          message: "Meal has been delivered.",
          actionUrl: "/customer/meals",
          sendEmail: false,
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        await sendNotificationToUser(riderUserId, {
          title: "Order delivered successfully.",
          message: "Order delivered successfully.",
          actionUrl: "/rider/dashboard",
          sendEmail: false,
        });
      }
    }
  } catch (err) {
    console.error("notifyDelivered failed:", err);
  }
}

export async function notifyBatchCompleted(batchId: string): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();
    const { data: batch, error } = await supabaseAdmin
      .from("delivery_batches")
      .select("assigned_rider_id")
      .eq("id", batchId)
      .maybeSingle();

    if (error || !batch?.assigned_rider_id) return;

    const riderUserId = await resolveRiderUserId(batch.assigned_rider_id);
    if (riderUserId) {
      await sendNotificationToUser(riderUserId, {
        title: "Batch Delivery Completed!",
        message: "You have successfully completed the batch delivery.",
        actionUrl: "/rider/dashboard",
        sendEmail: false,
      });
    }
  } catch (err) {
    console.error("notifyBatchCompleted failed:", err);
  }
}

export async function notifyRoutingAssignmentComplete(
  targetDate: string,
): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();

    await notifyAdmins({
      title: "Routing Automation Result",
      message: "Routing is completed. Batches assigned.",
      actionUrl: "/admin/operations",
      sendEmail: true,
      emailStrategy: "shared",
    });

    const { data: assignedOrders, error } = await supabaseAdmin
      .from("delivery_orders")
      .select("assigned_rider_id, customer_profile_id")
      .eq("delivery_date", targetDate)
      .eq("status", "ASSIGNED");

    if (error || !assignedOrders?.length) return;

    const riderProfileIds = new Set<string>();
    const customerProfileIds = new Set<string>();

    for (const order of assignedOrders) {
      if (order.assigned_rider_id) {
        riderProfileIds.add(order.assigned_rider_id);
      }
      if (order.customer_profile_id) {
        customerProfileIds.add(order.customer_profile_id);
      }
    }

    for (const riderProfileId of riderProfileIds) {
      const riderUserId = await resolveRiderUserId(riderProfileId);
      if (riderUserId) {
        await sendNotificationToUser(riderUserId, {
          title: "Batch Assigned!",
          message:
            "A batch has been assigned to you and is ready for pickup.",
          actionUrl: "/rider/dashboard",
          sendEmail: false,
        });
      }
    }

    for (const customerProfileId of customerProfileIds) {
      const customerUserId = await resolveCustomerUserId(customerProfileId);
      if (customerUserId) {
        await sendNotificationToUser(customerUserId, {
          title: "Meals Assigned to Rider",
          message: "Your upcoming meal has been assigned to a rider.",
          actionUrl: "/customer/meals",
          sendEmail: false,
        });
      }
    }
  } catch (err) {
    console.error("notifyRoutingAssignmentComplete failed:", err);
  }
}
