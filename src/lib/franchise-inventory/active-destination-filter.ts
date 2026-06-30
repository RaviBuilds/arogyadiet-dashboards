// src/lib/franchise-inventory/active-destination-filter.ts
// Pure function that filters franchises to only those eligible as dispatch destinations.
// (franchise-inventory spec — Task 7.1)
//
// Requirements validated: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1

/**
 * Minimal franchise shape needed for destination filtering.
 */
export interface FranchiseForDestination {
  id: string;
  name: string;
  status: string;
}

/**
 * The output shape for a valid dispatch destination.
 */
export interface FranchiseDestination {
  id: string;
  name: string;
}

/**
 * Returns exactly the franchises whose status is `active` (exact lowercase match).
 * Excludes `onboarding`, `suspended`, and any non-`active` status.
 *
 * This is pure computation — no database access.
 */
export function filterActiveDestinations(
  franchises: FranchiseForDestination[],
): FranchiseDestination[] {
  return franchises
    .filter((f) => f.status === "active")
    .map(({ id, name }) => ({ id, name }));
}
