// src/repositories/franchise/groupRepository.ts
// Data-access layer for the `groups` table (multi-tenant-franchise — Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// A Group lives within one City (`city_id`) and owns EXACTLY ONE Kitchen
// (`kitchen_id`, UNIQUE NOT NULL). The Group→Kitchen 1:1 is enforced by the DB.
//
// ATOMIC GROUP + KITCHEN CREATION (Req 2.3): creating a Group together with its
// single owned Kitchen must be one transaction. This codebase performs
// multi-statement atomicity via SECURITY DEFINER plpgsql RPCs invoked through
// `createAdminClient().rpc(...)` (see scripts/create-move-franchise-to-group-rpc.sql
// and scripts/create-move-pincode-rpc.sql). The authoritative atomic
// group+kitchen creation is therefore finalized in the `groupActions` Server
// Action (Task 5.2) — either by calling such an RPC or by composing the
// building-block inserts (Kitchen via the clinic `kitchenRepository.insertKitchen`,
// then {@link insertGroup} here) inside that action. {@link insertGroup} below is
// the Group half of those building blocks and performs NO kitchen creation on
// its own.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Group } from "@/types/franchise";

const GROUP_COLUMNS =
  "id, name, city_id, kitchen_id, created_at, updated_at";

/**
 * Input for inserting a Group. The `kitchen_id` must reference an already
 * created Kitchen that no other Group owns (the DB enforces UNIQUE NOT NULL).
 * Building block for the atomic group+kitchen creation finalized in
 * `groupActions` (Task 5.2, Req 2.3).
 */
export interface GroupInsert {
  name: string;
  city_id: string;
  kitchen_id: string;
}

/**
 * List all Groups within a given City via `city_id`, ordered by name.
 */
export async function listGroupsByCity(cityId: string): Promise<Group[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("city_id", cityId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list groups for city ${cityId}: ${error.message}`
    );
  }
  return (data ?? []) as Group[];
}

/**
 * Fetch a single Group by its identifier. Returns `null` when not found.
 */
export async function getGroupById(id: string): Promise<Group | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch group ${id}: ${error.message}`);
  }
  return (data as Group) ?? null;
}

/**
 * Insert a Group bound to its single owned Kitchen (`kitchen_id`). This is the
 * Group half of the atomic group+kitchen creation (Req 2.3); the action layer
 * is responsible for creating the Kitchen first and wrapping both writes in one
 * transaction (Task 5.2). The DB enforces the Group→Kitchen 1:1 via the UNIQUE
 * NOT NULL constraint on `groups.kitchen_id`.
 */
export async function insertGroup(input: GroupInsert): Promise<Group> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("groups")
    .insert({
      name: input.name,
      city_id: input.city_id,
      kitchen_id: input.kitchen_id,
    })
    .select(GROUP_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert group: ${error?.message ?? "unknown error"}`
    );
  }
  return data as Group;
}

/**
 * Delete a Group row by its identifier. This deletes ONLY the group row; use
 * {@link deleteGroupWithKitchen} to also remove the owned Kitchen (Req 2.7).
 * Dependency guarding (rejecting deletion when Franchises reference the Group)
 * is the action layer's responsibility, which should consult
 * {@link countFranchisesForGroup} first (Req 2.8).
 */
export async function deleteGroup(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("groups").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete group ${id}: ${error.message}`);
  }
}

/**
 * Delete a Group together with its single owned Kitchen (Req 2.7). The group row
 * is deleted first (it carries the `kitchen_id` FK to `kitchens`), then the
 * owned kitchen is removed.
 *
 * ATOMICITY: like the rest of this domain's multi-statement writes, the
 * authoritative single-transaction guarantee is finalized in the `groupActions`
 * Server Action (Task 5.2) — preferably via a SECURITY DEFINER RPC mirroring
 * scripts/create-move-franchise-to-group-rpc.sql. This helper composes the two
 * building-block deletes in dependency order; the action layer must have
 * already verified there are no dependent Franchises (Req 2.8).
 */
export async function deleteGroupWithKitchen(id: string): Promise<void> {
  const admin = createAdminClient();

  const { data: group, error: fetchError } = await admin
    .from("groups")
    .select("id, kitchen_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    throw new Error(
      `Failed to resolve group ${id} for deletion: ${fetchError.message}`
    );
  }
  if (!group) {
    // Nothing to delete — treat as a no-op so callers are idempotent.
    return;
  }

  const kitchenId = (group as { kitchen_id: string }).kitchen_id;

  // Delete the group first (it holds the FK to kitchens), then its kitchen.
  const { error: groupError } = await admin
    .from("groups")
    .delete()
    .eq("id", id);

  if (groupError) {
    throw new Error(`Failed to delete group ${id}: ${groupError.message}`);
  }

  const { error: kitchenError } = await admin
    .from("kitchens")
    .delete()
    .eq("id", kitchenId);

  if (kitchenError) {
    throw new Error(
      `Failed to delete kitchen ${kitchenId} owned by group ${id}: ${kitchenError.message}`
    );
  }
}

/**
 * Count the number of Franchises that reference the given Group via `group_id`.
 * Supports the dependency-guarded group deletion (Req 2.8): a Group may be
 * deleted only when this count is zero.
 */
export async function countFranchisesForGroup(
  groupId: string
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("franchises")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (error) {
    throw new Error(
      `Failed to count franchises for group ${groupId}: ${error.message}`
    );
  }
  return count ?? 0;
}
