// src/lib/auth/adminAccess.ts
//
// Server-side entry point for the admin access-level utilities.
//
// Pure, environment-agnostic helpers (types, resolveAccessLevel, canAccess,
// classifyAdminPath, isAdminPathAllowed, landingRouteFor, labels) live in
// `adminAccessCore.ts` and are re-exported here so server components and server
// actions can import everything from one place.
//
// This file additionally hosts the server-only context resolver + guards. The
// `server-only` import below guarantees these are never bundled into a client
// component. The EDGE MIDDLEWARE must import the pure helpers from
// `adminAccessCore.ts` directly (not from this file) to avoid pulling the
// server-only marker / SSR client into the edge bundle.

import "server-only";

import { redirect } from "next/navigation";
import {
  resolveAccessLevel,
  canAccess,
  landingRouteFor,
  type AccessArea,
  type AdminAccessLevel,
  DEFAULT_ACCESS_LEVEL,
} from "./adminAccessCore";

// Re-export the full pure API so existing import sites keep working.
export * from "./adminAccessCore";

// ─── Server-side context + guards ─────────────────────────────────────────────

export interface AdminContext {
  userId: string | null; // public.users.id
  roleCode: string | null; // e.g. "ADMIN"
  accessLevel: AdminAccessLevel;
}

/**
 * Resolve the signed-in user's role + access level via the Supabase SSR client.
 *
 * Precondition:  called within a request scope where the SSR client can read
 *                the session (server component / server action / route handler).
 * Postcondition: accessLevel is always a valid level (NULL coerced to full);
 *                userId / roleCode are null when no session can be resolved.
 */
export async function getCurrentAdminContext(): Promise<AdminContext> {
  // Lazy import keeps `next/headers` out of the module's top-level graph so the
  // module stays importable in non-request (test) environments.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, roleCode: null, accessLevel: DEFAULT_ACCESS_LEVEL };
  }

  const { data } = await supabase
    .from("users")
    .select("id, admin_access_level, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const roles = data?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  return {
    userId: data?.id ?? null,
    roleCode: roleCode ?? null,
    accessLevel: resolveAccessLevel(data?.admin_access_level),
  };
}

/** Thrown by `assertAdminAccess` when access is not permitted. */
export class AccessDeniedError extends Error {
  readonly area: AccessArea;
  constructor(area: AccessArea) {
    super(`Admin access denied for area: ${area}`);
    this.name = "AccessDeniedError";
    this.area = area;
  }
}

/**
 * Throw-style guard for server actions and server components. Resolves the
 * current admin's level and asserts it permits `area`.
 *
 * Postcondition: returns the resolved AdminAccessLevel if permitted; otherwise
 *                throws AccessDeniedError (non-ADMIN and no-session both deny).
 *                Callers map the error to redirect(landingRouteFor(level)) or
 *                a { success: false } response.
 */
export async function assertAdminAccess(
  area: AccessArea,
): Promise<AdminAccessLevel> {
  const { roleCode, accessLevel } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN") throw new AccessDeniedError(area);
  if (!canAccess(accessLevel, area)) throw new AccessDeniedError(area);
  return accessLevel;
}

/**
 * Redirect-style guard for server *pages* (server components). Resolves the
 * current admin's context and redirects on deny instead of throwing:
 *   - role is not ADMIN (or no session) -> redirect("/unauthorized")
 *   - level does not permit `area`       -> redirect(landingRouteFor(level))
 *
 * Returns the resolved AdminAccessLevel when access is permitted. This is the
 * page-level counterpart to `assertAdminAccess` (which throws, for server
 * actions). It is defense-in-depth behind the layout guards.
 */
export async function guardAdminPage(
  area: AccessArea,
): Promise<AdminAccessLevel> {
  const { roleCode, accessLevel } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN") redirect("/unauthorized");
  if (!canAccess(accessLevel, area)) redirect(landingRouteFor(accessLevel));
  return accessLevel;
}
