// src/lib/clinic/__tests__/workload-aggregation.property.test.ts
//
// Feature: core-clinic-architecture, Property 31: Workload aggregation correctness over a valid range
//
// Property 31: Workload aggregation correctness over a valid range — For any set
// of persisted snapshots, any date range with start <= end, and any grouping
// (day/week/month), the aggregated result groups the in-range snapshots by the
// requested bucket per clinic and per kitchen, where each aggregated count
// equals the sum of the corresponding counts of the in-range snapshots in that
// bucket; when no snapshot falls in range the result is empty with all counts
// zero.
//
// **Validates: Requirements 12.4, 12.6, 13.3**
//
// Strategy: `aggregateSnapshots(rows, grouping)` is a PURE function (no Supabase
// dependency). To model "over a valid range" we mirror what the IO caller
// (`getWorkloadStatistics`) does: generate a set of snapshots plus a valid date
// range [start, end] (start <= end), filter the snapshots to that range
// (lexicographic comparison is correct for fixed-width YYYY-MM-DD), then feed
// the in-range subset to `aggregateSnapshots`. We compute an INDEPENDENT
// reference grouping by (clinic_id, kitchen_id, bucketKey) — summing the meal
// counts and merging the shop-product maps — and assert the function's output
// matches it exactly. Generated counts are bounded so per-bucket sums stay well
// under the 0..100000 clamp, keeping the reference a plain sum.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { aggregateSnapshots, bucketKeyForDate } from "../workload";
import type { WorkloadGrouping, WorkloadSnapshot } from "@/types/clinic";

// ─── Generators ──────────────────────────────────────────────────────────────

const NUM_RUNS = 200;

// Small pools so grouping is meaningful (many rows share a clinic/kitchen and
// fall into the same bucket).
const CLINIC_IDS = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
];
const KITCHEN_IDS = [
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
];
const PRODUCT_IDS = ["prod-a", "prod-b", "prod-c"];

// A `YYYY-MM-DD` date string. Day is capped at 28 so every (year, month) pair is
// valid, and the fixed width makes lexicographic comparison a correct ordering.
const arbDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2020, max: 2025 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );

const arbGrouping: fc.Arbitrary<WorkloadGrouping> = fc.constantFrom(
  "day",
  "week",
  "month"
);

// A bounded count: well under the 100000 clamp so even many rows in one bucket
// keep the running sum below the ceiling (max rows 40 * 1000 = 40000).
const arbCount = fc.integer({ min: 0, max: 1000 });

// A shop-product-count map over a small product pool with bounded counts.
const arbShopProductCounts: fc.Arbitrary<Record<string, number>> = fc
  .array(
    fc.tuple(fc.constantFrom(...PRODUCT_IDS), fc.integer({ min: 0, max: 500 })),
    { maxLength: PRODUCT_IDS.length }
  )
  .map((pairs) => {
    const out: Record<string, number> = {};
    for (const [productId, count] of pairs) out[productId] = count;
    return out;
  });

const arbSnapshot: fc.Arbitrary<WorkloadSnapshot> = fc.record({
  id: fc.uuid(),
  clinic_id: fc.constantFrom(...CLINIC_IDS),
  kitchen_id: fc.constantFrom(...KITCHEN_IDS),
  target_date: arbDate,
  veg_count: arbCount,
  non_veg_count: arbCount,
  egg_count: arbCount,
  shop_product_counts: arbShopProductCounts,
  created_at: arbDate,
});

const arbSnapshots: fc.Arbitrary<WorkloadSnapshot[]> = fc.array(arbSnapshot, {
  maxLength: 40,
});

// A valid date range [start, end] with start <= end.
const arbValidRange: fc.Arbitrary<[string, string]> = fc
  .tuple(arbDate, arbDate)
  .map(([a, b]) => (a <= b ? [a, b] : [b, a]));

// ─── Independent reference implementation ──────────────────────────────────────

interface RefAggregate {
  clinic_id: string;
  kitchen_id: string;
  bucket: string;
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
  shop_product_counts: Record<string, number>;
}

/**
 * Independently group the given snapshots by (clinic_id, kitchen_id, bucketKey),
 * summing meal counts and merging shop-product maps. The bucket key mirrors
 * `bucketKeyForDate` exactly by reusing it (its correctness is covered by other
 * properties). Counts here are plain sums because generated values are bounded
 * below the 0..100000 clamp ceiling.
 */
function referenceAggregate(
  rows: WorkloadSnapshot[],
  grouping: WorkloadGrouping
): Map<string, RefAggregate> {
  const groups = new Map<string, RefAggregate>();

  for (const row of rows) {
    const bucket = bucketKeyForDate(row.target_date, grouping);
    const key = `${row.clinic_id}\u0000${row.kitchen_id}\u0000${bucket}`;

    let agg = groups.get(key);
    if (!agg) {
      agg = {
        clinic_id: row.clinic_id,
        kitchen_id: row.kitchen_id,
        bucket,
        veg_count: 0,
        non_veg_count: 0,
        egg_count: 0,
        shop_product_counts: {},
      };
      groups.set(key, agg);
    }

    agg.veg_count += row.veg_count;
    agg.non_veg_count += row.non_veg_count;
    agg.egg_count += row.egg_count;
    for (const [productId, count] of Object.entries(row.shop_product_counts)) {
      agg.shop_product_counts[productId] =
        (agg.shop_product_counts[productId] ?? 0) + count;
    }
  }

  return groups;
}

