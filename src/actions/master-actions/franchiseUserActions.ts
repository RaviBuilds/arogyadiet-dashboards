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
  ACCESS_LEVEL_LABELS,
  FRANCHISE_USER_ACCESS_LEVELS,
  landingRouteFor,
  resolveAccessLevel,
  resolveAccessConfiguration,
  validateFranchiseOperationsAccessInput,
  type AdminAccessLevel,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";
import { logAdminAction } from "@/lib/logger";
import { sendNotificationToUser } from "@/lib/notifications";
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

// `FRANCHISE_USER_ACCESS_LEVELS` — the levels this generic create path accepts,
// excluding `dietitian` — now lives in `@/lib/auth/adminAccessCore` and is
// imported above. It MUST NOT be re-exported from this file: the `"use server"`
// directive on line 1 restricts this module's exports to async functions only,
// and exporting the array threw
// `A "use server" file can only export async functions, found object` at module
// evaluation, taking down every Server Action in the master Franchise Hierarchy
// bundle. The Franchise Users dialog rendered but failed on its first call.
// Client Components import the constant straight from `adminAccessCore`.

const franchiseUserAccessLevelSchema = z.enum(FRANCHISE_USER_ACCESS_LEVELS);

/**
 * Resolve the per-group operations access to persist for a franchise user
 * (franchise-scoped-access Task 6).
 *
 * Mirrors `resolveOperationsAccessForLevel` in `master-actions/adminActions.ts`,
 * but validates through {@link validateFranchiseOperationsAccessInput} so the
 * `franchises` group — Core_Business network management, meaningless for a user
 * scoped to a single Franchise — is rejected on the write path and not merely
 * absent from the UI.
 *
 * WHY THIS EXISTS: `createFranchiseUser` previously accepted `accessLevel` and
 * wrote ONLY that column, silently discarding the group matrix. An
 * `operations`-level franchise user therefore resolved to `groups: {}`, so
 * `hasGroupAccess` was false for every group and they could reach nothing but
 * their landing route — the "Operations only" access level was non-functional.
 *
 * Postcondition: `null` for any level other than `operations` (those levels
 * carry no per-group configuration), otherwise the validated map.
 */
function resolveFranchiseOperationsAccess(
  level: AdminAccessLevel,
  operationsAccess: unknown,
):
  | { ok: true; value: OperationsAccess | null }
  | { ok: false; error: string } {
  if (level !== "operations") {
    return { ok: true, value: null };
  }
  const validation = validateFranchiseOperationsAccessInput(operationsAccess);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, value: validation.value };
}

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

/**
 * The `roles.id` of {@link FRANCHISE_ADMIN_ROLE_CODE}.
 *
 * WHY EVERY PATH IN THIS FILE NEEDS IT: `users.franchise_id` is stamped on
 * EVERY user belonging to a Franchise, not just its portal staff. A Franchise's
 * Customers (role `CUSTOMER`) and Riders (role `RIDER`) carry it too, because
 * that column is how their records are attributed to the tenant.
 *
 * Those people are NOT franchise portal users. They sign in on entirely
 * different subdomains — `customer.arogyadiet.com` and
 * `deliverypartner.arogyadiet.com` — and are administered from the Customers and
 * Riders sections. Selecting on `franchise_id` alone therefore pulls them into
 * this admin roster, where every Edit / Deactivate / Delete control is wired
 * straight at them.
 *
 * This is an ALLOWLIST on the role, deliberately, rather than a denylist that
 * excludes `CUSTOMER` and `RIDER`: any future tenant-scoped role would otherwise
 * leak into the roster the moment it was introduced.
 */
async function resolveFranchiseAdminRoleId(
  admin: ReturnType<typeof createAdminClient>,
): Promise<
  | { ok: true; roleId: string }
  | { ok: false; result: { success: false; error: string } }
