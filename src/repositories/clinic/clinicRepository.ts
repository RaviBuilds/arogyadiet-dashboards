// src/repositories/clinic/clinicRepository.ts
// Data-access layer for the `clinics` table (core-clinic-architecture).
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// src/lib/clinic/validation.ts) and no 'use server' wrappers (those live in
// src/actions/master-actions/clinicActions.ts). Uses the service-role admin
// client, mirroring the franchise data-access pattern.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Clinic, ClinicCreateInput, ClinicUpdateInput } from "@/types/clinic";

const CLINIC_COLUMNS =
  "id, name, address, latitude, longitude, kitchen_id, franchise_id, created_at, updated_at";

/**
 * Per-relationship breakdown of records referencing a clinic, plus the total.
 * Supports dependency-guarded clinic deletion (Req 14.5, 14.6): a clinic may be
 * deleted only when `total` is zero.
 */
export interface ClinicDependencyCounts {
  serviceAreas: number;
  riders: number;
  customers: number;
  snapshots: number;
  total: number;
}

/**
 * List all clinics ordered by name.
 */
export async function listClinics(): Promise<Clinic[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select(CLINIC_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list clinics: ${error.message}`);
  }
  return (data ?? []) as Clinic[];
}

/**
 * Fetch a single clinic by its identifier. Returns `null` when not found.
 */
export async function getClinicById(id: string): Promise<Clinic | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select(CLINIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch clinic ${id}: ${error.message}`);
  }
  return (data as Clinic) ?? null;
}

/**
 * List all clinics served by a given kitchen via `kitchen_id`.
 */
export async function listClinicsByKitchen(kitchenId: string): Promise<Clinic[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select(CLINIC_COLUMNS)
    .eq("kitchen_id", kitchenId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list clinics for kitchen ${kitchenId}: ${error.message}`
    );
  }
  return (data ?? []) as Clinic[];
}

/**
 * Insert a new clinic. Field validation (Req 3.5–3.8) and the clinic↔kitchen
 * same-city rule (Req 2.7) are enforced by the action layer; the database
 * enforces coordinate ranges and the `kitchen_id` foreign key. `franchise_id`
 * defaults to `null` (Core Clinic) when not provided.
 */
export async function insertClinic(input: ClinicCreateInput): Promise<Clinic> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .insert({
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      kitchen_id: input.kitchen_id,
      franchise_id: input.franchise_id ?? null,
    })
    .select(CLINIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert clinic: ${error?.message ?? "unknown error"}`);
  }
  return data as Clinic;
}

/**
 * Update an existing clinic. Only supplied keys are written. Returns the
 * updated record.
 */
export async function updateClinic(
  id: string,
  input: ClinicUpdateInput
): Promise<Clinic> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.address !== undefined) payload.address = input.address;
  if (input.latitude !== undefined) payload.latitude = input.latitude;
  if (input.longitude !== undefined) payload.longitude = input.longitude;
  if (input.kitchen_id !== undefined) payload.kitchen_id = input.kitchen_id;
  if (input.franchise_id !== undefined) payload.franchise_id = input.franchise_id;

  const { data, error } = await admin
    .from("clinics")
    .update(payload)
    .eq("id", id)
    .select(CLINIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update clinic ${id}: ${error?.message ?? "unknown error"}`);
  }
  return data as Clinic;
}

/**
 * Delete a clinic by its identifier. Dependency guarding is the action layer's
 * responsibility, which should consult {@link countClinicDependents} first.
 */
export async function deleteClinic(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("clinics").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete clinic ${id}: ${error.message}`);
  }
}

/**
 * Count records referencing the given clinic across `rider_service_areas`,
 * `rider_profiles`, `customer_profiles`, and `workload_snapshots` via their
 * `clinic_id` columns. Supports dependency-guarded deletion (Req 14.5, 14.6).
 */
export async function countClinicDependents(
  clinicId: string
): Promise<ClinicDependencyCounts> {
  const admin = createAdminClient();

  const countRefs = async (table: string): Promise<number> => {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);

    if (error) {
      throw new Error(
        `Failed to count ${table} for clinic ${clinicId}: ${error.message}`
      );
    }
    return count ?? 0;
  };

  const [serviceAreas, riders, customers, snapshots] = await Promise.all([
    countRefs("rider_service_areas"),
    countRefs("rider_profiles"),
    countRefs("customer_profiles"),
    countRefs("workload_snapshots"),
  ]);

  return {
    serviceAreas,
    riders,
    customers,
    snapshots,
    total: serviceAreas + riders + customers + snapshots,
  };
}
