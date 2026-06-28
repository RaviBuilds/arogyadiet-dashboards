// src/lib/clinic/__tests__/selection-no-stale.property.test.ts
// Feature: core-clinic-architecture, Property 37: Selection change retains no stale riders
//
// Property 37: Selection change retains no stale riders
// For any sequence of clinic selections in an operational view, the displayed
// rider set equals only the most recently selected clinic's riders, with no
// riders from any previously selected clinic retained.
//
// Approach: `ridersForSelectedClinic(selection, riders)` is the single source
// of truth for the displayed rider set — the UI recomputes the displayed riders
// purely from the current selection, so it inherently keeps no stale riders.
// We generate a fixed rider pool spread across multiple clinics plus a SEQUENCE
// of selections, fold over the sequence computing the displayed set after each
// selection, and assert after every step that the displayed set is exactly the
// riders of the current selection and contains none from any prior selection.
//
// Validates: Requirements 17.7

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ridersForSelectedClinic } from "../visibility";

// ─── Domain types ───────────────────────────────────────────────────────────

type Rider = { id: string; clinic_id: string | null };

// ─── Arbitrary generators ─────────────────────────────────────────────────--

// A small pool of distinct clinic ids so selections meaningfully overlap with
// the rider pool across the sequence.
const arbClinicIds = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.length > 0), {
    minLength: 1,
    maxLength: 5,
  });

// Build a fixed rider pool whose clinic_id is drawn from the known clinic ids
// (and occasionally null/unlinked). Rider ids are unique within the pool.
function arbRiderPool(clinicIds: string[]) {
  const arbClinicId = fc.oneof(
    fc.constantFrom(...clinicIds),
    fc.constant<string | null>(null)
  );
  return fc
    .uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.length > 0),
        clinic_id: arbClinicId,
      }),
      { selector: (r) => r.id, maxLength: 40 }
    );
}

// A sequence of selections: each is either a known clinic id, an unknown id,
// the empty string, or null (no selection). At least one selection in the run.
function arbSelectionSequence(clinicIds: string[]) {
  const arbSelection = fc.oneof(
    fc.constantFrom(...clinicIds),
    fc.constant(""),
    fc.constant<string | null>(null),
    fc.string({ maxLength: 6 })
  );
  return fc.array(arbSelection, { minLength: 1, maxLength: 12 });
}

const arbScenario = arbClinicIds.chain((clinicIds) =>
  fc.record({
    clinicIds: fc.constant(clinicIds),
    riders: arbRiderPool(clinicIds),
    selections: arbSelectionSequence(clinicIds),
  })
);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("ridersForSelectedClinic - Property 37: Selection change retains no stale riders", () => {
  it("after every selection, the displayed set is exactly the current clinic's riders and contains no stale riders", () => {
    fc.assert(
      fc.property(arbScenario, ({ riders, selections }) => {
        let previousDisplayed: Rider[] = [];

        for (const selection of selections) {
          // The UI recomputes the displayed set purely from the current selection.
          const displayed = ridersForSelectedClinic(selection, riders);

          if (selection === null || selection.length === 0) {
            // No clinic selected → nothing is shown (selector-first gating).
            expect(displayed).toEqual([]);
          } else {
            // Displayed set equals EXACTLY the riders of the current selection.
            const expected = riders.filter((r) => r.clinic_id === selection);
            expect(displayed).toEqual(expected);

            // Every displayed rider belongs to the current selection...
            for (const rider of displayed) {
              expect(rider.clinic_id).toBe(selection);
            }
            // ...and no rider whose clinic differs from the current selection
            // is retained (i.e. nothing stale from any prior selection).
            for (const rider of displayed) {
              expect(rider.clinic_id).not.toBe(null);
            }
          }

          // Cross-step invariant: no rider held over from the previous step
          // unless it also legitimately belongs to the current selection.
          for (const rider of previousDisplayed) {
            const stillDisplayed = displayed.some((d) => d.id === rider.id);
            if (stillDisplayed) {
              // Only allowed if it genuinely matches the new selection.
              expect(rider.clinic_id).toBe(selection);
            }
          }

          previousDisplayed = displayed;
        }
      }),
      { numRuns: 200 }
    );
  });

  it("the final displayed set depends only on the last selection, independent of prior selections", () => {
    fc.assert(
      fc.property(arbScenario, ({ riders, selections }) => {
        // Fold the whole sequence.
        let displayed: Rider[] = [];
        for (const selection of selections) {
          displayed = ridersForSelectedClinic(selection, riders);
        }

        // Recompute using ONLY the last selection — must be identical.
        const lastSelection = selections[selections.length - 1];
        const fromLastOnly = ridersForSelectedClinic(lastSelection, riders);

        expect(displayed).toEqual(fromLastOnly);
      }),
      { numRuns: 200 }
    );
  });
});
