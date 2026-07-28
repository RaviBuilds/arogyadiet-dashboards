// src/test/dietitian/filter-composition.property.test.ts
// Feature: dietitian-management, Property 26
//
// Property 26: Filters compose by conjunction and never grow the result.
//
// For any set of Dietitian customer-list rows and any combination of the
// search, missing-Self_Log, pending-logs and minimum-days filters, the
// displayed rows equal the intersection of the rows each active filter would
// select individually (Req 17.7), the result is a subset of the input in input
// order so the count can only fall (Req 17.8), and each individual filter has
// the semantics its acceptance criterion names (Req 17.1, 17.2, 17.3).
//
// The expected truth is derived from a reference model transcribed below from
// Requirement 17's acceptance criteria — not from `activePredicates` in the
// module under test — so the model cannot inherit a bug from the code it
// exercises.
//
// **Validates: Requirements 17.1, 17.2, 17.3, 17.7, 17.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applyDietitianFilters,
  matchesDietitianSearch,
  type DietitianCustomerRow,
  type DietitianFilters,
} from "@/lib/dietitian/listFilters";
import {
  NAME_POOL,
  dietitianCustomerRowArb,
  dietitianCustomerRowsArb,
  searchQueryArb,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference model: Requirement 17.1–17.3, transcribed ─────────────────────

type RowPredicate = (row: DietitianCustomerRow) => boolean;

/** Req 15.4: case-insensitive substring match on name, mobile or code. */
function referenceSearchMatch(row: DietitianCustomerRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystacks = [row.name, row.mobile, row.customerCode];
  return haystacks.some(
    (value) => typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

/**
 * Whether a filter field is *active*: an absent or inert field selects every
 * row and therefore contributes no predicate.
 */
function isActiveSearch(search: string | undefined): search is string {
  return typeof search === "string" && search.trim().length > 0;
}

function isActiveMinDays(minDays: number | undefined): minDays is number {
  return typeof minDays === "number" && Number.isFinite(minDays);
}

/**
 * The predicates Requirement 17 attaches to the active fields of `filters`,
 * paired with the single-field filter object that isolates each one.
 */
function referenceActiveFilters(
  filters: DietitianFilters,
): { filter: DietitianFilters; predicate: RowPredicate }[] {
  const active: { filter: DietitianFilters; predicate: RowPredicate }[] = [];

  if (isActiveSearch(filters.search)) {
    const term = filters.search;
    active.push({
      filter: { search: term },
      predicate: (row) => referenceSearchMatch(row, term),
    });
  }

  // Req 17.1: at least one date in the Logging_Window with no Self_Log.
  if (filters.missingSelfLog === true) {
    active.push({
      filter: { missingSelfLog: true },
      predicate: (row) => row.datesWithoutSelfLogCount > 0,
    });
  }

  // Req 17.2: Pending_Log_Count greater than 0.
  if (filters.pendingOnly === true) {
    active.push({
      filter: { pendingOnly: true },
      predicate: (row) => row.pendingLogCount > 0,
    });
  }

  // Req 17.3: Days_Not_Logged greater than or equal to the given whole number.
  if (isActiveMinDays(filters.minDaysNotLogged)) {
    const minDays = filters.minDaysNotLogged;
    active.push({
      filter: { minDaysNotLogged: minDays },
      predicate: (row) => row.daysNotLogged >= minDays,
    });
  }

  return active;
}

/** Req 17.7: the active predicates fold by conjunction. */
function referenceApply(
  rows: readonly DietitianCustomerRow[],
  filters: DietitianFilters,
): DietitianCustomerRow[] {
  const predicates = referenceActiveFilters(filters).map(
    (entry) => entry.predicate,
  );
  return rows.filter((row) => predicates.every((predicate) => predicate(row)));
}

// ─── Filter arbitraries ──────────────────────────────────────────────────────

/** Search terms including the inert (blank) spellings. */
const searchFieldArb: fc.Arbitrary<string | undefined> = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 3 },
  { arbitrary: fc.constantFrom("", " ", "\t\n", "   "), weight: 2 },
  { arbitrary: searchQueryArb, weight: 5 },
  {
    // Whole and partial names from the pool, so hits are common.
    arbitrary: fc
      .constantFrom(...NAME_POOL)
      .chain((name) =>
        fc
          .integer({ min: 1, max: Math.max(1, name.length) })
          .map((len) => name.slice(0, len)),
      ),
    weight: 3,
  },
);

const booleanFieldArb: fc.Arbitrary<boolean | undefined> = fc.constantFrom(
  undefined,
  false,
  true,
  true,
);

/** Minimum-days values, including the inert non-finite spellings. */
const minDaysFieldArb: fc.Arbitrary<number | undefined> = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 3 },
  { arbitrary: fc.constantFrom(Number.NaN, Infinity, -Infinity), weight: 1 },
  { arbitrary: fc.integer({ min: -5, max: 65 }), weight: 6 },
);

