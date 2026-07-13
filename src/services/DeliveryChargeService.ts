// src/services/DeliveryChargeService.ts
// Orchestrates the delivery-charge computation pipeline.
//
// Two entry points:
// - computeForCustomer: loads the customer's Primary_Address, then runs pipeline
// - computeForAddress: caller already holds address data, runs pipeline directly
//
// Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 4.1, 4.2

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeDeliveryDistanceKm,
  calculateDeliveryCharge,
  MAX_DELIVERY_CHARGE,
} from "@/lib/delivery/deliveryCharge";
import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import { resolveDeliveryRateForClinic } from "@/services/RateConfigService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryChargeOutcome =
  | {
      ok: true;
      distanceKm: number;
      ratePerKm: number;
      rateSource: "franchise" | "core" | "default";
      perDayCharge: number;
      totalDeliveryCharge: number;
      clinicId: string;
    }
  | { ok: false; reason: "missing_pincode" }
  | { ok: false; reason: "unresolved_clinic"; clinicResolution: "none" | "ambiguous" }
  | { ok: false; reason: "missing_coordinates" }
  | { ok: false; reason: "invalid_coordinates" }
  | { ok: false; reason: "unresolved_rate" }
  | { ok: false; reason: "invalid_input"; field: string };

// ---------------------------------------------------------------------------
// Internal pipeline
// ---------------------------------------------------------------------------

/**
 * Core pipeline shared by both public entry points.
 * Receives the address data (pincode, lat, lng), resolves clinic, distance,
 * rate, and charge.
 */
async function runPipeline(
  db: SupabaseClient,
  address: { pincode: string | null; lat: number | null; lng: number | null },
  planDays: number,
): Promise<DeliveryChargeOutcome> {
  // Step 1: Guard — pincode must be non-null and non-empty/whitespace
  if (!address.pincode || address.pincode.trim().length === 0) {
    return { ok: false, reason: "missing_pincode" };
  }

  // Step 2: Resolve clinic from pincode
  const clinicResolution = await resolveClinicForPincode(address.pincode.trim());

  if (clinicResolution.type === "none") {
    return { ok: false, reason: "unresolved_clinic", clinicResolution: "none" };
  }
  if (clinicResolution.type === "ambiguous") {
    return { ok: false, reason: "unresolved_clinic", clinicResolution: "ambiguous" };
  }

  const clinicId = clinicResolution.clinic_id;

  // Step 3: Load clinic coordinates from the clinics table
  const { data: clinicRow, error: clinicError } = await db
    .from("clinics")
    .select("id, latitude, longitude, franchise_id")
    .eq("id", clinicId)
    .maybeSingle();

  if (clinicError) throw clinicError;

  if (!clinicRow) {
    // Clinic resolved from pincode but not found in clinics table — treat as unresolved
    return { ok: false, reason: "unresolved_clinic", clinicResolution: "none" };
  }

  // Step 4: Compute distance between address and clinic
  const distanceResult = computeDeliveryDistanceKm(
    { lat: address.lat, lng: address.lng },
    { latitude: clinicRow.latitude, longitude: clinicRow.longitude },
  );

  if (!distanceResult.ok) {
    return { ok: false, reason: distanceResult.reason };
  }

  // Step 5: Resolve the delivery rate for this clinic
  const rateResult = await resolveDeliveryRateForClinic(db, {
    id: clinicRow.id,
    franchise_id: clinicRow.franchise_id,
  });

  // Step 6: Calculate the delivery charge
  const chargeResult = calculateDeliveryCharge({
    ratePerKm: rateResult.ratePerKm,
    distanceKm: distanceResult.distanceKm,
    planDays,
  });

  if (!chargeResult.ok) {
    return { ok: false, reason: "invalid_input", field: chargeResult.field };
  }

  // Step 7: Clamp — if totalDeliveryCharge exceeds MAX_DELIVERY_CHARGE, report invalid_input
  if (chargeResult.totalDeliveryCharge > MAX_DELIVERY_CHARGE) {
    return { ok: false, reason: "invalid_input", field: "totalDeliveryCharge" };
  }

  // Ensure non-negative (defensive; calculateDeliveryCharge validates non-negative inputs)
  if (chargeResult.totalDeliveryCharge < 0) {
    return { ok: false, reason: "invalid_input", field: "totalDeliveryCharge" };
  }

  // Step 8: Return success outcome
  return {
    ok: true,
    distanceKm: chargeResult.distanceKm,
    ratePerKm: chargeResult.ratePerKm,
    rateSource: rateResult.source,
    perDayCharge: chargeResult.perDayCharge,
    totalDeliveryCharge: chargeResult.totalDeliveryCharge,
    clinicId,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes the delivery charge for a customer by loading their Primary_Address
 * and running the full pipeline.
 *
 * Req 2.3, 2.4, 2.5, 2.6
 */
export async function computeForCustomer(
  db: SupabaseClient,
  args: { customerProfileId: string; planDays: number },
): Promise<DeliveryChargeOutcome> {
  // Load the customer's primary address
  const { data: addressRow, error: addressError } = await db
    .from("addresses")
    .select("pincode, lat, lng")
    .eq("customer_profile_id", args.customerProfileId)
    .eq("is_primary", true)
    .maybeSingle();

  if (addressError) throw addressError;

  // If no primary address exists, report missing_pincode (Req 2.6)
  if (!addressRow) {
    return { ok: false, reason: "missing_pincode" };
  }

  return runPipeline(
    db,
    {
      pincode: addressRow.pincode,
      lat: addressRow.lat,
      lng: addressRow.lng,
    },
    args.planDays,
  );
}

/**
 * Computes the delivery charge when the caller already holds the address data
 * (e.g. during checkout or onboarding where address is in memory).
 *
 * Req 2.3, 2.4, 2.5, 2.7
 */
export async function computeForAddress(
  db: SupabaseClient,
  args: {
    address: { pincode: string | null; lat: number | null; lng: number | null };
    planDays: number;
  },
): Promise<DeliveryChargeOutcome> {
  return runPipeline(db, args.address, args.planDays);
}
