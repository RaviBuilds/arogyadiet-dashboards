"use server";

// src/actions/master-actions/dietitianActions.ts
// Master-portal Server Actions for the Dietitian account provisioning surface
// (dietitian-management, Task 9.1).
//
// LAYERING: Action layer ONLY. Authorization, request-shape validation (via
// the Zod schemas in `src/validations/dietitianSchema.ts`) and not-found
// orchestration live here; every business rule (role/franchise derivation,
// franchise-cardinality enforcement, auth-account creation/ban and
// `admin_activity_logs` writes) lives in
// `src/services/DietitianAccountService.ts`. This file never touches Supabase
// directly for a write — the one exception is the plain Clinic listing read
// (`listClinicsWithFranchiseName`), which carries no business logic and is
// read straight from the repository, mirroring how `clinicActions.ts` reads
// `getClinicById` directly for its own not-found checks.
//
// Authorization mirrors `assertCallerCanManageCities` in `cityActions.ts` /
// `assertCallerCanManageClinics` in `clinicActions.ts`: Dietitian accounts are
// managed by the global ADMIN / MASTER_ADMIN roles, aligning with the
// `is_global_role()` RLS policy and the Master Portal's own MASTER_ADMIN-only
// layout guard (`src/app/master/(main)/layout.tsx`).
//
// `admin_activity_logs.admin_id` is the caller's Supabase Auth id (not
// `public.users.id`) — see `src/lib/logger.ts`'s `logAdminAction` and the
// layering note atop `DietitianAccountService.ts`. The auth guard below
// therefore resolves and returns the Auth uid as `actingUserId`, not the
// `public.users.id` some sibling guards (e.g. `assertCallerCanManageCities`)
// return.
//
// Requirements: 2.3, 2.13, 3.1, 3.5, 3.6, 3.7, 3.9

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  createDietitian as createDietitianService,
  updateDietitian as updateDietitianService,
  toggleDietitianActive as toggleDietitianActiveService,
  listDietitians as listDietitiansService,
} from "@/services/DietitianAccountService";
import {
  getDietitianById,
  listClinicsWithFranchiseName,
  type ClinicWithFranchiseName,
} from "@/repositories/dietitian/dietitianRepository";
import {
  createDietitianSchema,
  updateDietitianSchema,
  type CreateDietitianInput,
  type UpdateDietitianInput,
} from "@/validations/dietitianSchema";
import type { DietitianAccount } from "@/types/dietitian";

const MASTER_USER_MANAGEMENT_PATH = "/master/user-management";

// Roles permitted to manage Dietitian accounts (mirrors cityActions/clinicActions).
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

/**
 * Discriminated union returned by every Dietitian Server Action.
 * On failure, `error` carries a human-readable message and `field` optionally
 * identifies the offending input field, matching the `ActionResult` shape used
 * across the master-actions surface (e.g. `src/types/clinic.ts`).
 */
type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; field?: string };

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN
 * role. Mirrors `assertCallerCanManageCities` in `cityActions.ts`, except it
 * returns the caller's Supabase Auth id as `actingUserId` — the id
 * `DietitianAccountService` writes into `admin_activity_logs.admin_id`
 * (Req 2.13, 3.6), matching `logAdminAction`'s convention rather than
 * `public.users.id`.
 */
async function assertCallerCanManageDietitians(): Promise<
  { ok: true; actingUserId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { ok: false, error: "User record not found" };

  const rolesData = userRecord.roles as
    | { code?: string }
    | { code?: string }[]
    | null;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can manage dietitians",
    };
  }

  return { ok: true, actingUserId: user.id };
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * List every Dietitian account, joined with its assigned Clinic and owning
 * Franchise name, for the Master Portal's Dietitians section (Req 3.1, 3.3).
 */
export async function listDietitians(): Promise<
  ActionResult<DietitianAccount[]>
