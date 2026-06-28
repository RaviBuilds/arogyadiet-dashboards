// src/lib/clinic/stamping.ts
// Customer clinic stamping (core-clinic-architecture, Requirement 6).
//
// Customer-to-clinic association is anchored SOLELY to the Customer's
// Primary_Address pincode (Req 6.7). This module exposes:
//
//   1. `resolveCustomerStamp` — the PURE decision of what the customer's stamp
//      should become given the resolution of their PRIMARY-address pincode.
//      resolved/none → { next }; ambiguous → { unchanged: true } (Req 6.6).
//
//   2. `stampCustomerByPrimaryAddress` — the wiring helper that looks up the
//      customer's primary address, resolves its pincode via
//      `resolveClinicForPincode`, applies the pure decision, and PERSISTS the
//      result on BOTH `customer_profiles.clinic_id` and the primary
//      `addresses.clinic_id`, within the caller's existing operation.
//
//   3. `stampCustomerClinic` — a low-level primitive that stamps a specific
//      (customer, address) pair from an already-known pincode. Retained for
//      callers that already hold the exact address to stamp.
//
//   resolved  → set clinic_id to the resolved clinic                 (Req 6.1, 6.2)
//   none      → set clinic_id to null (unset)                        (Req 6.4, 6.5)
//   ambiguous → leave clinic_id unchanged + surface an ambiguity     (Req 6.6)
//
// The value is PERSISTED at write time and never recomputed at read time
// (Req 6.3). Callers pass the SAME Supabase client they use to write the
// address/profile so the stamp lands in the same operation, preserving the
// existing inputs/outputs/completion behavior of those flows (Req 6.8).
//
// Selecting a different Delivery_Address for a given day is a SEPARATE flow that
// never reaches this module, so it can never change `customer_profiles.clinic_id`
// (Req 6.7).
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
 * Pure decision of what a customer's stamped `clinic_id` should become, given
 * the resolution of their PRIMARY-address pincode and their current stamp.
 *
 * - resolved  → `{ next: <clinic_id> }` (Req 6.1, 6.2)
 * - none      → `{ next: null }` (unset/clear) (Req 6.4, 6.5)
 * - ambiguous → `{ unchanged: true }` — leave the existing stamp in place
 *               (Req 6.6; defensive — the DB unique pincode constraint makes
 *               this unreachable in practice).
 *
 * Pure and side-effect free, so it is fully property-testable in isolation.
 *
 * @param primaryAddressResolution The resolution of the Primary_Address pincode.
 * @param currentClinicId          The customer's currently persisted clinic_id.
 *                                 Accepted for caller symmetry / transition
 *                                 reasoning; the resolved/none decision does not
 *                                 depend on it.
 */
export function resolveCustomerStamp(
  primaryAddressResolution: ClinicResolution,
  // Part of the design signature for caller symmetry; the resolved/none decision
  // is independent of the prior value (a re-stamp to the same clinic is
  // idempotent), so it is intentionally unused here.
  _currentClinicId: string | null
): { next: string | null } | { unchanged: true } {
  // Ambiguous: never touch the existing stamp (Req 6.6).
  if (primaryAddressResolution.type === "ambiguous") {
    return { unchanged: true };
  }

  // resolved → that clinic (Req 6.1, 6.2); none → unset/null (Req 6.4, 6.5).
  const next =
    primaryAddressResolution.type === "resolved"
      ? primaryAddressResolution.clinic_id
      : null;

  return { next };
}

/**
 * Outcome of stamping a customer with their resolved clinic.
 *
 * - `stamped`    — pincode resolved to exactly one clinic; both `customer_profiles`
 *                  and the primary address row were set to `clinic_id` (Req 6.1, 6.2).
 * - `cleared`    — pincode resolved to no clinic; both `clinic_id` values were set
 *                  to `null` (Req 6.4, 6.5).
 * - `ambiguous`  — pincode resolved to more than one clinic; both `clinic_id`
 *                  values were left unchanged and ambiguity is surfaced (Req 6.6).
 * - `no_primary` — the customer has no primary address to anchor to; nothing was
 *                  changed (the stamp stays unset / unchanged).
 * - `error`      — a persistence error occurred; carries the message.
 */
export type ClinicStampResult =
  | { type: "stamped"; clinic_id: string }
  | { type: "cleared"; clinic_id: null }
  | { type: "ambiguous"; clinic_id: null }
  | { type: "no_primary" }
  | { type: "error"; error: string };

/**
 * Resolves the clinic for the customer's PRIMARY_ADDRESS pincode and persists the
 * resulting `clinic_id` on both the customer profile and the primary address row
 * using the supplied Supabase client (so the write happens within the caller's
 * existing operation — signup / address-update).
 *
 * Stamping is anchored to the Primary_Address only (Req 6.7); the customer's
 * stamp never tracks a per-day Delivery_Address selection.
 *
 * @param params.supabase          The Supabase client used by the calling flow.
 * @param params.customerProfileId The `customer_profiles.id` to stamp.
 * @returns A discriminated result describing what was persisted.
 */
export async function stampCustomerByPrimaryAddress(params: {
  supabase: SupabaseClient;
  customerProfileId: string;
}): Promise<ClinicStampResult> {
  const { supabase, customerProfileId } = params;

  // Anchor on the Customer's PRIMARY address (Req 6: Primary_Address pincode).
  const { data: primaryAddress, error: primaryError } = await supabase
    .from("addresses")
    .select("id, pincode, clinic_id")
    .eq("customer_profile_id", customerProfileId)
    .eq("is_primary", true)
    .maybeSingle();

  if (primaryError) {
    return { type: "error", error: primaryError.message };
  }

  // No primary address yet → nothing to anchor to; leave the stamp unchanged.
  if (!primaryAddress) {
    return { type: "no_primary" };
  }

  // Current persisted stamp (so the pure decision can reason about the change).
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("clinic_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  const currentClinicId = (profile?.clinic_id as string | null) ?? null;

  const resolution: ClinicResolution = await resolveClinicForPincode(
    primaryAddress.pincode as string
  );

  const decision = resolveCustomerStamp(resolution, currentClinicId);

  // Ambiguous → leave both clinic_id values unchanged (Req 6.6).
  if ("unchanged" in decision) {
    return { type: "ambiguous", clinic_id: null };
  }

  return persistStamp(
    supabase,
    customerProfileId,
    primaryAddress.id as string,
    decision.next
  );
}

/**
 * Resolves the clinic for `pincode` and persists the resulting `clinic_id` on
 * both the customer profile and the given address row using the supplied
 * Supabase client (so the write happens within the caller's existing operation).
 *
 * Low-level primitive for callers that already hold the exact (customer, address)
 * pair to stamp. Prefer `stampCustomerByPrimaryAddress` for the signup /
 * address-update flows so stamping stays anchored to the Primary_Address.
 *
 * @param params.supabase          The Supabase client used by the calling flow.
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
  const decision = resolveCustomerStamp(resolution, null);

  // Ambiguous: leave both clinic_id values unchanged, surface ambiguity (Req 6.6).
  if ("unchanged" in decision) {
    return { type: "ambiguous", clinic_id: null };
  }

  return persistStamp(supabase, customerProfileId, addressId, decision.next);
}

/**
 * Persists `clinicId` (a resolved clinic, or `null` to clear) on both the
 * customer profile and the address row, returning the matching result.
 */
async function persistStamp(
  supabase: SupabaseClient,
  customerProfileId: string,
  addressId: string,
  clinicId: string | null
): Promise<ClinicStampResult> {
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
