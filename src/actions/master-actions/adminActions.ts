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
  validateOperationsAccessInput,
  validateClinicScopeAssignment,
  type AdminAccessLevel,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";

/** Zod schema rejecting any value outside the permitted access-level set. */
const accessLevelSchema = z.enum(ADMIN_ACCESS_LEVELS);

/**
 * Clinic scope fields accepted by `createAdminUser` / `updateAdminUser`
 * (Requirement 13). This is the convention the User_Management_Form (task 6.6)
 * must follow when submitting the Clinic_Access_Checkbox / Core_Clinic dropdown:
 *
 *   - `clinicAccess` mirrors the Clinic_Access_Checkbox state. Omitted or
 *     `false` means "no clinic level access": any submitted `clinicId` is
 *     IGNORED and the stored Clinic_Scope_Assignment is cleared to `null`
 *     (Req 13.16). This is also what an unscoped create (no clinic fields sent
 *     at all) naturally resolves to.
 *   - `clinicAccess: true` requires a non-null `clinicId`. A submission with
 *     `clinicAccess: true` and `clinicId` omitted or `null` is rejected with
 *     "a clinic must be selected" (Req 13.11) rather than silently clearing
 *     the assignment — this is what lets the server enforce Requirement 13.11
 *     through 13.14 on its own, regardless of what client-side validation
 *     already blocks (Req 13.15).
 *   - When `clinicAccess: true` and `clinicId` is set, the caller's `groups`
 *     (the resolved `operationsAccess`) must hold only Clinic_Scoped_Groups —
 *     an `operations` or `franchises` entry is rejected (Req 13.13) — and the
 *     effective Access_Level must be `operations` (Req 13.14).
 */
interface ClinicScopeFormFields {
  clinicAccess?: boolean;
  clinicId?: string | null;
}

/**
 * Resolve the Core_Clinic id (if any) that should be persisted as the
 * Clinic_Scope_Assignment for a write, applying the convention documented on
 * `ClinicScopeFormFields` and enforcing Requirements 13.11-13.14 via
 * `validateClinicScopeAssignment`. Queries `public.clinics` once, only when a
 * clinic id is actually being considered, to resolve the Core-Clinic-only
 * check (Req 13.12) that `validateClinicScopeAssignment` cannot perform itself
 * (it is pure / has no database access).
 *
 * A `clinicId` that does not reference any existing `clinics` row is treated
 * the same as a franchise-owned clinic — `isCoreClinic: false` — so both
 * halves of Requirement 13.12 ("does not exist" and "franchise_id is not
 * NULL") produce the same rejection.
 */
async function resolveClinicScopeForWrite(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  level: AdminAccessLevel,
  fields: ClinicScopeFormFields,
  groups: OperationsAccess | null,
): Promise<
  | { ok: true; clinicIdToPersist: string | null }
  | { ok: false; error: string }
> {
  const clinicAccess = fields.clinicAccess === true;
  const clinicId = clinicAccess ? fields.clinicId ?? null : null;

  let isCoreClinic: boolean | null = null;
  if (clinicId !== null) {
    const { data } = await supabaseAdmin
      .from("clinics")
      .select("franchise_id")
      .eq("id", clinicId)
      .maybeSingle();
    isCoreClinic = data ? data.franchise_id === null : false;
  }

  const validation = validateClinicScopeAssignment({
    level,
    clinicAccess,
    clinicId,
    groups: groups ?? {},
    isCoreClinic,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  return { ok: true, clinicIdToPersist: clinicId };
}

/**
 * Resolve the per-group operations access to persist for a given level.
 * Local (non-exported) helper — a `"use server"` file may only export async
 * functions. Returns the JSONB value to store (`OperationsAccess` for the
 * `operations` level, otherwise `null`) or a validation error.
 */
function resolveOperationsAccessForLevel(
  level: AdminAccessLevel,
  operationsAccess: unknown,
):
  | { ok: true; value: OperationsAccess | null }
  | { ok: false; error: string } {
  if (level !== "operations") {
    // inventory / inventory_operations carry no per-group config (Req 10.3, 12.5).
    return { ok: true, value: null };
  }
  const validation = validateOperationsAccessInput(operationsAccess);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, value: validation.value };
}

export async function getAdminUsers() {
  const supabaseAdmin = createAdminClient();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select(
      "id, auth_user_id, full_name, email, mobile, is_active, created_at, admin_access_level, admin_operations_access, admin_clinic_id, roles(code)",
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
  operationsAccess?: OperationsAccess;
  clinicAccess?: boolean;
  clinicId?: string | null;
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

  // Resolve + validate the per-group operations config (Req 4.2, 4.3, 5.6, 10.3).
  const opsResolved = resolveOperationsAccessForLevel(
    accessLevel,
    formData.operationsAccess,
  );
  if (!opsResolved.ok) return { success: false, error: opsResolved.error };
  const operationsAccessValue = opsResolved.value;

  // Resolve + validate the Clinic_Scope_Assignment (Req 13.9, 13.11-13.15).
  // Persists nothing yet — validation happens before any write, same as the
  // access-level / operations-access checks above.
  const clinicScopeResolved = await resolveClinicScopeForWrite(
    supabaseAdmin,
    accessLevel,
    formData,
    operationsAccessValue,
  );
  if (!clinicScopeResolved.ok) {
    return { success: false, error: clinicScopeResolved.error };
  }
  const clinicIdToPersist = clinicScopeResolved.clinicIdToPersist;

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
          admin_operations_access: operationsAccessValue,
          admin_clinic_id: clinicIdToPersist,
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
        admin_clinic_id: clinicIdToPersist,
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
    admin_operations_access: operationsAccessValue,
    admin_clinic_id: clinicIdToPersist,
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
    admin_clinic_id: clinicIdToPersist,
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
    operationsAccess?: OperationsAccess;
    clinicAccess?: boolean;
    clinicId?: string | null;
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

  // Resolve + validate the per-group operations config for the resulting level.
  // Changing away from `operations` clears the stored per-group entries (Req 12.5).
  const opsResolved = resolveOperationsAccessForLevel(
    nextLevel,
    formData.operationsAccess,
  );
  if (!opsResolved.ok) return { success: false, error: opsResolved.error };

  // Resolve + validate the Clinic_Scope_Assignment for the resulting level
  // (Req 13.9-13.15, 13.18). Nothing is persisted before this check passes, so
  // a rejection here leaves the stored user record, access level, and
  // operations config exactly as they were (Req 13.10, 13.14).
  const clinicScopeResolved = await resolveClinicScopeForWrite(
    supabaseAdmin,
    nextLevel,
    formData,
    opsResolved.value,
  );
  if (!clinicScopeResolved.ok) {
    return { success: false, error: clinicScopeResolved.error };
  }
  const clinicIdToPersist = clinicScopeResolved.clinicIdToPersist;

  const { error } = await supabaseAdmin
    .from("users")
    .update({
      full_name: formData.fullName,
      mobile: formData.mobile || null,
      admin_access_level: nextLevel,
      admin_operations_access: opsResolved.value,
      admin_clinic_id: clinicIdToPersist,
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
    admin_clinic_id: clinicIdToPersist,
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
