"use server";

// src/actions/master-actions/franchiseActions.ts
// Master-portal Server Actions for the Franchise registry, lifecycle, and
// inter-group move in the multi-tenant-franchise hierarchy
// (multi-tenant-franchise spec — Tasks 6.1, 6.2, 6.3; Requirements 3.1, 3.2,
// 3.3, 3.5, 3.6, 4.1–4.8, 5.1–5.5, 8.1, 8.2, 15.5, 15.6).
//
// LAYERING: Action layer ONLY. These actions orchestrate authorization
// (full_network scope), the franchise feature-flag gate, pure validation
// (`franchiseSchema` from src/validations/franchise.ts), pure status-transition
// rules (`isValidStatusTransition` from src/lib/franchise/status-transitions.ts),
// and data access (src/repositories/franchise/*). The single MULTI-STATEMENT,
// must-be-atomic operation — the inter-group move — is delegated to the
// SECURITY DEFINER plpgsql RPC `move_franchise_to_group` invoked through the
// service-role admin client, mirroring groupActions and
// scripts/create-move-franchise-to-group-rpc.sql.
//
// A Franchise belongs to exactly one Group (`group_id`); its Kitchen, City, and
// Business are resolved THROUGH the Group. The legacy `franchises.kitchen_id`
// column is DEPRECATED and is never written here (Req 3.1). Each Franchise has
// EXACTLY ONE FRANCHISE_ADMIN owner (`owner_user_id`), whose `users.franchise_id`
// is stamped to the new franchise on create (Req 8.1).

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScope } from "@/lib/auth/scope-resolver";
import {
  FRANCHISE_FEATURES_ENABLED,
  FRANCHISE_SCOPED_ROLE,
} from "@/lib/franchise/constants";
import { isValidStatusTransition } from "@/lib/franchise/status-transitions";
import { franchiseSchema, type FranchiseSchemaInput } from "@/validations/franchise";
import {
  getFranchiseById,
  insertFranchise,
  updateFranchise as updateFranchiseRecord,
  setFranchiseStatus,
} from "@/repositories/franchise/franchiseRepository";
import { getGroupById } from "@/repositories/franchise/groupRepository";
import { listClinicsByFranchise } from "@/repositories/franchise/franchiseClinicRepository";
import type { ActionResult, Franchise, FranchiseStatus } from "@/types/franchise";

const MASTER_SYSTEM_PATH = "/system";

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Gate every Franchise action behind the franchise feature flag and the
 * full_network scope (MASTER_ADMIN / ADMIN). Returns `null` when the caller is
 * authorized, or an `ActionResult` failure otherwise.
 *
 * - When FRANCHISE_FEATURES_ENABLED is off the franchise surface is inert
 *   (Req 18.3, 18.4): no franchise reads/writes are performed.
 * - Only the full_network scope may manage the Franchise registry (the franchise
 *   hierarchy is a master/admin concern).
 */
