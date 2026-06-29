"use server";

// src/actions/admin-actions/riderClinicActions.ts
// Admin-portal Server Actions for the Rider ↔ Clinic linkage and the
// rider service-area constraint (core-clinic-architecture, task 9.1).
//
// A Rider (`rider_profiles`) is linked to at most ONE Clinic at a time via the
// single `rider_profiles.clinic_id` column. Because the linkage is one column,
// assignment naturally REPLACES any prior linkage, guaranteeing exactly one
// active clinic per rider (Req 8.1–8.3). Linkage is manual-only — nothing in
// this module (or elsewhere) creates or modifies it automatically (Req 8.4).
//
// A Rider's service-area pincodes must belong to that rider's linked Clinic.
// Pincodes are rows in `rider_service_areas` (clinic_id, rider_id, pincode);
// assigning a rider to a service area means setting `rider_id` on the matching
// `rider_service_areas` row whose pincode belongs to the rider's clinic
// (Req 9.1–9.3).
//
// ── "Active" clinic decision ──────────────────────────────────────────────
// The `clinics` table has NO `is_active` column. For CORE operations a clinic
// is "active/valid" precisely when it EXISTS (and, by the core data model, is a
// Core Clinic — `franchise_id IS NULL`). Accordingly, the validity check in
// `assignRiderToClinic` treats EXISTENCE as the definition of "active": a
// linkage is allowed only to a clinic that currently exists, and is rejected
// (leaving any existing linkage unchanged) when the clinic id does not resolve
// to a clinic row (Req 8.5).
//
// LAYERING: Mirrors `serviceAreaActions.ts` — authorization resolves the caller
// via the SSR server client (`createClient`), while data writes use the
// service-role admin client (`createAdminClient`). Returns the shared
// `ActionResult<T>` discriminated union from `@/types/clinic`.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { getClinicById } from "@/repositories/clinic/clinicRepository";
import type { ActionResult } from "@/types/clinic";
import { checkGroupManage } from "@/lib/auth/adminAccess";

// Roles permitted to administer rider↔clinic linkage (admin portal).
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

// Rider↔clinic linkage is administered from the admin riders area.
const ADMIN_RIDERS_PATH = "/admin/riders";

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors `assertCallerCanManageServiceAreas` in `serviceAreaActions.ts`.
 */
async function assertCallerCanManageRiders(): Promise<
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
      error: "Only an Admin or Master Admin can manage rider assignments",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch a rider's current linked clinic id. Returns `{ found: false }` when the
 * rider profile does not exist, otherwise `{ found: true, clinicId }` where
 * `clinicId` is `null` for an unlinked rider.
 */
async function getRiderClinicId(
  riderId: string
): Promise<
  { found: false } | { found: true; clinicId: string | null }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_profiles")
    .select("id, clinic_id")
    .eq("id", riderId)
    .maybeSingle();

  if (error || !data) return { found: false };
  return {
    found: true,
    clinicId: (data as { clinic_id: string | null }).clinic_id ?? null,
  };
}

// ─── Rider ↔ Clinic linkage (Req 8) ──────────────────────────────────────────

/**
 * Assign a Rider to a Clinic, storing the linkage on `rider_profiles.clinic_id`.
 *
 * Manual-only (Req 8.4): this explicit Admin action is the sole way a rider↔
 * clinic linkage is created or changed. Because the linkage is a single column,
 * a successful assignment REPLACES any existing linkage, leaving exactly one
 * active clinic per rider (Req 8.1, 8.2, 8.3).
 *
 * Rejects when the target Clinic does not exist ("active" ≡ "exists" for core
 * operations — the `clinics` table has no `is_active` column), leaving any
 * existing linkage unchanged (Req 8.5).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5.
 */
export async function assignRiderToClinic(
  riderId: string,
  clinicId: string
): Promise<ActionResult> {
  const gate = await checkGroupManage("riders");
  if (!gate.ok) return { success: false, error: gate.error };
  const auth = await assertCallerCanManageRiders();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!riderId) {
    return { success: false, error: "A rider is required", field: "riderId" };
  }

  if (!clinicId) {
    return { success: false, error: "A clinic is required", field: "clinicId" };
  }

  // Rider must exist before we attempt any linkage write.
  const rider = await getRiderClinicId(riderId);
  if (!rider.found) {
    return { success: false, error: "Rider not found", field: "riderId" };
  }

  // Validity check: "active" ≡ "exists" for core operations (Req 8.5). When the
  // clinic does not resolve, reject and leave any existing linkage unchanged.
  const clinic = await getClinicById(clinicId);
  if (!clinic) {
    return {
      success: false,
      error: "The selected clinic is invalid or unavailable",
      field: "clinicId",
    };
  }

  try {
    const admin = createAdminClient();

    // Single column ⇒ this overwrite REPLACES any prior linkage, guaranteeing
    // a single active clinic per rider (Req 8.1, 8.3).
    const { error } = await admin
      .from("rider_profiles")
      .update({ clinic_id: clinicId })
      .eq("id", riderId);

    if (error) throw error;

    await logAdminAction("UPDATE", "rider", riderId, {
      action: "assign_clinic",
      clinic_id: clinicId,
    });

    revalidatePath(ADMIN_RIDERS_PATH);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("assignRiderToClinic error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to assign rider to clinic";
    return {
      success: false,
      error: message,
    };
  }
}

