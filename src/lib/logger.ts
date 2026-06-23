"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminActionType = "CREATE" | "UPDATE" | "DELETE" | "REACTIVATE";

export async function logAdminAction(
  actionType: AdminActionType,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.warn("logAdminAction: no authenticated user");
      return;
    }

    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin.from("admin_activity_logs").insert({
      admin_id: user.id,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    });

    if (error) {
      console.error("logAdminAction insert error:", error);
    }
  } catch (err) {
    console.error("logAdminAction failed:", err);
  }
}
