"use server";

// src/actions/master-actions/kitchenActions.ts
// Master-portal Server Actions for the Kitchen entity within the revised
// Business → Kitchen → Clinic hierarchy (core-clinic-architecture, Task 3.4).
//
// LAYERING: Action layer ONLY. Business rules (authorization, business/city
// reference validation, dependency-guarded deletion, and the clinic↔kitchen
// same-city reassignment rule) live here; all data access is delegated to the
// clinic-domain repositories. This file NEVER touches Supabase directly.
//
// SCHEMA (revised, no geo): A Kitchen is a meal-prep / workload-aggregation
// entity that belongs to exactly one Business (`business_id`, Req 2.2, 2.8, 2.9)
// and exactly one City (`city_id`, Req 2.4). It carries NO street address,
// latitude, or longitude — the geographic routing origin is always the Clinic
// (Req 2.5). One Business may own one or more Kitchens with no upper limit
// (Req 2.3, 2.12). The pre-existing `kitchens` table is additive and is NEVER
// dropped (Req 2.1) — these actions only insert/update/delete individual rows.
//
// A Clinic's city is derived through its current Kitchen's `city_id` (clinics
// store no city_id of their own). On reassignment the target Kitchen MUST
// belong to the same City as the Clinic's current Kitchen (Req 2.13, 2.14);
// otherwise the reassignment is rejected and `kitchen_id` is left unchanged.
// A successful reassignment re-resolves the Clinic's Business through the new
// Kitchen (Clinic → Kitchen → Business, Req 2.13, 20.9).
//
// Authorization mirrors `assertCallerCanManageClinics` in clinicActions.ts and
// `assertCallerCanManageCities` in cityActions.ts: the clinic hierarchy is
// managed by the global ADMIN / MASTER_ADMIN roles, aligning with the
// `is_global_role()` RLS policy created in
// scripts/create-clinic-hierarchy-tables.sql.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getBusinessById } from "@/repositories/clinic/businessRepository";
import { getCityById } from "@/repositories/clinic/cityRepository";
import {
  insertKitchen,
  updateKitchen as updateKitchenRecord,
  deleteKitchen as deleteKitchenRecord,
  getKitchenById,
  countClinicsForKitchen,
  type KitchenInsert,
  type KitchenUpdate,
} from "@/repositories/clinic/kitchenRepository";
import {
  getClinicById,
  reassignClinicKitchen as reassignClinicKitchenRecord,
  resolveBusinessForClinic,
} from "@/repositories/clinic/clinicRepository";
import { sameCity } from "@/lib/clinic/validation";
import type { ActionResult } from "@/types/clinic";

/** Maximum length accepted for a kitchen name. */
const KITCHEN_NAME_MAX = 200;

const MASTER_SYSTEM_PATH = "/system";

// Roles permitted to manage the Core Clinic hierarchy.
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors the authorization pattern in cityActions.ts / clinicActions.ts — the
 * clinic hierarchy is managed by global roles (Req 14, RLS `is_global_role()`).
 */
