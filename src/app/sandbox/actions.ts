"use server";

import { sendNotificationToUser } from "@/lib/notifications";

export async function triggerTestPush(userId: string) {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    return { error: "User ID is required" };
  }

  await sendNotificationToUser(trimmedUserId, {
    title: "Test Notification",
    message: "Matrix Complete: Your backend is fully functional! 🚀",
    headings: { en: "Test Notification" },
    contents: { en: "Matrix Complete: Your backend is fully functional! 🚀" },
    web_push_topic: "test-topic",
    sendPush: true,
  });

  return { success: true };
}