/** Builds a filter object with the undefined fields genuinely absent. */
function buildFilters(parts: {
  search?: string | undefined;
  missingSelfLog?: boolean | undefined;
  pendingOnly?: boolean | undefined;
  minDaysNotLogged?: number | undefined;
}): DietitianFilters {
  const filters: DietitianFilters = {};
  if (parts.search !== undefined) filters.search = parts.search;
  if (parts.missingSelfLog !== undefined)
    filters.missingSelfLog = parts.missingSelfLog;
  if (parts.pendingOnly !== undefined) filters.pendingOnly = parts.pendingOnly;
  if (parts.minDaysNotLogged !== undefined)
    filters.minDaysNotLogged = parts.minDaysNotLogged;
  return filters;
}

const dietitianFiltersArb: fc.Arbitrary<DietitianFilters> = fc
  .record({
    search: searchFieldArb,
    missingSelfLog: booleanFieldArb,
    pendingOnly: booleanFieldArb,
    minDaysNotLogged: minDaysFieldArb,
  })
  .map(buildFilters);

/** Filter objects every field of which is absent or inert (the identity). */
const inertFiltersArb: fc.Arbitrary<DietitianFilters> = fc
  .record({
    search: fc.constantFrom(undefined, "", " ", "\t \n"),
    missingSelfLog: fc.constantFrom(undefined, false),
    pendingOnly: fc.constantFrom(undefined, false),
    minDaysNotLogged: fc.constantFrom(
      undefined,
      Number.NaN,
      Infinity,
      -Infinity,
    ),
  })
  .map(buildFilters);

