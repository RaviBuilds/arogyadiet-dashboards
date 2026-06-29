"use server";

// src/actions/master-actions/groupActions.ts
// Master-portal Server Actions for Group CRUD in the multi-tenant-franchise
// hierarchy (multi-tenant-franchise spec — Task 5.2, Requirements 2.3, 2.5,
// 2.6, 2.7, 2.8).
//
// LAYERING: Action layer ONLY. These actions orchestrate authorization
// (full_network scope), the franchise feature-flag gate, pure validation
// (`groupSchema` from src/validations/franchise.ts), and data access. The two
// MULTI-STATEMENT, must-be-atomic operations are delegated to SECURITY DEFINER
// plpgsql RPCs invoked through the service-role admin client
// (`createAdminClient().rpc(...)`), mirroring serviceAreaActions.movePincode and
// scripts/create-move-franchise-to-group-rpc.sql:
//   - createGroup  → public.create_group_with_kitchen  (Req 2.3, 2.5)
//   - deleteGroup  → public.delete_group_with_kitchen   (Req 2.7, 2.8)
//
// A Group owns EXACTLY ONE Kitchen (groups.kitchen_id UNIQUE NOT NULL). Creating
// a Group therefore creates its Kitchen in the same transaction (no geo on the
// Kitchen — the routing origin always lives on the Clinic, Req 2.5). Renaming a
// Group NEVER reassigns its kitchen_id and a second Kitchen can never be
// attached (Req 2.6). Deleting a Group deletes its Kitchen atomically, and is
// rejected when any Franchise still references the Group (Req 2.7, 2.8).

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import { groupSchema, type GroupSchemaInput } from "@/validations/franchise";
import { getGroupById } from "@/repositories/franchise/groupRepository";
import { updateKitchen as updateKitchenRecord } from "@/repositories/clinic/kitchenRepository";
import type { ActionResult, Group } from "@/types/franchise";

const MASTER_SYSTEM_PATH = "/system";

// ─── Input shapes ─────────────────────────────────────────────────────────────

/**
 * Input accepted when creating a Group (Req 2.3, 2.6). `name` + `city_id` are
 * validated via {@link groupSchema}. `kitchenName` is optional — the single
 * owned Kitchen's label defaults to "<group> Kitchen" when omitted.
 */
export interface CreateGroupInput extends GroupSchemaInput {
  kitchenName?: string;
}

/**
 * Input accepted when updating a Group (Req 2.6). `name` + `city_id` are
 * validated via {@link groupSchema}. `kitchenName` optionally relabels the
 * owned Kitchen. `kitchen_id` is intentionally part of the shape ONLY so an
 * attempt to attach a second Kitchen can be explicitly rejected — it is never
 * written.
 */
export interface UpdateGroupInput extends GroupSchemaInput {
  kitchenName?: string;
  kitchen_id?: string;
}

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Gate every Group action behind the franchise feature flag and the
 * full_network scope (MASTER_ADMIN / ADMIN). Returns `null` when the caller is
 * authorized, or an `ActionResult` failure otherwise.
 *
 * - When FRANCHISE_FEATURES_ENABLED is off the franchise surface is inert
 *   (Req 18.3, 18.4): no franchise reads/writes are performed.
 * - Only the full_network scope may manage Groups (the franchise hierarchy is a
 *   master/admin concern).
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
      error: "Only an Admin or Master Admin can manage groups",
    };
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the Kitchen label for a new Group. Falls back to "<group> Kitchen"
 * when no explicit kitchen name is supplied (Req 2.3).
 */
function resolveKitchenName(
  groupName: string,
  kitchenName?: string
): string {
  const explicit = (kitchenName ?? "").trim();
  if (explicit.length > 0) return explicit;
  return `${groupName} Kitchen`;
}

// ─── Actions (Task 5.2) ─────────────────────────────────────────────────────

