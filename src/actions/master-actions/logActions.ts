"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminActivityLogRow {
  id: string;
  admin_id: string | null;
  admin_name: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function getAdminActivityLogs(): Promise<AdminActivityLogRow[]> {
  const supabaseAdmin = createAdminClient();

  const { data: logs, error } = await supabaseAdmin
    .from("admin_activity_logs")
    .select("id, admin_id, action_type, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("getAdminActivityLogs error:", error);
    return [];
  }

  const adminIds = [
    ...new Set((logs || []).map((l) => l.admin_id).filter(Boolean)),
  ] as string[];

  let nameByAuthId = new Map<string, string>();

  if (adminIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("auth_user_id, full_name")
      .in("auth_user_id", adminIds);

    nameByAuthId = new Map(
      (users || []).map((u) => [u.auth_user_id, u.full_name || "Unknown Admin"]),
    );
  }

  return (logs || []).map((log) => ({
    id: log.id,
    admin_id: log.admin_id,
    admin_name: log.admin_id
      ? nameByAuthId.get(log.admin_id) || "Unknown Admin"
      : "System",
    action_type: log.action_type,
    entity_type: log.entity_type,
    entity_id: log.entity_id,
    details: log.details as Record<string, unknown> | null,
    created_at: log.created_at,
  }));
}
