// src/repositories/clinic/kitchenRepository.ts
// Data-access layer for the `kitchens` table as it participates in the
// Business → Kitchen → Clinic hierarchy (core-clinic-architecture).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
//
// SCHEMA (revised, no geo): A Kitchen is a meal-prep / workload-aggregation
// entity that belongs to exactly one Business (`business_id`, Req 2.2, 20.8) and
// exactly one City (`city_id`, Req 2.4). It carries NO street address, latitude,
// or longitude — the geographic routing origin is always the Clinic (Req 2.5).
// Any pre-existing lat/lng/address/is_active columns on the live `kitchens`
// table are NO LONGER USED by this feature and are intentionally not selected
// or written here.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Kitchen } from "@/types/clinic";

const KITCHEN_COLUMNS = "id, name, business_id, city_id";

/**
 * List all kitchens ordered by name.
 */
export async function listKitchens(): Promise<Kitchen[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .select(KITCHEN_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list kitchens: ${error.message}`);
  }
  return (data ?? []) as Kitchen[];
}

/**
 * Fetch a single kitchen by its identifier. Returns `null` when not found.
 */
export async function getKitchenById(id: string): Promise<Kitchen | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .select(KITCHEN_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch kitchen ${id}: ${error.message}`);
  }
  return (data as Kitchen) ?? null;
}

/**
 * List all kitchens associated with a given city via `city_id`.
 */
export async function listKitchensByCity(cityId: string): Promise<Kitchen[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .select(KITCHEN_COLUMNS)
    .eq("city_id", cityId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list kitchens for city ${cityId}: ${error.message}`);
  }
  return (data ?? []) as Kitchen[];
}

/**
 * List all kitchens owned by a given business via `business_id` (Req 20.8).
 */
export async function listKitchensByBusiness(
  businessId: string
): Promise<Kitchen[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .select(KITCHEN_COLUMNS)
    .eq("business_id", businessId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list kitchens for business ${businessId}: ${error.message}`
    );
  }
  return (data ?? []) as Kitchen[];
}

/**
 * Input accepted when creating a kitchen within the clinic hierarchy. Both a
 * `business_id` (Req 2.2, 2.8, 2.9) and a `city_id` (Req 2.4) are required; no
 * geo fields are accepted or persisted (Req 2.5).
 */
export interface KitchenInsert {
  name: string;
  business_id: string;
  city_id: string;
}

/**
 * Insert a new kitchen with its Business + City association. Validation that
 * the `business_id` / `city_id` reference existing records (Req 2.6, 2.8, 2.9)
 * is the action layer's responsibility; the database enforces the foreign keys.
 */
export async function insertKitchen(input: KitchenInsert): Promise<Kitchen> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .insert({
      name: input.name,
      business_id: input.business_id,
      city_id: input.city_id,
    })
    .select(KITCHEN_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert kitchen: ${error?.message ?? "unknown error"}`);
  }
  return data as Kitchen;
}

/**
 * Fields that may be updated on an existing kitchen. Only supplied keys are
 * written. No geo fields (Req 2.5).
 */
export interface KitchenUpdate {
  name?: string;
  business_id?: string;
  city_id?: string;
}

/**
 * Update an existing kitchen. Returns the updated record.
 */
export async function updateKitchen(
  id: string,
  input: KitchenUpdate
): Promise<Kitchen> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.business_id !== undefined) payload.business_id = input.business_id;
  if (input.city_id !== undefined) payload.city_id = input.city_id;

  const { data, error } = await admin
    .from("kitchens")
    .update(payload)
    .eq("id", id)
    .select(KITCHEN_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update kitchen ${id}: ${error?.message ?? "unknown error"}`);
  }
  return data as Kitchen;
}

/**
 * Delete a kitchen by its identifier. Dependency guarding (rejecting deletion
 * when clinics reference the kitchen) is the action layer's responsibility,
 * which should consult {@link countClinicsForKitchen} first.
 */
export async function deleteKitchen(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("kitchens").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete kitchen ${id}: ${error.message}`);
  }
}

/**
 * Count the number of clinics that reference the given kitchen via `kitchen_id`.
 * Supports dependency-guarded kitchen deletion (Req 2 deletion guard, 14.6).
 */
export async function countClinicsForKitchen(kitchenId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("clinics")
    .select("id", { count: "exact", head: true })
    .eq("kitchen_id", kitchenId);

  if (error) {
    throw new Error(
      `Failed to count clinics for kitchen ${kitchenId}: ${error.message}`
    );
  }
  return count ?? 0;
}
