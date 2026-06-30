// src/lib/clinic/__tests__/rider-warnings.property.test.ts
// Property test for the pincode-move rider clinic-mismatch warning.
//
// Feature: core-clinic-architecture, Property 20: Pincode-move clinic-mismatch warning
//
// Validates: Requirements 9.4

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildRiderClinicWarnings,
  type PincodeRiderMapping,
} from "../rider-warnings";

// ─── Arbitrary generators ──────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);
const arbClinicId = fc.uuid();

/**
 * A rider mapping whose clinicId may equal the destination clinic, differ from
 * it, or be null. We bias the generator toward the destination id so the
 * "already linked" (no-warning) branch is exercised frequently.
 */
function arbMappingRiders(destinationClinicId: string) {
  const arbClinicForRider = fc.oneof(
    fc.constant<string | null>(destinationClinicId), // matches destination
    arbClinicId, // arbitrary (almost surely differs)
    fc.constant<string | null>(null) // unlinked → mismatch
  );

  return fc.array(
    fc.record({
      riderId: fc.uuid(),
      riderName: fc.option(fc.string(), { nil: undefined }),
      clinicId: arbClinicForRider,
    }),
    { maxLength: 30 }
  ) as fc.Arbitrary<PincodeRiderMapping[]>;
}

// ─── Property Test ─────────────────────────────────────────────────────────

describe("Property 20: Pincode-move clinic-mismatch warning", () => {
  it("emits exactly one warning per mismatched rider (and none for matches), each correctly identifying rider and pincode", () => {
    fc.assert(
      fc.property(
        arbPincode,
        // chain so rider clinicIds are generated relative to the destination
        arbClinicId.chain((destinationClinicId) =>
          fc.tuple(
            fc.constant(destinationClinicId),
            arbMappingRiders(destinationClinicId)
          )
        ),
        (pincode, [destinationClinicId, mappingRiders]) => {
          const warnings = buildRiderClinicWarnings(
            destinationClinicId,
            pincode,
            mappingRiders
          );

          const mismatched = mappingRiders.filter(
            (r) => r.clinicId !== destinationClinicId
          );
          const matched = mappingRiders.filter(
            (r) => r.clinicId === destinationClinicId
          );

          // Exactly one warning per mismatched rider, none for matched riders.
          expect(warnings).toHaveLength(mismatched.length);

          // No warning references a rider already linked to the destination.
          const warnedRiderIds = new Set(warnings.map((w) => w.riderId));
          for (const m of matched) {
            // A matched rider could share an id with a mismatched rider in
            // pathological cases, but with uuid() generation collisions are
            // not produced, so this holds.
            expect(warnedRiderIds.has(m.riderId)).toBe(false);
          }

          // Pair each warning with its source rider (positional: the helper
          // preserves input order and skips matches).
          let idx = 0;
          for (const rider of mappingRiders) {
            if (rider.clinicId === destinationClinicId) continue;
            const w = warnings[idx++];
            expect(w.riderId).toBe(rider.riderId);
            expect(w.pincode).toBe(pincode);
            expect(w.currentClinicId).toBe(rider.clinicId);
            expect(w.destinationClinicId).toBe(destinationClinicId);
            expect(typeof w.message).toBe("string");
            expect(w.message.length).toBeGreaterThan(0);
            expect(w.message).toContain(pincode);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