async function assertFullNetworkScope(): Promise<
  { success: false; error: string } | null
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { success: false, error: "Franchise features are not enabled" };
  }

  // Resolve the caller's session first so an unauthenticated request is
  // reported as Unauthorized rather than a generic scope error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized" };

  const result = await resolveScope();
  if (!result.ok || result.scope.kind !== "full_network") {
    return {
      success: false,
      error: "Only an Admin or Master Admin can manage franchises",
    };
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the role code of a user by their internal `users.id`, handling both
 * the array and object shapes Supabase returns for the joined `roles(code)`.
 * Returns `null` when the user (or their role) cannot be resolved.
 */
async function resolveUserRoleCode(
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, roles(code)")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const rolesData = (data as { roles?: unknown }).roles;
  if (Array.isArray(rolesData)) {
    return (rolesData[0] as { code?: string } | undefined)?.code ?? null;
  }
  return (rolesData as { code?: string } | null)?.code ?? null;
}

/**
 * Validate the supplied input against {@link franchiseSchema} (name 1..100,
 * group_id uuid, owner_user_id uuid, optional status enum — Req 3.6) and check
 * that the referenced Group exists (Req 3.6). Returns the parsed data on success
 * or an `ActionResult` failure (carrying the offending field) otherwise.
 */
async function validateFranchiseInput(
  input: FranchiseSchemaInput
): Promise<
  | { ok: true; data: FranchiseSchemaInput }
  | { ok: false; result: { success: false; error: string; field?: string } }
> {
  const parsed = franchiseSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      result: {
        success: false,
        error: issue?.message ?? "Invalid franchise",
        field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
      },
    };
  }

  // The referenced Group must exist (Req 3.6).
  const group = await getGroupById(parsed.data.group_id);
  if (!group) {
    return {
      ok: false,
      result: {
        success: false,
        error: "The selected group does not exist",
        field: "group_id",
      },
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Reject a duplicate Franchise name (Req 3.6), case-insensitively. When
 * `excludeId` is supplied the franchise being updated is excluded from the
 * uniqueness check. Returns an `ActionResult` failure on a clash, else `null`.
 */
async function assertUniqueFranchiseName(
  name: string,
  excludeId?: string
): Promise<{ success: false; error: string; field: string } | null> {
  const admin = createAdminClient();
  let query = admin
    .from("franchises")
    .select("id")
    .ilike("name", name);

  if (excludeId) query = query.neq("id", excludeId);

  const { data } = await query.maybeSingle();
  if (data) {
    return {
      success: false,
      error: `A franchise named "${name}" already exists`,
      field: "name",
    };
  }
  return null;
}

/**
 * Detect whether the Franchise has any UNRESOLVED pincode-overlap conflict that
 * must block activation/reactivation (Req 15.5, 15.6). A conflict exists when a
 * pincode served by one of the franchise's Clinics also resolves to a Clinic the
 * franchise does NOT own (i.e. a Core or other-franchise Clinic) in
 * `rider_service_areas`.
 *
 * REUSE NOTE: the core-clinic conflict helper (`src/lib/clinic/conflict.ts`,
 * `detectClinicConflict`) detects a *customer's* per-day delivery-vs-primary
 * clinic conflict and is not applicable to this franchise-setup-time overlap
 * gate. No other readily-usable helper exists, so this performs the minimal
 * direct check against `rider_service_areas`.
 *
 * TODO(Req 15.6): the one-pincode-one-clinic invariant is ultimately enforced by
 * the `uq_service_area_pincode` unique index, so a persisted duplicate pincode
 * row should not normally exist. When the dedicated setup-time overlap-conflict
 * read model lands (Task 7.2), replace this minimal scan with that helper so the
 * activation gate names the pincode and every entity it maps to within 2s.
 */
async function hasUnresolvedPincodeOverlap(
  franchiseId: string
): Promise<boolean> {
  // Resolve the franchise's own Clinics (Clinic → Franchise).
  const clinics = await listClinicsByFranchise(franchiseId);
  const ownClinicIds = new Set(clinics.map((c) => c.id));
  if (ownClinicIds.size === 0) return false;

  const admin = createAdminClient();

  // Pincodes currently served by the franchise's own Clinics.
  const { data: ownAreas } = await admin
    .from("rider_service_areas")
    .select("pincode")
    .in("clinic_id", Array.from(ownClinicIds));

  const ownPincodes = Array.from(
    new Set((ownAreas ?? []).map((row) => (row as { pincode: string }).pincode))
  );
  if (ownPincodes.length === 0) return false;

  // Any service-area row for those pincodes that maps to a Clinic the franchise
  // does NOT own is an unresolved overlap conflict (Req 15.5).
  const { data: collidingAreas } = await admin
    .from("rider_service_areas")
    .select("pincode, clinic_id")
    .in("pincode", ownPincodes);

  return (collidingAreas ?? []).some((row) => {
    const clinicId = (row as { clinic_id: string | null }).clinic_id;
    // A null clinic_id means the pincode is unresolved (served by no clinic) —
    // also a conflict for the purposes of the activation gate (Req 15.5).
    return clinicId === null || !ownClinicIds.has(clinicId);
  });
}

// ─── Registry CRUD (Task 6.1) ───────────────────────────────────────────────

/**
 * Create a Franchise in the hierarchy (Req 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2,
 * 8.1, 8.2). Validates name (1..100) + group_id (uuid) + owner_user_id (uuid),
 * verifies the Group exists, rejects a duplicate name, and requires the owner to
 * be an existing FRANCHISE_ADMIN (exactly one owner — Req 4.1/4.2/8.1). Persists
 * the franchise as `onboarding` (Req 3.5) with its `group_id` set (never the
 * deprecated `kitchen_id`), then stamps the owner's `users.franchise_id` to the
 * new franchise (Req 8.1).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 8.1, 8.2.
 */
export async function createFranchise(
  input: FranchiseSchemaInput
): Promise<ActionResult<{ id: string }>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  const validated = await validateFranchiseInput(input);
  if (!validated.ok) return validated.result;

  const { name, group_id, owner_user_id } = validated.data;

  // Reject a duplicate franchise name (Req 3.6).
  const dup = await assertUniqueFranchiseName(name);
  if (dup) return dup;

  // The owner must reference an existing user whose role is FRANCHISE_ADMIN —
  // exactly one FRANCHISE_ADMIN owner per franchise (Req 4.1, 4.2, 8.1).
  const ownerRole = await resolveUserRoleCode(owner_user_id);
  if (ownerRole === null) {
    return {
      success: false,
      error: "The selected owner user does not exist",
      field: "owner_user_id",
    };
  }
  if (ownerRole !== FRANCHISE_SCOPED_ROLE) {
    return {
      success: false,
      error: "The franchise owner must be a Franchise Admin",
      field: "owner_user_id",
    };
  }

  try {
    // Persist as `onboarding`, stamping group_id; never the legacy kitchen_id
    // (Req 3.5, 3.1).
    const franchise = await insertFranchise({
      name,
      group_id,
      owner_user_id,
      status: "onboarding",
    });

    // Stamp the owner's users.franchise_id to the new franchise (Req 8.1).
    const admin = createAdminClient();
    const { error: ownerError } = await admin
      .from("users")
      .update({ franchise_id: franchise.id })
      .eq("id", owner_user_id);

    if (ownerError) {
      return {
        success: false,
        error: `Franchise created but failed to assign owner: ${ownerError.message}`,
      };
    }

    // Provision the franchise inventory within the creation flow (Req 1.1, 1.2, 1.5).
    // The RPC is idempotent (INSERT ... ON CONFLICT DO NOTHING) so concurrent
    // calls are safe (Req 1.4, 1.6). If provisioning fails, the franchise must
    // not be considered successfully created (Req 1.5).
    const { error: inventoryError } = await admin.rpc(
      "provision_franchise_inventory",
      { p_franchise_id: franchise.id }
    );

    if (inventoryError) {
      return {
        success: false,
        error: `Franchise created but inventory provisioning failed: ${inventoryError.message}`,
      };
    }

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: { id: franchise.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create franchise",
    };
  }
}

/**
 * Update an existing Franchise's name, group, owner, and/or status (Req 3.6).
 * Validates name (1..100) + group_id (uuid) + owner_user_id (uuid) and the
 * optional status against the allowed set; rejects an empty/oversized/duplicate
 * name, a non-existent group, a missing/non-FRANCHISE_ADMIN owner, and an
 * out-of-set status. Handles not-found.
 *
 * NOTE: lifecycle transitions are owned by {@link activateFranchise} /
 * {@link suspendFranchise} / {@link reactivateFranchise}; a `status` supplied
 * here is written verbatim after passing schema validation, but the transition
 * actions are the guarded path (Req 4.8).
 *
 * Validates: Requirement 3.6.
 */
export async function updateFranchise(
  id: string,
  input: FranchiseSchemaInput
): Promise<ActionResult<Franchise>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Franchise id is required" };
  }

  const validated = await validateFranchiseInput(input);
  if (!validated.ok) return validated.result;

  // Not-found guard.
  const existing = await getFranchiseById(id);
  if (!existing) {
    return { success: false, error: "Franchise not found" };
  }

  const { name, group_id, owner_user_id, status } = validated.data;

  // Reject a duplicate name, excluding the franchise being updated (Req 3.6).
  const dup = await assertUniqueFranchiseName(name, id);
  if (dup) return dup;

  // The owner must reference an existing FRANCHISE_ADMIN (Req 4.1, 4.2).
  const ownerRole = await resolveUserRoleCode(owner_user_id);
  if (ownerRole === null) {
    return {
      success: false,
      error: "The selected owner user does not exist",
      field: "owner_user_id",
    };
  }
  if (ownerRole !== FRANCHISE_SCOPED_ROLE) {
    return {
      success: false,
      error: "The franchise owner must be a Franchise Admin",
      field: "owner_user_id",
    };
  }

  try {
    const updated = await updateFranchiseRecord(id, {
      name,
      group_id,
      owner_user_id,
      ...(status !== undefined ? { status } : {}),
    });

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update franchise",
    };
  }
}

