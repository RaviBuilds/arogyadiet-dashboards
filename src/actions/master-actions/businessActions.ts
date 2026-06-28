"use server";

// src/actions/master-actions/businessActions.ts
// Master-portal Server Actions for Business CRUD in the new additive Core
// Business section (core-clinic-architecture, task 3.2).
//
// A Business is the top-level grouping entity, typed Core | Franchise. A Kitchen
// belongs to exactly one Business via `kitchens.business_id`; a Clinic resolves
// its Business through its Kitchen (Clinic → Kitchen → Business), so clinics
// never store `business_id` directly (Req 20.8, 20.9).
//
// LAYERING: These actions orchestrate authorization, pure validation
// (src/lib/clinic/validation.ts), and data access (src/repositories/clinic/*).
// They never touch Supabase directly — all reads/writes go through
// businessRepository. Business rules enforced here:
//   - name validity (trimmed 1..100) + business type validity (Req 20.1, 20.3, 20.4)
//   - dependency-guarded deletion (reject when kitchens reference the business)
//     (Req 20.5, 20.6)
//   - not-found handling on edit/delete (Req 20.7)

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  getBusinessById,
  insertBusiness,
  updateBusiness as updateBusinessRecord,
  deleteBusiness as deleteBusinessRecord,
  countKitchensForBusiness,
} from "@/repositories/clinic/businessRepository";
import {
  validateBusinessInput,
  type BusinessValidationError,
} from "@/lib/clinic/validation";
import type { ActionResult, Business, BusinessType } from "@/types/clinic";

/**
 * Managing Business records is a Master_Admin-only operation (Requirement 20:
 * "As a Master_Admin, I want to manage businesses...").
 */
const ALLOWED_ROLES = new Set(["MASTER_ADMIN"]);

const MASTER_SYSTEM_PATH = "/system";

/** Input accepted when creating or editing a Business. */
export interface BusinessInput {
  name: string;
  type: BusinessType;
}

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold a MASTER_ADMIN role. Mirrors
 * the authorization pattern in `cityActions.ts`.
 */
async function assertCallerCanManageBusinesses(): Promise<
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
      error: "Only a Master Admin can manage businesses",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Map a {@link BusinessValidationError} to a user-facing message identifying the
 * specific offending field (Requirement 20.3).
 */
function businessErrorMessage(error: BusinessValidationError): string {
  switch (error.field) {
    case "name":
      return error.reason === "empty"
        ? "Business name is required"
        : "Business name must be 100 characters or fewer";
    case "type":
      return "Business type must be either Core or Franchise";
  }
}

// ─── CRUD Operations (Task 3.2) ──────────────────────────────────────────────

/**
 * Create a Business after validating the trimmed name and the business type.
 * On success returns the new record's unique identifier (Req 20.2).
 *
 * Validates: Requirements 20.1, 20.2, 20.3, 20.4.
 */
export async function createBusiness(
  input: BusinessInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await assertCallerCanManageBusinesses();
  if (!auth.ok) return { success: false, error: auth.error };

  const name = (input?.name ?? "").trim();
  const type = input?.type;

  const errors = validateBusinessInput({ name, type });
  if (errors.length > 0) {
    const first = errors[0];
    return {
      success: false,
      error: businessErrorMessage(first),
      field: first.field,
    };
  }

  const business = await insertBusiness({ name, type });

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { id: business.id } };
}

/**
 * Update an existing Business's name and/or type. Returns a not-found error when
 * the identifier does not exist (Req 20.7) and retains the record's identifier
 * on success (Req 20.4).
 *
 * Validates: Requirements 20.1, 20.3, 20.4, 20.7.
 */
export async function updateBusiness(
  id: string,
  input: BusinessInput
): Promise<ActionResult<Business>> {
  const auth = await assertCallerCanManageBusinesses();
  if (!auth.ok) return { success: false, error: auth.error };

  // Not-found handling (Req 20.7).
  const existing = await getBusinessById(id);
  if (!existing) {
    return { success: false, error: "Business not found" };
  }

  const name = (input?.name ?? "").trim();
  const type = input?.type;

  const errors = validateBusinessInput({ name, type });
  if (errors.length > 0) {
    const first = errors[0];
    return {
      success: false,
      error: businessErrorMessage(first),
      field: first.field,
    };
  }

  const business = await updateBusinessRecord(id, { name, type });

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: business };
}

/**
 * Delete a Business, but only when no Kitchen references it. When at least one
 * Kitchen depends on the Business the deletion is rejected and the record is
 * retained (Req 20.6). Returns a not-found error when the identifier does not
 * exist (Req 20.7).
 *
 * Validates: Requirements 20.5, 20.6, 20.7.
 */
export async function deleteBusiness(id: string): Promise<ActionResult> {
  const auth = await assertCallerCanManageBusinesses();
  if (!auth.ok) return { success: false, error: auth.error };

  // Not-found handling (Req 20.7).
  const existing = await getBusinessById(id);
  if (!existing) {
    return { success: false, error: "Business not found" };
  }

  // Dependency-guarded deletion (Req 20.5, 20.6).
  const kitchenCount = await countKitchensForBusiness(id);
  if (kitchenCount > 0) {
    return {
      success: false,
      error:
        kitchenCount === 1
          ? "Cannot delete this business because 1 kitchen is associated with it"
          : `Cannot delete this business because ${kitchenCount} kitchens are associated with it`,
    };
  }

  await deleteBusinessRecord(id);

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: undefined };
}