const rowsArb = dietitianCustomerRowsArb({ maxLength: 15 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** True when `candidate` appears inside `source` in the same relative order. */
function isSubsequence(
  candidate: readonly DietitianCustomerRow[],
  source: readonly DietitianCustomerRow[],
): boolean {
  let cursor = 0;
  for (const row of source) {
    if (cursor < candidate.length && candidate[cursor] === row) cursor += 1;
  }
  return cursor === candidate.length;
}

function idsOf(rows: readonly DietitianCustomerRow[]): string[] {
  return rows.map((row) => row.customerProfileId);
}

// ─── Property 26 ─────────────────────────────────────────────────────────────

describe("Property 26: Filters compose by conjunction and never grow the result", () => {
  it("any filter combination yields a subset of the input in input order", () => {
    /**
     * **Validates: Requirements 17.8**
     */
    fc.assert(
      fc.property(rowsArb, dietitianFiltersArb, (rows, filters) => {
        const result = applyDietitianFilters(rows, filters);

        // Count can only fall (Req 17.8).
        expect(result.length).toBeLessThanOrEqual(rows.length);

        // Every displayed row came from the input, by identity — nothing is
        // fabricated and nothing is duplicated.
        const inputSet = new Set(rows);
        for (const row of result) expect(inputSet.has(row)).toBe(true);
        expect(new Set(result).size).toBe(result.length);

        // Input order is preserved: the result is a subsequence of the input.
        expect(isSubsequence(result, rows)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("adding a filter can only shrink or preserve the result", () => {
    /**
     * **Validates: Requirements 17.7, 17.8**
     */
    fc.assert(
      fc.property(rowsArb, dietitianFiltersArb, (rows, filters) => {
        const active = referenceActiveFilters(filters);

        // Accumulate the active filters one at a time; each step must be a
        // subset of the previous step, in the same order.
        let accumulated: DietitianFilters = {};
        let previous = applyDietitianFilters(rows, accumulated);
        expect(previous.length).toBe(rows.length);

        for (const entry of active) {
          accumulated = { ...accumulated, ...entry.filter };
          const next = applyDietitianFilters(rows, accumulated);

          expect(next.length).toBeLessThanOrEqual(previous.length);
          const previousSet = new Set(previous);
          for (const row of next) expect(previousSet.has(row)).toBe(true);
          expect(isSubsequence(next, previous)).toBe(true);

          previous = next;
        }

        // The last step is the full filter set.
        expect(idsOf(previous)).toEqual(idsOf(applyDietitianFilters(rows, filters)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the composed result equals the intersection of the individually filtered results", () => {
    /**
     * **Validates: Requirements 17.7**
     */
    fc.assert(
      fc.property(rowsArb, dietitianFiltersArb, (rows, filters) => {
        const composed = applyDietitianFilters(rows, filters);
        const active = referenceActiveFilters(filters);

        const individualSets = active.map(
          (entry) => new Set(applyDietitianFilters(rows, entry.filter)),
        );
        const intersection = rows.filter((row) =>
          individualSets.every((set) => set.has(row)),
        );

        expect(idsOf(composed)).toEqual(idsOf(intersection));

        // And the same intersection derived from the requirement predicates
        // rather than from the module's own single-filter behaviour.
        expect(idsOf(composed)).toEqual(idsOf(referenceApply(rows, filters)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("an empty or fully inert filter object is the identity", () => {
    /**
     * **Validates: Requirements 17.7, 17.8**
     */
    fc.assert(
      fc.property(rowsArb, inertFiltersArb, (rows, inert) => {
        for (const filters of [{} as DietitianFilters, inert]) {
          const result = applyDietitianFilters(rows, filters);
          expect(result).toEqual(rows);
          expect(result.length).toBe(rows.length);
          // A fresh array, so the caller's row set is never aliased.
          expect(result).not.toBe(rows);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("each individual filter has the semantics its acceptance criterion names", () => {
    /**
     * **Validates: Requirements 17.1, 17.2, 17.3**
     */
    fc.assert(
      fc.property(
        rowsArb,
        fc.integer({ min: -5, max: 65 }),
        searchFieldArb,
        (rows, minDays, search) => {
          // Req 17.1: at least one Logging_Window date with no Self_Log.
          expect(idsOf(applyDietitianFilters(rows, { missingSelfLog: true }))).toEqual(
            idsOf(rows.filter((row) => row.datesWithoutSelfLogCount > 0)),
          );

          // Req 17.2: Pending_Log_Count greater than 0.
          expect(idsOf(applyDietitianFilters(rows, { pendingOnly: true }))).toEqual(
            idsOf(rows.filter((row) => row.pendingLogCount > 0)),
          );

          // Req 17.3: Days_Not_Logged at or above the given whole number.
          expect(
            idsOf(applyDietitianFilters(rows, { minDaysNotLogged: minDays })),
          ).toEqual(idsOf(rows.filter((row) => row.daysNotLogged >= minDays)));

          // `false` and the non-finite minimums stay inert.
          expect(
            idsOf(
              applyDietitianFilters(rows, {
                missingSelfLog: false,
                pendingOnly: false,
                minDaysNotLogged: Number.NaN,
              }),
            ),
          ).toEqual(idsOf(rows));

          // Req 15.4 via the shared matcher: the search filter keeps exactly
          // the rows the matcher accepts.
          if (search !== undefined) {
            expect(idsOf(applyDietitianFilters(rows, { search }))).toEqual(
              idsOf(rows.filter((row) => referenceSearchMatch(row, search))),
            );
            for (const row of rows) {
              expect(matchesDietitianSearch(row, search)).toBe(
                referenceSearchMatch(row, search),
              );
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("never mutates the input array or its rows", () => {
    /**
     * **Validates: Requirements 17.8**
     */
    fc.assert(
      fc.property(rowsArb, dietitianFiltersArb, (rows, filters) => {
        const snapshot = JSON.stringify(rows);
        const identities = [...rows];

        applyDietitianFilters(rows, filters);

        expect(JSON.stringify(rows)).toBe(snapshot);
        expect(rows.length).toBe(identities.length);
        rows.forEach((row, index) => expect(row).toBe(identities[index]));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a single row is kept iff it satisfies every active filter", () => {
    /**
     * **Validates: Requirements 17.1, 17.2, 17.3, 17.7**
     */
    fc.assert(
      fc.property(
        dietitianCustomerRowArb,
        dietitianFiltersArb,
        (row, filters) => {
          const kept = applyDietitianFilters([row], filters).length === 1;
          const satisfiesAll = referenceActiveFilters(filters).every((entry) =>
            entry.predicate(row),
          );
          expect(kept).toBe(satisfiesAll);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
