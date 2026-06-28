// src/repositories/clinic/businessRepository.ts
// Data-access layer for the `businesses` table (core-clinic-architecture).
//
// LAYERING: This module is the data-access layer ONLY. It performs no business
// validation (that lives in src/lib/clinic/validation.ts) and exposes no
// 'use server' action wrappers (those live in src/actions/master-actions/).
// All access uses the service-role admin client, mirroring the franchise
// data-access pattern.
//
// A Business is the top-level grouping entity (typed Core | Franchise). A
// Kitchen belongs to exactly one Business via `kitchens.business_id`; a Clinic
// resolves its Business through its Kitchen (Clinic → Kitchen → Business), so
// clinics never store `business_id` directly. (Req 20.1, 20.8, 20.9)

import { createAdminClient } from "@/lib/supabase/admin";
import type { Business, BusinessType } from "@/types/clinic";

const BUSINESS_COLUMNS = "id, name, type, created_at, updated_at";

/**
 * List all businesses ordered by name.
 */
export async function listBusinesses(): Promise<Business[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list businesses: ${error.message}`);
  }
  return (data ?? []) as Business[];
}

/**
 * Fetch a single business by its identifier. Returns `null` when not found
 * (supports the 404 path in updateBusiness, Req 20.7).
 */
export async function getBusinessById(id: string): Promise<Business | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch business ${id}: ${error.message}`);
  }
  return (data as Business) ?? null;
}

/**
 * Input accepted when persisting a business. `name` is expected to be trimmed
 * and validated by the action layer (Req 20.1).
 */
export interface BusinessInsert {
  name: string;
  type: BusinessType;
}

/**
 * Insert a new business. Field validation (Req 20.1, 20.3, 20.4) is the action
 * layer's responsibility; the database enforces the `type` CHECK constraint.
 */
export async function insertBusiness(input: BusinessInsert): Promise<Business> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("businesses")
    .insert({ name: input.name, type: input.type })
    .select(BUSINESS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert business: ${error?.message ?? "unknown error"}`);
  }
  return data as Business;
}

/**
 * Update an existing business. Only supplied keys are written. Returns the
 * updated record.
 */
export async function updateBusiness(
  id: string,
  input: Partial<BusinessInsert>
): Promise<Business> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.type !== undefined) payload.type = input.type;

  const { data, error } = await admin
    .from("businesses")
    .update(payload)
    .eq("id", id)
    .select(BUSINESS_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update business ${id}: ${error?.message ?? "unknown error"}`);
  }
  return data as Business;
}

/**
 * Delete a business by its identifier. Dependency guarding (rejecting deletion
 * when kitchens reference the business) is the action layer's responsibility,
 * which should consult {@link countKitchensForBusiness} first (Req 20.5, 20.6).
 */
export async function deleteBusiness(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("businesses").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete business ${id}: ${error.message}`);
  }
}

/**
 * Count the number of kitchens that reference the given business via
 * `business_id`. Supports dependency-guarded business deletion (Req 20.5, 20.6).
 */
export async function countKitchensForBusiness(
  businessId: string
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("kitchens")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);

  if (error) {
    throw new Error(
      `Failed to count kitchens for business ${businessId}: ${error.message}`
    );
  }
  return count ?? 0;
}
