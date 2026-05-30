"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPincodeValidationError,
  isDeliverablePincode,
  normalizePincode,
} from "@/lib/address/validatePincode";

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
