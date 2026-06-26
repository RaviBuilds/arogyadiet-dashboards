"use server";

// src/actions/master-actions/clinicActions.ts
// Master-portal Server Actions for the Clinic entity within the
// City → Kitchen → Clinic hierarchy (core-clinic-architecture, Task 2.4).
//
// LAYERING: Action layer ONLY. Business rules (authorization, field validation,
// the clinic↔kitchen same-city rule, kitchen-reference validation, and
// dependency-guarded deletion) live here; all data access is delegated to the
// clinic-domain repositories (clinicRepository / kitchenRepository). This file
// NEVER touches Supabase directly.
//
// Authorization mirrors the `assertCallerCanManageCities` helper in
// src/actions/master-actions/cityActions.ts: the clinic hierarchy is managed by
// the global ADMIN / MASTER_ADMIN roles, aligning with the `is_global_role()`
// RLS policy created in scripts/create-clinic-hierarchy-tables.sql.
//
// Same-city rule interpretation (Req 2.7): the `clinics` table has no `city_id`
// column — a clinic's city is derived through its kitchen's `city_id`. Per the
// design, "a clinic and its kitchen must share a city". Because a Clinic has no
// independent city of its own at create time, the rule is enforced on
// RE-ASSOCIATION: when an existing Clinic's `kitchen_id` is changed, the new
// Kitchen MUST belong to the same City as the Clinic's current Kitchen,
// otherwise the association is rejected and the existing linkage is left
// unchanged. On create there is no prior city context, so the create path only
// validates that the referenced Kitchen exists (Req 3.8).

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  getClinicById,
  insertClinic,
  updateClinic as updateClinicRecord,
  deleteClinic as deleteClinicRecord,
  countClinicDependents,
} from "@/repositories/clinic/clinicRepository";
import { getKitchenById } from "@/repositories/clinic/kitchenRepository";
import {
  validateClinicInput,
  CLINIC_CREATE_BOUNDS,
  CLINIC_FORM_BOUNDS,
  type ClinicValidationError,
  type ClinicValidatableInput,
} from "@/lib/clinic/validation";
import type {
  ActionResult,
  ClinicCreateInput,
  ClinicUpdateInput,
} from "@/types/clinic";

const MASTER_SYSTEM_PATH = "/system";

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors `assertCallerCanManageCities` in cityActions.ts — the clinic
 * hierarchy is managed by global roles (Req 14, RLS `is_global_role()`).
 */
async function assertCallerCanManageClinics(): Promise<
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

  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can manage clinics",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map a {@link ClinicValidationError} to a user-facing message (Req 3.6, 3.7, 14.3). */
function clinicValidationErrorMessage(error: ClinicValidationError): string {
  switch (error.field) {
    case "name":
      return error.reason === "empty"
        ? "Clinic name is required"
        : "Clinic name is too long";
    case "address":
      return error.reason === "empty"
        ? "Clinic address is required"
        : "Clinic address is too long";
    case "latitude":
      return error.reason === "missing"
        ? "Latitude is required"
        : "Latitude must be between -90 and 90";
    case "longitude":
      return error.reason === "missing"
        ? "Longitude is required"
        : "Longitude must be between -180 and 180";
    case "kitchen_id":
      return "A kitchen association is required";
  }
}

/**
 * Build an `ActionResult` failure from the first offending validation error,
 * carrying its `field` so the master form can highlight the input. Returns
 * `null` when there are no errors.
 */
function firstValidationFailure(
  errors: ClinicValidationError[]
): { success: false; error: string; field?: string } | null {
  if (errors.length === 0) return null;
  const first = errors[0];
  return {
    success: false,
    error: clinicValidationErrorMessage(first),
    field: first.field,
  };
}

// ─── Actions ───────────────────────────────────────────────────────────────────

/**
 * Create a Clinic (Req 3.1, 3.5–3.9, 2.7).
 *
 * Validates fields against the canonical create bounds (Req 3.5–3.7), confirms
 * the referenced Kitchen exists (Req 3.8), and persists the Clinic. A clinic has
 * no independent city at create time, so the same-city rule (Req 2.7) reduces to
 * "the kitchen must exist" here. `franchise_id` defaults to `null` (Core Clinic,
 * Req 3.4, 3.9). On any failure no Clinic record is created.
 *
 * Validates: Requirements 3.1, 3.5, 3.6, 3.7, 3.8, 3.9.
 */