async function assertCallerCanManageKitchens(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { ok: false, error: "User record not found" };

  const rolesData = userRecord.roles as
    | { code?: string }
    | { code?: string }[]
    | null;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can manage kitchens",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Input shapes ─────────────────────────────────────────────────────────────

/**
 * Input accepted when creating or saving a Kitchen. Both a `business_id`
 * (Req 2.2, 2.8, 2.9) and a `city_id` (Req 2.4) are required; NO geo fields are
 * accepted or persisted (Req 2.5, 21.4).
 */
export interface KitchenInput {
  name: string;
  business_id: string;
  city_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate that `businessId` references an existing Business (Req 2.8, 2.9).
 * Returns an `ActionResult` failure (field = "business_id") when the value is
 * missing/blank or does not resolve to a real Business; returns `null` when
 * valid.
 */
async function assertBusinessExists(
  businessId: string | null | undefined
): Promise<{ success: false; error: string; field?: string } | null> {
  if (!businessId || businessId.trim().length === 0) {
    return {
      success: false,
      error: "A valid Business association is required",
      field: "business_id",
    };
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return {
      success: false,
      error: "A valid Business association is required",
      field: "business_id",
    };
  }

  return null;
}

/**
 * Validate that `cityId` references an existing City (Req 2.4). Returns an
 * `ActionResult` failure (field = "city_id") when the value is missing/blank or
 * does not resolve to a real City; returns `null` when valid.
 */
async function assertCityExists(
  cityId: string | null | undefined
): Promise<{ success: false; error: string; field?: string } | null> {
  if (!cityId || cityId.trim().length === 0) {
    return {
      success: false,
      error: "A valid City association is required",
      field: "city_id",
    };
  }

  const city = await getCityById(cityId);
  if (!city) {
    return {
      success: false,
      error: "A valid City association is required",
      field: "city_id",
    };
  }

  return null;
}

/** Validate the kitchen name. Returns an `ActionResult` failure or `null`. */
function validateKitchenName(
  rawName: string | null | undefined
): { success: false; error: string; field?: string } | null {
  const name = (rawName ?? "").trim();
  if (name.length === 0) {
    return { success: false, error: "Kitchen name is required", field: "name" };
  }
  if (name.length > KITCHEN_NAME_MAX) {
    return {
      success: false,
      error: `Kitchen name cannot exceed ${KITCHEN_NAME_MAX} characters`,
      field: "name",
    };
  }
  return null;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

/**
 * Create a Kitchen associated with a valid Business and City (Req 2.2, 2.4,
 * 2.5, 2.8, 2.9). Persists NO address/lat/lng. Rejects with the offending field
 * error when the name is invalid or no valid Business / City is referenced; in
 * that case no Kitchen record is created (Req 2.9).
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.12.
 */
export async function createKitchen(
  input: KitchenInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await assertCallerCanManageKitchens();
  if (!auth.ok) return { success: false, error: auth.error };

  const nameError = validateKitchenName(input?.name);
  if (nameError) return nameError;

  const businessError = await assertBusinessExists(input?.business_id);
  if (businessError) return businessError;

  const cityError = await assertCityExists(input?.city_id);
  if (cityError) return cityError;

  const payload: KitchenInsert = {
    name: input.name.trim(),
    business_id: input.business_id,
    city_id: input.city_id,
  };

  try {
    const kitchen = await insertKitchen(payload);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: { id: kitchen.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create kitchen",
    };
  }
}

/**
 * Update (save) an existing Kitchen (Req 2.5, 2.8, 2.9). Requires a valid
 * Business and City association; persists NO address/lat/lng. When the Business
 * or City reference is invalid the operation is rejected and the existing
 * Kitchen record is left unchanged (Req 2.9). Handles not-found.
 *
 * Validates: Requirements 2.2, 2.4, 2.5, 2.8, 2.9.
 */
export async function updateKitchen(
  id: string,
  input: KitchenInput
): Promise<ActionResult> {
  const auth = await assertCallerCanManageKitchens();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Kitchen id is required" };
  }

  // Confirm the Kitchen exists before mutating (not-found guard).
  const existing = await getKitchenById(id);
  if (!existing) {
    return { success: false, error: "Kitchen not found" };
  }

  const nameError = validateKitchenName(input?.name);
  if (nameError) return nameError;

  const businessError = await assertBusinessExists(input?.business_id);
  if (businessError) return businessError;

  const cityError = await assertCityExists(input?.city_id);
  if (cityError) return cityError;

  const updates: KitchenUpdate = {
    name: input.name.trim(),
    business_id: input.business_id,
    city_id: input.city_id,
  };

  try {
    await updateKitchenRecord(id, updates);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update kitchen",
    };
  }
}

/**
 * Delete a Kitchen, guarded by its dependents (Req 2.6 deletion guard, 14.7).
 * Rejects the deletion when one or more Clinics reference the Kitchen,
 * retaining the record unchanged. Handles not-found.
 *
 * Validates: Requirements 2.6, 14.7.
 */
export async function deleteKitchen(id: string): Promise<ActionResult> {
  const auth = await assertCallerCanManageKitchens();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Kitchen id is required" };
  }

  const existing = await getKitchenById(id);
  if (!existing) {
    return { success: false, error: "Kitchen not found" };
  }

  try {
    const clinicCount = await countClinicsForKitchen(id);
    if (clinicCount > 0) {
      return {
        success: false,
        error:
          "Cannot delete kitchen — it is referenced by one or more clinics. " +
          "Remove or reassign those clinics first.",
      };
    }

    await deleteKitchenRecord(id);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete kitchen",
    };
  }
}

