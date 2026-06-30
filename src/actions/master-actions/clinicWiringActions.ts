"use server";

// src/actions/master-actions/clinicWiringActions.ts
// Master-portal Server Actions that WIRE a Franchise to its Clinic(s) and assign
// served pincodes to a franchise Clinic in the multi-tenant-franchise hierarchy
// (multi-tenant-franchise spec — Tasks 7.1, 7.2; Requirements 6.1–6.6, 15.1,
// 15.2, 15.3, 15.4, 15.7).
//
// LAYERING: Action layer ONLY. These actions orchestrate authorization
// (full_network scope), the franchise feature-flag gate, pure validation
// (`franchiseClinicSchema` from src/validations/franchise.ts, which reuses the
// core-clinic `validateClinicInput` bounds via `clinicCreateSchema`), Kitchen
// resolution through the Franchise's Group, and data access
// (src/repositories/franchise/*, src/repositories/clinic/*). The pincode
// move/reassignment is the single MULTI-STATEMENT, must-be-atomic operation and
// is delegated to the EXISTING core-clinic RPC `move_pincode_and_reassign`
// (scripts/create-move-pincode-rpc.sql) — the same RPC `serviceAreaActions`
// uses — so the franchise stamp on `rider_service_areas` follows the
// destination Clinic and no new pincode RPC is written here.
//
// Geo (full address / latitude / longitude) lives ONLY on the Clinic; it is
// NEVER stored on the Kitchen (Req 6.2). A franchise Clinic's Kitchen is the
// single Kitchen owned by the Franchise's Group (Clinic → Franchise → Group →
// Kitchen, Req 6.3), resolved here and persisted as the Clinic's `kitchen_id`.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import { isValidPincode } from "@/lib/clinic/validation";
import {
  franchiseClinicSchema,
  type FranchiseClinicSchemaInput,
} from "@/validations/franchise";
import { getFranchiseById } from "@/repositories/franchise/franchiseRepository";
import { getGroupById } from "@/repositories/franchise/groupRepository";
import {
  insertFranchiseClinic,
  getFranchiseClinicById,
  updateFranchiseClinic as updateFranchiseClinicRecord,
} from "@/repositories/franchise/franchiseClinicRepository";
import {
  getServiceAreaByPincode,
  insertServiceArea,
} from "@/repositories/clinic/serviceAreaRepository";
import {
  buildRiderClinicWarnings,
  type PincodeRiderMapping,
  type RiderClinicWarning,
} from "@/lib/clinic/rider-warnings";
import type { ActionResult, FranchiseClinic } from "@/types/franchise";

const MASTER_SYSTEM_PATH = "/system";

// Postgres unique-violation SQLSTATE — raised by `uq_service_area_pincode`
// (the one-pincode-one-clinic invariant — Req 15.1).
const UNIQUE_VIOLATION = "23505";

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Gate every clinic-wiring action behind the franchise feature flag and the
 * full_network scope (MASTER_ADMIN / ADMIN). Returns `null` when the caller is
 * authorized, or an `ActionResult` failure otherwise. Mirrors
 * `assertFullNetworkScope` in `franchiseActions.ts`.
 *
 * - When FRANCHISE_FEATURES_ENABLED is off the franchise surface is inert
 *   (Req 18.3, 18.4): no franchise reads/writes are performed.
 * - Only the full_network scope may wire franchise Clinics / assign pincodes
 *   (the franchise hierarchy is a master/admin concern).
 */
