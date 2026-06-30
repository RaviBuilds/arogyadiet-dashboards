// src/repositories/franchise/cityRepository.ts
// Data-access layer for franchise `cities` (multi-tenant-franchise — Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation (that lives in the
// franchise validation lib) and no 'use server' wrappers (those live in
// src/actions/master-actions/ / franchise actions). All access uses the
// service-role admin client (createAdminClient) per the layering rules,
// mirroring the core-clinic cityRepository.
//
// A franchise City is the core-clinic `cities` row augmented with the additive
// nullable `business_id` column (see add-group-id-to-franchises.sql), so a City
// is scoped to a Franchise Business via `business_id` (Req 1.1). Scoping here is
// a Business filter on `business_id`, NOT the franchise `Scope` (which filters
// on `franchise_id`); cities carry no `franchise_id`, so `applyScope` does not
// apply to this table.

import { createAdminClient } from "@/lib/supabase/admin";
import type { FranchiseCity } from "@/types/franchise";

const FRANCHISE_CITY_COLUMNS =
  "id, name, created_at, updated_at, business_id";

/**
 * List the cities owned by a given Franchise Business via `business_id`,
 * ordered by name (Req 1.1). Returns only rows whose `business_id` matches.
 */
export async function listCitiesByBusiness(
  businessId: string
): Promise<FranchiseCity[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .select(FRANCHISE_CITY_COLUMNS)
    .eq("business_id", businessId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list cities for business ${businessId}: ${error.message}`
    );
  }
  return (data ?? []) as FranchiseCity[];
}

/**
 * Fetch a single franchise city by its identifier. Returns `null` when not
 * found.
 */
export async function getCityById(id: string): Promise<FranchiseCity | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .select(FRANCHISE_CITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch city ${id}: ${error.message}`);
  }
  return (data as FranchiseCity) ?? null;
}

/**
 * Insert a new city owned by the given Franchise Business (Req 1.1). The
 * database enforces case-insensitive name uniqueness; the action layer performs
 * duplicate-name checks before calling this.
 */
export async function insertCity(
  name: string,
  businessId: string
): Promise<FranchiseCity> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .insert({ name, business_id: businessId })
    .select(FRANCHISE_CITY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert city: ${error?.message ?? "unknown error"}`
    );
  }
  return data as FranchiseCity;
}

/**
 * Update an existing franchise city's name. Returns the updated record.
 */
export async function updateCity(
  id: string,
  name: string
): Promise<FranchiseCity> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cities")
    .update({ name })
    .eq("id", id)
    .select(FRANCHISE_CITY_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update city ${id}: ${error?.message ?? "unknown error"}`
    );
  }
  return data as FranchiseCity;
}

/**
 * Delete a franchise city by its identifier. Dependency guarding (rejecting
 * deletion when Groups reference the city) is the action layer's
 * responsibility, which should consult {@link countGroupsForCity} first
 * (Req 1.4, 1.5).
 */
export async function deleteCity(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("cities").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete city ${id}: ${error.message}`);
  }
}

/**
 * Count the number of Groups that reference the given city via `city_id`.
 * Supports the dependency-guarded city deletion (Req 1.4, 1.5): a city may be
 * deleted only when this count is zero.
 */
export async function countGroupsForCity(cityId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("groups")
    .select("id", { count: "exact", head: true })
    .eq("city_id", cityId);

  if (error) {
    throw new Error(
      `Failed to count groups for city ${cityId}: ${error.message}`
    );
  }
  return count ?? 0;
}
