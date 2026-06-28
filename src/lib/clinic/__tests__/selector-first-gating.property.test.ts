// src/lib/clinic/__tests__/selector-first-gating.property.test.ts
// Property test for the clinic-selector-first operational views (Live Routing
// Board, Live Tracking, Sandbox). Exercises the pure `ridersForSelectedClinic`
// gating helper in isolation (no Supabase/React/IO).
//
// Feature: core-clinic-architecture, Property 36: Clinic-selector-first gating
//
// Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ridersForSelectedClinic } from "../visibility";

type Rider = { id: string; clinic_id: string | null };

// Small fixed pool of clinic ids so generated riders and selections overlap
// enough to exercise both the "matching riders" and "zero matches" branches.
const CLINIC_POOL = ["clinic-a", "clinic-b", "clinic-c"] as const;

// A rider belongs to one of the pool clinics or to none (clinic_id === null,
// i.e. an unlinked rider). `id` is unique-ish via the index in the array map.
const arbClinicId = fc.constantFrom<string | null>(
  ...CLINIC_POOL,
  null
);

const arbRiders = fc
  .array(arbClinicId, { maxLength: 40 })
  .map((clinicIds) =>
    clinicIds.map(
      (clinic_id, index): Rider => ({ id: `rider-${index}`, clinic_id })
    )
  );

// A selection is either "no clinic selected" (null or empty string) or a
// specific clinic id from the pool.
const arbNoSelection = fc.constantFrom<string | null>(null, "");
const arbSpecificSelection = fc.constantFrom<string>(...CLINIC_POOL);

describe("Property 36: Clinic-selector-first gating", () => {
  it("no clinic selected (null or '') => no rider data is displayed", () => {
    fc.assert(
      fc.property(arbNoSelection, arbRiders, (selection, riders) => {
        // Requirements 17.1, 17.3, 17.5: while no clinic is selected, no
        // rider/route/tracking data is shown — only the selector.
        expect(ridersForSelectedClinic(selection, riders)).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });

  it("clinic selected => returns exactly the selected clinic's riders, excluding all others", () => {
    fc.assert(
      fc.property(
        arbSpecificSelection,
        arbRiders,
        (selection, riders) => {
          const result = ridersForSelectedClinic(selection, riders);

          // Requirements 17.2, 17.4, 17.6: result is exactly the riders whose
          // clinic_id === selection, excluding every other clinic's riders.
          const expected = riders.filter((r) => r.clinic_id === selection);
          expect(result).toEqual(expected);

          // Every returned rider belongs to the selected clinic (no leakage).
          for (const rider of result) {
            expect(rider.clinic_id).toBe(selection);
          }

          // No rider of another clinic (or unlinked rider) is included.
          const excluded = riders.filter((r) => r.clinic_id !== selection);
          for (const rider of excluded) {
            expect(result).not.toContain(rider);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("selected clinic with zero matching riders => empty-state ([])", () => {
    fc.assert(
      fc.property(
        arbSpecificSelection,
        arbRiders,
        (selection, riders) => {
          // Keep only riders NOT in the selected clinic, guaranteeing zero
          // matches for the selection.
          const ridersWithoutSelection = riders.filter(
            (r) => r.clinic_id !== selection
          );

          // Requirement 17.8: a selected clinic with zero assigned riders shows
          // the empty state — no rider rows/markers.
          expect(
            ridersForSelectedClinic(selection, ridersWithoutSelection)
          ).toEqual([]);
        }
      ),
      { numRuns: 200 }
    );
  });
});