async function assertFullNetworkScope(): Promise<
  { success: false; error: string } | null
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { success: false, error: "Franchise features are not enabled" };
  }

  // Resolve the caller's session first so an unauthenticated request is
  // reported as Unauthorized rather than a generic scope error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized" };

  const result = await resolveScope();
  if (!result.ok || result.scope.kind !== "full_network") {
    return {
      success: false,
      error: "Only an Admin or Master Admin can wire franchise clinics",
    };
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate a franchise Clinic input against {@link franchiseClinicSchema} — a
 * non-empty name (1..120), a non-empty full address (1..255), a latitude in
 * [-90, 90] and a longitude in [-180, 180] (inclusive), plus a `franchise_id`
 * uuid. The schema reuses the core-clinic `clinicCreateSchema` bounds (the same
 * bounds enforced by `validateClinicInput`). Returns the parsed data on success
 * or an `ActionResult` failure carrying the FIRST offending field (Req 6.5).
 */
function validateFranchiseClinicInput(
  input: FranchiseClinicSchemaInput
):
  | { ok: true; data: FranchiseClinicSchemaInput }
  | { ok: false; result: { success: false; error: string; field?: string } } {
  const parsed = franchiseClinicSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      result: {
        success: false,
        error: issue?.message ?? "Invalid clinic",
        field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
      },
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Resolve the single Kitchen owned by a Franchise's Group
 * (Franchise → group_id → groups.kitchen_id — Req 6.3). Returns the resolved
 * `kitchen_id` on success, or an `ActionResult` failure when the Franchise or
 * its Group cannot be resolved.
 */
async function resolveFranchiseKitchenId(
  franchiseId: string
): Promise<
  | { ok: true; kitchenId: string }
  | { ok: false; result: { success: false; error: string; field?: string } }
> {
  const franchise = await getFranchiseById(franchiseId);
  if (!franchise) {
    return {
      ok: false,
      result: {
        success: false,
        error: "The selected franchise does not exist",
        field: "franchise_id",
      },
    };
  }

  const group = await getGroupById(franchise.group_id);
  if (!group) {
    return {
      ok: false,
      result: {
        success: false,
        error: "The franchise's group could not be resolved",
        field: "franchise_id",
      },
    };
  }

  return { ok: true, kitchenId: group.kitchen_id };
}

/**
 * Confirm a Clinic exists by id and return its identity (id, name, and owning
 * `franchise_id`). Returns `null` when not found. Used to validate the
 * destination of a pincode assignment and to name entities in overlap-conflict
 * messages (Req 15.2).
 */
async function findClinicById(
  clinicId: string
): Promise<{ id: string; name: string; franchise_id: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, name, franchise_id")
    .eq("id", clinicId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id as string,
    name: (data as { name: string }).name,
    franchise_id: (data as { franchise_id: string | null }).franchise_id ?? null,
  };
}

/**
 * True when `error` represents a violation of the global pincode uniqueness
 * constraint `uq_service_area_pincode` (Req 15.1). Mirrors the detection in
 * `serviceAreaActions.ts`: the structured `23505` code on a raw Supabase error,
 * or the unique-violation signature embedded in a wrapped `Error` message.
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
 * Build the user-facing OVERLAP-CONFLICT message for a pincode that is mapped to
 * more than one entity during franchise setup (Req 15.2): it names the
 * duplicated pincode and lists every entity (franchise Clinic or Core_Operation)
 * the pincode maps to. The current owner is resolved from the single
 * `rider_service_areas` row for the pincode; a Core Clinic (null `franchise_id`)
 * is labelled "Core Operation".
 */
async function pincodeOverlapConflictError(
  pincode: string,
  destinationClinicName: string
): Promise<string> {
  const existing = await getServiceAreaByPincode(pincode);
  let currentOwnerLabel = "another clinic";

  if (existing?.clinic_id) {
    const owner = await findClinicById(existing.clinic_id);
    if (owner) {
      currentOwnerLabel = owner.franchise_id
        ? `franchise clinic "${owner.name}"`
        : `the Core Operation clinic "${owner.name}"`;
    }
  }

  return (
    `Pincode ${pincode} is already mapped to ${currentOwnerLabel}; it cannot ` +
    `also be served by clinic "${destinationClinicName}". Resolve this overlap ` +
    `so the pincode maps to exactly one entity before activating the franchise.`
  );
}

/**
 * Fetch the riders that map `pincode` together with their currently linked
 * clinic, BEFORE the assignment runs, so the resulting warnings reflect the
 * pre-assignment mappings (Req 9.4). Mirrors `fetchPincodeRiderMappings` in
 * `serviceAreaActions.ts`. Service-area rows with no assigned rider are skipped.
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

// ─── Clinic wiring (Task 7.1) ────────────────────────────────────────────────

/**
 * Wire a Clinic to a Franchise (Req 6.1, 6.2, 6.3, 6.4, 6.5). Validates a
 * non-empty name, a non-empty full address, a latitude in [-90, 90] and a
 * longitude in [-180, 180] (rejecting any missing/out-of-range geo or missing
 * name/address and persisting NO record — Req 6.5); resolves the Clinic's
 * Kitchen as the single Kitchen owned by the Franchise's Group (Req 6.3); then
 * persists a `clinics` row carrying the geo, the resolved `kitchen_id`, and
 * `franchise_id` set to that Franchise (Req 6.1, 6.4). Geo is stored ONLY on the
 * Clinic, never on the Kitchen (Req 6.2).
 *
 * full_network scope only; gated by FRANCHISE_FEATURES_ENABLED.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5.
 */
export async function wireClinicToFranchise(
  input: FranchiseClinicSchemaInput
): Promise<ActionResult<{ id: string }>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  // Reject missing/out-of-range geo or missing name/address BEFORE any write,
  // returning the offending field (Req 6.5).
  const validated = validateFranchiseClinicInput(input);
  if (!validated.ok) return validated.result;

  const { name, address, latitude, longitude, franchise_id } = validated.data;

  // Resolve the Clinic's Kitchen via the Franchise's Group (Req 6.3).
  const kitchen = await resolveFranchiseKitchenId(franchise_id);
  if (!kitchen.ok) return kitchen.result;

  try {
    // Persist the franchise Clinic: geo lives on the Clinic, kitchen_id is the
    // Group's Kitchen, franchise_id stamps the owning Franchise (Req 6.1, 6.4).
    const clinic = await insertFranchiseClinic({
      name,
      address,
      latitude,
      longitude,
      franchise_id,
      kitchen_id: kitchen.kitchenId,
    });

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: { id: clinic.id } };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to wire clinic to franchise",
    };
  }
}

