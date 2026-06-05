import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPushPayload,
  sendNotificationToUser,
} from "@/lib/notifications";

export async function notifyCustomersMealsOrderCreated(
  customerProfileIds: string[],
  targetDate: string,
): Promise<void> {
  if (customerProfileIds.length === 0) return;

  const supabaseAdmin = createAdminClient();
  const uniqueProfileIds = [...new Set(customerProfileIds)];

  const { data: profiles, error } = await supabaseAdmin
    .from("customer_profiles")
    .select("id, user_id")
    .in("id", uniqueProfileIds);

  if (error || !profiles?.length) return;

  const title = "Meals Order Created for tomorrow!";
  const message = "Your meals order has been created for tomorrow.";

  await Promise.all(
    profiles
      .filter((profile) => profile.user_id)
      .map((profile) =>
        sendNotificationToUser(profile.user_id!, {
          title,
          message,
          actionUrl: "/customer/meals",
          sendEmail: false,
          ...buildPushPayload(
            title,
            message,
            `meals-order-created-${profile.id}-${targetDate}`,
          ),
        }),
      ),
  );
}
