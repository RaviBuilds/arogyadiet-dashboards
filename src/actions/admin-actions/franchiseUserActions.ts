"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Auth Helper ───────────────────────────────────────────────────────────

async function assertCallerIsMasterAdmin(): Promise<
  { success: true } | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const rolesData: any = userRecord?.roles;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (roleCode !== "MASTER_ADMIN") {
    return { success: false, error: "Only MASTER_ADMIN can create franchise users" };
  }

  return { success: true };
}

// ─── Create Franchise Admin User ───────────────────────────────────────────

/**
 * Creates a FRANCHISE_ADMIN user and assigns them to a franchise.
 * Sets force_password_change = true so they must set their own password on first login.
 */
export async function createFranchiseAdminUser(input: {
  franchiseId: string;
  fullName: string;
  email: string;
  mobile?: string;
  password: string;
}): Promise<{ success: true; userId: string } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const { franchiseId, fullName, email, mobile, password } = input;
  const adminClient = createAdminClient();

  // Validate franchise exists
  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, name")
    .eq("id", franchiseId)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  // Check email not already in use by an ACTIVE user
  const { data: existingUser } = await adminClient
    .from("users")
    .select("id, is_active, franchise_id")
    .eq("email", email)
    .single();

  if (existingUser) {
    // If the user is deactivated (previously removed), reactivate and reassign
    if (!existingUser.is_active && !existingUser.franchise_id) {
      // Update the password in auth.users as well
      const { data: authUserRecord } = await adminClient
        .from("users")
        .select("auth_user_id")
        .eq("id", existingUser.id)
        .single();

      if (authUserRecord?.auth_user_id) {
        // Update password via Supabase Auth Admin REST API (direct fetch)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

        const passwordResetResponse = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${authUserRecord.auth_user_id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
            },
            body: JSON.stringify({ password }),
          }
        );

        if (!passwordResetResponse.ok) {
          const errData = await passwordResetResponse.json().catch(() => ({}));
          return { success: false, error: `Failed to reset password: ${errData.message || passwordResetResponse.statusText}` };
        }
      }

      const { error: reactivateError } = await adminClient
        .from("users")
        .update({
          is_active: true,
          franchise_id: franchiseId,
          full_name: fullName,
          mobile: mobile || null,
          force_password_change: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUser.id);

      if (reactivateError) {
        return { success: false, error: reactivateError.message };
      }

      // Update franchise owner
      await adminClient
        .from("franchises")
        .update({ owner_user_id: existingUser.id })
        .eq("id", franchiseId);

      revalidatePath("/franchises");
      return { success: true, userId: existingUser.id };
    }

    // Active user with this email already exists
    return { success: false, error: "An account with this email is already active in the system" };
  }

  // Create auth user in Supabase Auth
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    return { success: false, error: authError.message };
  }

  const authUserId = authData.user.id;

  // Get FRANCHISE_ADMIN role ID
  const { data: roleData } = await adminClient
    .from("roles")
    .select("id")
    .eq("code", "FRANCHISE_ADMIN")
    .single();

  if (!roleData) {
    // Cleanup: delete the auth user since we can't complete the flow
    await adminClient.auth.admin.deleteUser(authUserId);
    return { success: false, error: "FRANCHISE_ADMIN role not found in system" };
  }

  // Insert into public.users with franchise_id and force_password_change
  const { error: userInsertError } = await adminClient.from("users").insert({
    auth_user_id: authUserId,
    role_id: roleData.id,
    full_name: fullName,
    email,
    mobile: mobile || null,
    franchise_id: franchiseId,
    is_active: true,
    is_email_verified: true,
    force_password_change: true,
  });

  if (userInsertError) {
    // Cleanup auth user on failure
    await adminClient.auth.admin.deleteUser(authUserId);
    return { success: false, error: userInsertError.message };
  }

  // Update franchise owner_user_id
  const { data: createdUser } = await adminClient
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();

  if (createdUser) {
    await adminClient
      .from("franchises")
      .update({ owner_user_id: createdUser.id })
      .eq("id", franchiseId);
  }

  revalidatePath("/franchises");
  return { success: true, userId: createdUser?.id ?? authUserId };
}

/**
 * Get the franchise admin user(s) assigned to a franchise.
 */
export async function getFranchiseAdminUsers(franchiseId: string): Promise<
  { success: true; users: { id: string; full_name: string; email: string; is_active: boolean }[] }
  | { success: false; error: string }
> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("users")
    .select("id, full_name, email, is_active")
    .eq("franchise_id", franchiseId)
    .eq("is_active", true)
    .eq("role_id", (
      await adminClient.from("roles").select("id").eq("code", "FRANCHISE_ADMIN").single()
    ).data?.id ?? "")
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, users: data ?? [] };
}

/**
 * Remove (deactivate) a franchise admin user and clear the franchise owner.
 * Uses admin client (service role) so it bypasses RLS.
 */
export async function removeFranchiseAdmin(
  userId: string,
  franchiseId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  // Deactivate user and unlink from franchise
  const { error: userError } = await adminClient
    .from("users")
    .update({
      is_active: false,
      franchise_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (userError) {
    return { success: false, error: userError.message };
  }

  // Clear owner_user_id from franchise
  await adminClient
    .from("franchises")
    .update({ owner_user_id: null })
    .eq("id", franchiseId);

  revalidatePath("/franchises");
  return { success: true };
}

/**
 * Update a franchise admin user's details (name, mobile).
 * Uses admin client (service role) so it bypasses RLS.
 */
export async function updateFranchiseAdmin(
  userId: string,
  data: { fullName: string; mobile: string | null }
): Promise<{ success: true } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("users")
    .update({
      full_name: data.fullName,
      mobile: data.mobile,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/franchises");
  return { success: true };
}