> {
  const auth = await assertCallerCanManageDietitians();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const dietitians = await listDietitiansService();
    return { success: true, data: dietitians };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list dietitians",
    };
  }
}

/**
 * List every Clinic recorded in the `clinics` table, joined with the name of
 * its owning Franchise, for the Assign Clinic dropdown shown in both the
 * Create Dietitian dialog and the edit-Dietitian dialog (Req 2.3, 3.5). A
 * thin pass-through — this listing carries no business logic, so it is read
 * directly from the repository rather than via a service wrapper.
 */
export async function listClinicsForDietitianAssignment(): Promise<
  ActionResult<ClinicWithFranchiseName[]>
> {
  const auth = await assertCallerCanManageDietitians();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const clinics = await listClinicsWithFranchiseName();
    return { success: true, data: clinics };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list clinics",
    };
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a Dietitian account (Req 2). Validates `input` against
 * `createDietitianSchema` before calling `DietitianAccountService`, which
 * re-derives role/franchise from the assigned Clinic, enforces the
 * franchise-cardinality rule, creates the Supabase Auth identity, inserts the
 * `users` row and records the `admin_activity_logs` CREATE entry (Req 2.13).
 */
export async function createDietitian(
  input: CreateDietitianInput
): Promise<ActionResult<DietitianAccount>> {
  const auth = await assertCallerCanManageDietitians();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = createDietitianSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path?.[0] !== undefined ? String(issue.path[0]) : undefined,
    };
  }

  const result = await createDietitianService(parsed.data, auth.actingUserId);
  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  revalidatePath(MASTER_USER_MANAGEMENT_PATH);
  return { success: true, data: result.data };
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Update a Dietitian's editable fields and/or assigned Clinic (Req 3.5, 3.6,
 * 3.7). Validates `input` against `updateDietitianSchema`, resolves the
 * Dietitian's current `franchise_id` (so a reassignment within the same
 * Franchise is not rejected against itself) and delegates the write to
 * `DietitianAccountService`. Handles not-found.
 */
export async function updateDietitian(
  dietitianId: string,
  input: UpdateDietitianInput
): Promise<ActionResult<DietitianAccount>> {
  const auth = await assertCallerCanManageDietitians();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!dietitianId || dietitianId.trim().length === 0) {
    return { success: false, error: "Dietitian id is required" };
  }

  const parsed = updateDietitianSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path?.[0] !== undefined ? String(issue.path[0]) : undefined,
    };
  }

  const existing = await getDietitianById(dietitianId);
  if (!existing) {
    return { success: false, error: "Dietitian not found" };
  }

  const result = await updateDietitianService(
    dietitianId,
    parsed.data,
    auth.actingUserId,
    existing.franchiseId
  );
  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  revalidatePath(MASTER_USER_MANAGEMENT_PATH);
  return { success: true, data: result.data };
}

// ─── Deactivate / reactivate ─────────────────────────────────────────────────

/**
 * Flip a Dietitian's `is_active` flag and ban/unban the Supabase Auth account
 * in lock-step (Req 3.9). Resolves the Dietitian's `authUserId` before
 * delegating to `DietitianAccountService`. Handles not-found.
 */
export async function toggleDietitianActive(
  dietitianId: string,
  nextActive: boolean
): Promise<ActionResult<DietitianAccount>> {
  const auth = await assertCallerCanManageDietitians();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!dietitianId || dietitianId.trim().length === 0) {
    return { success: false, error: "Dietitian id is required" };
  }

  const existing = await getDietitianById(dietitianId);
  if (!existing) {
    return { success: false, error: "Dietitian not found" };
  }

  const result = await toggleDietitianActiveService(
    dietitianId,
    existing.authUserId,
    nextActive,
    auth.actingUserId
  );
  if (!result.success) {
    return { success: false, error: result.error };
  }

  revalidatePath(MASTER_USER_MANAGEMENT_PATH);
  return { success: true, data: result.data };
}