const COUNT_MAX = 100000;

// ─── Property tests ────────────────────────────────────────────────────────────

describe("Property 31: Workload aggregation correctness over a valid range", () => {
  it("groups in-range snapshots per (clinic, kitchen, bucket) with summed counts", () => {
    fc.assert(
      fc.property(
        arbSnapshots,
        arbValidRange,
        arbGrouping,
        (snapshots, [startDate, endDate], grouping) => {
          // Mirror getWorkloadStatistics: filter to the valid range first.
          const inRange = snapshots.filter(
            (s) => s.target_date >= startDate && s.target_date <= endDate
          );

          const result = aggregateSnapshots(inRange, grouping);
          const reference = referenceAggregate(inRange, grouping);

          // One aggregate per distinct (clinic, kitchen, bucket).
          expect(result).toHaveLength(reference.size);

          // No duplicate group keys in the output.
          const outputKeys = result.map(
            (a) => `${a.clinic_id}\u0000${a.kitchen_id}\u0000${a.bucket}`
          );
          expect(new Set(outputKeys).size).toBe(outputKeys.length);

          for (const agg of result) {
            const key = `${agg.clinic_id}\u0000${agg.kitchen_id}\u0000${agg.bucket}`;
            const ref = reference.get(key);

            // Every emitted group must correspond to a real reference group.
            expect(ref).toBeDefined();
            if (!ref) continue;

            // Each count equals the independent sum of its members' counts.
            expect(agg.veg_count).toBe(ref.veg_count);
            expect(agg.non_veg_count).toBe(ref.non_veg_count);
            expect(agg.egg_count).toBe(ref.egg_count);

            // Shop product counts equal the merged (summed) maps. The pure
            // merge keeps every product key that appears in any member map,
            // including ones whose summed value is 0 (only the IO finalizer
            // prunes zero-clamped entries), so the reference does NOT drop them.
            expect(agg.shop_product_counts).toEqual(ref.shop_product_counts);

            // Counts are clamped within 0..100000.
            for (const count of [
              agg.veg_count,
              agg.non_veg_count,
              agg.egg_count,
            ]) {
              expect(count).toBeGreaterThanOrEqual(0);
              expect(count).toBeLessThanOrEqual(COUNT_MAX);
            }
            for (const count of Object.values(agg.shop_product_counts)) {
              expect(count).toBeGreaterThanOrEqual(0);
              expect(count).toBeLessThanOrEqual(COUNT_MAX);
            }

            // Every member of this bucket actually maps to this bucket key.
            expect(bucketKeyForDate(startDate, grouping)).toBeDefined();
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("every aggregate's bucket is the requested grouping of its members' dates", () => {
    fc.assert(
      fc.property(
        arbSnapshots,
        arbValidRange,
        arbGrouping,
        (snapshots, [startDate, endDate], grouping) => {
          const inRange = snapshots.filter(
            (s) => s.target_date >= startDate && s.target_date <= endDate
          );

          const result = aggregateSnapshots(inRange, grouping);

          for (const agg of result) {
            // Members are exactly the in-range rows whose (clinic, kitchen,
            // bucketKey) match this aggregate.
            const members = inRange.filter(
              (s) =>
                s.clinic_id === agg.clinic_id &&
                s.kitchen_id === agg.kitchen_id &&
                bucketKeyForDate(s.target_date, grouping) === agg.bucket
            );
            expect(members.length).toBeGreaterThan(0);

            const sumVeg = members.reduce((n, s) => n + s.veg_count, 0);
            const sumNonVeg = members.reduce((n, s) => n + s.non_veg_count, 0);
            const sumEgg = members.reduce((n, s) => n + s.egg_count, 0);

            expect(agg.veg_count).toBe(sumVeg);
            expect(agg.non_veg_count).toBe(sumNonVeg);
            expect(agg.egg_count).toBe(sumEgg);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("yields an empty result when no snapshot falls in range", () => {
    fc.assert(
      fc.property(arbSnapshots, arbGrouping, (snapshots, grouping) => {
        // A range that is logically valid (start <= end) but, by construction,
        // cannot contain any generated date (all dates are in 2020..2025).
        const result = aggregateSnapshots([], grouping);
        expect(result).toEqual([]);

        // And explicitly: filtering to an out-of-range window yields nothing.
        const inRange = snapshots.filter(
          (s) => s.target_date >= "2099-01-01" && s.target_date <= "2099-12-28"
        );
        expect(inRange).toHaveLength(0);
        expect(aggregateSnapshots(inRange, grouping)).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("aggregating an empty input is empty for every grouping", () => {
    for (const grouping of ["day", "week", "month"] as WorkloadGrouping[]) {
      expect(aggregateSnapshots([], grouping)).toEqual([]);
    }
  });
});
