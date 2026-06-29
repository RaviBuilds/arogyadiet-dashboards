"use server";

// src/actions/master-actions/cityActions.ts
// Master-portal Server Actions for City CRUD in the Core Clinic Management
// surface (core-clinic-architecture, task 3.3).
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

// ─── Franchise City dependencies (multi-tenant-franchise — Task 5.1) ─────────
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { franchiseCitySchema } from "@/validations/franchise";
import { getBusinessById } from "@/repositories/clinic/businessRepository";
import {
  listCitiesByBusiness,
  getCityById as getFranchiseCityById,
  insertCity as insertFranchiseCityRecord,
  updateCity as updateFranchiseCityRecord,
  deleteCity as deleteFranchiseCityRecord,
  countGroupsForCity,
} from "@/repositories/franchise/cityRepository";
import type { FranchiseCity } from "@/types/franchise";

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

// ─── CRUD Operations (Task 3.3) ──────────────────────────────────────────────

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

// ═════════════════════════════════════════════════════════════════════════════
// Franchise City CRUD (multi-tenant-franchise — Task 5.1)
//
// These actions manage Cities owned by a Franchise Business (scoped via
// `business_id`), and are kept fully distinct from the Core City actions above.
// Business rules enforced here:
//   - feature-flag gated: when FRANCHISE_FEATURES_ENABLED is off, no franchise
//     read/write/side effect occurs (Req 1.6)
//   - full_network scope only (MASTER_ADMIN / ADMIN), resolved before any data
//     access (Req 1.6)
//   - the referenced Business must exist AND be type 'Franchise' (Req 1.1, 1.3)
//   - name 1..100, unique case-insensitively WITHIN that Business (Req 1.2)
//   - dependency-guarded deletion: rejected when Groups reference the City
//     (Req 1.4, 1.5)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Gate every franchise-city action on the feature flag and the caller's Scope.
 *
 * The flag is checked FIRST so that, when franchise features are disabled, the
 * action returns a not-enabled result with NO franchise reads, writes, or other
 * side effects (Req 1.6). Otherwise the caller's Scope is resolved and must be
 * `full_network` (MASTER_ADMIN / ADMIN); any other scope is rejected.
 */
async function assertFranchiseCityAccess(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { ok: false, error: "Franchise features are not enabled" };
  }

  const scopeResult = await resolveScope();
  if (!scopeResult.ok || scopeResult.scope.kind !== "full_network") {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can manage franchise cities",
    };
  }

  return { ok: true };
}

/**
 * Confirm the referenced Business exists AND is of type `Franchise`. Returns the
 * field-specific error to surface on the `business_id` field (Req 1.1, 1.3).
 */
async function assertFranchiseBusiness(
  businessId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const business = await getBusinessById(businessId);
  if (!business) {
    return { ok: false, error: "Business not found" };
  }
  if (business.type !== "Franchise") {
    return {
      ok: false,
      error: "Cities can only be created under a Franchise business",
    };
  }
  return { ok: true };
}

/**
 * Create a City under a Franchise Business.
 *
 * Validates the input shape via {@link franchiseCitySchema} (name 1..100,
 * `business_id` a uuid), confirms the Business exists and is a Franchise, and
 * enforces case-insensitive name uniqueness WITHIN that Business. On success
 * returns the new record's identifier (Req 1.1, 1.2, 1.3).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.6.
 */
export async function createFranchiseCity(
  input: { name: string; business_id: string }
): Promise<ActionResult<{ id: string }>> {
  const access = await assertFranchiseCityAccess();
  if (!access.ok) return { success: false, error: access.error };

  const parsed = franchiseCitySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue.message,
      field: typeof issue.path[0] === "string" ? issue.path[0] : undefined,
    };
  }
  const { name, business_id } = parsed.data;

  // Business must exist AND be type 'Franchise' (Req 1.1, 1.3).
  const businessCheck = await assertFranchiseBusiness(business_id);
  if (!businessCheck.ok) {
    return { success: false, error: businessCheck.error, field: "business_id" };
  }

  // Case-insensitive uniqueness WITHIN the Business (Req 1.2).
  const siblings = await listCitiesByBusiness(business_id);
  const existingNamesLower = new Set<string>(
    siblings.map((c) => c.name.trim().toLowerCase())
  );

  const validation = validateCityName(name, existingNamesLower);
  if (!validation.ok) {
    return {
      success: false,
      error: cityNameErrorMessage(validation.reason),
      field: "name",
    };
  }

  const city = await insertFranchiseCityRecord(name, business_id);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { id: city.id } };
}

/**
 * Update an existing Franchise City's name. Returns a not-found error when the
 * identifier does not exist, confirms the Business is still a Franchise, allows
 * a self-rename, and rejects case-insensitive duplicates against OTHER cities in
 * the same Business (Req 1.2, 1.3).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.6.
 */
export async function updateFranchiseCity(
  id: string,
  input: { name: string; business_id: string }
): Promise<ActionResult<FranchiseCity>> {
  const access = await assertFranchiseCityAccess();
  if (!access.ok) return { success: false, error: access.error };

  const parsed = franchiseCitySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue.message,
      field: typeof issue.path[0] === "string" ? issue.path[0] : undefined,
    };
  }
  const { name, business_id } = parsed.data;

  // Not-found handling.
  const existing = await getFranchiseCityById(id);
  if (!existing) {
    return { success: false, error: "City not found" };
  }

  // Business must exist AND be type 'Franchise' (Req 1.1, 1.3).
  const businessCheck = await assertFranchiseBusiness(business_id);
  if (!businessCheck.ok) {
    return { success: false, error: businessCheck.error, field: "business_id" };
  }

  // Exclude this record so it can keep its own name (self-rename, Req 1.2).
  const siblings = await listCitiesByBusiness(business_id);
  const existingNamesLower = new Set<string>(
    siblings
      .filter((c) => c.id !== id)
      .map((c) => c.name.trim().toLowerCase())
  );

  const validation = validateCityName(
    name,
    existingNamesLower,
    existing.name.trim().toLowerCase()
  );
  if (!validation.ok) {
    return {
      success: false,
      error: cityNameErrorMessage(validation.reason),
      field: "name",
    };
  }

  const city = await updateFranchiseCityRecord(id, name);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: city };
}

/**
 * Delete a Franchise City, but only when no Group references it. When at least
 * one Group depends on the City the deletion is rejected and the record is
 * retained (Req 1.4, 1.5).
 *
 * Validates: Requirements 1.4, 1.5, 1.6.
 */
export async function deleteFranchiseCity(id: string): Promise<ActionResult> {
  const access = await assertFranchiseCityAccess();
  if (!access.ok) return { success: false, error: access.error };

  // Not-found handling.
  const existing = await getFranchiseCityById(id);
  if (!existing) {
    return { success: false, error: "City not found" };
  }

  // Dependency-guarded deletion (Req 1.4, 1.5).
  const groupCount = await countGroupsForCity(id);
  if (groupCount > 0) {
    return { success: false, error: "City has associated groups" };
  }

  await deleteFranchiseCityRecord(id);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: undefined };
}
