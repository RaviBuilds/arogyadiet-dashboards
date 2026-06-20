import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

export async function notifySubscriptionStopped(
  customerProfileId: string,
  subscriptionId: string,
): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("user_id")
      .eq("id", customerProfileId)
      .maybeSingle();

    const customerTitle = "Subscription Stopped";
    const customerMessage =
      "Your subscription has been stopped. Contact support if you have questions.";

    if (profile?.user_id) {
      await sendNotificationToUser(profile.user_id, {
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
    const adminMessage = "A customer subscription has been stopped.";

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
    const supabaseAdmin = createAdminClient();
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("user_id")
      .eq("id", customerProfileId)
      .maybeSingle();

    const customerTitle = "Subscription Expired";
    const customerMessage =
      "Your subscription plan has expired. Renew now to continue enjoying your meals!";

    if (profile?.user_id) {
      await sendNotificationToUser(profile.user_id, {
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
    const adminMessage = "A customer subscription has expired naturally.";

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