/**
 * Update an existing franchise Clinic's geo (Req 6.1, 6.2, 6.4, 6.5). Applies
 * the same validation as {@link wireClinicToFranchise} (rejecting any
 * missing/out-of-range geo or missing name/address and persisting no change —
 * Req 6.5), re-resolves the Clinic's Kitchen via the Franchise's Group so the
 * Clinic → Franchise → Group → Kitchen invariant is maintained (Req 6.3), and
 * updates the `clinics` row. Geo remains ONLY on the Clinic (Req 6.2).
 *
 * full_network scope only; gated by FRANCHISE_FEATURES_ENABLED.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5.
 */
export async function updateFranchiseClinic(
  clinicId: string,
  input: FranchiseClinicSchemaInput
): Promise<ActionResult<FranchiseClinic>> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  if (!clinicId || clinicId.trim().length === 0) {
    return { success: false, error: "Clinic id is required", field: "clinicId" };
  }

  const validated = validateFranchiseClinicInput(input);
  if (!validated.ok) return validated.result;

  // Not-found guard.
  const existing = await getFranchiseClinicById(clinicId);
  if (!existing) {
    return { success: false, error: "Clinic not found" };
  }

  const { name, address, latitude, longitude, franchise_id } = validated.data;

  // Re-resolve the Kitchen via the Franchise's Group so the Clinic stays bound
  // to its Group's single Kitchen (Req 6.3).
  const kitchen = await resolveFranchiseKitchenId(franchise_id);
  if (!kitchen.ok) return kitchen.result;

  try {
    const updated = await updateFranchiseClinicRecord(clinicId, {
      name,
      address,
      latitude,
      longitude,
      kitchen_id: kitchen.kitchenId,
    });

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update franchise clinic",
    };
  }
}

// ─── Pincode assignment + overlap detection (Task 7.2) ───────────────────────

/**
 * Assign a 6-digit pincode to a franchise Clinic (Req 6.6, 15.1, 15.2, 15.3,
 * 15.4, 15.7).
 *
 * The pincode-to-Clinic association is the one-pincode-one-clinic model in
 * `rider_service_areas`, backed by the `uq_service_area_pincode` unique index
 * (Req 15.1). The franchise stamp follows the DESTINATION Clinic: the Clinic's
 * `franchise_id` is the served pincode's owning entity.
 *
 * OVERLAP DETECTION (evaluated at SETUP time, not at customer signup — Req 15.4):
 *   - If the pincode is already served by ANOTHER Clinic (a franchise Clinic or
 *     a Core_Operation Clinic), the assignment is a configuration conflict
 *     (Req 15.2). It is surfaced immediately as a conflict result that names the
 *     pincode and the entities it maps to, persists no change, and — because the
 *     activation guard (`hasUnresolvedPincodeOverlap`) lives in
 *     `franchiseActions` — blocks ONLY the franchise's transition to `active`
 *     (Req 15.5, 15.6); non-conflicting pincodes still serve customers.
 *   - The `uq_service_area_pincode` unique violation is also caught as the
 *     authoritative source of truth (robust against concurrency), mapped to the
 *     same conflict result.
 *
 * MOVE / REASSIGN: when the pincode has a clinic-LESS service-area row (a legacy
 * unassigned pincode), the assignment delegates to the EXISTING atomic RPC
 * `move_pincode_and_reassign` (with a NULL source clinic) so the service-area
 * stamp and any matching customer / primary-address re-stamp commit together,
 * returning the count of reassigned customers (Req 15.7). When no row exists yet
 * the association is inserted directly. Either path returns the reassigned-customer
 * count plus any rider-clinic mismatch warnings (mirroring
 * `serviceAreaActions.movePincode`).
 *
 * full_network scope only; gated by FRANCHISE_FEATURES_ENABLED.
 *
 * Validates: Requirements 6.6, 15.1, 15.2, 15.3, 15.4, 15.7.
 */
