import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPushPayload,
  notifyAdmins,
  sendNotificationToUser,
} from "@/lib/notifications";
import { getCustomerNameByUserId } from "@/lib/notifications/lookups";

export type AdminProfileSection =
  | "basic_info"
  | "dietary"
  | "medical"
  | "medical_document"
  | "address";

export async function resolveUserIdFromProfile(
  profileId: string,
): Promise<string | null> {
  const supabaseAdmin = createAdminClient();
  const { data: profile, error } = await supabaseAdmin
    .from("customer_profiles")
    .select("user_id")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !profile?.user_id) return null;
  return profile.user_id;
}

function getAdminProfileNotificationCopy(
  section: AdminProfileSection,
  options?: { isAddressEdit?: boolean; addressTag?: string; isAddressDelete?: boolean },
): { title: string; message: string } {
  switch (section) {
    case "basic_info":
      return {
        title: "Profile Updated!",
        message: "Your Profile has been updated successfully!",
      };
    case "dietary":
      return {
        title: "Profile Updated!",
        message: "Your Profile has been updated successfully!",
      };
    case "medical":
      return {
        title: "Profile Updated!",
        message: "Your Profile has been updated successfully!",
      };
    case "medical_document":
      return {
        title: "Profile Updated!",
        message: "Your Profile has been updated successfully!",
      };
    case "address":
      if (options?.isAddressDelete) {
        return {
          title: "Profile Updated!",
          message: "Your Profile has been updated successfully!",
        };
      }
      if (options?.isAddressEdit) {
        return {
          title: "Profile Updated!",
          message: "Your Profile has been updated successfully!",
        };
      }
      return {
        title: "Profile Updated!",
        message: "Your Profile has been updated successfully!",
      };
  }
}

export async function notifyAdminCustomerProfileUpdated(
  userId: string,
  section: AdminProfileSection,
  options?: {
    isAddressEdit?: boolean;
    addressTag?: string;
    isAddressDelete?: boolean;
  },
): Promise<void> {
  const { title, message } = getAdminProfileNotificationCopy(section, options);
  const customerName = await getCustomerNameByUserId(userId);

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/customer/profile",
    sendEmail: false,
    ...buildPushPayload(title, message, `admin-profile-${section}-${userId}`),
  });

  const adminTitle = "Customer profile updated!";
  const adminMessage = `Hi Admin, Customer's ${customerName} profile has been updated.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(adminTitle, adminMessage, `admin-profile-admin-${userId}`),
  });
}

export async function notifyAddressSaved(
  userId: string,
  options: { isEdit: boolean; tag?: string },
): Promise<void> {
  const title = "Profile Updated!";
  const message = "Your Profile has been updated successfully!";
  const customerName = await getCustomerNameByUserId(userId);

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/customer/profile",
    sendEmail: false,
    ...buildPushPayload(title, message, `address-saved-${userId}`),
  });

  const adminTitle = "Customer profile updated!";
  const adminMessage = `Hi Admin, Customer ${customerName} has just updated the profile.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(adminTitle, adminMessage, `address-saved-admin-${userId}`),
  });
}

export async function notifyAddressDeleted(userId: string): Promise<void> {
  const title = "Profile Updated!";
  const message = "Your Profile has been updated successfully!";
  const customerName = await getCustomerNameByUserId(userId);

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/customer/profile",
    sendEmail: false,
    ...buildPushPayload(title, message, `address-deleted-${userId}`),
  });

  const adminTitle = "Customer profile updated!";
  const adminMessage = `Hi Admin, Customer ${customerName} has just updated the profile.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(adminTitle, adminMessage, `address-deleted-admin-${userId}`),
  });
}

export async function notifyDeliveryAddressesUpdated(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const title = "Meal Planner Updated!";
  const message =
    "You have successfully updated meals planner for future dates.";
  const customerName = await getCustomerNameByUserId(userId);

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/customer/subscription/manage/planner",
    sendEmail: false,
    ...buildPushPayload(title, message, `delivery-schedule-${subscriptionId}`),
  });

  const adminTitle = "Meal Planner Updated!";
  const adminMessage = `Hi Admin, Customer ${customerName}, updated the meal planner.`;

  await notifyAdmins({
    title: adminTitle,
    message: adminMessage,
    actionUrl: "/admin/customers",
    sendEmail: false,
    ...buildPushPayload(
      adminTitle,
      adminMessage,
      `delivery-schedule-admin-${subscriptionId}`,
    ),
  });
}
