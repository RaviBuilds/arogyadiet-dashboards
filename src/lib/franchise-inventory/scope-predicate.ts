// src/lib/franchise-inventory/scope-predicate.ts
// Pure scope-filtering predicate that mimics Row Level Security (RLS) at the
// application layer. Ensures franchise-scoped callers only see their own data.
//
// Requirements validated: 2.6, 3.1, 3.2, 3.4, 11.3, 11.6

/**
 * Minimal row shape — any object carrying a `franchise_id` field.
 */
export interface ScopedRow {
  franchise_id: string;
  [key: string]: unknown;
}

/**
 * Filters an array of rows to include only those whose `franchise_id` matches
 * the caller's franchise. This is a generic application-layer enforcement of
 * tenant isolation, complementing the database-level RLS policies.
 *
 * @param rows - The full set of rows (potentially belonging to multiple franchises).
 * @param callerFranchiseId - The authenticated caller's franchise identifier.
 * @returns Only the rows belonging to the caller's franchise.
 */
export function filterByScope<T extends ScopedRow>(
  rows: T[],
  callerFranchiseId: string
): T[] {
  return rows.filter((row) => row.franchise_id === callerFranchiseId);
}