// ─── Rider service-area constraint by clinic (Req 9) ─────────────────────────

/**
 * Return the pincodes selectable for a Rider — i.e. those belonging to the
 * Rider's linked Clinic — excluding every pincode that does not belong to that
 * Clinic (Req 9.2).
 *
 * When the Rider has no linked Clinic, no pincodes are assignable, so this
 * returns an error per Req 9.1 semantics (a clinic must be linked first).
 *
 * Validates: Requirements 9.1, 9.2.
 */
export async function getAssignablePincodesForRider(
  riderId: string
): Promise<ActionResult<string[]>> {
  const auth = await assertCallerCanManageRiders();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!riderId) {
    return { success: false, error: "A rider is required", field: "riderId" };
  }

  const rider = await getRiderClinicId(riderId);
  if (!rider.found) {
    return { success: false, error: "Rider not found", field: "riderId" };
  }

  // No linked clinic ⇒ nothing is assignable (Req 9.1).
  if (!rider.clinicId) {
    return {
      success: false,
      error:
        "A clinic must be linked to the rider before any service-area pincode can be assigned",
      field: "riderId",
    };
  }

  try {
    const admin = createAdminClient();

    // Only pincodes belonging to the rider's linked clinic are selectable;
    // all others are excluded (Req 9.2).
    const { data, error } = await admin
      .from("rider_service_areas")
      .select("pincode")
      .eq("clinic_id", rider.clinicId)
      .order("pincode", { ascending: true });

    if (error) throw error;

    const pincodes = (data ?? []).map(
      (row) => (row as { pincode: string }).pincode
    );

    return { success: true, data: pincodes };
  } catch (error) {
    console.error("getAssignablePincodesForRider error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load assignable pincodes";
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Assign a Rider to a service-area pincode by setting `rider_id` on the
 * matching `rider_service_areas` row.
 *
 * Rejects when the Rider has no linked Clinic, leaving the Rider's service-area
 * unchanged (Req 9.1). Rejects a pincode that does not belong to the Rider's
 * linked Clinic, leaving existing associations unchanged (Req 9.3). Otherwise
 * the Rider is assigned to that clinic-owned service-area pincode.
 *
 * Validates: Requirements 9.1, 9.3.
 */
export async function assignServiceAreaToRider(
  riderId: string,
  pincode: string
): Promise<ActionResult> {
  const gate = await checkGroupManage("riders");
  if (!gate.ok) return { success: false, error: gate.error };
  const auth = await assertCallerCanManageRiders();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!riderId) {
    return { success: false, error: "A rider is required", field: "riderId" };
  }

  const trimmedPincode = (pincode ?? "").trim();
  if (!trimmedPincode) {
    return { success: false, error: "A pincode is required", field: "pincode" };
  }

  const rider = await getRiderClinicId(riderId);
  if (!rider.found) {
    return { success: false, error: "Rider not found", field: "riderId" };
  }

  // No linked clinic ⇒ reject before any write (Req 9.1).
  if (!rider.clinicId) {
    return {
      success: false,
      error:
        "A clinic must be linked to the rider before any service-area pincode can be assigned",
      field: "riderId",
    };
  }

  try {
    const admin = createAdminClient();

    // Locate the service-area row for this pincode (one-pincode-one-clinic, so
    // at most one row).
    const { data: area, error: fetchError } = await admin
      .from("rider_service_areas")
      .select("id, clinic_id")
      .eq("pincode", trimmedPincode)
      .maybeSingle();

    if (fetchError) throw fetchError;

    // Pincode outside the rider's linked clinic boundary ⇒ reject, leaving
    // existing associations unchanged (Req 9.3). Covers both an unknown pincode
    // and one owned by a different clinic.
    if (!area || (area as { clinic_id: string | null }).clinic_id !== rider.clinicId) {
      return {
        success: false,
        error:
          "That pincode lies outside the rider's linked clinic boundary",
        field: "pincode",
      };
    }

    const serviceAreaId = (area as { id: string }).id;

    const { error } = await admin
      .from("rider_service_areas")
      .update({ rider_id: riderId })
      .eq("id", serviceAreaId);

    if (error) throw error;

    await logAdminAction("UPDATE", "service_area", serviceAreaId, {
      action: "assign_rider",
      rider_id: riderId,
      pincode: trimmedPincode,
    });

    revalidatePath(ADMIN_RIDERS_PATH);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("assignServiceAreaToRider error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to assign service area to rider";
    return {
      success: false,
      error: message,
    };
  }
}
