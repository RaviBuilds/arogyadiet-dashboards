// src/lib/auth/dashboard-scope.ts
// Central, flag-gated scoping helper for the SHARED RBAC-aware dashboard data
// reads (multi-tenant-franchise — Task 12.3, Req 17.1–17.8, 21.3–21.5).
//
// This is the SINGLE insertion point the shared customer/rider/inventory/order/
// report data reads use to (a) resolve the caller's dashboard Scope and (b)
// apply that Scope to a Supabase query on the `franchise_id` column. It wraps
// the existing Scope_Resolver (`resolveScope` / `applyScope` from
// `@/lib/auth/scope-resolver`) and adds the dashboard-specific gating:
//
//   - FRANCHISE_FEATURES_ENABLED is false → behave EXACTLY as today: every read
//     resolves to `full_network` and NO `franchise_id` filter is applied, so the
//     Core_Operation / Admin_Dashboard is byte-for-byte unchanged (Req 17.4,
//     17.5, 20.8). Nothing franchise-specific runs.
//   - MASTER_ADMIN / ADMIN  → `full_network` → query unchanged (sees Core + every
//     Franchise) (Req 17.4, 17.5).
//   - FRANCHISE_ADMIN + franchise_id → `franchise` → `.eq('franchise_id', id)`
//     so the viewer sees ONLY their own Franchise's records (Req 17.2, 21.3–21.5).
//   - FRANCHISE_ADMIN without a Franchise → `no_franchise` indication (Req 17.7).
//   - any other (core RIDER/CUSTOMER) role → `access_denied` indication, since
//     none of the three dashboard roles is held (Req 17.6).
//   - no authenticated/resolvable caller → `unresolved` indication (Req 17.6).
//
// The resolved Scope mirrors the RLS predicate exactly (via the underlying
// Scope_Resolver), so the application layer and RLS agree (Req 18.7).
//
// Building the dashboard UI components is OUT OF SCOPE for this task; this module
// only produces the Scope + the indication a shared read entry point can surface.

import "server-only";

import type { Scope } from "@/types/franchise";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import { resolveScope, applyScope } from "@/lib/auth/scope-resolver";

/**
 * The reason a dashboard read cannot proceed under the viewer's Scope:
 *   - `no_franchise`  — FRANCHISE_ADMIN with no assigned Franchise (Req 17.7).
 *   - `access_denied` — viewer holds none of FRANCHISE_ADMIN / ADMIN /
 *                       MASTER_ADMIN (a core RIDER/CUSTOMER role) (Req 17.6).
 *   - `unresolved`    — no authenticated user / no resolvable role (Req 17.6).
 */
export type DashboardScopeDenial = "no_franchise" | "access_denied" | "unresolved";

/**
 * The result of resolving the dashboard Scope for the current caller.
 *   - `{ ok: true, scope }`          — proceed; apply `scope` to every read.
 *   - `{ ok: false, reason }`        — render no data; surface the indication.
 */
export type DashboardScopeResult =
  | { ok: true; scope: Scope }
  | { ok: false; reason: DashboardScopeDenial };

/**
 * Resolves the {@link Scope} for a SHARED dashboard data read, applying the
 * dashboard role policy (Req 17.2–17.7) on top of the base Scope_Resolver.
 *
 * When `FRANCHISE_FEATURES_ENABLED` is false this short-circuits to
 * `full_network` WITHOUT touching any franchise resolution, so the existing
 * Core / Admin dashboards behave exactly as they do today (Req 17.4/17.5/20.8).
 */
export async function resolveDashboardScope(): Promise<DashboardScopeResult> {
  // Flag OFF → no franchise-specific work; full network, unchanged behavior.
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { ok: true, scope: { kind: "full_network" } };
  }

  const resolved = await resolveScope();

  if (!resolved.ok) {
    // FRANCHISE_ADMIN without a Franchise (Req 17.7) vs. no resolvable caller.
    return {
      ok: false,
      reason: resolved.reason === "no_franchise" ? "no_franchise" : "unresolved",
    };
  }

  // A `core` Scope here means a core RIDER/CUSTOMER role reached a dashboard
  // surface — none of the three dashboard roles is held, so deny (Req 17.6).
  if (resolved.scope.kind === "core") {
    return { ok: false, reason: "access_denied" };
  }

  // full_network (MASTER_ADMIN / ADMIN) or franchise (FRANCHISE_ADMIN).
  return { ok: true, scope: resolved.scope };
}

/**
 * Applies a resolved dashboard {@link Scope} to a Supabase query on the
 * `franchise_id` column. Identical to {@link applyScope} but additionally
 * short-circuits when the franchise feature flag is off, so a flag-off (or
 * `full_network`) read returns the query completely unchanged (Req 17.4/17.5/
 * 20.8). franchise scope → `.eq('franchise_id', id)`; core scope →
 * `.is('franchise_id', null)`.
 *
 * Generic over the query-builder type so callers keep their concrete builder
 * type through the call (chainable before awaiting / adding `.order(...)`).
 */
export function applyDashboardScope<Q>(query: Q, scope: Scope): Q {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return query;
  }
  return applyScope(query, scope);
}
