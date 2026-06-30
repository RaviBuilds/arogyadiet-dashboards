// src/repositories/franchise/franchiseRepository.ts
// Data-access layer for the `franchises` table as it participates in the
// multi-tenant hierarchy (multi-tenant-franchise — Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// A Franchise belongs to exactly one Group (`group_id`); its Kitchen, City, and
// Business are resolved THROUGH the Group. The legacy `franchises.kitchen_id`
// column is DEPRECATED (left physically present, no longer read or written —
// see add-group-id-to-franchises.sql) and is intentionally never selected or
// written here. The single FRANCHISE_ADMIN owner is `owner_user_id`. (Req 3.1)

import { createAdminClient } from "@/lib/supabase/admin";
import type { Franchise, FranchiseStatus } from "@/types/franchise";

// NOTE: deliberately excludes the deprecated `kitchen_id` column.
const FRANCHISE_COLUMNS =
  "id, name, group_id, owner_user_id, status, created_at, updated_at";

/**
 * Input for inserting a Franchise into the hierarchy (Req 3.1). A Franchise is
 * created against a Group with a single FRANCHISE_ADMIN owner; `status` defaults
 * to `onboarding` at the DB level when omitted.
 */
export interface FranchiseInsert {
  name: string;
  group_id: string;
  owner_user_id: string;
  status?: FranchiseStatus;
}

/**
 * Fields that may be updated on an existing Franchise. Only supplied keys are
 * written. The deprecated `kitchen_id` is never written.
 */
export interface FranchiseUpdate {
  name?: string;
  group_id?: string;
  owner_user_id?: string;
  status?: FranchiseStatus;
}

/**
 * List Franchises ordered by name. When `groupId` is supplied, only Franchises
 * belonging to that Group are returned.
 */
export async function listFranchises(groupId?: string): Promise<Franchise[]> {
  const admin = createAdminClient();
  let query = admin
    .from("franchises")
    .select(FRANCHISE_COLUMNS)
    .order("name", { ascending: true });

  if (groupId) {
    query = query.eq("group_id", groupId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list franchises: ${error.message}`);
  }
  return (data ?? []) as Franchise[];
}

/**
 * Fetch a single Franchise by its identifier. Returns `null` when not found.
 */
export async function getFranchiseById(id: string): Promise<Franchise | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchises")
    .select(FRANCHISE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch franchise ${id}: ${error.message}`);
  }
  return (data as Franchise) ?? null;
}

/**
 * Insert a new Franchise with its Group association, owner, and status (Req 3.1,
 * 3.3). Existence of `group_id` / `owner_user_id` and the status-transition
 * rules are the action layer's responsibility; the DB enforces the FKs and the
 * `franchise_status` enum.
 */
export async function insertFranchise(
  input: FranchiseInsert
): Promise<Franchise> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {
    name: input.name,
    group_id: input.group_id,
    owner_user_id: input.owner_user_id,
  };
  if (input.status !== undefined) payload.status = input.status;

  const { data, error } = await admin
    .from("franchises")
    .insert(payload)
    .select(FRANCHISE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert franchise: ${error?.message ?? "unknown error"}`
    );
  }
  return data as Franchise;
}

/**
 * Update an existing Franchise. Only supplied keys are written. Returns the
 * updated record.
 */
export async function updateFranchise(
  id: string,
  input: FranchiseUpdate
): Promise<Franchise> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.group_id !== undefined) payload.group_id = input.group_id;
  if (input.owner_user_id !== undefined)
    payload.owner_user_id = input.owner_user_id;
  if (input.status !== undefined) payload.status = input.status;

  const { data, error } = await admin
    .from("franchises")
    .update(payload)
    .eq("id", id)
    .select(FRANCHISE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update franchise ${id}: ${error?.message ?? "unknown error"}`
    );
  }
  return data as Franchise;
}

/**
 * Set a Franchise's lifecycle status (Req 3.3, 4.x). The action layer validates
 * the transition (onboarding → active → suspended → active); this writes the
 * supplied status verbatim. Returns the updated record.
 */
export async function setFranchiseStatus(
  id: string,
  status: FranchiseStatus
): Promise<Franchise> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchises")
    .update({ status })
    .eq("id", id)
    .select(FRANCHISE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to set status for franchise ${id}: ${error?.message ?? "unknown error"}`
    );
  }
  return data as Franchise;
}
