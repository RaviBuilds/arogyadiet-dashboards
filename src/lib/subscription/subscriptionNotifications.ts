import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

type CustomerProfileRef = {
  user_id: string | null;
  users?:
    | { full_name?: string | null }
    | { full_name?: string | null }[]
    | null;
};

/**
 * Resolves the customer's `users.id` and display name in a single round trip so
 * admin-facing notifications can name the customer the alert is about.
 */
async function resolveCustomerRef(
  customerProfileId: string,
): Promise<{ userId: string | null; customerName: string }> {
  const supabaseAdmin = createAdminClient();
  const { data } = await supabaseAdmin
    .from("customer_profiles")
    .select("user_id, users!customer_profiles_user_id_fkey(full_name)")
    .eq("id", customerProfileId)
    .maybeSingle<CustomerProfileRef>();

  const user = Array.isArray(data?.users) ? data?.users[0] : data?.users;

  return {
    userId: data?.user_id ?? null,
    customerName: user?.full_name?.trim() || "Customer",
  };
}

export async function notifySubscriptionStopped(
  customerProfileId: string,
  subscriptionId: string,
): Promise<void> {
  try {
    const { userId, customerName } =
      await resolveCustomerRef(customerProfileId);

    const customerTitle = "Subscription Stopped";
    const customerMessage =
      "Your subscription has been stopped. Contact support if you have questions.";

    if (userId) {
      await sendNotificationToUser(userId, {
        title: customerTitle,
        message: customerMessage,
        actionUrl: "/customer/dashboard",
        sendEmail: true,
        headings: { en: customerTitle },
        contents: { en: customerMessage },
        web_push_topic: `subscription-stopped-${subscriptionId}`,
        sendPush: true,
      });
    }

    const adminTitle = "Subscription Stopped";
    const adminMessage = `Subscription of customer ${customerName} has been stopped.`;

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: `/admin/subscriptions/${subscriptionId}`,
      sendEmail: false,
      headings: { en: adminTitle },
      contents: { en: adminMessage },
      web_push_topic: `subscription-stopped-admin-${subscriptionId}`,
      sendPush: true,
    });
  } catch (err) {
    console.error("notifySubscriptionStopped failed:", err);
  }
}

export async function notifySubscriptionExpired(
  customerProfileId: string,
  subscriptionId: string,
): Promise<void> {
  try {
    const { userId, customerName } =
      await resolveCustomerRef(customerProfileId);

    const customerTitle = "Subscription Expired";
    const customerMessage =
      "Your subscription plan has expired. Renew now to continue enjoying your meals!";

    if (userId) {
      await sendNotificationToUser(userId, {
        title: customerTitle,
        message: customerMessage,
        actionUrl: "/customer/dashboard",
        sendEmail: true,
        headings: { en: customerTitle },
        contents: { en: customerMessage },
        web_push_topic: `subscription-expired-${subscriptionId}`,
        sendPush: true,
      });
    }

    const adminTitle = "Subscription Expired";
    const adminMessage = `Subscription of customer ${customerName} has expired naturally.`;

    await notifyAdmins({
      title: adminTitle,
      message: adminMessage,
      actionUrl: `/admin/subscriptions/${subscriptionId}`,
      sendEmail: false,
      headings: { en: adminTitle },
      contents: { en: adminMessage },
      web_push_topic: `subscription-expired-admin-${subscriptionId}`,
      sendPush: true,
    });
  } catch (err) {
    console.error("notifySubscriptionExpired failed:", err);
  }
}
