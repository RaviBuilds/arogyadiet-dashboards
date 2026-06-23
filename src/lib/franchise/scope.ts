// src/lib/franchise/scope.ts
// Shared helper for applying an operations "scope" filter to Supabase queries.
//
// Scope semantics (used by the Operations Control submenus):
//   - undefined / "all" → no filter (admin sees core + every franchise)
//   - "core"            → franchise_id IS NULL (head-office core business only)
//   - <franchise uuid>  → that franchise's records only
//
// This keeps the admin "View Data For" selector and the franchise portal
// (always scoped to its own franchise) on a single, consistent contract.

export type OperationsScope = string | undefined; // "core" | "all" | uuid | undefined

/**
 * Apply the scope filter to a Supabase query builder on the given column.
 * Returns the (possibly filtered) query.
 */
export function applyOperationsScope<T extends { eq: any; is: any }>(
  query: T,
  scope: OperationsScope,
  column = "franchise_id",
): T {
  if (!scope || scope === "all") return query;
  if (scope === "core") return query.is(column, null);
  return query.eq(column, scope);
}

/** True when the scope targets a single franchise (a UUID, not core/all). */
export function isFranchiseScope(scope: OperationsScope): scope is string {
  return Boolean(scope) && scope !== "all" && scope !== "core";
}
