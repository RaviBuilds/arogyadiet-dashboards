"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";

export async function getAdminUsers() {
  const supabaseAdmin = createAdminClient();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, auth_user_id, full_name, email, mobile, is_active, created_at, roles(code)")
    .eq("roles.code", "ADMIN")
    .not("roles", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAdminUsers error:", error);
    return [];
  }

  // Filter to only ADMIN role users (the join filter above may not fully work with all Supabase versions)
  return (data || []).filter((u: any) => {
    const roleCode = Array.isArray(u.roles) ? u.roles[0]?.code : u.roles?.code;
    return roleCode === "ADMIN";
  });
}

export async function createAdminUser(formData: {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
}) {
  const supabaseAdmin = createAdminClient();

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
      });
      revalidatePath("/master/user-management");
      return { success: true };
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
  });
  revalidatePath("/master/user-management");
  return { success: true };
}

export async function updateAdminUser(
  userId: string,
  formData: {
    fullName: string;
    mobile: string;
  },
) {
  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("users")
    .update({
      full_name: formData.fullName,
      mobile: formData.mobile || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  await logAdminAction("UPDATE", "admin_user", userId, formData);
  revalidatePath("/master/user-management");
  return { success: true };
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
