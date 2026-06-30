// src/lib/clinic/__tests__/conflict-detection.property.test.ts
// Feature: core-clinic-architecture, Property 43: Conflict Clinic detection
//
// Property 43: For any Primary_Address clinic and any selected Delivery_Address
// clinic resolution, `detectClinicConflict` reports a conflict iff the delivery
// clinic differs from the primary clinic or the delivery address resolves to no
// clinic: `mismatch` when both resolve to clinics that differ, `unresolved`
// (needs-attention) when the delivery address resolves to no clinic, and `none`
// when both resolve to the same clinic. In every case the customer's stamped
// clinic_id is never altered by raising the conflict.
//
// NOTE on the IMPLEMENTED decision tree (see src/lib/clinic/conflict.ts): a
// `mismatch` requires BOTH ids non-null. When primaryClinicId === null but the
// delivery resolves to a clinic, there is no concrete primary clinic to compare
// against, so the implementation returns `none` (not `mismatch`). The oracle
// below mirrors that documented decision tree exactly.
//
// Validates: Requirements 22.1, 22.2, 22.4, 22.5, 22.8

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectClinicConflict, type ClinicConflict } from "../conflict";

// ─── Arbitrary generators ──────────────────────────────────────────────────
// A resolved clinic is a uuid; an unresolved one is null. This is the exact
// domain of both inputs: `customer_profiles.clinic_id` (Primary_Address clinic)
// and the delivery-address resolution, each `string | null`.
const arbClinicIdOrNull: fc.Arbitrary<string | null> = fc.oneof(
  fc.uuid(),
  fc.constant(null)
);

// Independent oracle for the IMPLEMENTED decision tree (conflict.ts):
//   1. deliveryClinicId === null               -> unresolved
//   2. both non-null and they differ           -> mismatch
//   3. otherwise (same clinic, OR primary null) -> none
function oracle(
  primaryClinicId: string | null,
  deliveryClinicId: string | null
): ClinicConflict {
  if (deliveryClinicId === null) {
    return { type: "unresolved", primaryClinicId, deliveryClinicId: null };
  }
  if (primaryClinicId !== null && deliveryClinicId !== primaryClinicId) {
    return { type: "mismatch", primaryClinicId, deliveryClinicId };
  }
  return { type: "none" };
}

describe("Property 43: Conflict Clinic detection", () => {
  it("matches the documented decision tree for every (primary, delivery) pair", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, arbClinicIdOrNull, (primaryClinicId, deliveryClinicId) => {
        const result = detectClinicConflict(primaryClinicId, deliveryClinicId);
        expect(result).toEqual(oracle(primaryClinicId, deliveryClinicId));
      }),
      { numRuns: 200 }
    );
  });

  it("reports `unresolved` whenever the delivery address resolves to no clinic (Req 22.5)", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, (primaryClinicId) => {
        const result = detectClinicConflict(primaryClinicId, null);
        expect(result.type).toBe("unresolved");
        // The unresolved entry carries the (possibly null) primary clinic and a
        // null delivery clinic — never blocking, just needs-attention.
        if (result.type === "unresolved") {
          expect(result.primaryClinicId).toBe(primaryClinicId);
          expect(result.deliveryClinicId).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("reports `mismatch` exactly when both clinics are non-null and differ (Req 22.2)", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (primaryClinicId, deliveryClinicId) => {
        // Constrain to two distinct non-null clinics: pre-condition for mismatch.
        fc.pre(primaryClinicId !== deliveryClinicId);
        const result = detectClinicConflict(primaryClinicId, deliveryClinicId);
        expect(result).toEqual({ type: "mismatch", primaryClinicId, deliveryClinicId });
      }),
      { numRuns: 100 }
    );
  });

  it("reports `none` when both resolve to the same clinic (Req 22.4)", () => {
    fc.assert(
      fc.property(fc.uuid(), (clinicId) => {
        const result = detectClinicConflict(clinicId, clinicId);
        expect(result).toEqual({ type: "none" });
      }),
      { numRuns: 100 }
    );
  });

  it("reports `none` when there is no primary clinic to compare against, even if delivery resolves (implemented decision tree)", () => {
    fc.assert(
      fc.property(fc.uuid(), (deliveryClinicId) => {
        // primaryClinicId === null: no concrete primary clinic, so the
        // implementation returns `none` rather than `mismatch`.
        const result = detectClinicConflict(null, deliveryClinicId);
        expect(result).toEqual({ type: "none" });
      }),
      { numRuns: 100 }
    );
  });

  it("never alters the customer's stamp — detection is a pure classification (Req 22.8)", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, arbClinicIdOrNull, (primaryClinicId, deliveryClinicId) => {
        // The inputs are primitive (string | null) and passed by value, so the
        // function cannot mutate the customer's stamp. We assert the result is a
        // well-formed classification and that calling it is referentially
        // transparent (same inputs -> same output, no hidden state).
        const first = detectClinicConflict(primaryClinicId, deliveryClinicId);
        const second = detectClinicConflict(primaryClinicId, deliveryClinicId);
        expect(first).toEqual(second);
        expect(["none", "mismatch", "unresolved"]).toContain(first.type);
      }),
      { numRuns: 100 }
    );
  });
});
