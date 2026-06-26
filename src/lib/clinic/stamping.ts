// src/lib/clinic/stamping.ts
// Customer clinic stamping (core-clinic-architecture, Requirement 6).
//
// Given a customer profile and one of its address rows (plus the address
// pincode), this module resolves the owning clinic via `resolveClinicForPincode`
// and PERSISTS the resulting `clinic_id` on BOTH `customer_profiles` and that
// `addresses` row, within the same operation that writes the address/profile.
//
//   resolved  → set both clinic_id to the resolved clinic            (Req 6.1, 6.2)
//   none      → set both clinic_id to null                           (Req 6.4, 6.5)
//   ambiguous → leave clinic_id unchanged + surface an ambiguity     (Req 6.6)
//
// The value is PERSISTED at write time and never recomputed at read time
// (Req 6.3). Callers (addressActions.saveAddressAction, and any signup flow
// that creates a first address inline) pass the SAME Supabase client they use
// to write the address so the stamp lands in the same operation, preserving the
// existing inputs/outputs/completion behavior of those flows (Req 6.7).
//
// NOTE: like reassignment.ts, this module touches ONLY `customer_profiles` and
// `addresses` — never the immutable `delivery_orders`/`delivery_batches` clinic
// stamps.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveClinicForPincode,
  type ClinicResolution,
} from "@/lib/clinic/pincode-resolver";

/**
 * Outcome of stamping a customer + address with their resolved clinic.
 *
 * - `stamped`   — pincode resolved to exactly one clinic; both `customer_profiles`
 *                 and the address row were set to `clinic_id` (Req 6.1, 6.2).
 * - `cleared`   — pincode resolved to no clinic; both `clinic_id` values were set
 *                 to `null` (Req 6.4, 6.5).
 * - `ambiguous` — pincode resolved to more than one clinic; both `clinic_id`
 *                 values were left unchanged and ambiguity is surfaced (Req 6.6).
 * - `error`     — a persistence error occurred; carries the message.
 */
export type ClinicStampResult =
  | { type: "stamped"; clinic_id: string }
  | { type: "cleared"; clinic_id: null }
  | { type: "ambiguous"; clinic_id: null }
  | { type: "error"; error: string };

/**
 * Resolves the clinic for `pincode` and persists the resulting `clinic_id` on
 * both the customer profile and the given address row using the supplied
 * Supabase client (so the write happens within the caller's existing operation).
 *
 * @param params.supabase          The Supabase client used by the calling flow
 *                                 (server or admin client) to write the stamp.
 * @param params.customerProfileId The `customer_profiles.id` to stamp.
 * @param params.addressId         The `addresses.id` to stamp.
 * @param params.pincode           The address pincode to resolve.
 * @returns A discriminated result describing what was persisted.
 */
export async function stampCustomerClinic(params: {
  supabase: SupabaseClient;
  customerProfileId: string;
  addressId: string;
  pincode: string;
}): Promise<ClinicStampResult> {
  const { supabase, customerProfileId, addressId, pincode } = params;

  const resolution: ClinicResolution = await resolveClinicForPincode(pincode);

  // Ambiguous: leave both clinic_id values unchanged, surface ambiguity (Req 6.6).
  if (resolution.type === "ambiguous") {
    return { type: "ambiguous", clinic_id: null };
  }

  // resolved → clinic id; none → null. Persisted on BOTH records (Req 6.1–6.5).
  const clinicId = resolution.type === "resolved" ? resolution.clinic_id : null;

  const { error: profileError } = await supabase
    .from("customer_profiles")
    .update({ clinic_id: clinicId })
    .eq("id", customerProfileId);

  if (profileError) {
    return { type: "error", error: profileError.message };
  }

  const { error: addressError } = await supabase
    .from("addresses")
    .update({ clinic_id: clinicId })
    .eq("id", addressId);

  if (addressError) {
    return { type: "error", error: addressError.message };
  }

  return clinicId === null
    ? { type: "cleared", clinic_id: null }
    : { type: "stamped", clinic_id: clinicId };
}