// ─── Lifecycle transitions (Task 6.2) ───────────────────────────────────────

/**
 * Shared driver for the lifecycle actions. Loads the franchise, rejects a no-op
 * transition via the pure {@link isValidStatusTransition} (Req 4.8), optionally
 * runs the unresolved-pincode-overlap activation guard (Req 15.5/15.6), then
 * persists the new status.
 */
async function transitionFranchise(
  id: string,
  to: FranchiseStatus,
  options?: { guardOverlap?: boolean }
): Promise<ActionResult<Franchise>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Franchise id is required" };
  }

  const existing = await getFranchiseById(id);
  if (!existing) {
    return { success: false, error: "Franchise not found" };
  }

  // Reject no-op transitions that would leave the status unchanged (Req 4.8).
  if (!isValidStatusTransition(existing.status, to)) {
    return {
      success: false,
      error:
        existing.status === to
          ? `Franchise is already "${to}"`
          : `Cannot change franchise status from "${existing.status}" to "${to}"`,
    };
  }

  // Activation / reactivation is refused while any unresolved pincode-overlap
  // conflict exists for the franchise (Req 15.5, 15.6).
  if (options?.guardOverlap) {
    let overlap = false;
    try {
      overlap = await hasUnresolvedPincodeOverlap(id);
    } catch {
      // A read failure here must not silently allow activation past the guard.
      return {
        success: false,
        error:
          "Unable to verify pincode assignments for activation. Please try again.",
      };
    }
    if (overlap) {
      return {
        success: false,
        error:
          "Cannot activate while an unresolved pincode overlap conflict exists. " +
          "Resolve the conflicting pincode assignments first.",
      };
    }
  }

  try {
    const updated = await setFranchiseStatus(id, to);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : `Failed to set franchise status to "${to}"`,
    };
  }
}