export async function createClinic(
  input: ClinicCreateInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await assertCallerCanManageClinics();
  if (!auth.ok) return { success: false, error: auth.error };

  // Field validation against the canonical create bounds (Req 3.5–3.7).
  const candidate: ClinicValidatableInput = {
    name: input?.name,
    address: input?.address,
    latitude: input?.latitude,
    longitude: input?.longitude,
    kitchen_id: input?.kitchen_id,
  };
  const fieldFailure = firstValidationFailure(
    validateClinicInput(candidate, CLINIC_CREATE_BOUNDS)
  );
  if (fieldFailure) return fieldFailure;

  // Kitchen-reference validation (Req 3.8). kitchen_id presence is guaranteed by
  // the validation above.
  const kitchen = await getKitchenById(input.kitchen_id);
  if (!kitchen) {
    return {
      success: false,
      error: "The selected kitchen does not exist",
      field: "kitchen_id",
    };
  }

  const payload: ClinicCreateInput = {
    name: input.name.trim(),
    address: input.address.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    kitchen_id: input.kitchen_id,
    franchise_id: input.franchise_id ?? null,
  };

  try {
    const clinic = await insertClinic(payload);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: { id: clinic.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create clinic",
    };
  }
}

/**
 * Update an existing Clinic (Req 14.4, 2.7, 3.8).
 *
 * Only supplied fields are written. Validation runs against the merged record
 * (existing values overlaid with the submitted edits) using the wider
 * master-portal form bounds (Req 14.2–14.3). When `kitchen_id` is changed, the
 * new Kitchen must exist (Req 3.8) and must belong to the same City as the
 * Clinic's current Kitchen (Req 2.7); otherwise the association is rejected and
 * the existing linkage is left unchanged. Handles not-found.
 *
 * Validates: Requirements 2.7, 3.8, 14.4, 14.5.
 */
export async function updateClinic(
  id: string,
  input: ClinicUpdateInput
): Promise<ActionResult> {
  const auth = await assertCallerCanManageClinics();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Clinic id is required" };
  }

  // Not-found handling (Req 14.4-style guard).
  const existing = await getClinicById(id);
  if (!existing) {
    return { success: false, error: "Clinic not found" };
  }

  // Validate the resulting record (existing overlaid with supplied edits) using
  // the master-portal form bounds (Req 14.2, 14.3).
  const merged: ClinicValidatableInput = {
    name: input.name !== undefined ? input.name : existing.name,
    address: input.address !== undefined ? input.address : existing.address,
    latitude: input.latitude !== undefined ? input.latitude : existing.latitude,
    longitude:
      input.longitude !== undefined ? input.longitude : existing.longitude,
    kitchen_id:
      input.kitchen_id !== undefined ? input.kitchen_id : existing.kitchen_id,
  };
  const fieldFailure = firstValidationFailure(
    validateClinicInput(merged, CLINIC_FORM_BOUNDS)
  );
  if (fieldFailure) return fieldFailure;

  // Same-city rule on re-association (Req 2.7, 3.8): a changed kitchen must
  // exist and must share the City of the Clinic's current kitchen.
  if (input.kitchen_id !== undefined && input.kitchen_id !== existing.kitchen_id) {
    const [newKitchen, currentKitchen] = await Promise.all([
      getKitchenById(input.kitchen_id),
      getKitchenById(existing.kitchen_id),
    ]);

    if (!newKitchen) {
      return {
        success: false,
        error: "The selected kitchen does not exist",
        field: "kitchen_id",
      };
    }

    // Only enforce when a city context exists on both sides. When the current
    // kitchen has no city (legacy/unassociated), there is no expected city to
    // compare against, so the existence check above is sufficient.
    if (
      currentKitchen?.city_id &&
      newKitchen.city_id !== currentKitchen.city_id
    ) {
      return {
        success: false,
        error: "The kitchen and clinic must belong to the same city",
        field: "kitchen_id",
      };
    }
  }

  // Build the update payload from only the supplied keys, trimming text fields.
  const updates: ClinicUpdateInput = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.address !== undefined) updates.address = input.address.trim();
  if (input.latitude !== undefined) updates.latitude = input.latitude;
  if (input.longitude !== undefined) updates.longitude = input.longitude;
  if (input.kitchen_id !== undefined) updates.kitchen_id = input.kitchen_id;
  if (input.franchise_id !== undefined) updates.franchise_id = input.franchise_id;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: "No fields to update" };
  }

  try {
    await updateClinicRecord(id, updates);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update clinic",
    };
  }
}

/**
 * Delete a Clinic, guarded by its dependents (Req 14.5, 14.6).
 *
 * Rejects the deletion when any service area, rider, customer, or workload
 * snapshot references the Clinic, retaining the record unchanged. Handles
 * not-found.
 *
 * Validates: Requirements 14.5, 14.6.
 */
export async function deleteClinic(id: string): Promise<ActionResult> {
  const auth = await assertCallerCanManageClinics();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Clinic id is required" };
  }

  // Not-found handling.
  const existing = await getClinicById(id);
  if (!existing) {
    return { success: false, error: "Clinic not found" };
  }

  try {
    // Dependency-guarded deletion (Req 14.5, 14.6).
    const dependents = await countClinicDependents(id);
    if (dependents.total > 0) {
      return {
        success: false,
        error:
          "Cannot delete clinic — it is referenced by dependent records " +
          "(service areas, riders, customers, or workload snapshots). " +
          "Remove or reassign those records first.",
      };
    }

    await deleteClinicRecord(id);
    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete clinic",
    };
  }
}
