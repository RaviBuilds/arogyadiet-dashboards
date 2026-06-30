// src/lib/clinic/workload-access.ts
// Pure authorization predicate for the admin Operations workload view
// (core-clinic-architecture, Requirements 13.4, 13.5).
//
// This module is intentionally PURE and IO-free so it can be reused by the
// `getClinicWorkloadView` Server Action AND property-tested in isolation
// (task 15.3, Property 33) without a live Supabase connection.

/** Role codes permitted to access the workload view. */
const WORKLOAD_VIEW_ROLES = ["ADMIN", "MASTER_ADMIN"] as const;

/**
 * Decide whether a user holding the given role code may access the workload
 * view, including its per-Clinic and per-Kitchen breakdown.
 *
 * Access is granted ONLY to `ADMIN` and `MASTER_ADMIN` (Req 13.4). Every other
 * role — including a franchise admin role (`FRANCHISE_ADMIN`) — as well as a
 * missing/empty role, is denied (Req 13.5). PURE: depends only on its input.
 *
 * @param roleCode The caller's role code (e.g. "ADMIN", "FRANCHISE_ADMIN"), or
 *   `null`/`undefined` when no role could be resolved.
 * @returns `true` iff the role is permitted to view workload data.
 *
 * Validates: Requirements 13.4, 13.5.
 */
export function canAccessWorkloadView(
  roleCode: string | null | undefined
): boolean {
  return roleCode === "ADMIN" || roleCode === "MASTER_ADMIN";
}

/** Failure code surfaced when the caller is not authorized to view workload data. */
export const WORKLOAD_FORBIDDEN_CODE = "forbidden";

export { WORKLOAD_VIEW_ROLES };
