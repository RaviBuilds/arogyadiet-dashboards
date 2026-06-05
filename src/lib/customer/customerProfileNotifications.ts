import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

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
