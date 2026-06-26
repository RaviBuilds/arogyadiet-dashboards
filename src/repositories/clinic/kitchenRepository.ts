// src/repositories/clinic/kitchenRepository.ts
// Data-access layer for the `kitchens` table as it participates in the
// City → Kitchen → Clinic hierarchy (core-clinic-architecture).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// The `kitchens` table is pre-existing and carries additional operational
// columns; only the columns relevant to the clinic hierarchy are selected here.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Kitchen } from "@/types/clinic";

const KITCHEN_COLUMNS = "id, name, address_text, lat, lng, is_active, city_id";

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
 * Input accepted when creating a kitchen within the clinic hierarchy.
 */
export interface KitchenInsert {
  name: string;
  city_id: string;
  address_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_active?: boolean;
}

/**
 * Insert a new kitchen with a city association. Validation that the `city_id`
 * references an existing city (Req 2.6) is the action layer's responsibility.
 */
export async function insertKitchen(input: KitchenInsert): Promise<Kitchen> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kitchens")
    .insert({
      name: input.name,
      city_id: input.city_id,
      address_text: input.address_text ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      is_active: input.is_active ?? true,
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
 * written.
 */
export interface KitchenUpdate {
  name?: string;
  city_id?: string;
  address_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_active?: boolean;
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
  if (input.city_id !== undefined) payload.city_id = input.city_id;
  if (input.address_text !== undefined) payload.address_text = input.address_text;
  if (input.lat !== undefined) payload.lat = input.lat;
  if (input.lng !== undefined) payload.lng = input.lng;
  if (input.is_active !== undefined) payload.is_active = input.is_active;

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
 * Supports dependency-guarded kitchen deletion (Req 14.6).
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