/**
 * Activate a Franchise (→ `active`). Rejects the no-op activate-when-active
 * (Req 4.8) and refuses while any unresolved pincode-overlap conflict exists
 * (Req 15.5, 15.6).
 *
 * Validates: Requirements 4.3, 4.4, 4.8, 15.5, 15.6.
 */
export async function activateFranchise(
  id: string
): Promise<ActionResult<Franchise>> {
  return transitionFranchise(id, "active", { guardOverlap: true });
}

/**
 * Suspend a Franchise (→ `suspended`). Rejects the no-op suspend-when-suspended
 * (Req 4.8). Suspended franchises retain their historical records; the denial of
 * Franchise_Admin dashboard operations is enforced in middleware (Req 4.5) — this
 * action only sets the status.
 *
 * Validates: Requirements 4.6, 4.7, 4.8.
 */
export async function suspendFranchise(
  id: string
): Promise<ActionResult<Franchise>> {
  return transitionFranchise(id, "suspended");
}

/**
 * Reactivate a suspended Franchise (→ `active`). Rejects the no-op
 * reactivate-when-active (Req 4.8) and, like activation, refuses while any
 * unresolved pincode-overlap conflict exists (Req 15.5, 15.6).
 *
 * Validates: Requirements 4.3, 4.4, 4.8, 15.5, 15.6.
 */
export async function reactivateFranchise(
  id: string
): Promise<ActionResult<Franchise>> {
  return transitionFranchise(id, "active", { guardOverlap: true });
}

// ─── Inter-group move (Task 6.3) ─────────────────────────────────────────────

/**
 * Move a Franchise from its current Group to a destination Group WITHIN THE SAME
 * CITY (Req 5.1–5.5). A thin wrapper over the SECURITY DEFINER RPC
 * `move_franchise_to_group`, which validates and re-points `franchises.group_id`
 * atomically and returns the destination Group's Kitchen id (the re-resolved
 * Kitchen / cascade preview — Req 5.4).
 *
 * The RPC touches ONLY `franchises.group_id`, so the franchise_id, its Clinics,
 * and its pincode/service-area assignments are preserved across the move
 * (Req 5.5) — surfaced here as `preservedFranchiseId`.
 *
 * RPC error mapping:
 *   - "destination group not found"                          → field `destGroupId` (Req 5.3)
 *   - "inter-group move allowed only within the same city"   → field `destGroupId` (Req 5.2)
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5.
 */
export async function moveFranchiseToGroup(
  franchiseId: string,
  destGroupId: string
): Promise<
  ActionResult<{ newKitchenId: string; preservedFranchiseId: string }>
> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!franchiseId || franchiseId.trim().length === 0) {
    return { success: false, error: "Franchise id is required", field: "franchiseId" };
  }
  if (!destGroupId || destGroupId.trim().length === 0) {
    return {
      success: false,
      error: "Destination group id is required",
      field: "destGroupId",
    };
  }

  const admin = createAdminClient();
  const { data: newKitchenId, error } = await admin.rpc(
    "move_franchise_to_group",
    {
      p_franchise_id: franchiseId,
      p_dest_group_id: destGroupId,
    }
  );

  if (error || !newKitchenId) {
    const message = error?.message ?? "";
    if (message.includes("destination group not found")) {
      return {
        success: false,
        error: "The destination group does not exist",
        field: "destGroupId",
      };
    }
    if (message.includes("same city")) {
      return {
        success: false,
        error: "A franchise can only be moved to another group in the same city",
        field: "destGroupId",
      };
    }
    return { success: false, error: message || "Failed to move franchise" };
  }

  revalidatePath(MASTER_SYSTEM_PATH);
  return {
    success: true,
    data: {
      newKitchenId: newKitchenId as string,
      preservedFranchiseId: franchiseId,
    },
  };
}
