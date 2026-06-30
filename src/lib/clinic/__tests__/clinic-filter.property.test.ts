// Feature: core-clinic-architecture, Property 35: Clinic filter predicate
//
// Property tests for the clinic filter predicate and list filter
// (`matchesClinicFilter`, `filterRowsByClinic`, `ALL_CLINICS`) in
// src/lib/clinic/visibility.ts.
//
// Property 35: Clinic filter predicate
//   For any set of rider/customer rows and any clinic filter selection, the
//   displayed rows are exactly those whose linked clinic matches the
//   selection; when "All Clinics" is selected or the filter is cleared, all
//   rows are displayed.
//
// Validates: Requirements 16.5, 16.6

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  matchesClinicFilter,
  filterRowsByClinic,
  ALL_CLINICS,
  type ClinicFilterSelection,
} from "../visibility";

// ─── Arbitrary generators ──────────────────────────────────────────────────

/**
 * A small pool of clinic ids (plus null) so rows meaningfully share clinics
 * and a specific-id selection actually matches multiple rows.
 */
const CLINIC_POOL = ["clinic-a", "clinic-b", "clinic-c"] as const;

/** A row's clinic_id: drawn from the pool, or null (unlinked). */
const arbClinicId: fc.Arbitrary<string | null> = fc.oneof(
  fc.constantFrom(...CLINIC_POOL),
  fc.constant(null)
);

/** A rider/customer row carrying its linked clinic_id. */
const arbRow: fc.Arbitrary<{ clinic_id: string | null }> = arbClinicId.map(
  (clinic_id) => ({ clinic_id })
);

/** An array of rows over the small clinic-id pool (including null). */
const arbRows = fc.array(arbRow, { maxLength: 50 });

/**
 * A clinic filter selection ∈ {null, ALL_CLINICS, a present clinic id, an
 * absent clinic id}. "absent" is an id guaranteed not to appear in the pool.
 */
const arbSelection: fc.Arbitrary<ClinicFilterSelection> = fc.oneof(
  fc.constant(null),
  fc.constant(ALL_CLINICS),
  fc.constantFrom(...CLINIC_POOL),
  fc.constant("clinic-not-present")
);

const NUM_RUNS = 200;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 35: Clinic filter predicate", () => {
  it('null or "All Clinics" selection displays ALL rows, order preserved (Req 16.6)', () => {
    fc.assert(
      fc.property(
        arbRows,
        fc.constantFrom<ClinicFilterSelection>(null, ALL_CLINICS),
        (rows, selection) => {
          const result = filterRowsByClinic(rows, selection);
          // Same length, same elements, same order — identity over rows.
          expect(result).toEqual(rows);
          // Per-row predicate agrees: every row matches.
          for (const row of rows) {
            expect(matchesClinicFilter(row, selection)).toBe(true);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("a specific selection returns exactly the rows whose clinic_id equals it (Req 16.5)", () => {
    fc.assert(
      fc.property(arbRows, fc.constantFrom(...CLINIC_POOL), (rows, selection) => {
        const result = filterRowsByClinic(rows, selection);
        const expected = rows.filter((r) => r.clinic_id === selection);
        expect(result).toEqual(expected);
        // Every displayed row matches the selection; none is null/other.
        for (const row of result) {
          expect(row.clinic_id).toBe(selection);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("filterRowsByClinic agrees with matchesClinicFilter per-row for any selection", () => {
    fc.assert(
      fc.property(arbRows, arbSelection, (rows, selection) => {
        const result = filterRowsByClinic(rows, selection);
        const expected = rows.filter((r) => matchesClinicFilter(r, selection));
        expect(result).toEqual(expected);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("order is preserved — result is a subsequence of the input", () => {
    fc.assert(
      fc.property(arbRows, arbSelection, (rows, selection) => {
        const result = filterRowsByClinic(rows, selection);
        // Walk the input once, matching each result element in order.
        let i = 0;
        for (const row of rows) {
          if (i < result.length && result[i] === row) {
            i++;
          }
        }
        expect(i).toBe(result.length);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("a selection matching no rows yields an empty list", () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const selection = "clinic-not-present";
        const result = filterRowsByClinic(rows, selection);
        expect(result).toEqual([]);
        for (const row of rows) {
          expect(matchesClinicFilter(row, selection)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("empty input yields empty output for any selection", () => {
    fc.assert(
      fc.property(arbSelection, (selection) => {
        expect(filterRowsByClinic([], selection)).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
