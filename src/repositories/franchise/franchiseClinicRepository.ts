// src/repositories/franchise/franchiseClinicRepository.ts
// Data-access layer for franchise `clinics` rows (multi-tenant-franchise —
// Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// A franchise Clinic is a row in the shared `clinics` table with a non-null
// `franchise_id`. Geo (address / latitude / longitude) lives on the Clinic
// (Req 6.1). The Clinic's Kitchen is the Franchise's Group's Kitchen
// (Clinic → Franchise → Group → Kitchen); the action layer resolves that
// Kitchen via the Group and passes it here as `kitchen_id` — this layer does no
// resolution itself.

import { createAdminClient } from "@/lib/supabase/admin";
import type { FranchiseClinic } from "@/types/franchise";

const CLINIC_COLUMNS =
  "id, name, address, latitude, longitude, kitchen_id, franchise_id, created_at, updated_at";

/**
 * Input for inserting a franchise Clinic (Req 6.1). `franchise_id` is required
 * (franchise clinics always carry their owning Franchise) and `kitchen_id` is
 * the Franchise's Group's Kitchen, resolved by the action layer via the Group.
 */
export interface FranchiseClinicInsert {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  franchise_id: string;
  kitchen_id: string;
}

/**
 * Fields that may be updated on a franchise Clinic. Only supplied keys are
 * written.
 */
export interface FranchiseClinicUpdate {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  kitchen_id?: string;
}

/**
 * List the Clinics belonging to a given Franchise via `franchise_id`, ordered by
 * name (Req 6.1).
 */
export async function listClinicsByFranchise(
  franchiseId: string
): Promise<FranchiseClinic[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select(CLINIC_COLUMNS)
    .eq("franchise_id", franchiseId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list clinics for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data ?? []) as FranchiseClinic[];
}

/**
 * Fetch a single franchise Clinic by its identifier. Returns `null` when not
 * found.
 */
export async function getFranchiseClinicById(
  id: string
): Promise<FranchiseClinic | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select(CLINIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch clinic ${id}: ${error.message}`);
  }
  return (data as FranchiseClinic) ?? null;
}

/**
 * Insert a new franchise Clinic carrying its `franchise_id` and the Kitchen
 * resolved via the Franchise's Group (`kitchen_id`). The action layer enforces
 * the resolution and field validation; the DB enforces coordinate ranges and
 * the foreign keys. (Req 6.1)
 */
export async function insertFranchiseClinic(
  input: FranchiseClinicInsert
): Promise<FranchiseClinic> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .insert({
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      franchise_id: input.franchise_id,
      kitchen_id: input.kitchen_id,
    })
    .select(CLINIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert franchise clinic: ${error?.message ?? "unknown error"}`
    );
  }
  return data as FranchiseClinic;
}

/**
 * Update an existing franchise Clinic. Only supplied keys are written. Returns
 * the updated record.
 */
export async function updateFranchiseClinic(
  id: string,
  input: FranchiseClinicUpdate
): Promise<FranchiseClinic> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.address !== undefined) payload.address = input.address;
  if (input.latitude !== undefined) payload.latitude = input.latitude;
  if (input.longitude !== undefined) payload.longitude = input.longitude;
  if (input.kitchen_id !== undefined) payload.kitchen_id = input.kitchen_id;

  const { data, error } = await admin
    .from("clinics")
    .update(payload)
    .eq("id", id)
    .select(CLINIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update franchise clinic ${id}: ${error?.message ?? "unknown error"}`
    );
  }
  return data as FranchiseClinic;
}
