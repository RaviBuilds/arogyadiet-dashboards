"use server";

// src/actions/master-actions/cityActions.ts
// Master-portal Server Actions for City CRUD in the Core Clinic Management
// surface (core-clinic-architecture, task 2.2).
//
// LAYERING: These actions orchestrate authorization, pure validation
// (src/lib/clinic/validation.ts), and data access (src/repositories/clinic/*).
// They never touch Supabase directly — all reads/writes go through
// cityRepository. Business rules enforced here:
//   - name validity + case-insensitive uniqueness (Req 1.2, 1.3, 1.4)
//   - dependency-guarded deletion (reject when kitchens reference the city)
//     (Req 1.5, 1.6, 14.7)
//   - not-found handling on edit/delete (Req 1.7)

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  getCityById,
  getCityByNameLower,
  insertCity,
  updateCity as updateCityRecord,
  deleteCity as deleteCityRecord,
  countKitchensForCity,
} from "@/repositories/clinic/cityRepository";
import { validateCityName } from "@/lib/clinic/validation";
import type { ActionResult, City } from "@/types/clinic";

// Roles permitted to manage the Core Clinic hierarchy.
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

const MASTER_SYSTEM_PATH = "/system";

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors the authorization pattern in
 * `src/actions/admin-actions/franchiseActions.ts`.
 */
async function assertCallerCanManageCities(): Promise<
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
      error: "Only an Admin or Master Admin can manage cities",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Map a {@link validateCityName} failure reason to a user-facing message. */
function cityNameErrorMessage(
  reason: "empty" | "too_long" | "duplicate"
): string {
  switch (reason) {
    case "empty":
      return "City name is required";
    case "too_long":
      return "City name must be 100 characters or fewer";
    case "duplicate":
      return "A city with this name already exists";
  }
}

// ─── CRUD Operations (Task 2.2) ──────────────────────────────────────────────

/**
 * Create a City after validating the name and enforcing case-insensitive
 * uniqueness.
 *
 * Validates: Requirements 1.2, 1.3.
 */
export async function createCity(
  input: { name: string }
): Promise<ActionResult<City>> {
  const auth = await assertCallerCanManageCities();
  if (!auth.ok) return { success: false, error: auth.error };

  const name = (input?.name ?? "").trim();

  // DB-backed case-insensitive duplicate check (Req 1.1, 1.3).
  const conflict = await getCityByNameLower(name);
  const existingNamesLower = new Set<string>(
    conflict ? [conflict.name.trim().toLowerCase()] : []
  );

  const validation = validateCityName(name, existingNamesLower);
  if (!validation.ok) {
    return {
      success: false,
      error: cityNameErrorMessage(validation.reason),
      field: "name",
    };
  }

  const city = await insertCity(name);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: city };
}

/**
 * Update an existing City's name. Allows a self-rename (keeping the record's own
 * name, including case-only changes) and rejects duplicates against other
 * cities.
 *
 * Validates: Requirements 1.3, 1.4, 1.7.
 */
export async function updateCity(
  id: string,
  input: { name: string }
): Promise<ActionResult<City>> {
  const auth = await assertCallerCanManageCities();
  if (!auth.ok) return { success: false, error: auth.error };

  // Not-found handling (Req 1.7).
  const existing = await getCityById(id);
  if (!existing) {
    return { success: false, error: "City not found" };
  }

  const name = (input?.name ?? "").trim();
  const currentNameLower = existing.name.trim().toLowerCase();

  // Exclude this record so it can keep its own name (self-rename, Req 1.4).
  const conflict = await getCityByNameLower(name, id);
  const existingNamesLower = new Set<string>(
    conflict ? [conflict.name.trim().toLowerCase()] : []
  );

  const validation = validateCityName(name, existingNamesLower, currentNameLower);
  if (!validation.ok) {
    return {
      success: false,
      error: cityNameErrorMessage(validation.reason),
      field: "name",
    };
  }

  const city = await updateCityRecord(id, name);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: city };
}

/**
 * Delete a City, but only when no Kitchen references it. When at least one
 * Kitchen depends on the City the deletion is rejected and the record is
 * retained.
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 14.7.
 */
export async function deleteCity(id: string): Promise<ActionResult> {
  const auth = await assertCallerCanManageCities();
  if (!auth.ok) return { success: false, error: auth.error };

  // Not-found handling (Req 1.7).
  const existing = await getCityById(id);
  if (!existing) {
    return { success: false, error: "City not found" };
  }

  // Dependency-guarded deletion (Req 1.5, 1.6, 14.7).
  const kitchenCount = await countKitchensForCity(id);
  if (kitchenCount > 0) {
    return {
      success: false,
      error:
        kitchenCount === 1
          ? "Cannot delete this city because 1 kitchen is associated with it"
          : `Cannot delete this city because ${kitchenCount} kitchens are associated with it`,
    };
  }

  await deleteCityRecord(id);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: undefined };
}
