// src/lib/clinic/__tests__/stamp-immutability.property.test.ts
// Property test for the immutability of order/batch clinic stamps
// (core-clinic-architecture, Requirement 19).
//
// Feature: core-clinic-architecture, Property 41: Clinic stamp is immutable after creation

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assertStampImmutable } from "../order-stamp";

// ─── Arbitrary generators ──────────────────────────────────────────────────
//
// A stamp value is either a clinic uuid or `null` (unset). We bias the
// generator to produce `null` frequently so every combination of
// (current, incoming) — null/null, null/uuid, uuid/null, uuid/same,
// uuid/different — is exercised across the run.

const arbStamp: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 2, arbitrary: fc.uuid() }
);

describe("Order/Batch Clinic Stamp Immutability - Property Tests", () => {
  // Feature: core-clinic-architecture, Property 41: Clinic stamp is immutable after creation
  // **Validates: Requirements 19.4, 19.5**
  describe("Property 41: Clinic stamp is immutable after creation", () => {
    it("a stamp may only transition from unset (null) to set; an already-set stamp cannot change to a different value, while re-writing the same value is an allowed no-op", () => {
      fc.assert(
        fc.property(arbStamp, arbStamp, (current, incoming) => {
          const result = assertStampImmutable(current, incoming);

          if (current === null) {
            // First-time set: any incoming value (including null) is allowed.
            expect(result).toEqual({ ok: true });
          } else if (incoming === current) {
            // Already-set: re-writing the identical value is an allowed no-op.
            expect(result).toEqual({ ok: true });
          } else {
            // Already-set and changing to a different value: rejected as
            // immutable; the original value is retained by the caller.
            expect(result).toEqual({ ok: false, reason: "immutable" });
          }
        }),
        { numRuns: 100 }
      );
    });

    it("targets every combination — verifies each branch with a representative case at least once", () => {
      // First-time set with null incoming.
      expect(assertStampImmutable(null, null)).toEqual({ ok: true });
      // First-time set with a concrete incoming.
      expect(
        assertStampImmutable(null, "11111111-1111-1111-1111-111111111111")
      ).toEqual({ ok: true });
      // No-op rewrite of the same value.
      expect(
        assertStampImmutable(
          "11111111-1111-1111-1111-111111111111",
          "11111111-1111-1111-1111-111111111111"
        )
      ).toEqual({ ok: true });
      // Attempt to change an already-set stamp to a different value.
      expect(
        assertStampImmutable(
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222"
        )
      ).toEqual({ ok: false, reason: "immutable" });
      // Attempt to clear an already-set stamp (set -> null) is also a change.
      expect(
        assertStampImmutable("11111111-1111-1111-1111-111111111111", null)
      ).toEqual({ ok: false, reason: "immutable" });
    });
  });
});
