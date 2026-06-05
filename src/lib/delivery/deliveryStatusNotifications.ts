import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPushPayload,
  notifyAdmins,
  sendNotificationToUser,
} from "@/lib/notifications";
import { getRiderNameByProfileId } from "@/lib/notifications/lookups";

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
    const riderName = await getRiderNameByProfileId(riderProfileId);
    const adminTitle = "Meal Out for delivery";
    const adminMessage = `Hi admin, Rider ${riderName} picked the batch.`;

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: "/admin/operations",
      sendEmail: false,
      ...buildPushPayload(
        adminTitle,
        adminMessage,
        `out-for-delivery-admin-${riderProfileId}`,
      ),
    });

    const riderUserId = await resolveRiderUserId(riderProfileId);
    if (riderUserId) {
      const riderTitle = "Meal Out for delivery";
      const riderMessage = "Meal picked and out for delivery.";
      await sendNotificationToUser(riderUserId, {
        title: riderTitle,
        message: riderMessage,
        actionUrl: "/rider/dashboard",
        sendEmail: false,
        ...buildPushPayload(
          riderTitle,
          riderMessage,
          `out-for-delivery-rider-${riderProfileId}`,
        ),
      });
    }

    if (orderIds.length === 0) return;

    const supabaseAdmin = createAdminClient();
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
        const title = "Meal Out for delivery";
        const message = "Your meal is picked by rider and out for delivery.";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `out-for-delivery-${order.customer_profile_id}`,
          ),
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
        const title = "Rider is approaching!";
        const message =
          "Rider is near to your location and reaching in a while.";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(title, message, `reaching-${orderId}`),
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        const title = "Marked Reaching to location";
        const message = "Marked Reaching to location.";
        await sendNotificationToUser(riderUserId, {
          title,
          message,
          actionUrl: "/rider/dashboard",
          sendEmail: false,
          ...buildPushPayload(title, message, `reaching-rider-${orderId}`),
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
        const title = "Your order delivered!";
        const message = "Your meal has been delivered!";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(title, message, `delivered-${orderId}`),
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        const title = "Your order delivered!";
        const message = "Your meal has been delivered!";
        await sendNotificationToUser(riderUserId, {
          title,
          message,
          actionUrl: "/rider/dashboard",
          sendEmail: false,
          ...buildPushPayload(title, message, `delivered-rider-${orderId}`),
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
      const title = "Batch Delivery Completed!";
      const message = "You have successfully completed the batch delivery!";
      await sendNotificationToUser(riderUserId, {
        title,
        message,
        actionUrl: "/rider/dashboard",
        sendEmail: false,
        ...buildPushPayload(title, message, `batch-completed-${batchId}`),
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

    const adminTitle = "Routing Automation Result";
    const adminMessage =
      "Hi Admin, Routing is completed, below mentioned is the result.";

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: "/admin/operations",
      sendEmail: true,
      emailStrategy: "shared",
      ...buildPushPayload(adminTitle, adminMessage, `routing-admin-${targetDate}`),
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
        const title = "Batch Assigned!";
        const message =
          "Batch has been assigned for you and ready to pickup.";
        await sendNotificationToUser(riderUserId, {
          title,
          message,
          actionUrl: "/rider/dashboard",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `batch-assigned-${riderProfileId}-${targetDate}`,
          ),
        });
      }
    }

    for (const customerProfileId of customerProfileIds) {
      const customerUserId = await resolveCustomerUserId(customerProfileId);
      if (customerUserId) {
        const title = "Meals Assigned to Rider";
        const message = "Your upcoming meal has been assigned to rider.";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `meals-assigned-${customerProfileId}-${targetDate}`,
          ),
        });
      }
    }
  } catch (err) {
    console.error("notifyRoutingAssignmentComplete failed:", err);
  }
}

export async function notifyFailedDeliveryApproved(
  orderId: string,
): Promise<void> {
  try {
    const order = await resolveOrderContext(orderId);
    if (!order) return;

    if (order.customer_profile_id) {
      const customerUserId = await resolveCustomerUserId(
        order.customer_profile_id,
      );
      if (customerUserId) {
        const title = "Delivery Could Not Be Completed";
        const message =
          "Your delivery could not be completed today. Our team will follow up.";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(title, message, `failed-delivery-approved-${orderId}`),
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        const title = "Failed Delivery Approved!";
        const message = "Failed delivery has been approved by the admin.";
        await sendNotificationToUser(riderUserId, {
          title,
          message,
          actionUrl: "/rider/dashboard",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `failed-delivery-approved-rider-${orderId}`,
          ),
        });
      }
    }
  } catch (err) {
    console.error("notifyFailedDeliveryApproved failed:", err);
  }
}

export async function notifyFailedDeliveryRejected(
  orderId: string,
): Promise<void> {
  try {
    const order = await resolveOrderContext(orderId);
    if (!order) return;

    if (order.customer_profile_id) {
      const customerUserId = await resolveCustomerUserId(
        order.customer_profile_id,
      );
      if (customerUserId) {
        const title = "Delivery Back On Track";
        const message = "Your delivery is continuing. The rider is on the way.";
        await sendNotificationToUser(customerUserId, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(title, message, `failed-delivery-rejected-${orderId}`),
        });
      }
    }

    if (order.assigned_rider_id) {
      const riderUserId = await resolveRiderUserId(order.assigned_rider_id);
      if (riderUserId) {
        const title = "Failed Delivery Rejected!";
        const message = "Failed delivery has been rejected by the admin.";
        await sendNotificationToUser(riderUserId, {
          title,
          message,
          actionUrl: "/rider/dashboard",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `failed-delivery-rejected-rider-${orderId}`,
          ),
        });
      }
    }
  } catch (err) {
    console.error("notifyFailedDeliveryRejected failed:", err);
  }
}
