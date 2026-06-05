import * as OneSignal from "@onesignal/node-onesignal";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

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

function getOneSignalClient(): OneSignal.DefaultApi | null {
  if (!isOneSignalConfigured()) return null;

  const configuration = OneSignal.createConfiguration({
    restApiKey: ONESIGNAL_REST_API_KEY!,
  });

  return new OneSignal.DefaultApi(configuration);
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
  try {
    const client = getOneSignalClient();
    if (!client) return;

    const externalIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (externalIds.length === 0) return;

    const notification = new OneSignal.Notification();
    notification.app_id = ONESIGNAL_APP_ID!;
    notification.headings = payload.headings ?? { en: payload.title };
    notification.contents = payload.contents ?? { en: payload.message };
    notification.include_aliases = { external_id: externalIds };
    notification.target_channel = "push";

    if (payload.webPushTopic) {
      notification.web_push_topic = payload.webPushTopic;
    }

    if (payload.actionUrl) {
      notification.url = `${APP_BASE_URL}${payload.actionUrl}`;
    }

    const response = await client.createNotification(notification);

    if (!response.id) {
      console.error("OneSignal push was not created:", response.errors);
    }
  } catch (err) {
    console.error("sendPushToExternalUserIds failed:", err);
  }
}
