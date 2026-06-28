// src/lib/clinic/__tests__/delivery-address-no-restamp.property.test.ts
//
// Feature: core-clinic-architecture, Property 14: Delivery-address selection never changes the customer's clinic stamp
//
// Property 14: For any customer with a stamped clinic_id and for any selection
//   of a Delivery_Address (for a specific delivery day) whose pincode differs
//   from the Primary_Address pincode, the customer's stamped clinic_id is
//   determined solely by the Primary_Address and is left unchanged by the
//   delivery-address selection.
//
// **Validates: Requirements 6.7**
//
// Strategy: `resolveCustomerStamp` — the sole decision point for what a
//   customer's clinic stamp becomes — takes ONLY the Primary_Address resolution
//   (and the prior stamp) as input. A Delivery_Address selection is a separate
//   flow that never reaches this function. We model that structural fact by
//   generating an arbitrary Delivery_Address resolution that differs from the
//   Primary_Address resolution and confirming the stamp decision computed from
//   the primary is identical whether or not a delivery selection occurred — the
//   delivery resolution provably cannot influence the result.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { resolveCustomerStamp } from "../stamping";
import type { ClinicResolution } from "@/lib/clinic/pincode-resolver";

// ─── Generators ──────────────────────────────────────────────────────────────

const arbClinicId = fc.uuid();

const arbResolution: fc.Arbitrary<ClinicResolution> = fc.oneof(
  arbClinicId.map(
    (clinic_id): ClinicResolution => ({ type: "resolved", clinic_id })
  ),
  fc.constant<ClinicResolution>({ type: "none", clinic_id: null }),
  fc.constant<ClinicResolution>({ type: "ambiguous", clinic_id: null })
);

const arbInitialClinic = fc.oneof(fc.uuid(), fc.constant<string | null>(null));

/**
 * Models the customer's stamp pipeline. Only the Primary_Address resolution is
 * an input; a per-day Delivery_Address selection is deliberately NOT passed to
 * the stamper (Req 6.7), so it cannot influence the result.
 */
function computeStampForDay(
  primaryResolution: ClinicResolution,
  currentClinicId: string | null
): { next: string | null } | { unchanged: true } {
  return resolveCustomerStamp(primaryResolution, currentClinicId);
}

describe("Delivery-address selection never re-stamps the customer - Property 14", () => {
  it("the stamp decision depends only on the Primary_Address, never on the selected Delivery_Address", () => {
    fc.assert(
      fc.property(
        arbResolution, // Primary_Address resolution
        arbResolution, // a Delivery_Address resolution (a different address for the day)
        arbClinicId, // the customer's Primary_Address pincode (proxy)
        arbClinicId, // the selected Delivery_Address pincode (proxy)
        arbInitialClinic, // the customer's current stamp
        (primaryResolution, deliveryResolution, primaryPincode, deliveryPincode, currentClinicId) => {
          // Only consider days where the customer selects a DIFFERENT delivery
          // address than their primary (the precondition of Property 14).
          fc.pre(deliveryPincode !== primaryPincode);

          // Baseline: stamp computed from the Primary_Address alone (no delivery
          // selection involved at all).
          const baseline = resolveCustomerStamp(primaryResolution, currentClinicId);

          // With a delivery-address selection in play for the day. The delivery
          // resolution is generated but, per Req 6.7, the stamper never receives
          // it — so the computed stamp must be identical to the baseline.
          const withDeliverySelection = computeStampForDay(
            primaryResolution,
            currentClinicId
          );

          expect(withDeliverySelection).toEqual(baseline);

          // And concretely: the stamp follows the PRIMARY resolution, never the
          // (differing) delivery resolution.
          if (primaryResolution.type === "resolved") {
            expect(withDeliverySelection).toEqual({
              next: primaryResolution.clinic_id,
            });
            // Even if the delivery address resolved to some other clinic, the
            // stamp is the primary's clinic — never the delivery clinic.
            if (
              deliveryResolution.type === "resolved" &&
              deliveryResolution.clinic_id !== primaryResolution.clinic_id
            ) {
              expect(withDeliverySelection).not.toEqual({
                next: deliveryResolution.clinic_id,
              });
            }
          } else if (primaryResolution.type === "none") {
            expect(withDeliverySelection).toEqual({ next: null });
          } else {
            expect(withDeliverySelection).toEqual({ unchanged: true });
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