/**
 * Reassign a Clinic to a different Kitchen, enforcing the same-city rule
 * (Req 2.13, 2.14).
 *
 * A Clinic's city is derived through its current Kitchen's `city_id` (clinics
 * store no `city_id`). The reassignment is accepted ONLY when the target
 * Kitchen's City equals the Clinic's current Kitchen's City (Req 2.13);
 * otherwise it is rejected, the Clinic's existing `kitchen_id` is left unchanged
 * (Req 2.14), and an error indicating the same-city requirement is returned. On
 * success the Clinic's `kitchen_id` is updated and its Business is re-resolved
 * through the new Kitchen (Clinic → Kitchen → Business, Req 2.13, 20.9).
 *
 * Validates: Requirements 2.13, 2.14, 20.9.
 */
export async function reassignClinicKitchen(
  clinicId: string,
  newKitchenId: string
): Promise<ActionResult> {
  const auth = await assertCallerCanManageKitchens();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!clinicId || clinicId.trim().length === 0) {
    return { success: false, error: "Clinic id is required" };
  }
  if (!newKitchenId || newKitchenId.trim().length === 0) {
    return {
      success: false,
      error: "A target kitchen is required",
      field: "kitchen_id",
    };
  }

  // Resolve the Clinic (not-found guard).
  const clinic = await getClinicById(clinicId);
  if (!clinic) {
    return { success: false, error: "Clinic not found" };
  }

  // Resolve the target Kitchen (must exist) and the Clinic's current Kitchen
  // (whose city defines the Clinic's city).
  const [newKitchen, currentKitchen] = await Promise.all([
    getKitchenById(newKitchenId),
    getKitchenById(clinic.kitchen_id),
  ]);

  if (!newKitchen) {
    return {
      success: false,
      error: "The selected kitchen does not exist",
      field: "kitchen_id",
    };
  }

  // The Clinic's city is its current kitchen's city. If the current kitchen is
  // missing its city association we cannot establish the Clinic's city, so the
  // same-city rule cannot be satisfied — reject and leave the linkage unchanged.
  if (!currentKitchen || !currentKitchen.city_id) {
    return {
      success: false,
      error:
        "Cannot determine the clinic's city from its current kitchen; " +
        "reassignment rejected.",
      field: "kitchen_id",
    };
  }

  // Same-city rule (Req 2.13, 2.14): the target kitchen must belong to the same
  // City as the clinic's current kitchen.
  if (!sameCity(currentKitchen.city_id, newKitchen.city_id)) {
    return {
      success: false,
      error: "The kitchen and clinic must belong to the same city",
      field: "kitchen_id",
    };
  }

  try {
    await reassignClinicKitchenRecord(clinicId, newKitchenId);

    // Re-resolve the Clinic's Business through the new Kitchen (Req 2.13, 20.9).
    // This is a read-through confirming the Clinic → Kitchen → Business chain is
    // consistent after the move; a data-integrity failure here surfaces as an
    // error rather than silently leaving an inconsistent state.
    await resolveBusinessForClinic(clinicId);

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to reassign clinic kitchen",
    };
  }
}
