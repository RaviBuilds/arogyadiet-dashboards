// src/repositories/clinic/serviceAreaRepository.ts
// Data-access layer for the `rider_service_areas` table as it participates in
// the clinic hierarchy (core-clinic-architecture).
//
// LAYERING: Data-access ONLY. No business validation (pincode format, 6-digit
// checks) and no 'use server' wrappers — those live in
// src/actions/admin-actions/serviceAreaActions.ts. Uses the service-role admin
// client, mirroring the established admin-operational table pattern.
//
// The one-pincode-one-clinic invariant is enforced at the DB level by the
// global unique index `uq_service_area_pincode` (Req 4.1, 4.2, 4.3); this layer
// surfaces rows so the action layer can return friendly errors.

import { createAdminClient } from "@/lib/supabase/admin";

const SERVICE_AREA_COLUMNS = "id, pincode, area_name, rider_id, clinic_id";

/**
 * A rider service area row scoped to the columns relevant to the clinic
 * hierarchy. `clinic_id` is the owning clinic (nullable until assigned); each
 * pincode belongs to at most one clinic (Req 4.1).
 */
export interface ServiceArea {
  id: string;
  pincode: string;
  area_name: string | null;
  rider_id: string | null;
  clinic_id: string | null;
}

/**
 * List all service areas owned by a given clinic via `clinic_id`, ordered by
 * pincode (Req 5.1).
 */
export async function listServiceAreasByClinic(
  clinicId: string
): Promise<ServiceArea[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .select(SERVICE_AREA_COLUMNS)
    .eq("clinic_id", clinicId)
    .order("pincode", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list service areas for clinic ${clinicId}: ${error.message}`
    );
  }
  return (data ?? []) as ServiceArea[];
}

/**
 * Fetch the single service area for a pincode, if any. Because `pincode` is
 * globally unique, this returns at most one row. Returns `null` when the
 * pincode is unassigned. Supports the already-assigned (current-owner) error
 * surfaced by the action layer (Req 5.2, 5.6).
 */
export async function getServiceAreaByPincode(
  pincode: string
): Promise<ServiceArea | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .select(SERVICE_AREA_COLUMNS)
    .eq("pincode", pincode)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up service area for pincode ${pincode}: ${error.message}`);
  }
  return (data as ServiceArea) ?? null;
}

/**
 * Fetch a single service area by its identifier. Returns `null` when not found
 * (supports not-found handling on edit/delete).
 */
export async function getServiceAreaById(id: string): Promise<ServiceArea | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .select(SERVICE_AREA_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch service area ${id}: ${error.message}`);
  }
  return (data as ServiceArea) ?? null;
}

/**
 * Input accepted when adding a pincode to a clinic (Req 5.2).
 */
export interface ServiceAreaInsert {
  clinic_id: string;
  pincode: string;
  area_name?: string | null;
}

/**
 * Insert a new service area assigning a pincode to a clinic. The DB unique
 * index `uq_service_area_pincode` rejects an already-assigned pincode; the
 * action layer translates that into a friendly error (Req 4.3, 5.2).
 */
export async function insertServiceArea(
  input: ServiceAreaInsert
): Promise<ServiceArea> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .insert({
      clinic_id: input.clinic_id,
      pincode: input.pincode,
      area_name: input.area_name ?? null,
    })
    .select(SERVICE_AREA_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert service area: ${error?.message ?? "unknown error"}`);
  }
  return data as ServiceArea;
}

/**
 * Update an existing service area's pincode (Req 5.3). The global unique index
 * rejects collisions with another clinic's pincode.
 */
export async function updateServiceAreaPincode(
  id: string,
  pincode: string
): Promise<ServiceArea> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .update({ pincode })
    .eq("id", id)
    .select(SERVICE_AREA_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update service area ${id}: ${error?.message ?? "unknown error"}`);
  }
  return data as ServiceArea;
}

/**
 * Delete a service area by its identifier (Req 5.5).
 */
export async function deleteServiceArea(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("rider_service_areas")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to delete service area ${id}: ${error.message}`);
  }
}

/**
 * Count the number of service areas owned by a given clinic. Supports
 * dependency-guarded clinic deletion (Req 3.10 deletion guard).
 */
export async function countServiceAreasForClinic(
  clinicId: string
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("rider_service_areas")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (error) {
    throw new Error(
      `Failed to count service areas for clinic ${clinicId}: ${error.message}`
    );
  }
  return count ?? 0;
}
