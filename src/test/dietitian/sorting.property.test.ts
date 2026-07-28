// src/test/dietitian/sorting.property.test.ts
// Feature: dietitian-management, Property 27
//
// Property 27: Sorting orders correctly, treats a missing last-log date as
// earliest, and preserves the multiset.
//
// For any set of Dietitian customer-list rows, any sort key and any direction,
// the output is ordered by that key in that direction (Req 17.4, 17.5), rows
// with no Last_Dietitian_Log_Date sit at the earliest orderable position in
// every ordering — first when ascending, last when descending, and first under
// the default ordering (Req 17.6) — and the output is a permutation of the
// input with the caller's array left untouched (Req 17.9).
//
// The expected ordering is derived from a reference comparator transcribed
// below from Requirement 17's acceptance criteria, not from `compareAscending`
// in the module under test, so the model cannot inherit a bug from the code it
// exercises.
//
// **Validates: Requirements 17.4, 17.5, 17.6, 17.9**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  DEFAULT_DIETITIAN_SORT,
  DIETITIAN_SORT_KEYS,
  sortDietitianRows,
  type DietitianCustomerRow,
  type DietitianSortKey,
  type SortDirection,
} from "@/lib/dietitian/listFilters";
import {
  dietitianCustomerRowsArb,
  istDateArb,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference model: Requirement 17.4–17.6, transcribed ─────────────────────

/** The two sortable columns named by Req 17.4 and 17.5. */
const REFERENCE_SORT_KEYS = [
  "lastDietitianLogDate",
  "daysNotLogged",
] as const satisfies readonly DietitianSortKey[];

const REFERENCE_DIRECTIONS = ["asc", "desc"] as const satisfies readonly SortDirection[];

/**
 * Req 17.6: a Customer_Record with no Dietitian_Log orders as the earliest
 * value. Real dates are `YYYY-MM-DD`, so lexicographic order is chronological
 * order.
 */
function referenceCompareLastLogDate(
  a: string | null,
  b: string | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function referenceCompareAscending(
  a: DietitianCustomerRow,
  b: DietitianCustomerRow,
  key: DietitianSortKey,
): number {
  if (key === "lastDietitianLogDate") {
    return referenceCompareLastLogDate(
      a.lastDietitianLogDate,
      b.lastDietitianLogDate,
    );
  }
  return a.daysNotLogged === b.daysNotLogged
    ? 0
    : a.daysNotLogged < b.daysNotLogged
      ? -1
      : 1;
}

/** The directed comparator: the descending order is the ascending one negated. */
function referenceCompare(
  a: DietitianCustomerRow,
  b: DietitianCustomerRow,
  key: DietitianSortKey,
  direction: SortDirection,
): number {
  const ascending = referenceCompareAscending(a, b, key);
  return direction === "desc" ? -ascending : ascending;
}

/**
 * A stable reference sort built by decorating each row with its incoming index
 * and breaking ties on that index, so ties keep their input order.
 */
function referenceSort(
  rows: readonly DietitianCustomerRow[],
  key: DietitianSortKey,
  direction: SortDirection,
): DietitianCustomerRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        referenceCompare(a.row, b.row, key, direction) || a.index - b.index,
    )
    .map((entry) => entry.row);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const sortKeyArb: fc.Arbitrary<DietitianSortKey> = fc.constantFrom(
  ...REFERENCE_SORT_KEYS,
);

const directionArb: fc.Arbitrary<SortDirection> = fc.constantFrom(
  ...REFERENCE_DIRECTIONS,
);

/** The generator already produces a `null` last-log date frequently (Req 17.6). */
const rowsArb = dietitianCustomerRowsArb({ maxLength: 15 });

const nonEmptyRowsArb = dietitianCustomerRowsArb({
  minLength: 1,
  maxLength: 15,
});

/**
 * Rows whose sort keys are drawn from a tiny pool, so ties on both columns are
 * common and stability is actually exercised. Only the two sort-key fields are
 * rewritten; the cadence coherence of the other fields is irrelevant to sorting.
 */
const tiedRowsArb: fc.Arbitrary<DietitianCustomerRow[]> = fc
  .tuple(
    dietitianCustomerRowsArb({ minLength: 2, maxLength: 12 }),
    fc.uniqueArray(istDateArb, { minLength: 1, maxLength: 3 }),
  )
  .chain(([rows, datePool]) =>
    fc
      .tuple(
        fc.array(
          fc.option(fc.constantFrom(...datePool), { nil: null }),
          { minLength: rows.length, maxLength: rows.length },
        ),
        fc.array(fc.integer({ min: 0, max: 2 }), {
          minLength: rows.length,
          maxLength: rows.length,
        }),
      )
      .map(([dates, days]) =>
        rows.map((row, index) => ({
          ...row,
          lastDietitianLogDate: dates[index],
          daysNotLogged: days[index],
        })),
      ),
  );

// ─── Helpers ─────────────────────────────────────────────────────────────────

function idsOf(rows: readonly DietitianCustomerRow[]): string[] {
  return rows.map((row) => row.customerProfileId);
}

/** Multiset of rows by identity, as a count per row reference. */
function multiset(
  rows: readonly DietitianCustomerRow[],
): Map<DietitianCustomerRow, number> {
  const counts = new Map<DietitianCustomerRow, number>();
  for (const row of rows) counts.set(row, (counts.get(row) ?? 0) + 1);
  return counts;
}

function expectSameMultiset(
  actual: readonly DietitianCustomerRow[],
  expected: readonly DietitianCustomerRow[],
): void {
  const actualCounts = multiset(actual);
  const expectedCounts = multiset(expected);
  expect(actual.length).toBe(expected.length);
  expect(actualCounts.size).toBe(expectedCounts.size);
  for (const [row, count] of expectedCounts) {
    expect(actualCounts.get(row)).toBe(count);
  }
}

// ─── Property 27 ─────────────────────────────────────────────────────────────

describe("Property 27: Sorting orders correctly, treats a missing last-log date as earliest, and preserves the multiset", () => {
  it("the output is a permutation of the input and the input is never mutated", () => {
    /**
     * **Validates: Requirements 17.9**
     */
    fc.assert(
      fc.property(rowsArb, sortKeyArb, directionArb, (rows, key, direction) => {
        const snapshot = JSON.stringify(rows);
        const identities = [...rows];

        const sorted = sortDietitianRows(rows, key, direction);

        // Same multiset of rows, by identity (Req 17.9).
        expectSameMultiset(sorted, rows);

        // A fresh array, never the caller's own.
        expect(sorted).not.toBe(rows);

        // The caller's array and its rows are untouched.
        expect(JSON.stringify(rows)).toBe(snapshot);
        expect(rows.length).toBe(identities.length);
        rows.forEach((row, index) => expect(row).toBe(identities[index]));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("orders by the chosen key in the chosen direction", () => {
    /**
     * **Validates: Requirements 17.4, 17.5**
     */
    fc.assert(
      fc.property(rowsArb, sortKeyArb, directionArb, (rows, key, direction) => {
        const sorted = sortDietitianRows(rows, key, direction);

        // Every adjacent pair is ordered under the directed comparator.
        for (let i = 1; i < sorted.length; i += 1) {
          expect(
            referenceCompare(sorted[i - 1], sorted[i], key, direction),
          ).toBeLessThanOrEqual(0);
        }

        // And the whole ordering matches the reference stable sort.
        expect(idsOf(sorted)).toEqual(idsOf(referenceSort(rows, key, direction)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("both sort keys are offered in both directions", () => {
    /**
     * **Validates: Requirements 17.4, 17.5**
     */
    expect([...DIETITIAN_SORT_KEYS].sort()).toEqual(
      [...REFERENCE_SORT_KEYS].sort(),
    );

    fc.assert(
      fc.property(rowsArb, (rows) => {
        for (const key of REFERENCE_SORT_KEYS) {
          const ascending = sortDietitianRows(rows, key, "asc");
          const descending = sortDietitianRows(rows, key, "desc");

          expect(idsOf(ascending)).toEqual(idsOf(referenceSort(rows, key, "asc")));
          expect(idsOf(descending)).toEqual(
            idsOf(referenceSort(rows, key, "desc")),
          );

          // Reversing the direction reverses the ordering of any two rows that
          // do not tie on the key.
          const ascendingPositions = new Map(
            ascending.map((row, index) => [row, index] as const),
          );
          const descendingPositions = new Map(
            descending.map((row, index) => [row, index] as const),
          );
          for (const a of rows) {
            for (const b of rows) {
              if (a === b) continue;
              if (referenceCompareAscending(a, b, key) >= 0) continue;
              // a strictly precedes b ascending, and follows it descending.
              expect(ascendingPositions.get(a)!).toBeLessThan(
                ascendingPositions.get(b)!,
              );
              expect(descendingPositions.get(a)!).toBeGreaterThan(
                descendingPositions.get(b)!,
              );
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a missing last-log date is the earliest orderable value in both directions", () => {
    /**
     * **Validates: Requirements 17.6**
     */
    fc.assert(
      fc.property(nonEmptyRowsArb, (rows) => {
        const missing = rows.filter((row) => row.lastDietitianLogDate === null);
        const present = rows.filter((row) => row.lastDietitianLogDate !== null);

        const ascending = sortDietitianRows(rows, "lastDietitianLogDate", "asc");
        const descending = sortDietitianRows(
          rows,
          "lastDietitianLogDate",
          "desc",
        );

        // Ascending: every row with no Dietitian_Log comes before every row
        // that has one.
        expect(
          ascending.slice(0, missing.length).every(
            (row) => row.lastDietitianLogDate === null,
          ),
        ).toBe(true);
        expect(
          ascending.slice(missing.length).every(
            (row) => row.lastDietitianLogDate !== null,
          ),
        ).toBe(true);

        // Descending: the same rows sit at the tail, because the direction only
        // negates the ascending comparator.
        expect(
          descending.slice(present.length).every(
            (row) => row.lastDietitianLogDate === null,
          ),
        ).toBe(true);
        expect(
          descending.slice(0, present.length).every(
            (row) => row.lastDietitianLogDate !== null,
          ),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rows that tie on the sort key keep their incoming relative order", () => {
    /**
     * **Validates: Requirements 17.4, 17.5, 17.9**
     */
    fc.assert(
      fc.property(tiedRowsArb, sortKeyArb, directionArb, (rows, key, direction) => {
        const sorted = sortDietitianRows(rows, key, direction);
        expectSameMultiset(sorted, rows);

        // The stable reference ordering is reproduced exactly.
        expect(idsOf(sorted)).toEqual(idsOf(referenceSort(rows, key, direction)));

        // Directly: the subsequence of rows sharing a key value is unchanged.
        const positions = new Map(rows.map((row, index) => [row, index] as const));
        for (let i = 1; i < sorted.length; i += 1) {
          if (referenceCompareAscending(sorted[i - 1], sorted[i], key) !== 0) {
            continue;
          }
          expect(positions.get(sorted[i - 1])!).toBeLessThan(
            positions.get(sorted[i])!,
          );
        }

        // Sorting is idempotent, so re-sorting an already sorted set is a no-op.
        expect(idsOf(sortDietitianRows(sorted, key, direction))).toEqual(
          idsOf(sorted),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the default ordering is last-log-date ascending, so never-logged customers surface first", () => {
    /**
     * **Validates: Requirements 17.4, 17.6**
     */
    expect(DEFAULT_DIETITIAN_SORT).toEqual({
      key: "lastDietitianLogDate",
      direction: "asc",
    });

    fc.assert(
      fc.property(rowsArb, (rows) => {
        const sorted = sortDietitianRows(
          rows,
          DEFAULT_DIETITIAN_SORT.key,
          DEFAULT_DIETITIAN_SORT.direction,
        );

        expect(idsOf(sorted)).toEqual(
          idsOf(referenceSort(rows, "lastDietitianLogDate", "asc")),
        );

        const firstWithDate = sorted.findIndex(
          (row) => row.lastDietitianLogDate !== null,
        );
        if (firstWithDate >= 0) {
          expect(
            sorted
              .slice(firstWithDate)
              .every((row) => row.lastDietitianLogDate !== null),
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
