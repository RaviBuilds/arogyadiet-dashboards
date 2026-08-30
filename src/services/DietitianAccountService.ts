// src/services/DietitianAccountService.ts
// Business service for creating, editing, deactivating and listing Dietitian
// accounts (Master Portal "Dietitians" section + "Create Dietitian" on Edit
// Franchise).
//
// LAYERING: Business service. It composes the data-access layer
// (`src/repositories/dietitian/dietitianRepository.ts`) with the derivation and
// validation rules the repository deliberately leaves to its caller. It also
// creates/deletes the Supabase Auth identity — the one side effect that cannot
// be expressed as a plain repository write. It holds NO `'use server'`
// wrappers (those live in `src/actions/master-actions/dietitianActions.ts` and
// `src/actions/master-actions/franchiseUserActions.ts`) and does NO
// HTTP/auth-context resolution — every caller passes an already-resolved
// `actingUserId` (the caller's Supabase Auth id, matching
// `admin_activity_logs.admin_id` — see `src/lib/logger.ts`).
//
// Responsibilities (design.md §10, "Services"):
//   * `createDietitian` — validate input, derive `roleCode`/`franchiseId` from
//     the assigned Clinic's `franchise_id` (Req 2.9, 2.10), create the Supabase
//     Auth identity, insert the `users` row, and delete the auth identity on
//     any failure AFTER it was created so no partial account is observable
//     (Req 2.14).
//   * `updateDietitian` — re-derive `roleCode`/`franchiseId` when the assigned
//     Clinic changes (Req 3.6) and map a franchise-cardinality violation to the
//     pinned message (Req 3.7).
//   * `toggleDietitianActive` — flip `is_active` and ban/unban the Supabase
//     Auth account in lock-step (Req 3.9, 3.11).
//   * `listDietitians` — a thin pass-through to the repository (Req 3.1, 3.3).
//   * Map the `users_mobile_key` unique violation and the
//     `users_one_active_dietitian_per_franchise` partial unique index
//     violation to their pinned messages rather than surfacing a raw DB error
//     (Req 2.6, 2.11, 2.12, 10.4) — this is what makes the concurrent-create
//     case return a sensible error instead of a 500.
//   * Write one `admin_activity_logs` entry per create/update naming the
//     acting user, the Dietitian and the assigned Clinic (Req 2.13, 3.6).
//
// Requirements: 2.6, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 3.6, 3.7, 3.9, 3.11,
//               10.1, 10.2, 10.3, 10.4, 21.3, 22.3, 22.7

import { createAdminClient } from "@/lib/supabase/admin";
import {

  getDietitianById,
  insertDietitian,
  listClinicsWithFranchiseName,
  listDietitians as repoListDietitians,
  updateDietitian as repoUpdateDietitian,
  type ClinicWithFranchiseName,
  type DietitianRoleCode,
} from "@/repositories/dietitian/dietitianRepository";
import { clearLinksForDeletedDietitian } from "@/services/AssignmentService";
import {
  createDietitianSchema,
  updateDietitianSchema,
  type CreateDietitianInput,
  type UpdateDietitianInput,
} from "@/validations/dietitianSchema";
import {

  MOBILE_ALREADY_REGISTERED,
} from "@/lib/dietitian/messages";
import type { DietitianAccount } from "@/types/dietitian";

/** Postgres SQLSTATE for a unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/** The subset of a PostgrestError this module inspects to classify failures. */
interface PgErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** The result shape returned by every mutating entry point of this service. */
export type DietitianAccountResult =
  | { success: true; data: DietitianAccount }
  | { success: false; error: string; field?: string };

/**
 * Whether a raised error is the `users_mobile_key` unique violation on the
 * Dietitian Mobile number (Req 2.6, 2.8). Inspects the SQLSTATE plus the
 * message/details text, mirroring `customerOnboardingRepository`'s
 * `classifyUniqueViolation` — Postgres surfaces the offending constraint name
 * in the error text, not as a separate structured field.
 */