> {
  const { data, error } = await admin
    .from("roles")
    .select("id")
    .eq("code", FRANCHISE_ADMIN_ROLE_CODE)
    .single();

  if (error || !data) {
    return {
      ok: false,
      result: {
        success: false,
        error: `Role ${FRANCHISE_ADMIN_ROLE_CODE} is not configured`,
      },
    };
  }
  return { ok: true, roleId: data.id as string };
}

/** Refused when a Customer or Rider row is targeted through this surface. */
const NOT_A_FRANCHISE_PORTAL_USER =
  "This account is not a franchise portal user. Customers and riders belong to the Customers and Riders sections and cannot be managed here.";

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
  /**
   * The stored per-group Manage/View matrix, already normalised by
   * `resolveAccessConfiguration` (so `{}` for any level other than
   * `operations`). Lets the Edit dialog prefill the group checkboxes without
   * re-deriving them client-side (franchise-scoped-access Task 6).
   */
  operationsAccess: OperationsAccess;
  /**
   * `true` iff this user is the Franchise_Owner (`franchises.owner_user_id`).
   * The Owner's access is derived from that column, NOT from
   * `admin_access_level`, so editing their level would be silently ineffective
   * — the UI shows them as full-access and the lifecycle actions refuse to
   * demote or deactivate them.
   */
  isOwner: boolean;
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

  // Portal staff only. Without the role filter this roster also listed the
  // Franchise's Customers and Riders — see {@link resolveFranchiseAdminRoleId}.
  const role = await resolveFranchiseAdminRoleId(admin);
  if (!role.ok) return role.result;

  const { data, error } = await admin
    .from("users")
    .select(
      "id, full_name, email, mobile, admin_access_level, admin_operations_access, is_active, created_at",
    )
    .eq("franchise_id", trimmedFranchiseId)
    .eq("role_id", role.roleId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  // One extra read to resolve the Franchise_Owner, so the UI can render their
  // row as derived-full-access rather than offering an edit that would not take
  // effect.
  const { data: franchiseRow } = await admin
    .from("franchises")
    .select("owner_user_id")
    .eq("id", trimmedFranchiseId)
    .maybeSingle();
  const ownerUserId = (franchiseRow?.owner_user_id as string | null) ?? null;

  const users: FranchiseUserListItem[] = (data ?? []).map((row) => {
    const accessLevel = resolveAccessLevel(row.admin_access_level);
    // Reuse the shared normaliser so the list and the runtime gate can never
    // disagree about what is stored (it yields `{}` for non-`operations` levels).
    const { groups } = resolveAccessConfiguration(
      row.admin_access_level,
      row.admin_operations_access,
    );
    return {
      id: row.id as string,
      fullName: (row.full_name as string | null) ?? "",
      email: (row.email as string | null) ?? "",
      mobile: (row.mobile as string | null) ?? null,
      accessLevel,
      isDietitian: accessLevel === DIETITIAN_ACCESS_LEVEL,
      operationsAccess: groups,
      isOwner: ownerUserId !== null && ownerUserId === (row.id as string),
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
  /**
   * Per-group Manage/View matrix, meaningful only when `accessLevel` is
   * `operations`. Ignored (and persisted as `null`) for every other level, and
   * REQUIRED to be a non-empty selection of franchise-grantable groups when the
   * level IS `operations` — see {@link resolveFranchiseOperationsAccess}.
   */
  operationsAccess?: OperationsAccess;
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

  // Resolve + validate the group matrix BEFORE anything is written, so a bad
  // submission cannot leave an auth user or a `users` row behind.
  const opsResolved = resolveFranchiseOperationsAccess(
    accessLevel,
    input.operationsAccess,
  );
  if (!opsResolved.ok) {
    return { success: false, error: opsResolved.error, field: "operationsAccess" };
  }
  const operationsAccessValue = opsResolved.value;

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
      admin_operations_access: operationsAccessValue,
      // `admin_clinic_id` is deliberately NEVER set for a franchise user: one
      // Franchise owns exactly one Clinic, so clinic-level sub-scoping is
      // meaningless here, and the database restricts that column to Core
      // Clinics anyway (enforce_admin_clinic_is_core()).
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

// ─── Franchise user lifecycle: update / toggle / delete ──────────────────────
//
// franchise-scoped-access Task 7. These mirror `master-actions/adminActions.ts`
// (`updateAdminUser` / `toggleAdminActive` / `deleteAdminUser`) so a Franchise's
// user roster is managed exactly like the Core admin roster.
//
// TWO RULES EVERY ACTION BELOW ENFORCES:
//
//  1. TENANT BINDING — the target `users` row must carry the supplied
//     `franchiseId`. Without it, a master-portal request could be replayed with
//     another franchise's user id and mutate an account outside the franchise
//     being edited.
//
//  2. THE FRANCHISE_OWNER IS NOT EDITABLE HERE — the Owner's effective access is
//     derived from `franchises.owner_user_id` (the override applied in
//     `middleware.ts`, `franchise/(main)/layout.tsx` and
//     `resolveFranchiseAccessContext`), NOT from `admin_access_level`. Writing a
//     lower level onto the Owner would persist a value that is then ignored at
//     runtime, so the UI would report a demotion that never took effect.
//     Deactivating them would lock the Franchise out of its own portal. Both are
//     refused with an explanatory message rather than silently accepted.

/** The Franchise_Owner cannot be demoted or deactivated through this surface. */
const OWNER_NOT_EDITABLE =
  "This user is the Franchise Owner. Their access is derived from the franchise ownership record and cannot be changed here. Transfer ownership first.";

/**
 * Resolve a franchise user for mutation: the row must exist, belong to
 * `franchiseId`, and (unless `allowOwner`) must not be the Franchise_Owner.
 *
 * Returns the current level + owner flag so callers can decide whether the
 * access level actually changed without a second read.
 */
async function resolveFranchiseUserForWrite(
  admin: ReturnType<typeof createAdminClient>,
  franchiseId: string,
  userId: string,
): Promise<
  | {
      ok: true;
      authUserId: string | null;
      currentLevel: AdminAccessLevel;
      /**
       * The stored group matrix, normalised. Returned so a partial update (e.g.
       * renaming a user without touching permissions) can PRESERVE it rather
       * than be rejected for not resubmitting it.
       */
      currentOperationsAccess: OperationsAccess;
      isActive: boolean;
      isOwner: boolean;
    }
  | { ok: false; result: { success: false; error: string; field?: string } }
> {
  const trimmedFranchiseId = franchiseId?.trim() ?? "";
  const trimmedUserId = userId?.trim() ?? "";

  if (trimmedFranchiseId.length === 0) {
    return {
      ok: false,
      result: { success: false, error: "Franchise id is required", field: "franchiseId" },
    };
  }
  if (trimmedUserId.length === 0) {
    return {
      ok: false,
      result: { success: false, error: "User id is required", field: "userId" },
    };
  }

  const { data: row } = await admin
    .from("users")
    .select(
      "id, auth_user_id, role_id, franchise_id, admin_access_level, admin_operations_access, is_active",
    )
    .eq("id", trimmedUserId)
    .maybeSingle();

  if (!row) {
    return { ok: false, result: { success: false, error: "Franchise user not found" } };
  }

  // Rule 1 — tenant binding.
  if ((row.franchise_id as string | null) !== trimmedFranchiseId) {
    return {
      ok: false,
      result: {
        success: false,
        error: "This user does not belong to the selected franchise",
      },
    };
  }

  // Rule 1b — the target must be franchise PORTAL staff.
  //
  // The tenant check above is satisfied by a Customer or a Rider of this same
  // Franchise, because `users.franchise_id` is stamped on them too. Before this
  // check, `deleteFranchiseUser` would happily delete a paying Customer's
  // account and `toggleFranchiseUserActive` would lock them out of
  // `customer.arogyadiet.com`. Enforced here rather than only in the list query
  // so a replayed or hand-crafted request cannot reach them either.
  const role = await resolveFranchiseAdminRoleId(admin);
  if (!role.ok) return { ok: false, result: role.result };
  if ((row.role_id as string | null) !== role.roleId) {
    return {
      ok: false,
      result: { success: false, error: NOT_A_FRANCHISE_PORTAL_USER },
    };
  }

  const { data: franchiseRow } = await admin
    .from("franchises")
    .select("owner_user_id")
    .eq("id", trimmedFranchiseId)
    .maybeSingle();

  const isOwner =
    typeof franchiseRow?.owner_user_id === "string" &&
    franchiseRow.owner_user_id === (row.id as string);

  const { groups } = resolveAccessConfiguration(
    row.admin_access_level,
    row.admin_operations_access,
  );

  return {
    ok: true,
    authUserId: (row.auth_user_id as string | null) ?? null,
    currentLevel: resolveAccessLevel(row.admin_access_level),
    currentOperationsAccess: groups,
    isActive: Boolean(row.is_active),
    isOwner,
  };
}

/**
 * Update a franchise user's profile fields, Access_Level and group matrix
 * (franchise-scoped-access Task 7).
 *
 * Everything is validated BEFORE any write, so a rejection leaves the stored
 * row, level and matrix exactly as they were. Exactly one access-level-changed
 * notification is sent, and only when the level actually changed —
 * `sendNotificationToUser` swallows its own errors, so a notification failure
 * can never revert the persisted change.
 *
 * Email is intentionally not editable here (same as `updateAdminUser`): it is
 * the auth identity and changing it requires an Auth-side update.
 */
export async function updateFranchiseUser(input: {
  franchiseId: string;
  userId: string;
  fullName: string;
  mobile?: string;
  accessLevel?: string;
  operationsAccess?: OperationsAccess;
}): Promise<ActionResult<{ accessLevel: AdminAccessLevel }>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const fullName = input.fullName?.trim() ?? "";
  if (fullName.length === 0) {
    return { success: false, error: "Full name is required", field: "fullName" };
  }

  const admin = createAdminClient();
  const target = await resolveFranchiseUserForWrite(
    admin,
    input.franchiseId,
    input.userId,
  );
  if (!target.ok) return target.result;

  // Rule 2 — the Owner's level is derived, so refuse rather than persist a
  // value that would be ignored at runtime.
  if (target.isOwner && input.accessLevel !== undefined) {
    const requested = resolveAccessLevel(input.accessLevel);
    if (requested !== target.currentLevel) {
      return { success: false, error: OWNER_NOT_EDITABLE, field: "accessLevel" };
    }
  }

  // A Dietitian's level is managed by its own dedicated flow, which enforces
  // clinic assignment; the generic edit path must not move an account into or
  // out of that level.
  if (target.currentLevel === DIETITIAN_ACCESS_LEVEL && input.accessLevel !== undefined) {
    const requested = resolveAccessLevel(input.accessLevel);
    if (requested !== DIETITIAN_ACCESS_LEVEL) {
      return {
        success: false,
        error:
          "A Dietitian's access level cannot be changed here. Use the Dietitian controls instead.",
        field: "accessLevel",
      };
    }
  }

  let nextLevel: AdminAccessLevel = target.currentLevel;
  if (input.accessLevel !== undefined && target.currentLevel !== DIETITIAN_ACCESS_LEVEL) {
    const parsedLevel = franchiseUserAccessLevelSchema.safeParse(input.accessLevel);
    if (!parsedLevel.success) {
      return { success: false, error: "Invalid access level", field: "accessLevel" };
    }
    nextLevel = parsedLevel.data;
  }

  // A partial update (e.g. renaming a user, or toggling nothing but the mobile)
  // must not be forced to resubmit the whole permission matrix. When no matrix
  // is supplied AND the level is unchanged, the stored one is preserved;
  // otherwise the submitted value is used. Changing away from `operations`
  // clears the entries regardless, since those levels carry no matrix.
  const submittedOperationsAccess =
    input.operationsAccess !== undefined
      ? input.operationsAccess
      : nextLevel === target.currentLevel
        ? target.currentOperationsAccess
        : undefined;

  const opsResolved = resolveFranchiseOperationsAccess(
    nextLevel,
    submittedOperationsAccess,
  );
  if (!opsResolved.ok) {
    return { success: false, error: opsResolved.error, field: "operationsAccess" };
  }

  const { error } = await admin
    .from("users")
    .update({
      full_name: fullName,
      mobile: input.mobile?.trim() || null,
      admin_access_level: nextLevel,
      admin_operations_access: opsResolved.value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.userId);

  if (error) return { success: false, error: error.message };

  if (target.currentLevel !== nextLevel) {
    await sendNotificationToUser(input.userId, {
      title: "Access level updated",
      message: `Your access level has been updated to ${ACCESS_LEVEL_LABELS[nextLevel]}.`,
      actionUrl: landingRouteFor(nextLevel),
      type: "ADMIN_ACCESS_LEVEL_CHANGED",
    });
  }

  await logAdminAction("UPDATE", "franchise_user", input.userId, {
    franchise_id: input.franchiseId,
    full_name: fullName,
    admin_access_level: nextLevel,
  });

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { accessLevel: nextLevel } };
}

/**
 * Activate or deactivate a franchise user (franchise-scoped-access Task 7).
 *
 * Mirrors `toggleAdminActive`: flips `users.is_active` AND bans/unbans the
 * Supabase Auth account, so a deactivated user cannot simply sign in again.
 * `876600h` (~100 years) is the same ban duration the admin path uses.
 *
 * Deactivating the Franchise_Owner is refused — it would lock the Franchise out
 * of its own portal.
 */
export async function toggleFranchiseUserActive(input: {
  franchiseId: string;
  userId: string;
  currentlyActive: boolean;
}): Promise<ActionResult<{ isActive: boolean }>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const admin = createAdminClient();
  const target = await resolveFranchiseUserForWrite(
    admin,
    input.franchiseId,
    input.userId,
  );
  if (!target.ok) return target.result;

  const nextActive = !input.currentlyActive;

  if (target.isOwner && !nextActive) {
    return { success: false, error: OWNER_NOT_EDITABLE };
  }

  const { error: userError } = await admin
    .from("users")
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq("id", input.userId);

  if (userError) return { success: false, error: userError.message };

  if (target.authUserId) {
    const { error: authError } = await admin.auth.admin.updateUserById(
      target.authUserId,
      { ban_duration: nextActive ? "none" : "876600h" },
    );
    if (authError) return { success: false, error: authError.message };
  }

  await logAdminAction("UPDATE", "franchise_user", input.userId, {
    franchise_id: input.franchiseId,
    action: nextActive ? "activate" : "deactivate",
  });

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { isActive: nextActive } };
}

/**
 * Permanently delete a franchise user (franchise-scoped-access Task 7).
 *
 * Order matters, and matches `deleteAdminUser`: the `public.users` row is
 * removed FIRST, then the Auth account. Deleting Auth first would leave an
 * orphaned `users` row pointing at a non-existent identity — a state no guard
 * can resolve — whereas the reverse leaves at worst an unreferenced Auth user.
 *
 * Deleting the Franchise_Owner is refused.
 */
export async function deleteFranchiseUser(input: {
  franchiseId: string;
  userId: string;
}): Promise<ActionResult<{ userId: string }>> {
  const guard = await assertFullNetworkScope();
  if (!guard.ok) return guard.result;

  const admin = createAdminClient();
  const target = await resolveFranchiseUserForWrite(
    admin,
    input.franchiseId,
    input.userId,
  );
  if (!target.ok) return target.result;

  if (target.isOwner) {
    return { success: false, error: OWNER_NOT_EDITABLE };
  }

  const { error: userError } = await admin
    .from("users")
    .delete()
    .eq("id", input.userId);

  if (userError) return { success: false, error: userError.message };

  if (target.authUserId) {
    const { error: authError } = await admin.auth.admin.deleteUser(
      target.authUserId,
    );
    if (authError) return { success: false, error: authError.message };
  }

  await logAdminAction("DELETE", "franchise_user", input.userId, {
    franchise_id: input.franchiseId,
  });

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { userId: input.userId } };
}
