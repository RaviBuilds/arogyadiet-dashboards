// Feature: core-clinic-architecture, Property 10: Service areas partition by clinic
//
// Property tests for `groupServiceAreasByClinic` (src/lib/clinic/service-area-grouping.ts).
//
// Property 10: Service areas partition by clinic
//   For any set of service-area records, grouping them by clinic produces a
//   partition: the union of all clinic groups equals the input set, and the
//   groups are pairwise disjoint (each pincode appears under exactly one
//   clinic).
//
// Validates: Requirements 5.1

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  groupServiceAreasByClinic,
  type ServiceAreaRow,
} from "../service-area-grouping";

// ─── Arbitrary generators ──────────────────────────────────────────────────

/** Exactly six numeric digits — the canonical pincode shape. */
const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

/** A clinic_id: either a UUID or null (an unassociated pincode). */
const arbClinicId: fc.Arbitrary<string | null> = fc.oneof(
  fc.uuid(),
  fc.constant(null)
);

/**
 * An array of Service_Area rows with UNIQUE pincodes (the upstream invariant),
 * each carrying an arbitrary clinic_id (including null). A small clinic-id pool
 * is used so that grouping is meaningful (many rows share a clinic).
 */
const arbServiceAreaRows: fc.Arbitrary<ServiceAreaRow[]> = fc
  .uniqueArray(arbPincode, { maxLength: 60 })
  .chain((pincodes) =>
    fc
      .array(arbClinicId, { minLength: pincodes.length, maxLength: pincodes.length })
      .map((clinicIds) =>
        pincodes.map((pincode, i) => ({ pincode, clinic_id: clinicIds[i] }))
      )
  );

// ─── Helpers ────────────────────────────────────────────────────────────────

const NUM_RUNS = 200;

/** A stable string key for a row, for set comparisons. */
function rowKey(row: ServiceAreaRow): string {
  return `${row.clinic_id ?? "<null>"}::${row.pincode}`;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 10: Service areas partition by clinic", () => {
  it("union of all groups is a permutation of the input set", () => {
    fc.assert(
      fc.property(arbServiceAreaRows, (rows) => {
        const groups = groupServiceAreasByClinic(rows);

        const flattened = [...groups.values()].flat();

        // Same number of rows: nothing dropped, nothing duplicated.
        expect(flattened).toHaveLength(rows.length);

        // Same multiset of rows (permutation): sorted keys match exactly.
        const inputKeys = rows.map(rowKey).sort();
        const outputKeys = flattened.map(rowKey).sort();
        expect(outputKeys).toEqual(inputKeys);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("groups are pairwise disjoint — each pincode appears under exactly one clinic", () => {
    fc.assert(
      fc.property(arbServiceAreaRows, (rows) => {
        const groups = groupServiceAreasByClinic(rows);

        const seen = new Set<string>();
        for (const bucket of groups.values()) {
          for (const row of bucket) {
            // No pincode may appear in two different groups (or twice overall).
            expect(seen.has(row.pincode)).toBe(false);
            seen.add(row.pincode);
          }
        }

        // Every input pincode is accounted for exactly once.
        expect(seen.size).toBe(rows.length);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("every row lands in the bucket whose key equals its clinic_id", () => {
    fc.assert(
      fc.property(arbServiceAreaRows, (rows) => {
        const groups = groupServiceAreasByClinic(rows);

        for (const [key, bucket] of groups.entries()) {
          for (const row of bucket) {
            expect(row.clinic_id).toBe(key);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("number of groups equals the number of distinct clinic_id values", () => {
    fc.assert(
      fc.property(arbServiceAreaRows, (rows) => {
        const groups = groupServiceAreasByClinic(rows);

        const distinctKeys = new Set(rows.map((r) => r.clinic_id));
        expect(groups.size).toBe(distinctKeys.size);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("grouping an empty input yields an empty partition", () => {
    const groups = groupServiceAreasByClinic([]);
    expect(groups.size).toBe(0);
    expect([...groups.values()].flat()).toHaveLength(0);
  });
});
