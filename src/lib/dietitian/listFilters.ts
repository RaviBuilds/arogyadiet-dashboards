// src/lib/dietitian/listFilters.ts
// Feature: dietitian-management — filtering and sorting of the Dietitian
// customer list. Pure module: no I/O, no clock, no Supabase.
//
// The Server Action reads the in-scope rows, decorates them with the
// Cadence_Engine values and then hands the whole set to this module. Keeping
// the filter and sort semantics here means the Log Customer list, the
// Dietitian_Activity_Report and the franchise activity page all narrow and
// order rows identically, and the behaviour is testable without a database.
//
// Two invariants drive the shape of this file:
//   - filters fold by conjunction, so the result can only shrink (Req 17.7, 17.8)
//   - sorting copies before it sorts, so the multiset is preserved (Req 17.9)
//
// _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

import type { DietitianCustomerRow } from "@/types/dietitian";

// The row shape lives in `src/types/dietitian.ts` so the repositories, the
// services and the shared components can all name it without importing this
// module. It is re-exported here because callers of the filters normally want
// both together.
export type { DietitianCustomerRow };

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * The active filters of the Dietitian customer list. Every field is optional
 * and an absent — or inert — field leaves the row set untouched:
 *
 * - `search`: matches the customer name, mobile or customer code (Req 15.4).
 *   Empty or whitespace-only is inert.
 * - `missingSelfLog`: keeps rows with at least one date in the Logging_Window
 *   that has no Self_Log (Req 17.1). Only `true` is active.
 * - `pendingOnly`: keeps rows whose Pending_Log_Count is above zero (Req 17.2).
 *   Only `true` is active.
 * - `minDaysNotLogged`: keeps rows whose Days_Not_Logged is at least this whole
 *   number of days (Req 17.3). A non-finite value is inert.
 */
export interface DietitianFilters {
  /** Free text matched against name, mobile and customer code. */
  search?: string;
  /** `datesWithoutSelfLogCount > 0`. */
  missingSelfLog?: boolean;
  /** `pendingLogCount > 0`. */
  pendingOnly?: boolean;
  /** `daysNotLogged >= minDaysNotLogged`. */
  minDaysNotLogged?: number;
}

/** The fields the search filter looks at (Req 15.4). */
type SearchableField = "name" | "mobile" | "customerCode";

const SEARCHABLE_FIELDS: readonly SearchableField[] = [
  "name",
  "mobile",
  "customerCode",
];

function normalizeSearchTerm(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * True when the normalized term occurs in the name, the mobile or the customer
 * code of the row. Matching is case-insensitive substring matching, so a
 * partial mobile or a partial code hits, and a `null` field simply cannot
 * match.
 */
export function matchesDietitianSearch(
  row: DietitianCustomerRow,
  term: string,
): boolean {
  const needle = normalizeSearchTerm(term);
  if (needle.length === 0) return true;

  return SEARCHABLE_FIELDS.some((field) => {
    const value = row[field];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
}

/** A single filter reduced to a row predicate. */
type RowPredicate = (row: DietitianCustomerRow) => boolean;

/**
 * Turns the filter object into the list of predicates that are actually active.
 * An inert field contributes nothing, which is what makes an empty or partially
 * filled filter object a no-op rather than a special case in the caller.
 */
function activePredicates(filters: DietitianFilters): RowPredicate[] {
  const predicates: RowPredicate[] = [];

  if (typeof filters.search === "string" && normalizeSearchTerm(filters.search).length > 0) {
    const term = filters.search;
    predicates.push((row) => matchesDietitianSearch(row, term));
  }

  if (filters.missingSelfLog === true) {
    predicates.push((row) => row.datesWithoutSelfLogCount > 0);
  }

  if (filters.pendingOnly === true) {
    predicates.push((row) => row.pendingLogCount > 0);
  }

  const minDays = filters.minDaysNotLogged;
  if (typeof minDays === "number" && Number.isFinite(minDays)) {
    predicates.push((row) => row.daysNotLogged >= minDays);
  }

  return predicates;
}

/**
 * Applies every active filter to `rows`, combining them with logical
 * conjunction (Req 17.7).
 *
 * The predicates are folded with `every`, so the result is a subset of the
 * input in input order: adding a filter can only remove rows, never add or
 * reorder them (Req 17.8). The input is never mutated — `filter` returns a new
 * array.
 */
export function applyDietitianFilters(
  rows: readonly DietitianCustomerRow[],
  filters: DietitianFilters,
): DietitianCustomerRow[] {
  const predicates = activePredicates(filters);
  if (predicates.length === 0) return [...rows];

  return rows.filter((row) => predicates.every((predicate) => predicate(row)));
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** The sortable columns of the Dietitian customer list (Req 17.4, 17.5). */
export type DietitianSortKey = "lastDietitianLogDate" | "daysNotLogged";

export type SortDirection = "asc" | "desc";

export const DIETITIAN_SORT_KEYS: readonly DietitianSortKey[] = [
  "lastDietitianLogDate",
  "daysNotLogged",
];

/**
 * The list's default ordering: oldest Last_Dietitian_Log_Date first, so the
 * customers who have never been logged surface at the top (Req 17.6).
 */
export const DEFAULT_DIETITIAN_SORT: {
  key: DietitianSortKey;
  direction: SortDirection;
} = { key: "lastDietitianLogDate", direction: "asc" };

/**
 * Orders two `Last_Dietitian_Log_Date` values ascending, treating `null` as the
 * earliest orderable value (Req 17.6). Because the direction is applied by
 * negating this result, a customer with no Dietitian_Log stays at the "earliest"
 * end of the ordering in both directions: first when ascending, last when
 * descending.
 *
 * Real dates are `YYYY-MM-DD` strings, whose lexicographic order is their
 * chronological order, so a plain string comparison is enough.
 */
function compareLastLogDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareAscending(
  a: DietitianCustomerRow,
  b: DietitianCustomerRow,
  key: DietitianSortKey,
): number {
  if (key === "lastDietitianLogDate") {
    return compareLastLogDate(a.lastDietitianLogDate, b.lastDietitianLogDate);
  }
  return a.daysNotLogged - b.daysNotLogged;
}

/**
 * Returns `rows` ordered by `key` in `direction`.
 *
 * The array is copied before it is sorted, so the caller's row set is left
 * untouched and the output is always a permutation of the input (Req 17.9).
 * `Array.prototype.sort` is stable, so rows that tie on the sort key keep their
 * incoming relative order and the result is deterministic.
 */
export function sortDietitianRows(
  rows: readonly DietitianCustomerRow[],
  key: DietitianSortKey,
  direction: SortDirection,
): DietitianCustomerRow[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => sign * compareAscending(a, b, key));
}
