"use server";

// src/actions/master-actions/kitchenActions.ts
// Master-portal Server Actions for the Kitchen entity within the
// City → Kitchen → Clinic hierarchy (core-clinic-architecture, Task 2.3).
//
// LAYERING: Action layer ONLY. Business rules (auth, city-reference validation,
// dependency-guarded deletion) live here; all data access is delegated to the
// clinic-domain repositories. The pre-existing `kitchens` table is additive and
// is NEVER dropped (Req 2.1, 2.3) — these actions only insert/update/delete
// individual rows.
//
// Authorization mirrors src/actions/admin-actions/franchiseActions.ts, but the
// clinic hierarchy is managed by global roles (ADMIN / MASTER_ADMIN), aligning
// with the `is_global_role()` RLS policy created in
// scripts/create-clinic-hierarchy-tables.sql.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
import type { ActionResult, Kitchen } from "@/types/clinic";

/** Maximum length accepted for a kitchen name. */
const KITCHEN_NAME_MAX = 200;

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Assert the caller is an authenticated global-role user (ADMIN or
 * MASTER_ADMIN). Follows the role-lookup pattern in franchiseActions.ts; the
 * clinic hierarchy is managed by global roles (Req 14, RLS `is_global_role()`).
 */
async function assertCallerIsGlobalAdmin(): Promise<
  { success: true; userId: string } | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { success: false, error: "User record not found" };

  const rolesData = userRecord.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;

  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    return {
      success: false,
      error: "Only ADMIN or MASTER_ADMIN can manage kitchens",
    };
  }

  return { success: true, userId: userRecord.id };
}

// ─── Input shapes ─────────────────────────────────────────────────────────────

export interface KitchenCreateInput {
  name: string;
  city_id: string;
  address_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_active?: boolean;
}

export interface KitchenUpdateInput {
  name?: string;
  city_id?: string;
  address_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_active?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate that `cityId` references an existing City (Req 2.6). Returns an
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

// ─── Actions ───────────────────────────────────────────────────────────────────

/**
 * Create a Kitchen associated with a valid City (Req 2.2, 2.5, 2.6).
 * Rejects with a `city_id` field error when no valid City is referenced; in
 * that case no Kitchen record is created.
 */
export async function createKitchen(
  input: KitchenCreateInput
): Promise<ActionResult<{ id: string }>> {
  const authCheck = await assertCallerIsGlobalAdmin();
  if (!authCheck.success) return authCheck;

  const name = (input.name ?? "").trim();
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

  const cityError = await assertCityExists(input.city_id);
  if (cityError) return cityError;

  const payload: KitchenInsert = {
    name,
    city_id: input.city_id,
    address_text: input.address_text ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    is_active: input.is_active ?? true,
  };

  try {
    const kitchen = await insertKitchen(payload);
    revalidatePath("/system");
    return { success: true, data: { id: kitchen.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create kitchen",
    };
  }
}

/**
 * Update an existing Kitchen (Req 2.5, 2.6). When `city_id` is supplied it must
 * reference an existing City, otherwise the operation is rejected with a
 * `city_id` field error and the existing Kitchen record is left unchanged.
 */
export async function updateKitchen(
  id: string,
  input: KitchenUpdateInput
): Promise<ActionResult> {
  const authCheck = await assertCallerIsGlobalAdmin();
  if (!authCheck.success) return authCheck;

  if (!id || id.trim().length === 0) {
    return { success: false, error: "Kitchen id is required" };
  }

  // Confirm the Kitchen exists before mutating (Req 1.7-style not-found guard).
  const existing = await getKitchenById(id);
  if (!existing) {
    return { success: false, error: "Kitchen not found" };
  }

  const updates: KitchenUpdate = {};

  if (input.name !== undefined) {
    const name = (input.name ?? "").trim();
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
    updates.name = name;
  }

  if (input.city_id !== undefined) {
    const cityError = await assertCityExists(input.city_id);
    if (cityError) return cityError;
    updates.city_id = input.city_id;
  }

  if (input.address_text !== undefined) updates.address_text = input.address_text;
  if (input.lat !== undefined) updates.lat = input.lat;
  if (input.lng !== undefined) updates.lng = input.lng;
  if (input.is_active !== undefined) updates.is_active = input.is_active;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: "No fields to update" };
  }

  try {
    await updateKitchenRecord(id, updates);
    revalidatePath("/system");
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update kitchen",
    };
  }
}

/**
 * Delete a Kitchen, guarded by its dependents (Req 14.5, 14.6, 14.7).
 * Rejects the deletion when one or more Clinics reference the Kitchen,
 * retaining the record unchanged.
 */
export async function deleteKitchen(id: string): Promise<ActionResult> {
  const authCheck = await assertCallerIsGlobalAdmin();
  if (!authCheck.success) return authCheck;

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
          "Cannot delete kitchen — it is referenced by one or more clinics. Remove or reassign those clinics first.",
      };
    }

    await deleteKitchenRecord(id);
    revalidatePath("/system");
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete kitchen",
    };
  }
}

// Re-exported so callers can build typed payloads without reaching into the
// repository layer.
export type { Kitchen };
