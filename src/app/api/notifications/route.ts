import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const NOTIFICATION_SELECT =
  "id, user_id, title, message, action_url, is_read, created_at, type";

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
  type?: string;
};

function formatDbError(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}): string {
  return [error.message, error.code, error.details, error.hint]
    .filter(Boolean)
    .join(" | ");
}

async function resolveAuthenticatedUserId(): Promise<{
  userId: string | null;
  unauthenticated: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error(
      "/api/notifications auth error:",
      formatDbError(authError),
    );
    return { userId: null, unauthenticated: true };
  }

  if (!user) {
    return { userId: null, unauthenticated: true };
  }

  const supabaseAdmin = createAdminClient();
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "/api/notifications profile lookup error:",
      formatDbError(profileError),
    );
    return { userId: null, unauthenticated: false };
  }

  if (!profile?.id) {
    console.warn(
      "/api/notifications: authenticated session but no users row for auth_user_id",
      user.id,
    );
  }

  return { userId: profile?.id ?? null, unauthenticated: false };
}

export async function GET() {
  try {
    const { userId, unauthenticated } = await resolveAuthenticatedUserId();

    if (unauthenticated) {
      return NextResponse.json({
        notifications: [] as NotificationRow[],
        unreadCount: 0,
      });
    }

    if (!userId) {
      console.warn("GET /api/notifications: no internal user id resolved");
      return NextResponse.json({
        notifications: [] as NotificationRow[],
        unreadCount: 0,
      });
    }

    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select(NOTIFICATION_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error(
        "GET /api/notifications query error:",
        formatDbError(error),
      );
      return NextResponse.json(
        { error: error.message || "Failed to load notifications" },
        { status: 500 },
      );
    }

    const notifications = (data ?? []) as NotificationRow[];
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    if (notifications.length === 0) {
      console.info(
        `GET /api/notifications: user ${userId} has no notification rows`,
      );
    }

    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected server error";
    console.error("GET /api/notifications failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, unauthenticated } = await resolveAuthenticatedUserId();

    if (unauthenticated || !userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await request.json()) as { id?: string };
    const notificationId = body.id?.trim();

    if (!notificationId) {
      return NextResponse.json(
        { error: "Notification id is required" },
        { status: 400 },
      );
    }

    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "PATCH /api/notifications error:",
        formatDbError(error),
      );
      return NextResponse.json(
        { error: error.message || "Failed to mark notification as read" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected server error";
    console.error("PATCH /api/notifications failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
