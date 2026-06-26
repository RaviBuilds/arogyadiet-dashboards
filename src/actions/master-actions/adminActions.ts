"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { sendNotificationToUser } from "@/lib/notifications";
import {
  ADMIN_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  resolveAccessLevel,
  landingRouteFor,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";

/** Zod schema rejecting any value outside the permitted access-level set. */
const accessLevelSchema = z.enum(ADMIN_ACCESS_LEVELS);

export async function getAdminUsers() {
  const supabaseAdmin = createAdminClient();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select(
      "id, auth_user_id, full_name, email, mobile, is_active, created_at, admin_access_level, roles(code)",
    )
    .eq("roles.code", "ADMIN")
    .not("roles", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAdminUsers error:", error);
    return [];
  }

  // Filter to only ADMIN role users (the join filter above may not fully work with all Supabase versions)
  return (data || []).filter((u) => {
    const roles = u.roles as
      | { code: string }[]
      | { code: string }
      | null
      | undefined;
    const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;
    return roleCode === "ADMIN";
  });
}

export async function createAdminUser(formData: {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  accessLevel?: string;
}) {
  const supabaseAdmin = createAdminClient();

  // Validate the access level: reject invalid values; default to full access
  // when omitted (Req 9.3/9.4/9.5).
  let accessLevel: AdminAccessLevel = "inventory_operations";
  if (formData.accessLevel !== undefined) {
    const parsed = accessLevelSchema.safeParse(formData.accessLevel);
    if (!parsed.success) {
      return { success: false, error: "Invalid access level." };
    }
    accessLevel = parsed.data;
  }

  // Check for existing email
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id, is_active")
    .eq("email", formData.email)
    .single();

  if (existing) {
    // If user is deactivated, reactivate them with ADMIN role
    if (!existing.is_active) {
      const { data: roleData } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("code", "ADMIN")
        .single();

      if (!roleData) {
        return { success: false, error: "System configuration error: ADMIN role not found." };
      }

      const { error: reactivateError } = await supabaseAdmin
        .from("users")
        .update({
          is_active: true,
          role_id: roleData.id,
          full_name: formData.fullName,
          mobile: formData.mobile || null,
          admin_access_level: accessLevel,
          force_password_change: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (reactivateError) {
        return { success: false, error: reactivateError.message };
      }

      await logAdminAction("REACTIVATE", "admin_user", existing.id, {
        email: formData.email,
        full_name: formData.fullName,
        admin_access_level: accessLevel,
      });
      revalidatePath("/master/user-management");
      return { success: true, accessLevel };
    }

    return { success: false, error: "An account with this email is already active." };
  }

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: formData.email,
    password: formData.password,
    email_confirm: true,
    user_metadata: { full_name: formData.fullName },
  });

  if (authError) return { success: false, error: authError.message };

  const authUserId = authData.user.id;

  // Get ADMIN role id
  const { data: roleData } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("code", "ADMIN")
    .single();

  if (!roleData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "System configuration error: ADMIN role not found." };
  }

  // Insert into public.users
  const { error: userError } = await supabaseAdmin.from("users").insert({
    auth_user_id: authUserId,
    role_id: roleData.id,
    full_name: formData.fullName,
    email: formData.email,
    mobile: formData.mobile || null,
    admin_access_level: accessLevel,
    is_active: true,
    is_email_verified: true,
  });

  if (userError) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: userError.message };
  }

  const { data: createdUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();

  await logAdminAction("CREATE", "admin_user", createdUser?.id ?? authUserId, {
    email: formData.email,
    full_name: formData.fullName,
    admin_access_level: accessLevel,
  });
  revalidatePath("/master/user-management");
  return { success: true, accessLevel };
}

export async function updateAdminUser(
  userId: string,
  formData: {
    fullName: string;
    mobile: string;
    accessLevel?: string;
  },
) {
  const supabaseAdmin = createAdminClient();

  // Resolve the target admin and its current level before mutating.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("id, admin_access_level")
    .eq("id", userId)
    .single();

  if (fetchError || !current) {
    return { success: false, error: "Admin user not found." };
  }

  const prevLevel = resolveAccessLevel(current.admin_access_level);

  // Reject an invalid submitted level (leave stored value unchanged). When the
  // level is omitted from the submission, keep the existing level (no change).
  let nextLevel: AdminAccessLevel = prevLevel;
  if (formData.accessLevel !== undefined) {
    const parsed = accessLevelSchema.safeParse(formData.accessLevel);
    if (!parsed.success) {
      return { success: false, error: "Invalid access level." };
    }
    nextLevel = parsed.data;
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update({
      full_name: formData.fullName,
      mobile: formData.mobile || null,
      admin_access_level: nextLevel,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // On persist failure, the stored level is unchanged and no notification fires.
  if (error) return { success: false, error: error.message };

  // Send exactly one access-level-changed notification only when it changed.
  // sendNotificationToUser swallows its own errors, so a notification failure
  // never reverts the persisted change (Req 11.3/11.4).
  if (prevLevel !== nextLevel) {
    await sendNotificationToUser(userId, {
      title: "Access level updated",
      message: `Your admin access level has been updated to ${ACCESS_LEVEL_LABELS[nextLevel]}.`,
      actionUrl: landingRouteFor(nextLevel),
      type: "ADMIN_ACCESS_LEVEL_CHANGED",
    });
  }

  await logAdminAction("UPDATE", "admin_user", userId, {
    full_name: formData.fullName,
    mobile: formData.mobile,
    admin_access_level: nextLevel,
  });
  revalidatePath("/master/user-management");
  return { success: true, accessLevel: nextLevel };
}

export async function deleteAdminUser(userId: string) {
  const supabaseAdmin = createAdminClient();

  // Get auth_user_id before deleting
  const { data: userData, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("auth_user_id")
    .eq("id", userId)
    .single();

  if (fetchError || !userData) {
    return { success: false, error: "Admin user not found." };
  }

  // Delete from public.users first
  const { error: userError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", userId);

  if (userError) return { success: false, error: userError.message };

  // Delete auth user
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
    userData.auth_user_id,
  );

  if (authError) return { success: false, error: authError.message };

  await logAdminAction("DELETE", "admin_user", userId, {});
  revalidatePath("/master/user-management");
  return { success: true };
}

export async function toggleAdminActive(userId: string, currentlyActive: boolean) {
  const supabaseAdmin = createAdminClient();

  const newActive = !currentlyActive;

  // Get auth_user_id
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("auth_user_id")
    .eq("id", userId)
    .single();

  if (!userData) return { success: false, error: "Admin user not found." };

  // Update is_active in public.users
  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ is_active: newActive, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (userError) return { success: false, error: userError.message };

  // Ban / unban in Supabase Auth
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
    userData.auth_user_id,
    { ban_duration: newActive ? "none" : "876600h" },
  );

  if (authError) return { success: false, error: authError.message };

  await logAdminAction("UPDATE", "admin_user", userId, { is_active: newActive });
  revalidatePath("/master/user-management");
  return { success: true };
}
