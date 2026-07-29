import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToExternalUserIds } from "@/lib/onesignal/server";
import {
  resolveAccessLevel,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";
import { Resend } from "resend";

// Constructed on first send rather than at import time: the Resend constructor
// throws when RESEND_API_KEY is absent, which would take down every module that
// transitively imports this one (client component graphs and tests included).
let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (resendClient) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Resend is not configured — skipping notification email.");
    return null;
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "ArogyaDiet <noreply@arogyadiet.com>";
const SHARED_ADMIN_INBOX_FALLBACK = "arogya664@gmail.com";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

async function getSharedAdminInbox(): Promise<string> {
  try {
    const supabaseAdmin = createAdminClient();
    const { data } = await supabaseAdmin
      .from("system_settings")
      .select("shared_admin_email")
      .eq("id", "global")
      .single();
    return data?.shared_admin_email || SHARED_ADMIN_INBOX_FALLBACK;
  } catch {
    return SHARED_ADMIN_INBOX_FALLBACK;
  }
}

export interface NotificationPayload {
  title: string;
  message: string;
  headings?: Record<string, string>;
  contents?: Record<string, string>;
  web_push_topic?: string;
  actionUrl?: string;
  type?: string;
  sendEmail?: boolean;
  sendPush?: boolean;
  emailStrategy?: "shared" | "individual";
  /** When true, notifyAdmins skips in-app inserts (email/push only). */
  skipInApp?: boolean;
  /**
   * Admin access levels that must NOT receive this alert (in-app, email and
   * push alike). Used for alerts that are irrelevant to a narrow access level —
   * e.g. add-on service requests are hidden from `inventory` (inventory-only)
   * and `dietitian` admins. Omit to notify every admin, which stays the
   * default for all existing callers.
   */
  excludeAccessLevels?: readonly AdminAccessLevel[];
}

export function buildPushPayload(
  title: string,
  message: string,
  topic: string,
): Pick<
  NotificationPayload,
  "headings" | "contents" | "web_push_topic" | "sendPush"
> {
  return {
    headings: { en: title },
    contents: { en: message },
    web_push_topic: topic,
    sendPush: true,
  };
}

const ADMIN_ROLE_CODES = ["ADMIN", "MASTER_ADMIN", "SUPER_ADMIN"] as const;
const DEFAULT_NOTIFICATION_TYPE = "SYSTEM";

type NotificationRow = {
  user_id: string;
  title: string;
  message: string;
  action_url: string | null;
  type: string;
};

type AdminUser = {
  id: string;
  email: string | null;
  admin_access_level?: string | null;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildNotificationEmailHtml(payload: NotificationPayload): string {
  const link = payload.actionUrl
    ? `<p><a href="${APP_BASE_URL}${payload.actionUrl}">Click here to view</a></p>`
    : "";
  return `<div><h2>${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.message)}</p>${link}</div>`;
}

async function sendNotificationEmail(
  to: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) return;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: payload.title,
      html: buildNotificationEmailHtml(payload),
    });
    if (error) {
      console.error("notifyAdmins email error:", error);
    }
  } catch (err) {
    console.error("notifyAdmins email failed:", err);
  }
}

async function sendAdminEmails(
  payload: NotificationPayload,
  adminUsers: AdminUser[],
): Promise<void> {
  try {
    const strategy = payload.emailStrategy ?? "shared";

    if (strategy === "shared") {
      const sharedInbox = await getSharedAdminInbox();
      await sendNotificationEmail(sharedInbox, payload);
      return;
    }

    const recipients = adminUsers
      .map((user) => user.email?.trim())
      .filter((email): email is string => Boolean(email));

    await Promise.all(
      recipients.map((to) => sendNotificationEmail(to, payload)),
    );
  } catch (err) {
    console.error("sendAdminEmails failed:", err);
  }
}

async function sendUserNotificationEmail(
  userId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("sendUserNotificationEmail lookup error:", error);
      return;
    }

    const email = user?.email?.trim();
    if (!email) return;

    await sendNotificationEmail(email, payload);
  } catch (err) {
    console.error("sendUserNotificationEmail failed:", err);
  }
}

function toNotificationRow(
  userId: string,
  payload: NotificationPayload,
): NotificationRow {
  return {
    user_id: userId,
    title: payload.title,
    message: payload.message,
    action_url: payload.actionUrl ?? null,
    type: payload.type ?? DEFAULT_NOTIFICATION_TYPE,
  };
}

async function sendPushNotifications(
  userIds: string[],
  payload: NotificationPayload,
): Promise<void> {
  await sendPushToExternalUserIds(userIds, {
    title: payload.title,
    message: payload.message,
    headings: payload.headings,
    contents: payload.contents,
    webPushTopic: payload.web_push_topic,
    actionUrl: payload.actionUrl,
  });
}

export async function sendNotificationToUser(
  userId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin
      .from("notifications")
      .insert(toNotificationRow(userId, payload));

    if (error) {
      console.error("sendNotificationToUser insert error:", error);
    }

    if (payload.sendEmail) {
      void sendUserNotificationEmail(userId, payload);
    }

    if (payload.sendPush) {
      void sendPushNotifications([userId], payload);
    }
  } catch (err) {
    console.error("sendNotificationToUser failed:", err);
  }
}

export async function notifyAdmins(payload: NotificationPayload): Promise<void> {
  try {
    const supabaseAdmin = createAdminClient();

    const { data: adminRoles, error: rolesError } = await supabaseAdmin
      .from("roles")
      .select("id")
      .in("code", [...ADMIN_ROLE_CODES]);

    if (rolesError) {
      console.error("notifyAdmins roles query error:", rolesError);
      return;
    }

    const roleIds = adminRoles?.map((role) => role.id) ?? [];
    if (roleIds.length === 0) {
      console.error("notifyAdmins: no admin roles found");
      return;
    }

    const { data: adminUsers, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id, email, admin_access_level")
      .in("role_id", roleIds);

    if (usersError) {
      console.error("notifyAdmins users query error:", usersError);
      return;
    }

    const excluded = payload.excludeAccessLevels ?? [];
    const admins = ((adminUsers ?? []) as AdminUser[]).filter(
      (admin) =>
        excluded.length === 0 ||
        !excluded.includes(resolveAccessLevel(admin.admin_access_level)),
    );
    if (admins.length === 0) {
      return;
    }

    if (!payload.skipInApp) {
      const { error: insertError } = await supabaseAdmin
        .from("notifications")
        .insert(admins.map((admin) => toNotificationRow(admin.id, payload)));

      if (insertError) {
        console.error("notifyAdmins insert error:", insertError);
      }
    }

    if (payload.sendEmail && admins.length > 0) {
      void sendAdminEmails(payload, admins);
    }

    if (payload.sendPush && admins.length > 0) {
      void sendPushNotifications(
        admins.map((admin) => admin.id),
        payload,
      );
    }
  } catch (err) {
    console.error("notifyAdmins failed:", err);
  }
}
