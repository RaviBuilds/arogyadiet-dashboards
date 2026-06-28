// src/lib/clinic/__tests__/workload-invalid-range.property.test.ts
//
// Feature: core-clinic-architecture, Property 32: Invalid date range is rejected
//
// Property 32: Invalid date range is rejected — For any statistics request whose
// start date is after its end date, the request is rejected with an
// invalid-range error.
//
// **Validates: Requirements 12.5**
//
// Strategy: exercise `getWorkloadStatistics` from `../workload`. The invalid
// path (start > end) is rejected purely from the parameters and never touches
// the database. We still mock `@/lib/supabase/admin` `createAdminClient` so the
// module imports, and so the complementary check (start <= end) can exercise
// the IO branch: the fake returns an empty snapshot set, yielding a successful,
// empty aggregate — proving a valid range does NOT produce the invalid-range
// error.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// Replace the admin client with a minimal in-memory fake (hoisted by vitest).
// The invalid path returns before this is ever queried; the valid path resolves
// to an empty snapshot set so it succeeds with an empty aggregate.
vi.mock("@/lib/supabase/admin", () => {
  const result = Promise.resolve({ data: [], error: null });
  const builder = {
    select: () => builder,
    gte: () => builder,
    lte: () => builder,
    eq: () => builder,
    order: () => result,
  };
  return {
    createAdminClient: () => ({ from: () => builder }),
  };
});

import { getWorkloadStatistics } from "../workload";
import type { WorkloadGrouping } from "@/types/clinic";

// ─── Generators ──────────────────────────────────────────────────────────────

// A `YYYY-MM-DD` date string. Day is capped at 28 so every (year, month) pair is
// valid, and the fixed width makes lexicographic comparison a correct ordering.
const arbDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2000, max: 2099 }),
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

// A pair of distinct dates, returned as [earlier, later].
const arbDistinctOrderedPair: fc.Arbitrary<[string, string]> = fc
  .tuple(arbDate, arbDate)
  .filter(([a, b]) => a !== b)
  .map(([a, b]) => (a < b ? [a, b] : [b, a]));

const INVALID_RANGE_ERROR =
  "Invalid date range: the start date must be on or before the end date.";

// ─── Property tests ────────────────────────────────────────────────────────────

describe("Property 32: Invalid date range is rejected", () => {
  it("rejects any request whose start date is after its end date", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDistinctOrderedPair,
        arbGrouping,
        async ([earlier, later], grouping) => {
          // start is strictly after end → invalid range.
          const result = await getWorkloadStatistics({
            startDate: later,
            endDate: earlier,
            grouping,
          });

          expect(result.success).toBe(false);
          if (result.success === false) {
            expect(typeof result.error).toBe("string");
            expect(result.error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("does NOT return the invalid-range error when start <= end", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDistinctOrderedPair,
        arbGrouping,
        fc.boolean(),
        async ([earlier, later], grouping, useEqual) => {
          // Valid range: start on-or-before end (equal dates included).
          const startDate = earlier;
          const endDate = useEqual ? earlier : later;

          const result = await getWorkloadStatistics({
            startDate,
            endDate,
            grouping,
          });

          // The empty snapshot fake makes a valid range succeed with an empty
          // aggregate; crucially it must NOT be the invalid-range rejection.
          expect(result.success).toBe(true);
          if (result.success === true) {
            expect(result.data).toEqual([]);
          } else {
            expect(result.error).not.toBe(INVALID_RANGE_ERROR);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
