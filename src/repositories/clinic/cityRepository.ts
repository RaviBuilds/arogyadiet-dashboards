// src/repositories/clinic/cityRepository.ts
// Data-access layer for the `cities` table (core-clinic-architecture).
//
// LAYERING: This module is the data-access layer ONLY. It performs no business
// validation (that lives in src/lib/clinic/validation.ts) and exposes no
// 'use server' action wrappers (those live in src/actions/master-actions/).
// All access uses the service-role admin client, mirroring the franchise
// data-access pattern (see assignment-resolver.ts / franchiseActions.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import type { City } from "@/types/clinic";

const CITY_COLUMNS = "id, name, created_at, updated_at";

/**
 * List all cities ordered by name (case-insensitive ascending).
 */
export async function listCities(): Promise<City[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .select(CITY_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list cities: ${error.message}`);
  }
  return (data ?? []) as City[];
}

/**
 * Fetch a single city by its identifier. Returns `null` when not found.
 */
export async function getCityById(id: string): Promise<City | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .select(CITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch city ${id}: ${error.message}`);
  }
  return (data as City) ?? null;
}

/**
 * Fetch a city whose name matches the supplied value case-insensitively.
 * Used by the action layer for duplicate-name checks (Req 1.1). When
 * `excludeId` is provided, that record is ignored so a city can keep its own
 * name on edit (self-rename, Req 1.4). Returns `null` when no other city
 * matches.
 */
export async function getCityByNameLower(
  name: string,
  excludeId?: string
): Promise<City | null> {
  const admin = createAdminClient();
  let query = admin
    .from("cities")
    .select(CITY_COLUMNS)
    .ilike("name", name);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up city by name: ${error.message}`);
  }
  return (data as City) ?? null;
}

/**
 * Insert a new city with the supplied name. The database enforces
 * case-insensitive uniqueness via `uq_cities_name_lower`.
 */
export async function insertCity(name: string): Promise<City> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .insert({ name })
    .select(CITY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert city: ${error?.message ?? "unknown error"}`);
  }
  return data as City;
}

/**
 * Update an existing city's name. Returns the updated record.
 */
export async function updateCity(id: string, name: string): Promise<City> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .update({ name })
    .eq("id", id)
    .select(CITY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update city ${id}: ${error?.message ?? "unknown error"}`);
  }
  return data as City;
}

/**
 * Delete a city by its identifier. Dependency guarding (rejecting deletion when
 * kitchens reference the city) is the responsibility of the action layer, which
 * should consult {@link countKitchensForCity} first.
 */
export async function deleteCity(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("cities").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete city ${id}: ${error.message}`);
  }
}

/**
 * Count the number of kitchens that reference the given city via `city_id`.
 * Supports dependency-guarded deletion (Req 1.5, 1.6, 14.6).
 */
export async function countKitchensForCity(cityId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("kitchens")
    .select("id", { count: "exact", head: true })
    .eq("city_id", cityId);

  if (error) {
    throw new Error(`Failed to count kitchens for city ${cityId}: ${error.message}`);
  }
  return count ?? 0;
}
