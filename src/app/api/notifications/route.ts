import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

// [Req 12.1, 12.4] Identity resolution — down to at most 2 sequential
// round-trips (auth.getUser() + users lookup) using a single SSR client,
// instead of the prior auth.getUser() (SSR client) followed by a SEPARATE
// createAdminClient() instantiation + query. The `users` table's existing
// RLS policy ("Allow authenticated to read users" — SELECT true) already
// permits this lookup via the SSR client, so the admin client was never
// required here.
//
// [Middleware Identity_Header note — Req 9/12 Open Question, resolved as
// option (a) in src/middleware.ts] `/api` routes never reach the
// Identity_Header-setting logic in middleware because of its early return
// for `/api` paths — narrowing that early return would widen its blast
// radius to every /api route (webhooks, cron, admin APIs). This route
// therefore always uses its own `auth.getUser()` resolution rather than
// depending on an Identity_Header that will never be present.
async function resolveAuthenticatedUserId(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
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
    return { supabase, userId: null, unauthenticated: true };
  }

  if (!user) {
    return { supabase, userId: null, unauthenticated: true };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "/api/notifications profile lookup error:",
      formatDbError(profileError),
    );
    return { supabase, userId: null, unauthenticated: false };
  }

  if (!profile?.id) {
    console.warn(
      "/api/notifications: authenticated session but no users row for auth_user_id",
      user.id,
    );
  }

  return { supabase, userId: profile?.id ?? null, unauthenticated: false };
}

export async function GET() {
  try {
    const { supabase, userId, unauthenticated } =
      await resolveAuthenticatedUserId();

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

    // [Req 12.1, 12.4] Reuse the SSR client from identity resolution instead
    // of instantiating a separate admin (service-role) client — the
    // existing "Users can view own notifications" RLS policy already
    // permits this self-scoped read.
    const { data, error } = await supabase
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
    const { supabase, userId, unauthenticated } =
      await resolveAuthenticatedUserId();

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

    // [Req 12.1, 12.4] Reuse the SSR client — the existing "Users can update
    // own notifications" RLS policy already permits this self-scoped update.
    const { error } = await supabase
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
