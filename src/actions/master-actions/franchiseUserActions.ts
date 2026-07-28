"use server";

// src/actions/master-actions/franchiseUserActions.ts
// Master-portal Server Actions for the Franchise Users section of the Edit
// Franchise workspace (dietitian-management — Task 9.3; Requirements 21.1,
// 21.2, 21.3, 22.1, 22.2, 22.3, 22.7).
//
// LAYERING: Action layer ONLY. Sits alongside the other Franchise Hierarchy
// master-actions (`franchiseActions.ts`, `clinicWiringActions.ts`,
// `agreementDocActions.ts`) and reuses the same `assertFullNetworkScope`
// pattern (FRANCHISE_FEATURES_ENABLED gate + full_network scope via
// `resolveScope`) so only a MASTER_ADMIN/ADMIN caller can manage a Franchise's
// user roster.
//
// THREE ENTRY POINTS (Req 21.1, 21.2, 21.3, 22.1, 22.2, 22.3):
//   - `listFranchiseUsers(franchiseId)` — every `users` row whose
//     `franchise_id` equals the selected Franchise (Req 21.1).
//   - `createFranchiseUser` — the generic "Create Franchise User" action
//     (name/email/mobile/password/Access_Level, Req 21.2). Writes the `users`
//     row directly (mirrors `franchiseAdminActions.createUnassignedFranchiseAdmin`
//     / `admin-actions/franchiseUserActions.createFranchiseAdminUser`) because
//     `DietitianAccountService` always stamps `admin_access_level = 'dietitian'`
//     and therefore cannot provision a plain non-Dietitian franchise user.
//     Every level EXCEPT `dietitian` may be chosen here — a Franchise Dietitian
//     carries extra invariants (Clinic auto-assignment, at-most-one-per-franchise
//     cardinality) that only `createFranchiseDietitian` enforces.
//   - `createFranchiseDietitian` — the "Create Dietitian" action on the Edit
//     Franchise dialog (Req 22.1, 22.2). Resolves the Franchise's own Clinic
//     (Req 22.4 when none exists) and DELEGATES to
//     `DietitianAccountService.createDietitian`, passing that Clinic as the
//     assigned Clinic. The service derives role `FRANCHISE_ADMIN` and
//     `franchise_id` from the Clinic's `franchise_id` (Req 22.3), enforces the
//     at-most-one-active-Dietitian-per-Franchise cardinality (Req 22.5, 22.6 —
//     surfaced as `FRANCHISE_ALREADY_HAS_DIETITIAN`), and performs the
//     create-then-rollback-on-failure atomicity (Req 22.7) — none of that is
//     duplicated here.

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import {
  DIETITIAN_ACCESS_LEVEL,
  resolveAccessLevel,
  type AdminAccessLevel,
} from "@/lib/auth/adminAccessCore";
import { getFranchiseById } from "@/repositories/franchise/franchiseRepository";
import { listClinicsByFranchise } from "@/repositories/franchise/franchiseClinicRepository";
import { createDietitian } from "@/services/DietitianAccountService";
import { WIRE_CLINIC_TO_FRANCHISE_FIRST } from "@/lib/dietitian/messages";
import type { ActionResult } from "@/types/franchise";
import type { DietitianAccount } from "@/types/dietitian";

const MASTER_SYSTEM_PATH = "/system";
const FRANCHISE_ADMIN_ROLE_CODE = "FRANCHISE_ADMIN";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Access levels a plain "Create Franchise User" may carry (Req 21.2). The
 * `dietitian` level deliberately excluded — a Franchise Dietitian is
 * provisioned ONLY through {@link createFranchiseDietitian}, which resolves
 * the Franchise's Clinic and enforces the per-franchise cardinality rule that
 * this generic action does not know about. Exported so the Franchise Users
 * panel's Access_Level `<Select>` offers exactly the levels this action
 * accepts.
 */
