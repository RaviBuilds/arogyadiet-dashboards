"use server";

// src/actions/admin-actions/serviceAreaActions.ts
// Admin-portal, clinic-aware Server Actions for the Service Areas section
// (core-clinic-architecture, task 5.1).
//
// A Service_Area is a row in `rider_service_areas` mapping a single pincode to a
// Clinic (and, later, to a Rider). This module lets an Admin add, edit, and
// delete pincodes per Clinic. The one-pincode-one-clinic invariant (Req 4.1,
// 4.2) is enforced at the database level by the UNIQUE index
// `uq_service_area_pincode`; these actions surface that constraint as a
// friendly "already assigned" error identifying the current owning clinic
// (Req 4.3, 5.3) and reject bad pincode formats before any write (Req 5.4)
// using the pure `isValidPincode` validator.
//
// LAYERING: Server Actions → repository (`serviceAreaRepository`) → Supabase.
// CRUD writes/reads delegate to the repository data-access functions
// (`getServiceAreaByPincode`, `getServiceAreaById`, `insertServiceArea`,
// `updateServiceAreaPincode`, `deleteServiceArea`); authorization resolves the
// caller via the SSR server client (`createClient`). Returns the shared
// `ActionResult<T>` discriminated union from `@/types/clinic`.
//
// NOTE: `movePincode` (atomic move + customer reassignment) is task 5.2 and is
// kept in the "Pincode move" section below.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { isValidPincode } from "@/lib/clinic/validation";
import {
  getServiceAreaByPincode,
  getServiceAreaById,
  insertServiceArea,
  updateServiceAreaPincode,
  deleteServiceArea,
} from "@/repositories/clinic/serviceAreaRepository";
import {
  buildRiderClinicWarnings,
  type PincodeRiderMapping,
  type RiderClinicWarning,
} from "@/lib/clinic/rider-warnings";
import type { ActionResult } from "@/types/clinic";

// Roles permitted to administer Service Areas (admin portal).
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

// Service Areas are administered from the admin riders area.
const ADMIN_RIDERS_PATH = "/admin/riders";

// Postgres unique-violation SQLSTATE — raised by `uq_service_area_pincode`.
const UNIQUE_VIOLATION = "23505";

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors `assertCallerCanManageCities` in
 * `src/actions/master-actions/cityActions.ts`, scoped to the admin portal.
 */
async function assertCallerCanManageServiceAreas(): Promise<
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
      error: "Only an Admin or Master Admin can manage service areas",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * True when `error` represents a violation of the global pincode uniqueness
 * constraint `uq_service_area_pincode` (Req 4.2, 4.3).
 *
 * The repository layer wraps Postgres errors in a plain `Error` (which drops
 * the `23505` SQLSTATE code), while raw Supabase errors carry `.code`. This
 * helper detects both: the structured code on a raw error, and the
 * unique-violation signature embedded in a wrapped error's message.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === UNIQUE_VIOLATION) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes(UNIQUE_VIOLATION) ||
    /duplicate key|uq_service_area_pincode|unique constraint/i.test(message)
  );
}

/**
 * Build the user-facing "already assigned" message for a pincode that violates
 * `uq_service_area_pincode`, identifying the owning Clinic by name where it can
 * be resolved (Req 4.3, 5.3).
 *
 * Resolves the current owner from the single `rider_service_areas` row for the
 * pincode via the repository (`getServiceAreaByPincode`), then looks up the
 * owning Clinic's name.
 */
async function alreadyAssignedError(pincode: string): Promise<string> {
  const existing = await getServiceAreaByPincode(pincode);
  if (existing?.clinic_id) {
    const owner = await findClinicById(existing.clinic_id);
    if (owner?.name) {
      return `Pincode ${pincode} is already assigned to clinic "${owner.name}".`;
    }
  }
  return `Pincode ${pincode} is already assigned to a clinic.`;
}

// ─── Service Area CRUD by Clinic (Task 5.1) ──────────────────────────────────

/**
 * Add a 6-digit pincode to a Clinic, creating a Service_Area association.
 *
 * Rejects a malformed pincode before any write (Req 5.4) and surfaces a
 * friendly "already assigned" error when the pincode is already owned by a
 * Clinic — relying on the `uq_service_area_pincode` unique index as the source
 * of truth so the check is robust against concurrency (Req 4.3, 5.2, 5.3).
 *
 * `area_name` is NOT NULL in `rider_service_areas`; when no name is supplied it
 * defaults to the pincode itself. `rider_id` is left null until a rider is
 * assigned later (task 6).
 *
 * Validates: Requirements 4.1, 4.3, 5.2, 5.3, 5.4.
 */
