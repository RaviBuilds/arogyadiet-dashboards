const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_NOTIFICATIONS_URL = "https://api.onesignal.com/notifications";

let missingConfigLogged = false;

function isOneSignalConfigured(): boolean {
  if (ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY) {
    return true;
  }

  if (!missingConfigLogged) {
    console.warn(
      "OneSignal push skipped: NEXT_PUBLIC_ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY is missing.",
    );
    missingConfigLogged = true;
  }

  return false;
}

export type PushPayload = {
  title: string;
  message: string;
  headings?: Record<string, string>;
  contents?: Record<string, string>;
  webPushTopic?: string;
  actionUrl?: string;
};

export async function sendPushToExternalUserIds(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!isOneSignalConfigured()) return;

  const externalIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (externalIds.length === 0) return;

  const body = {
    app_id: ONESIGNAL_APP_ID,
    headings: payload.headings ?? { en: payload.title },
    contents: payload.contents ?? { en: payload.message },
    include_aliases: { external_id: externalIds },
    target_channel: "push",
    ...(payload.webPushTopic ? { web_push_topic: payload.webPushTopic } : {}),
    ...(payload.actionUrl ? { url: `${APP_BASE_URL}${payload.actionUrl}` } : {}),
  };

  try {
    const response = await fetch(ONESIGNAL_NOTIFICATIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OneSignal API error response:", errorText);
      return;
    }

    const data = (await response.json()) as {
      id?: string;
      errors?: unknown;
    };

    if (!data?.id) {
      console.error("OneSignal push was not created:", data?.errors ?? data);
    }
  } catch (fetchError) {
    console.error("Caught fetch exception:", fetchError);
  }
}