export const FRANCHISE_USER_ACCESS_LEVELS = [
  "inventory",
  "operations",
  "inventory_operations",
] as const;

const franchiseUserAccessLevelSchema = z.enum(FRANCHISE_USER_ACCESS_LEVELS);

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Gate every action behind the franchise feature flag and the full_network
 * scope (MASTER_ADMIN / ADMIN). Returns the caller's Supabase Auth id on
 * success — reused as the `actingUserId` passed into
 * `DietitianAccountService.createDietitian` — or an `ActionResult` failure
 * otherwise. Mirrors `assertFullNetworkScope` in `franchiseActions.ts` /
 * `clinicWiringActions.ts`.
 */
async function assertFullNetworkScope(): Promise<
  | { ok: true; authUserId: string }
  | { ok: false; result: { success: false; error: string } }
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return {
      ok: false,
      result: { success: false, error: "Franchise features are not enabled" },
    };
  }

  // Resolve the caller's session first so an unauthenticated request is
  // reported as Unauthorized rather than a generic scope error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, result: { success: false, error: "Unauthorized" } };
  }

  const result = await resolveScope();
  if (!result.ok || result.scope.kind !== "full_network") {
    return {
      ok: false,
      result: {
        success: false,
        error: "Only an Admin or Master Admin can manage franchise users",
      },
    };
  }

  return { ok: true, authUserId: user.id };
}

// ─── List ────────────────────────────────────────────────────────────────────

/** One row of the Franchise Users section (Req 21.1). */
export interface FranchiseUserListItem {
  id: string;
  fullName: string;
  email: string;
  mobile: string | null;
  accessLevel: AdminAccessLevel;
  /** `true` iff this row is the Franchise's Dietitian (Access_Level `dietitian`), so the UI can flag it distinctly from a plain franchise user. */
  isDietitian: boolean;
  isActive: boolean;
  createdAt: string;
}

/**
 * List every `users` row whose `franchise_id` equals `franchiseId`, newest
 * first (Req 21.1). Uses the admin (service-role) client so the read is not
 * constrained by RLS — this is a master-portal-only surface, gated by
 * {@link assertFullNetworkScope}.
 */