export async function addPincodeToClinic(
  clinicId: string,
  pincode: string,
  areaName?: string
): Promise<ActionResult> {
  const auth = await assertCallerCanManageServiceAreas();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedPincode = (pincode ?? "").trim();

  // Bad-format rejection BEFORE any write (Req 5.4).
  if (!isValidPincode(trimmedPincode)) {
    return {
      success: false,
      error: "Pincode must be exactly 6 digits",
      field: "pincode",
    };
  }

  if (!clinicId) {
    return { success: false, error: "A clinic is required", field: "clinicId" };
  }

  const resolvedAreaName = (areaName ?? "").trim() || trimmedPincode;

  // Pre-check the global owner so we can identify the current owning clinic
  // before attempting a write (Req 4.3, 5.3). The DB unique index remains the
  // authoritative source of truth and is re-checked in the catch below.
  const preexisting = await getServiceAreaByPincode(trimmedPincode);
  if (preexisting) {
    return {
      success: false,
      error: await alreadyAssignedError(trimmedPincode),
      field: "pincode",
    };
  }

  try {
    const inserted = await insertServiceArea({
      clinic_id: clinicId,
      pincode: trimmedPincode,
      area_name: resolvedAreaName,
    });

    await logAdminAction("CREATE", "service_area", inserted.id, {
      clinic_id: clinicId,
      pincode: trimmedPincode,
      area_name: resolvedAreaName,
    });

    revalidatePath(ADMIN_RIDERS_PATH);
    return { success: true, data: undefined };
  } catch (error) {
    // Already-assigned: unique-violation on the global pincode index (Req 4.3, 5.3).
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: await alreadyAssignedError(trimmedPincode),
        field: "pincode",
      };
    }
    console.error("addPincodeToClinic error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to add pincode to clinic";
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Edit an existing Service_Area's pincode to a new value.
 *
 * Rejects a malformed new pincode before any write (Req 5.4), reports a missing
 * record, and surfaces the already-assigned error when the new value collides
 * with another Clinic's pincode (Req 4.3, 5.3, 5.5).
 *
 * Validates: Requirements 4.3, 5.4, 5.5.
 */
export async function editPincode(
  serviceAreaId: string,
  newPincode: string
): Promise<ActionResult> {
  const auth = await assertCallerCanManageServiceAreas();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedPincode = (newPincode ?? "").trim();

  // Bad-format rejection BEFORE any write (Req 5.4).
  if (!isValidPincode(trimmedPincode)) {
    return {
      success: false,
      error: "Pincode must be exactly 6 digits",
      field: "pincode",
    };
  }

  if (!serviceAreaId) {
    return { success: false, error: "Service area not found" };
  }

  // Not-found handling: confirm the record exists before updating.
  const existing = await getServiceAreaById(serviceAreaId);
  if (!existing) {
    return { success: false, error: "Service area not found" };
  }

  // Pre-check a collision with ANOTHER clinic's pincode; renaming to the same
  // record's own value is a no-op and allowed (Req 4.3, 5.3, 5.5).
  const owner = await getServiceAreaByPincode(trimmedPincode);
  if (owner && owner.id !== serviceAreaId) {
    return {
      success: false,
      error: await alreadyAssignedError(trimmedPincode),
      field: "pincode",
    };
  }

  try {
    await updateServiceAreaPincode(serviceAreaId, trimmedPincode);

    await logAdminAction("UPDATE", "service_area", serviceAreaId, {
      pincode: trimmedPincode,
    });

    revalidatePath(ADMIN_RIDERS_PATH);
    return { success: true, data: undefined };
  } catch (error) {
    // Already-assigned: unique-violation on the global pincode index (Req 4.3, 5.3).
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: await alreadyAssignedError(trimmedPincode),
        field: "pincode",
      };
    }
    console.error("editPincode error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update pincode";
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Delete a Service_Area, removing the pincode's association with its Clinic.
 *
 * Validates: Requirements 5.6.
 */
export async function deletePincode(
  serviceAreaId: string
): Promise<ActionResult> {
  const auth = await assertCallerCanManageServiceAreas();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!serviceAreaId) {
    return { success: false, error: "Service area not found" };
  }

  // Not-found handling: confirm the record exists before deleting.
  const existing = await getServiceAreaById(serviceAreaId);
  if (!existing) {
    return { success: false, error: "Service area not found" };
  }

  try {
    await deleteServiceArea(serviceAreaId);

    await logAdminAction("DELETE", "service_area", serviceAreaId, {});

    revalidatePath(ADMIN_RIDERS_PATH);
    return { success: true, data: undefined };
  } catch (error) {
    console.error("deletePincode error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to delete pincode";
    return {
      success: false,
      error: message,
    };
  }
}

// ─── Pincode move (Task 5.2) ─────────────────────────────────────────────────

/**
 * Confirm a Clinic exists by id. Returns its name when found, else `null`.
 */
async function findClinicById(
  clinicId: string
): Promise<{ id: string; name: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, name")
    .eq("id", clinicId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, name: (data as { name: string }).name };
}

/**
 * Fetch the riders that map `pincode` together with their currently linked
 * clinic, BEFORE the move runs, so the resulting warnings reflect the pre-move
 * mappings (Req 9.4). Joins `rider_service_areas` → `rider_profiles` (→ `users`
 * for a display name). Service-area rows with no assigned rider are skipped.
 */
async function fetchPincodeRiderMappings(
  pincode: string
): Promise<PincodeRiderMapping[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rider_service_areas")
    .select("rider_id, rider_profiles(clinic_id, users(full_name))")
    .eq("pincode", pincode)
    .not("rider_id", "is", null);

  if (error || !data) return [];

  type ServiceAreaRiderRow = {
    rider_id: string | null;
    rider_profiles?:
      | {
          clinic_id?: string | null;
          users?:
            | { full_name?: string | null }
            | { full_name?: string | null }[]
            | null;
        }
      | {
          clinic_id?: string | null;
          users?:
            | { full_name?: string | null }
            | { full_name?: string | null }[]
            | null;
        }[]
      | null;
  };

  return (data as ServiceAreaRiderRow[]).reduce<PincodeRiderMapping[]>(
    (acc, row) => {
      const riderId = row.rider_id;
      if (!riderId) return acc;

      const profileRel = row.rider_profiles;
      const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;

      const userRel = profile?.users;
      const user = Array.isArray(userRel) ? userRel[0] : userRel;

      acc.push({
        riderId,
        riderName: user?.full_name ?? undefined,
        clinicId: profile?.clinic_id ?? null,
      });
      return acc;
    },
    []
  );
}

/**
 * Atomically move a pincode from a source Clinic to a destination Clinic and
 * cascade the customer auto-reassignment, returning the count of reassigned
 * customers plus any rider-clinic mismatch warnings.
 *
 * The transactional guarantee (Req 4.4, 7.5) is provided by the
 * `move_pincode_and_reassign` Postgres RPC, which performs the service-area
 * move and the customer/address re-stamping in a single transaction. This
 * action authorizes the caller, validates inputs, computes the pre-move rider
 * warnings (Req 9.4), then delegates the atomic write to that RPC.
 *
 * On success the pincode is associated only with the destination Clinic and
 * every matching customer/address has been re-stamped (Req 5.7, 7.1, 7.2); on
 * failure the RPC rolls back so the pincode and all stamps remain unchanged.
 *
 * Validates: Requirements 4.4, 4.5, 5.7, 7.1, 7.2, 7.3, 9.4, 19.4.
 */
export async function movePincode(
  pincode: string,
  fromClinicId: string,
  toClinicId: string
): Promise<ActionResult<{ reassignedCount: number; riderWarnings: RiderClinicWarning[] }>> {
  const auth = await assertCallerCanManageServiceAreas();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedPincode = (pincode ?? "").trim();

  // Bad-format rejection BEFORE any write (Req 5.4).
  if (!isValidPincode(trimmedPincode)) {
    return {
      success: false,
      error: "Pincode must be exactly 6 digits",
      field: "pincode",
    };
  }

  if (!fromClinicId) {
    return {
      success: false,
      error: "A source clinic is required",
      field: "fromClinicId",
    };
  }

  if (!toClinicId) {
    return {
      success: false,
      error: "A destination clinic is required",
      field: "toClinicId",
    };
  }

  // Both clinics must exist before attempting the move.
  const [fromClinic, toClinic] = await Promise.all([
    findClinicById(fromClinicId),
    findClinicById(toClinicId),
  ]);

  if (!fromClinic) {
    return {
      success: false,
      error: "Source clinic not found",
      field: "fromClinicId",
    };
  }

  if (!toClinic) {
    return {
      success: false,
      error: "Destination clinic not found",
      field: "toClinicId",
    };
  }

  // Compute rider-clinic mismatch warnings from the PRE-move mappings (Req 9.4).
  const mappingRiders = await fetchPincodeRiderMappings(trimmedPincode);
  const riderWarnings = buildRiderClinicWarnings(
    toClinicId,
    trimmedPincode,
    mappingRiders
  );

  try {
    const admin = createAdminClient();

    // Authoritative atomic move + reassignment via the transactional RPC
    // (Req 4.4, 7.5). Returns the count of reassigned customers (Req 7.3).
    const { data, error } = await admin.rpc("move_pincode_and_reassign", {
      p_pincode: trimmedPincode,
      p_from_clinic: fromClinicId,
      p_to_clinic: toClinicId,
    });

    if (error) throw error;

    const reassignedCount =
      typeof data === "number" ? data : Number(data ?? 0) || 0;

    await logAdminAction("UPDATE", "service_area", null, {
      action: "move_pincode",
      pincode: trimmedPincode,
      from_clinic_id: fromClinicId,
      to_clinic_id: toClinicId,
      reassigned_count: reassignedCount,
    });

    revalidatePath(ADMIN_RIDERS_PATH);
    return {
      success: true,
      data: { reassignedCount, riderWarnings },
    };
  } catch (error) {
    // Already-assigned: unique-violation on the global pincode index (Req 4.5).
    const code = (error as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) {
      return {
        success: false,
        error: await alreadyAssignedError(trimmedPincode),
        field: "pincode",
      };
    }
    console.error("movePincode error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to move pincode";
    return {
      success: false,
      error: message,
    };
  }
}
