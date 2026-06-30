// src/lib/auth/scope-resolver.ts
// Scope_Resolver — the single application-layer tenant-isolation gate for the
// multi-tenant-franchise spec (Task 3.1, Req 8.3/8.4, 18.1–18.7).
//
// This file is the SESSION half of the resolver: it resolves the caller's Scope
// from their authenticated session and binds the DB session context, reusing
// the existing helpers discovered in `src/lib/franchise/` and `src/lib/supabase/`.
//
// The PURE half (`scopePermits`, `applyScope`) lives in `./scope-predicate` —
// kept free of Supabase / auth imports so it can be unit/property-tested in
// isolation — and is re-exported here so callers can import everything from
// `@/lib/auth/scope-resolver`.
//
// The resolved `Scope` mirrors the RLS predicate
//   is_global_role()
//     OR franchise_id = current_franchise_id()
//     OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
// so neither the application layer nor RLS can permit what the other denies
// (Req 18.7). The `Scope` type lives in `src/types/franchise.ts`; note its
// franchise variant uses the field name `franchise_id`.

import type { Scope } from "@/types/franchise";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { createClient } from "@/lib/supabase/server";
import { setFranchiseSessionContext } from "@/lib/supabase/franchise-session";
import {
  GLOBAL_ACCESS_ROLES,
  FRANCHISE_SCOPED_ROLE,
} from "@/lib/franchise/constants";

// Re-export the pure predicate + query application so consumers can import the
// full Scope_Resolver surface from a single module (Req 18.7).
export { scopePermits, applyScope } from "./scope-predicate";

/**
 * The result of resolving a caller's Scope.
 *   - `{ ok: true, scope }`                   — exactly one Scope resolved.
 *   - `{ ok: false, reason: "no_franchise" }` — FRANCHISE_ADMIN with no
 *     assigned franchise_id (Req 8.4).
 *   - `{ ok: false, reason: "unresolved" }`   — no authenticated user/role, so
 *     no Scope can be resolved (Req 18.6).
 */
export type ResolveScopeResult =
  | { ok: true; scope: Scope }
  | { ok: false; reason: "unresolved" | "no_franchise" };

/**
 * Resolves exactly one {@link Scope} from the authenticated user's role +
 * franchise_id, reusing the shared session resolver (`resolveFranchiseContext`).
 *
 *   - MASTER_ADMIN / ADMIN             → `{ kind: "full_network" }` (Req 18.3)
 *   - FRANCHISE_ADMIN + franchise_id   → `{ kind: "franchise", franchise_id }` (Req 18.2)
 *   - FRANCHISE_ADMIN + null franchise → `{ ok: false, reason: "no_franchise" }` (Req 8.4)
 *   - core roles (RIDER/CUSTOMER/etc)  → `{ kind: "core" }` (Req 18.4)
 *   - no authenticated user/role       → `{ ok: false, reason: "unresolved" }` (Req 18.6)
 */
export async function resolveScope(): Promise<ResolveScopeResult> {
  const context = await resolveFranchiseContext();

  // No authenticated user / no resolvable role → no Scope (Req 18.6).
  if (!context) {
    return { ok: false, reason: "unresolved" };
  }

  // MASTER_ADMIN / ADMIN → full network access (Req 18.3).
  if ((GLOBAL_ACCESS_ROLES as readonly string[]).includes(context.role)) {
    return { ok: true, scope: { kind: "full_network" } };
  }

  // FRANCHISE_ADMIN → scoped to their own franchise, or an error if unassigned.
  if (context.role === FRANCHISE_SCOPED_ROLE) {
    if (!context.franchise_id) {
      // FRANCHISE_ADMIN without an assigned franchise (Req 8.4).
      return { ok: false, reason: "no_franchise" };
    }
    return {
      ok: true,
      scope: { kind: "franchise", franchise_id: context.franchise_id },
    };
  }

  // Core roles (RIDER / CUSTOMER / anything else) → core rows only (Req 18.4).
  return { ok: true, scope: { kind: "core" } };
}

/**
 * Maps a resolved Scope to the `app.franchise_id` session value:
 *   - franchise(f)        → that franchise_id
 *   - full_network / core → null (global bypass / core rows)
 */
function scopeFranchiseId(scope: Scope): string | null {
  return scope.kind === "franchise" ? scope.franchise_id : null;
}

/**
 * Binds the DB session context (`app.role`, `app.franchise_id`) for the current
 * request via the existing `set_franchise_context` RPC, so RLS enforces the
 * same boundary the application layer just resolved (Req 18.7).
 *
 * Reuses {@link setFranchiseSessionContext}, which is gated by the franchise
 * feature flag and calls `set_franchise_context(p_role, p_franchise_id)`.
 */
export async function bindDbScope(scope: Scope, role: string): Promise<void> {
  const supabase = await createClient();
  await setFranchiseSessionContext(supabase, role, scopeFranchiseId(scope));
}
