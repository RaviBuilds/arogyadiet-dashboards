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
  resolveAccessConfiguration,
  canAccess,
  hasGroupAccess,
  canManageGroup,
  landingRouteFor,
  type AccessArea,
  type AdminAccessLevel,
  type AccessConfiguration,
  type OperationsGroup,
  DEFAULT_ACCESS_LEVEL,
} from "./adminAccessCore";

// Re-export the full pure API so existing import sites keep working.
export * from "./adminAccessCore";

// ─── Server-side context + guards ─────────────────────────────────────────────

export interface AdminContext {
  userId: string | null; // public.users.id
  roleCode: string | null; // e.g. "ADMIN"
  accessLevel: AdminAccessLevel;
  /** Fully-resolved per-group configuration (always valid). */
  config: AccessConfiguration;
}

/**
 * Resolve the signed-in user's role + access configuration via the Supabase SSR
 * client.
 *
 * Precondition:  called within a request scope where the SSR client can read
 *                the session (server component / server action / route handler).
 * Postcondition: config is always valid (NULL level coerced to full, malformed
 *                groups dropped); accessLevel mirrors config.level for back-compat;
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
    return {
      userId: null,
      roleCode: null,
      accessLevel: DEFAULT_ACCESS_LEVEL,
      config: { level: DEFAULT_ACCESS_LEVEL, groups: {} },
    };
  }

  const { data } = await supabase
    .from("users")
    .select("id, admin_access_level, admin_operations_access, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const roles = data?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  const config = resolveAccessConfiguration(
    data?.admin_access_level,
    data?.admin_operations_access,
  );

  return {
    userId: data?.id ?? null,
    roleCode: roleCode ?? null,
    accessLevel: config.level,
    config,
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
 * Thrown by the group-scoped guards when a caller lacks access to an operations
 * group. `readOnly` distinguishes "you have view access but tried to write"
 * from "you have no access to this group at all" so callers can surface the
 * right message (Req 9.2, 9.3).
 */
export class GroupAccessDeniedError extends Error {
  readonly group: OperationsGroup;
  readonly readOnly: boolean;
  constructor(group: OperationsGroup, readOnly: boolean) {
    super(
      readOnly
        ? `Read-only access for group: ${group}`
        : `Admin access denied for group: ${group}`,
    );
    this.name = "GroupAccessDeniedError";
    this.group = group;
    this.readOnly = readOnly;
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
 * Read-capable guard for operations group server actions / loaders. Permits the
 * caller when they are an ADMIN with at least view access to `group` (Req 5.4,
 * 9.5). Throws GroupAccessDeniedError otherwise.
 */
export async function assertGroupAccess(
  group: OperationsGroup,
): Promise<AccessConfiguration> {
  const { roleCode, config } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN") throw new GroupAccessDeniedError(group, false);
  if (!hasGroupAccess(config, group)) {
    throw new GroupAccessDeniedError(group, false);
  }
  return config;
}

/**
 * Write guard for operations group server actions. Permits the caller only when
 * they are an ADMIN with manage access to `group` (Req 9.1–9.4). A view-only
 * admin is rejected with `readOnly = true`; an admin lacking the group entirely
 * is rejected with `readOnly = false`.
 */
export async function assertGroupManage(
  group: OperationsGroup,
): Promise<AccessConfiguration> {
  const { roleCode, config } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN") throw new GroupAccessDeniedError(group, false);
  if (canManageGroup(config, group)) return config;
  // Distinguish view-only (has access, no write) from no-access.
  throw new GroupAccessDeniedError(group, hasGroupAccess(config, group));
}

/**
 * Redirect-style page guard for an operations group (server components).
 *   - role is not ADMIN (or no session) -> redirect("/unauthorized")
 *   - group not granted                  -> redirect(landingRouteFor(level))
 *
 * Returns the resolved configuration when access is permitted. Defense in depth
 * behind the middleware route gate (Req 8.3, 9 reachability).
 */
export async function guardAdminGroup(
  group: OperationsGroup,
): Promise<AccessConfiguration> {
  const { roleCode, config } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN") redirect("/unauthorized");
  if (!hasGroupAccess(config, group)) redirect(landingRouteFor(config.level));
  return config;
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
