"use server";

// src/actions/master-actions/franchiseAdminActions.ts
// Master-portal Server Actions for managing FRANCHISE_ADMIN owner accounts that
// back the Master Hierarchy "Add Franchise" flow (multi-tenant-franchise).
//
// WHY A FRANCHISE-LESS VARIANT: the new create flow requires the owner to EXIST
// BEFORE the franchise is created (createFranchise stamps the chosen owner's
// users.franchise_id). The existing admin-actions/createFranchiseAdminUser
// REQUIRES a franchiseId up-front and sets that franchise's owner, which does
// not fit. This module reuses its auth-user-creation PATTERN
// (createAdminClient().auth.admin.createUser + insert into public.users with the
// FRANCHISE_ADMIN role id) but persists franchise_id = NULL, leaving the owner
// "unassigned" until createFranchise stamps them.
//
// LAYERING: Action layer only. MASTER_ADMIN-only (mirrors the auth check in
// admin-actions/franchiseUserActions.ts) and gated by FRANCHISE_FEATURES_ENABLED.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import type { ActionResult } from "@/types/franchise";

const FRANCHISE_ADMIN_ROLE_CODE = "FRANCHISE_ADMIN";

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Gate every action behind the franchise feature flag and a MASTER_ADMIN
 * caller. Returns `null` when authorized, or an `ActionResult` failure
 * otherwise. Mirrors the auth check used across the franchise master/admin
 * actions (role code resolved from the joined `roles(code)`).
 */
async function assertMasterAdmin(): Promise<
  { success: false; error: string } | null
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { success: false, error: "Franchise features are not enabled" };
  }

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

  const rolesData: unknown = (userRecord as { roles?: unknown } | null)?.roles;
  const roleCode = Array.isArray(rolesData)
    ? (rolesData[0] as { code?: string } | undefined)?.code
    : (rolesData as { code?: string } | null)?.code;

  if (roleCode !== "MASTER_ADMIN") {
    return {
      success: false,
      error: "Only a Master Admin can manage Franchise Admin accounts",
    };
  }

  return null;
}

// ─── List FRANCHISE_ADMIN users ──────────────────────────────────────────────

/**
 * List every active FRANCHISE_ADMIN user, newest first. `franchise_id` is
 * included so the owner picker can flag (and the UI can label) admins who
 * already own a franchise. Uses the admin (service-role) client so the read is
 * not constrained by RLS.
 */
export async function listFranchiseAdmins(): Promise<
  ActionResult<
    { id: string; full_name: string; email: string; franchise_id: string | null }[]
  >
> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const admin = createAdminClient();

  // Resolve the FRANCHISE_ADMIN role id once.
  const { data: roleData, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("code", FRANCHISE_ADMIN_ROLE_CODE)
    .single();

  if (roleError || !roleData) {
    return { success: false, error: "FRANCHISE_ADMIN role not found in system" };
  }

  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email, franchise_id")
    .eq("role_id", roleData.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  const admins = (data ?? []).map((row) => ({
    id: row.id as string,
    full_name: (row.full_name as string | null) ?? "",
    email: (row.email as string | null) ?? "",
    franchise_id: (row.franchise_id as string | null) ?? null,
  }));

  return { success: true, data: admins };
}

// ─── Create an unassigned FRANCHISE_ADMIN user ───────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Create a FRANCHISE_ADMIN user that is NOT yet assigned to any franchise
 * (`franchise_id = NULL`). The franchise stamp happens later, when
 * createFranchise assigns this user as a franchise owner.
 *
 * Reuses the auth-user-creation pattern from
 * admin-actions/createFranchiseAdminUser: create the Supabase auth user
 * (email_confirm: true, user_metadata.full_name), look up the FRANCHISE_ADMIN
 * role id, then insert a public.users row. On any failure AFTER the auth user is
 * created, the auth user is deleted (cleanup) so no orphaned credential lingers.
 *
 * Validates email format and a minimum password length of 6, and rejects a
 * duplicate ACTIVE email with a clear message.
 */
export async function createUnassignedFranchiseAdmin(input: {
  fullName: string;
  email: string;
  mobile?: string;
  password: string;
}): Promise<ActionResult<{ userId: string; full_name: string; email: string }>> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const mobile = input.mobile?.trim() || null;
  const password = input.password ?? "";

  // ── Pure input validation ──────────────────────────────────────────────
  if (fullName.length === 0) {
    return { success: false, error: "Full name is required", field: "fullName" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { success: false, error: "Enter a valid email address", field: "email" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      success: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      field: "password",
    };
  }

  const admin = createAdminClient();

  // Reject a duplicate ACTIVE email up-front with a clear message.
  const { data: existingUser } = await admin
    .from("users")
    .select("id, is_active")
    .eq("email", email)
    .maybeSingle();

  if (existingUser?.is_active) {
    return {
      success: false,
      error: "An account with this email is already active in the system",
      field: "email",
    };
  }

  // Resolve the FRANCHISE_ADMIN role id BEFORE creating the auth user so we can
  // fail cleanly without any cleanup when the role is missing.
  const { data: roleData, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("code", FRANCHISE_ADMIN_ROLE_CODE)
    .single();

  if (roleError || !roleData) {
    return { success: false, error: "FRANCHISE_ADMIN role not found in system" };
  }

  // ── Create the Supabase auth user ──────────────────────────────────────
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError || !authData?.user) {
    return {
      success: false,
      error: authError?.message ?? "Failed to create auth user",
      field: "email",
    };
  }

  const authUserId = authData.user.id;

  // ── Insert the public.users row (franchise_id = NULL → unassigned) ──────
  const { data: insertedUser, error: userInsertError } = await admin
    .from("users")
    .insert({
      auth_user_id: authUserId,
      role_id: roleData.id,
      full_name: fullName,
      email,
      mobile,
      franchise_id: null,
      is_active: true,
      is_email_verified: true,
      force_password_change: true,
    })
    .select("id")
    .single();

  if (userInsertError || !insertedUser) {
    // Cleanup the orphaned auth user on any failure after auth creation.
    await admin.auth.admin.deleteUser(authUserId);
    return {
      success: false,
      error: userInsertError?.message ?? "Failed to create user record",
    };
  }

  return {
    success: true,
    data: { userId: insertedUser.id as string, full_name: fullName, email },
  };
}
