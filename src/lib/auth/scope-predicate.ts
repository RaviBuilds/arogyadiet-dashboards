// src/lib/auth/scope-predicate.ts
// PURE Scope predicate + query application for the multi-tenant-franchise spec
// (Task 3.1, Req 18.7).
//
// This module has NO Supabase / auth / Next.js imports (only a type-only import
// of `Scope`), so it can be unit/property-tested in complete isolation. It is
// re-exported from `scope-resolver.ts` so callers can import either entry point.
//
// `scopePermits` mirrors the RLS USING / WITH CHECK clause exactly:
//   is_global_role()
//     OR franchise_id = current_franchise_id()
//     OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
// so no layer permits what the other denies (Req 18.7).

import type { Scope } from "@/types/franchise";

/**
 * Pure predicate: does this Scope permit acting on a row carrying
 * `rowFranchiseId`?
 *   - full_network → `true` for any rowFranchiseId          (is_global_role())
 *   - franchise(f) → `rowFranchiseId === f`                 (franchise_id = current_franchise_id())
 *   - core         → `rowFranchiseId === null`              (franchise_id IS NULL AND current_franchise_id() IS NULL)
 */
export function scopePermits(scope: Scope, rowFranchiseId: string | null): boolean {
  switch (scope.kind) {
    case "full_network":
      return true;
    case "franchise":
      return rowFranchiseId === scope.franchise_id;
    case "core":
      return rowFranchiseId === null;
  }
}

/**
 * Minimal structural shape of a Supabase query builder this module relies on.
 * Both `eq` and `is` return the same (chainable) builder type.
 */
interface ScopableQuery {
  eq(column: string, value: unknown): unknown;
  is(column: string, value: unknown): unknown;
}

/**
 * Applies the Scope to a Supabase query builder on the `franchise_id` column:
 *   - franchise(f)  → `.eq('franchise_id', f)`
 *   - core          → `.is('franchise_id', null)`
 *   - full_network  → no filter (sees core + every franchise)
 *
 * Generic over the query builder type `Q` so the caller keeps its concrete
 * builder type through the call. This is pure query construction — no Supabase
 * import is required to build the filter.
 */
export function applyScope<Q>(query: Q, scope: Scope): Q {
  const builder = query as unknown as ScopableQuery;
  switch (scope.kind) {
    case "franchise":
      return builder.eq("franchise_id", scope.franchise_id) as unknown as Q;
    case "core":
      return builder.is("franchise_id", null) as unknown as Q;
    case "full_network":
      return query;
  }
}
