import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

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
        message: "Your personal details were updated by an administrator.",
      };
    case "dietary":
      return {
        title: "Diet Preferences Updated!",
        message:
          "Your allergies and diet preferences were updated by an administrator.",
      };
    case "medical":
      return {
        title: "Medical Profile Updated!",
        message: "Your medical information was updated by an administrator.",
      };
    case "medical_document":
      return {
        title: "Medical Document Updated!",
        message:
          "A medical document on your profile was updated by an administrator.",
      };
    case "address":
      if (options?.isAddressDelete) {
        return {
          title: "Delivery address removed",
          message:
            "A delivery address was removed from your profile by an administrator.",
        };
      }
      if (options?.isAddressEdit) {
        return {
          title: "Delivery address updated",
          message: `Your delivery address${options.addressTag ? ` (${options.addressTag})` : ""} was updated by an administrator.`,
        };
      }
      return {
        title: "Delivery address saved",
        message: `A new delivery address${options?.addressTag ? ` (${options.addressTag})` : ""} was added to your profile by an administrator.`,
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

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/profile",
    sendEmail: false,
    headings: { en: title },
    contents: { en: message },
    web_push_topic: `admin-profile-${section}-${userId}`,
    sendPush: true,
  });

  await notifyAdmins({
    title: "Customer profile updated (admin)",
    message: `You updated a customer's ${section.replace("_", " ")}.`,
    actionUrl: "/admin/customers",
    sendEmail: false,
  });
}

export async function notifyAddressSaved(
  userId: string,
  options: { isEdit: boolean; tag?: string },
): Promise<void> {
  const title = options.isEdit ? "Delivery address updated" : "Delivery address saved";
  const message = options.isEdit
    ? `Your delivery address${options.tag ? ` (${options.tag})` : ""} has been updated.`
    : `Your new delivery address${options.tag ? ` (${options.tag})` : ""} has been saved.`;

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/profile",
    sendEmail: false,
    headings: { en: title },
    contents: { en: message },
    web_push_topic: `address-saved-${userId}`,
    sendPush: true,
  });

  await notifyAdmins({
    title: "Customer address updated",
    message: "A customer updated a delivery address.",
    actionUrl: "/admin/customers",
    sendEmail: false,
  });
}

export async function notifyAddressDeleted(userId: string): Promise<void> {
  const title = "Delivery address removed";
  const message = "A delivery address has been removed from your profile.";

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/profile",
    sendEmail: false,
    headings: { en: title },
    contents: { en: message },
    web_push_topic: `address-deleted-${userId}`,
    sendPush: true,
  });

  await notifyAdmins({
    title: "Customer address removed",
    message: "A customer removed a delivery address.",
    actionUrl: "/admin/customers",
    sendEmail: false,
  });
}

export async function notifyDeliveryAddressesUpdated(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const title = "Delivery schedule updated";
  const message = "Your upcoming delivery addresses have been updated.";

  await sendNotificationToUser(userId, {
    title,
    message,
    actionUrl: "/subscription/manage/address",
    sendEmail: false,
    headings: { en: title },
    contents: { en: message },
    web_push_topic: `delivery-schedule-${subscriptionId}`,
    sendPush: true,
  });

  await notifyAdmins({
    title: "Customer delivery schedule updated",
    message: "A customer updated delivery addresses on their meal schedule.",
    actionUrl: "/admin/customers",
    sendEmail: false,
  });
}