export async function assignPincodeToFranchiseClinic(
  pincode: string,
  clinicId: string
): Promise<
  ActionResult<{ reassignedCount: number; riderWarnings: RiderClinicWarning[] }>
> {
  const denied = await assertFullNetworkScope();
  if (denied) return denied;

  const trimmedPincode = (pincode ?? "").trim();

  // Bad-format rejection BEFORE any read/write (Req 15.1 — 6-digit pincode).
  if (!isValidPincode(trimmedPincode)) {
    return {
      success: false,
      error: "Pincode must be exactly 6 digits",
      field: "pincode",
    };
  }

  if (!clinicId || clinicId.trim().length === 0) {
    return { success: false, error: "A clinic is required", field: "clinicId" };
  }

  // The destination must be an existing FRANCHISE Clinic — pincodes are wired to
  // a franchise Clinic as the routing origin (Req 6.6).
  const destClinic = await findClinicById(clinicId);
  if (!destClinic) {
    return {
      success: false,
      error: "The selected clinic is invalid or unavailable",
      field: "clinicId",
    };
  }
  if (!destClinic.franchise_id) {
    return {
      success: false,
      error: "The selected clinic is not a franchise clinic",
      field: "clinicId",
    };
  }

  // Inspect the current owner of the pincode for overlap detection (Req 15.2).
  const existing = await getServiceAreaByPincode(trimmedPincode);

  // Already assigned to THIS clinic → idempotent no-op success.
  if (existing?.clinic_id && existing.clinic_id === clinicId) {
    return { success: true, data: { reassignedCount: 0, riderWarnings: [] } };
  }

  // OVERLAP: the pincode is already served by a DIFFERENT Clinic (franchise or
  // Core). Surface the conflict naming the pincode and the entities it maps to;
  // persist nothing (Req 15.2, 15.4). This blocks only activation (the guard
  // lives in franchiseActions — Req 15.5, 15.6).
  if (existing?.clinic_id && existing.clinic_id !== clinicId) {
    return {
      success: false,
      error: await pincodeOverlapConflictError(trimmedPincode, destClinic.name),
      field: "pincode",
    };
  }

  // Compute rider-clinic mismatch warnings from the PRE-assignment mappings (Req 9.4).
  const mappingRiders = await fetchPincodeRiderMappings(trimmedPincode);
  const riderWarnings = buildRiderClinicWarnings(
    clinicId,
    trimmedPincode,
    mappingRiders
  );

  try {
    const admin = createAdminClient();

    if (existing) {
      // A clinic-LESS service-area row exists (clinic_id IS NULL): assign it via
      // the authoritative atomic RPC with a NULL source clinic, so the
      // service-area stamp and any matching customer / primary-address re-stamp
      // commit together (Req 15.7). Returns the count of reassigned customers.
      const { data, error } = await admin.rpc("move_pincode_and_reassign", {
        p_pincode: trimmedPincode,
        p_from_clinic: null,
        p_to_clinic: clinicId,
      });

      if (error) throw error;

      const reassignedCount =
        typeof data === "number" ? data : Number(data ?? 0) || 0;

      revalidatePath(MASTER_SYSTEM_PATH);
      return { success: true, data: { reassignedCount, riderWarnings } };
    }

    // No service-area row yet: create the association. The DB unique index
    // `uq_service_area_pincode` is the authoritative overlap guard and is
    // re-checked in the catch below (Req 15.1, 15.2). No customers are stamped
    // to a brand-new pincode, so the reassigned count is 0.
    await insertServiceArea({
      clinic_id: clinicId,
      pincode: trimmedPincode,
      area_name: trimmedPincode,
    });

    revalidatePath(MASTER_SYSTEM_PATH);
    return { success: true, data: { reassignedCount: 0, riderWarnings } };
  } catch (error) {
    // Overlap surfaced by the unique index — map to the conflict result (Req 15.2).
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: await pincodeOverlapConflictError(trimmedPincode, destClinic.name),
        field: "pincode",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to assign pincode to franchise clinic",
    };
  }
}