function isMobileUniqueViolation(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${
    error.hint ?? ""
  }`.toLowerCase();
  const isUnique = error.code === PG_UNIQUE_VIOLATION || haystack.includes("duplicate key");
  return isUnique && haystack.includes("mobile");
}

// REMOVED: `isFranchiseDietitianUniqueViolation`.
//
// It mapped the `users_one_active_dietitian_per_franchise` partial unique index
// violation to a friendly message. `scripts/allow-multiple-franchise-dietitians.sql`
// DROPS that index — a Franchise may now hold a team of Dietitians — so the
// violation can no longer occur and the mapper had become dead code that
// implied a constraint the database no longer enforces.

/**
 * Delete a just-created Supabase Auth identity, swallowing any error from the
 * cleanup itself — a cleanup failure must never mask the original creation
 * failure that triggered it (Req 2.14, 22.7). Mirrors
 * `OnboardingService.safeDeleteAuthUser`.
 */
async function safeDeleteAuthUser(authUserId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(authUserId);
  } catch (err) {
    console.error("DietitianAccountService: failed to delete auth user during rollback:", err);
  }
}

/**
 * Record one `admin_activity_logs` entry for a Dietitian account create or
 * update, naming the acting user, the Dietitian and the assigned Clinic
 * (Req 2.13, 3.6). Mirrors the `logAdminAction` convention
 * (`src/lib/logger.ts`) of swallowing write failures rather than throwing —
 * `admin_activity_logs` is operational telemetry, so a failed insert must
 * never revert the account write that already succeeded.
 */
async function recordDietitianAccountChange(params: {
  actingUserId: string | null;
  actionType: "CREATE" | "UPDATE";
  dietitianUserId: string;
  clinicId: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("admin_activity_logs").insert({
      admin_id: params.actingUserId,
      action_type: params.actionType,
      entity_type: "dietitian",
      entity_id: params.dietitianUserId,
      details: {
        dietitian_id: params.dietitianUserId,
        clinic_id: params.clinicId,
      },
    });
    if (error) {
      console.error("recordDietitianAccountChange insert error:", error);
    }
  } catch (err) {
    console.error("recordDietitianAccountChange failed:", err);
  }
}

/**
 * Resolve the role code and `franchise_id` a Dietitian must carry for a given
 * assigned Clinic (Req 2.9, 2.10, 3.6, 22.3):
 *   - Clinic is `null` (no assignment) → role `ADMIN`, `franchise_id` `null`.
 *   - Clinic's `franchise_id` is `null` (Core_Business) → role `ADMIN`,
 *     `franchise_id` `null`.
 *   - Clinic's `franchise_id` is set (Franchise) → role `FRANCHISE_ADMIN`,
 *     `franchise_id` equal to that Clinic's `franchise_id`.
 */
function deriveRoleAndFranchise(
  clinic: ClinicWithFranchiseName | null,
): { roleCode: DietitianRoleCode; franchiseId: string | null } {
  if (!clinic || clinic.franchiseId === null) {
    return { roleCode: "ADMIN", franchiseId: null };
  }
  return { roleCode: "FRANCHISE_ADMIN", franchiseId: clinic.franchiseId };
}

/**
 * Look up a Clinic (with its owning Franchise id) by id, returning `null` for
 * a `null` clinicId or a clinicId that does not resolve. Reuses the same
 * batched-name-resolution listing the repository already exposes rather than
 * adding a second single-row Clinic lookup module.
 */
async function findClinic(clinicId: string | null): Promise<ClinicWithFranchiseName | null> {
  if (clinicId === null) return null;
  const clinics = await listClinicsWithFranchiseName();
  return clinics.find((c) => c.id === clinicId) ?? null;
}

/**
 * Formerly asserted that a Franchise held at most one active Dietitian.
 *
 * `scripts/allow-multiple-franchise-dietitians.sql` lifted that cap — a
 * Franchise now needs a TEAM of Dietitians, each reading only the
 * Customer_Records assigned to them — so this is now unconditionally permissive.
 *
 * Kept as a no-op seam rather than deleted at every call site: it documents that
 * the rule was removed deliberately (not overlooked), and gives one place to
 * reinstate a limit if the business ever wants one.
 */
async function assertFranchiseDietitianCardinality(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _franchiseId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: true };
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * List every Dietitian account, joined with its assigned Clinic and owning
 * Franchise name (Req 3.1, 3.3). A thin pass-through — all business logic for
 * this feature is on the write path.
 */
export async function listDietitians(): Promise<DietitianAccount[]> {
  return repoListDietitians();
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a Dietitian account (Req 2). Steps:
 *   1. Validate input against `createDietitianSchema` (mobile-required,
 *      10-digit, email, password length — Req 2.4, 2.5).
 *   2. Resolve the assigned Clinic (if any) and derive `roleCode` /
 *      `franchiseId` from its `franchise_id` (Req 2.9, 2.10).
 *   3. Pre-check the at-most-one-active-Dietitian-per-Franchise rule
 *      (Req 2.11) before touching Auth.
 *   4. Create the Supabase Auth identity.
 *   5. Insert the `users` row. On ANY failure after step 4, delete the auth
 *      identity so no `users` row and no auth identity are left behind
 *      (Req 2.14) — including a duplicate-mobile (`users_mobile_key`) or a
 *      franchise-cardinality race (`users_one_active_dietitian_per_franchise`)
 *      that step 3 did not catch (Req 2.12).
 *   6. Record an `admin_activity_logs` CREATE entry naming the acting user,
 *      the created Dietitian and the assigned Clinic (Req 2.13).
 */
export async function createDietitian(
  input: CreateDietitianInput,
  actingUserId: string | null,
): Promise<DietitianAccountResult> {
  const parsed = createDietitianSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path?.[0] !== undefined ? String(issue.path[0]) : undefined,
    };
  }
  const { fullName, email, mobile, password, clinicId } = parsed.data;

  const clinic = await findClinic(clinicId);
  const { roleCode, franchiseId } = deriveRoleAndFranchise(clinic);

  const cardinality = await assertFranchiseDietitianCardinality(franchiseId);
  if (!cardinality.ok) {
    return { success: false, error: cardinality.error, field: "clinicId" };
  }

  const admin = createAdminClient();
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

  try {
    const dietitian = await insertDietitian({
      authUserId,
      roleCode,
      fullName,
      email,
      mobile,
      franchiseId,
      clinicId,
    });

    await recordDietitianAccountChange({
      actingUserId,
      actionType: "CREATE",
      dietitianUserId: dietitian.id,
      clinicId,
    });

    return { success: true, data: dietitian };
  } catch (err) {
    // COMPENSATE: delete the pre-created auth identity so no partial account
    // is observable (Req 2.14). This runs for every post-auth failure,
    // including the constraint violations mapped below.
    await safeDeleteAuthUser(authUserId);

    const pgError = extractPgError(err);
    if (isMobileUniqueViolation(pgError)) {
      return { success: false, error: MOBILE_ALREADY_REGISTERED, field: "mobile" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create dietitian",
    };
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Update a Dietitian's editable fields and/or assigned Clinic (Req 3.5, 3.6).
 * When `clinicId` changes, `roleCode`/`franchise_id` are re-derived from the
 * new Clinic and the franchise-cardinality rule is re-checked, excluding this
 * Dietitian's own current Franchise from the "already has a Dietitian" count
 * so a reassignment within the same Franchise is not rejected against itself
 * (Req 3.6, 3.7). The Dietitian_Link of every Customer_Record referencing this
 * Dietitian is left untouched — this function never calls into
 * `AssignmentService` (Req 3.8).
 */
export async function updateDietitian(
  dietitianId: string,
  input: UpdateDietitianInput,
  actingUserId: string | null,
  currentFranchiseId: string | null,
): Promise<DietitianAccountResult> {
  const parsed = updateDietitianSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path?.[0] !== undefined ? String(issue.path[0]) : undefined,
    };
  }
  const { fullName, mobile, clinicId } = parsed.data;

  const clinic = await findClinic(clinicId);
  const { roleCode, franchiseId } = deriveRoleAndFranchise(clinic);

  // Only re-check cardinality when the resulting Franchise actually changes —
  // reassigning within the same Franchise (or leaving it unset) must not be
  // rejected against the Dietitian's own existing row (Req 3.6).
  if (franchiseId !== null && franchiseId !== currentFranchiseId) {
    const cardinality = await assertFranchiseDietitianCardinality(franchiseId);
    if (!cardinality.ok) {
      return { success: false, error: cardinality.error, field: "clinicId" };
    }
  }

  try {
    const dietitian = await repoUpdateDietitian(dietitianId, {
      fullName,
      mobile,
      clinicId,
      franchiseId,
      roleCode,
    });

    await recordDietitianAccountChange({
      actingUserId,
      actionType: "UPDATE",
      dietitianUserId: dietitian.id,
      clinicId,
    });

    return { success: true, data: dietitian };
  } catch (err) {
    const pgError = extractPgError(err);
    if (isMobileUniqueViolation(pgError)) {
      return { success: false, error: MOBILE_ALREADY_REGISTERED, field: "mobile" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update dietitian",
    };
  }
}

// ─── Deactivate / reactivate ─────────────────────────────────────────────────

/** The outcome of {@link toggleDietitianActive}. */
export type ToggleDietitianActiveResult =
  | { success: true; data: DietitianAccount }
  | { success: false; error: string };

/**
 * Flip a Dietitian's `is_active` flag and ban/unban the Supabase Auth account
 * in lock-step (Req 3.9, 3.11): deactivating sets `is_active = false` and bans
 * the auth account; reactivating sets `is_active = true` and lifts the ban.
 * Every Health_Log and Log_Audit_Trail entry the Dietitian authored is
 * retained — this function never touches `health_logs` or
 * `health_log_audit_entries` (Req 3.10). The Dietitian_Link of every
 * Customer_Record is likewise left untouched (Req 3.8).
 *
 * Reactivating re-checks the at-most-one-active-Dietitian-per-Franchise rule
 * (Req 10.2, 10.4, Property 6) against this Dietitian's own current
 * `franchise_id` — a Core_Business Dietitian (`franchiseId === null`) is
 * always permitted, mirroring {@link assertFranchiseDietitianCardinality}. A
 * cardinality race that slips past this pre-check (e.g. two concurrent
 * reactivations) is mapped from the database's partial unique index
 * violation (no longer possible — the index was dropped), exactly as
 * {@link createDietitian} and {@link updateDietitian} do (Req 2.12).
 */
export async function toggleDietitianActive(
  dietitianId: string,
  authUserId: string,
  nextActive: boolean,
  actingUserId: string | null,
): Promise<ToggleDietitianActiveResult> {
  try {
    if (nextActive) {
      const existing = await getDietitianById(dietitianId);
      // Only re-check when this actually transitions inactive → active —
      // otherwise the Dietitian's own already-active row would count against
      // itself and reject a no-op reactivation.
      if (existing?.franchiseId && !existing.isActive) {
        const cardinality = await assertFranchiseDietitianCardinality(existing.franchiseId);
        if (!cardinality.ok) {
          return { success: false, error: cardinality.error };
        }
      }
    }

    const dietitian = await repoUpdateDietitian(dietitianId, { isActive: nextActive });

    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: nextActive ? "none" : "876600h",
    });

    if (authError) {
      return { success: false, error: authError.message };
    }

    await recordDietitianAccountChange({
      actingUserId,
      actionType: "UPDATE",
      dietitianUserId: dietitian.id,
      clinicId: dietitian.clinicId,
    });

    return { success: true, data: dietitian };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update dietitian status",
    };
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/** The outcome of {@link deleteDietitian}. */
export type DeleteDietitianResult = { success: true } | { success: false; error: string };

/**
 * Permanently delete a Dietitian account: clear every Dietitian_Link
 * referencing it (Req 6.5 — via `AssignmentService`, so the affected
 * Customer_Records are audited BEFORE the FK's `ON DELETE SET NULL` clears
 * them regardless), delete the `users` row, then delete the Supabase Auth
 * identity. Every Health_Log and Log_Audit_Trail entry the Dietitian authored
 * is retained (Req 3.10) — this function never touches `health_logs` or
 * `health_log_audit_entries`.
 */
export async function deleteDietitian(
  dietitianId: string,
  authUserId: string,
  actingUserId: string | null,
): Promise<DeleteDietitianResult> {
  try {
    await clearLinksForDeletedDietitian(dietitianId, actingUserId);

    const admin = createAdminClient();
    const { error: deleteError } = await admin.from("users").delete().eq("id", dietitianId);
    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    const { error: authError } = await admin.auth.admin.deleteUser(authUserId);
    if (authError) {
      return { success: false, error: authError.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete dietitian",
    };
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Extract a `PgErrorLike` from an arbitrary thrown value. The repository
 * layer throws a plain `Error` whose `message` embeds the original Postgrest
 * error text (`Failed to insert dietitian: <pg message>`), so the constraint
 * classifiers inspect the `Error.message` text rather than a structured
 * field — mirroring how `customerOnboardingRepository`'s classifier reads
 * message/details text for the same reason (Postgrest error shape is not
 * preserved across a re-thrown `Error`).
 */
function extractPgError(err: unknown): PgErrorLike | null {
  if (err instanceof Error) {
    return { message: err.message };
  }
  return null;
}