/**
 * Create a Group together with the single Kitchen it owns, atomically (Req 2.3,
 * 2.5, 2.6). Validates name (1..100) + city_id (uuid) via {@link groupSchema},
 * then delegates to the SECURITY DEFINER RPC `create_group_with_kitchen`, which
 * creates the Kitchen (no geo) and the Group in one transaction and returns the
 * new group id.
 *
 * Validates: Requirements 2.3, 2.5, 2.6.
 */
export async function createGroup(
  input: CreateGroupInput
): Promise<ActionResult<{ id: string; kitchenId?: string }>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid group",
      field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
    };
  }

  const { name, city_id } = parsed.data;
  const kitchenName = resolveKitchenName(name, input?.kitchenName);

  const admin = createAdminClient();
  const { data: groupId, error } = await admin.rpc(
    "create_group_with_kitchen",
    {
      p_city_id: city_id,
      p_group_name: name,
      p_kitchen_name: kitchenName,
    }
  );

  if (error || !groupId) {
    const message = error?.message ?? "";
    if (message.includes("city not found")) {
      return {
        success: false,
        error: "The selected city does not exist",
        field: "city_id",
      };
    }
    return {
      success: false,
      error: message || "Failed to create group",
    };
  }

  const id = groupId as string;

  // Resolve the owned Kitchen id for the caller (best-effort; the group already
  // exists at this point, so a read failure does not undo the create).
  let kitchenId: string | undefined;
  try {
    const group = await getGroupById(id);
    kitchenId = group?.kitchen_id;
  } catch {
    kitchenId = undefined;
  }

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { id, kitchenId } };
}

/**
 * Rename an existing Group, and optionally relabel the single Kitchen it owns.
 * NEVER reassigns `kitchen_id` and rejects any attempt to attach a second
 * Kitchen (Req 2.6). Handles not-found.
 *
 * Validates: Requirement 2.6.
 */
export async function updateGroup(
  id: string,
  input: UpdateGroupInput
): Promise<ActionResult<Group>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Group id is required" };
  }

  // A Group owns EXACTLY ONE Kitchen; attaching a second Kitchen is forbidden
  // (Req 2.6). Reject any attempt to supply a kitchen_id outright.
  if (input?.kitchen_id != null && String(input.kitchen_id).trim().length > 0) {
    return {
      success: false,
      error: "A group owns exactly one kitchen; a second kitchen cannot be attached",
      field: "kitchen_id",
    };
  }

  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid group",
      field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
    };
  }

  // Not-found guard.
  const existing = await getGroupById(id);
  if (!existing) {
    return { success: false, error: "Group not found" };
  }

  const { name } = parsed.data;

  try {
    // Rename the group ONLY — kitchen_id is never touched (Req 2.6).
    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("groups")
      .update({ name })
      .eq("id", id)
      .select("id, name, city_id, kitchen_id, created_at, updated_at")
      .single();

    if (error || !updated) {
      return {
        success: false,
        error: error?.message ?? "Failed to update group",
      };
    }

    // Optionally relabel the owned Kitchen (label only — no reassignment).
    const kitchenName = (input?.kitchenName ?? "").trim();
    if (kitchenName.length > 0) {
      await updateKitchenRecord(existing.kitchen_id, { name: kitchenName });
    }

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: updated as Group };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update group",
    };
  }
}

/**
 * Delete a Group together with the single Kitchen it owns, atomically (Req 2.7).
 * Delegates to the SECURITY DEFINER RPC `delete_group_with_kitchen`, which
 * refuses the deletion when any Franchise still references the Group (Req 2.8)
 * — surfaced here as a clean, user-facing error.
 *
 * Validates: Requirements 2.7, 2.8.
 */
export async function deleteGroup(id: string): Promise<ActionResult> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Group id is required" };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_group_with_kitchen", {
    p_group_id: id,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("group has associated franchises")) {
      return {
        success: false,
        error:
          "Cannot delete this group because one or more franchises are " +
          "associated with it. Remove or reassign those franchises first.",
      };
    }
    return { success: false, error: message || "Failed to delete group" };
  }

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: undefined };
}
