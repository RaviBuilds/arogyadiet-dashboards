"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPincodeValidationError,
  isDeliverablePincode,
  normalizePincode,
} from "@/lib/address/validatePincode";
import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import { listActiveDietitiansForFranchise } from "@/repositories/dietitian/dietitianRepository";

export async function getServiceAreaPincodesAction(): Promise<string[]> {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from("rider_service_areas")
    .select("pincode");

  if (error) {
    console.error("Failed to fetch service area pincodes:", error);
    return [];
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) =>
          typeof row.pincode === "string" ? normalizePincode(row.pincode) : "",
        )
        .filter(Boolean),
    ),
  );
}

export async function assertDeliverablePincode(
  pincode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const serviceAreaPincodes = await getServiceAreaPincodesAction();
  const error = getPincodeValidationError(pincode, serviceAreaPincodes);

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

export async function isDeliverablePincodeAction(
  pincode: string,
): Promise<boolean> {
  const serviceAreaPincodes = await getServiceAreaPincodesAction();
  return isDeliverablePincode(pincode, serviceAreaPincodes);
}

/**
 * Resolve the Clinic that owns a pincode, for the Meal onboarding wizard's
 * Dietitian dropdown (dietitian-management, Task 12.6, Req 7.1). Returns
 * `null` when the pincode resolves to no Clinic or is ambiguous — the caller
 * treats that identically to "Clinic not yet resolved".
 */
export async function resolveClinicForPincodeAction(
  pincode: string,
): Promise<{ clinicId: string | null }> {
  const resolution = await resolveClinicForPincode(pincode);
  return { clinicId: resolution.type === "resolved" ? resolution.clinic_id : null };
}

/**
 * Resolve a Franchise's single active Dietitian, for the Franchise-session
 * Meal onboarding wizard's read-only Dietitian display (dietitian-management,
 * Task 12.6, Req 7.6). Returns `null` when the Franchise has no active
 * Dietitian — the caller treats that as "no dietitian to display", not an
 * error, since onboarding may still complete with an empty Dietitian_Link.
 */
export async function getFranchiseDietitianAction(
  franchiseId: string,
): Promise<{ dietitianId: string | null; dietitianName: string | null }> {
  const dietitians = await listActiveDietitiansForFranchise(franchiseId);
  const dietitian = dietitians[0] ?? null;
  return {
    dietitianId: dietitian?.id ?? null,
    dietitianName: dietitian?.fullName ?? null,
  };
}