export async function listFranchiseUsers(
  franchiseId: string,
): Promise<ActionResult<FranchiseUserListItem[]>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const trimmedFranchiseId = franchiseId?.trim() ?? "";
  if (trimmedFranchiseId.length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email, mobile, admin_access_level, is_active, created_at")
    .eq("franchise_id", trimmedFranchiseId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  const users: FranchiseUserListItem[] = (data ?? []).map((row) => {
    const accessLevel = resolveAccessLevel(row.admin_access_level);
    return {
      id: row.id as string,
      fullName: (row.full_name as string | null) ?? "",
      email: (row.email as string | null) ?? "",
      mobile: (row.mobile as string | null) ?? null,
      accessLevel,
      isDietitian: accessLevel === DIETITIAN_ACCESS_LEVEL,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at as string,
    };
  });

  return { success: true, data: users };
}

// ─── Create a plain Franchise User ───────────────────────────────────────────

/**
 * Create a plain (non-Dietitian) Franchise user via the generic "Create
 * Franchise User" action (Req 21.2): captures full name, email, mobile,
 * password and Access_Level, assigns role `FRANCHISE_ADMIN` and
 * `users.franchise_id` equal to the selected Franchise (Req 21.3).
 *
 * Reuses the auth-user-creation pattern from
 * `franchiseAdminActions.createUnassignedFranchiseAdmin` /
 * `admin-actions/franchiseUserActions.createFranchiseAdminUser`: create the
 * Supabase auth user (`email_confirm: true`, `user_metadata.full_name`), look
 * up the `FRANCHISE_ADMIN` role id, then insert a `public.users` row. On any
 * failure AFTER the auth user is created, the auth user is deleted so no
 * orphaned credential lingers.
 *
 * `accessLevel` defaults to `inventory_operations` when omitted and is
 * rejected outside {@link FRANCHISE_USER_ACCESS_LEVELS} — the `dietitian`
 * level is provisioned only via {@link createFranchiseDietitian}.
 */
export async function createFranchiseUser(input: {
  franchiseId: string;
  fullName: string;
  email: string;
  mobile?: string;
  password: string;
  accessLevel?: string;
}): Promise<ActionResult<{ userId: string }>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const franchiseId = input.franchiseId?.trim() ?? "";
  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const mobile = input.mobile?.trim() || null;
  const password = input.password ?? "";

  // ── Pure input validation ──────────────────────────────────────────────
  if (franchiseId.length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }
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

  let accessLevel: AdminAccessLevel = "inventory_operations";
  if (input.accessLevel !== undefined) {
    const parsedLevel = franchiseUserAccessLevelSchema.safeParse(input.accessLevel);
    if (!parsedLevel.success) {
      return { success: false, error: "Invalid access level", field: "accessLevel" };
    }
    accessLevel = parsedLevel.data;
  }

  // The target Franchise must exist (Req 21.3).
  const franchise = await getFranchiseById(franchiseId);
  if (!franchise) {
    return { success: false, error: "Franchise not found", field: "franchiseId" };
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

  // ── Insert the public.users row (role FRANCHISE_ADMIN, franchise_id set) ─
  const { data: insertedUser, error: userInsertError } = await admin
    .from("users")
    .insert({
      auth_user_id: authUserId,
      role_id: roleData.id,
      full_name: fullName,
      email,
      mobile,
      franchise_id: franchiseId,
      admin_access_level: accessLevel,
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

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { userId: insertedUser.id as string } };
}

// ─── Create a Franchise Dietitian ────────────────────────────────────────────

/**
 * Create the Franchise's Dietitian via the "Create Dietitian" action on the
 * Edit Franchise dialog (Req 22.1, 22.2): captures full name, email, mobile
 * and password — the Franchise's Clinic is resolved automatically and never
 * captured from the caller (the UI displays it as read-only text, Req 22.2).
 *
 * Resolves the Franchise's own Clinic via `listClinicsByFranchise` (Req 22.3
 * — "the Franchise's Clinic", singular) and, when none is wired, returns the
 * pinned `Wire a clinic to this franchise first` message without touching
 * Auth or `users` (Req 22.4). Otherwise DELEGATES to
 * `DietitianAccountService.createDietitian`, passing that Clinic as the
 * assigned Clinic — the service derives role `FRANCHISE_ADMIN` and
 * `franchise_id` from the Clinic's `franchise_id` (which already equals this
 * Franchise), enforces the at-most-one-active-Dietitian-per-Franchise
 * cardinality (Req 22.5, 22.6), and reverts the authentication account and
 * `users` row on any failure so no partial Dietitian is observable (Req 22.7).
 */
export async function createFranchiseDietitian(input: {
  franchiseId: string;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
}): Promise<ActionResult<DietitianAccount>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const franchiseId = input.franchiseId?.trim() ?? "";
  if (franchiseId.length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }

  const franchise = await getFranchiseById(franchiseId);
  if (!franchise) {
    return { success: false, error: "Franchise not found", field: "franchiseId" };
  }

  // Resolve the Franchise's own Clinic (Req 22.3, 22.4).
  const clinics = await listClinicsByFranchise(franchiseId);
  const clinic = clinics[0];
  if (!clinic) {
    return {
      success: false,
      error: WIRE_CLINIC_TO_FRANCHISE_FIRST,
      field: "franchiseId",
    };
  }

  const result = await createDietitian(
    {
      fullName: input.fullName,
      email: input.email,
      mobile: input.mobile,
      password: input.password,
      clinicId: clinic.id,
    },
    guard.authUserId,
  );

  if (result.success) {
    revalidatePath(MASTER_SYSTEM_PATH);
  }

  return result;
}
