// Feature: core-clinic-architecture, Property 6: Core Clinic classification
//
// Property test for `isCoreClinic` (src/lib/clinic/validation.ts).
//
// Property 6: Core Clinic classification
//   For any clinic, it is classified as a Core Clinic if and only if its
//   `franchise_id` is NULL. A clinic carrying any franchise id (an arbitrary
//   uuid string) is never Core; a clinic with `franchise_id === null` is
//   always Core.
//
// Validates: Requirements 3.4, 18.1

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isCoreClinic } from "../validation";

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * franchise_id is either NULL (Core Clinic) or an arbitrary uuid string
 * (non-Core / franchise clinic). `expectedCore` records the ground truth so the
 * property can assert the biconditional.
 */
const arbFranchiseLink = fc.oneof(
  fc.constant<{ franchise_id: string | null; expectedCore: boolean }>({
    franchise_id: null,
    expectedCore: true,
  }),
  fc.uuid().map((id) => ({ franchise_id: id, expectedCore: false }))
);

// ─── Property Test ─────────────────────────────────────────────────────────

describe("isCoreClinic - Property 6: Core Clinic classification", () => {
  it("classifies a clinic as Core iff its franchise_id is null", () => {
    fc.assert(
      fc.property(arbFranchiseLink, ({ franchise_id, expectedCore }) => {
        const result = isCoreClinic({ franchise_id });

        // Biconditional: Core ⇔ franchise_id === null
        expect(result).toBe(franchise_id === null);
        expect(result).toBe(expectedCore);
      }),
      { numRuns: 200 }
    );
  });

  it("any non-null franchise_id is never classified as Core", () => {
    fc.assert(
      fc.property(fc.uuid(), (franchiseId) => {
        expect(isCoreClinic({ franchise_id: franchiseId })).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("a null franchise_id is always classified as Core", () => {
    expect(isCoreClinic({ franchise_id: null })).toBe(true);
  });
});
