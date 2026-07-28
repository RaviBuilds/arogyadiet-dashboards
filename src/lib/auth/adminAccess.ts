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
  resolveAccessLevel,
  canAccess,
  hasGroupAccess,
  canManageGroup,
  isDietitianLevel,
  landingRouteFor,
  type AccessArea,
  type AdminAccessLevel,
  type AccessConfiguration,
  type OperationsGroup,
  type PortalBase,
  DEFAULT_ACCESS_LEVEL,
} from "./adminAccessCore";
import {
  resolveWarehouseAuthorization,
  type WarehouseCapability,
} from "@/lib/inventory/warehouse-access";
import {
  dietitianCanRead,
  dietitianScopeFromUser,
  type DietitianScope,
} from "@/lib/dietitian/scope";
import { CUSTOMER_NOT_IN_SCOPE } from "@/lib/dietitian/messages";

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
  // MASTER_ADMIN is the super-admin and is never constrained by the ADMIN
  // group model (Req 13.5 — its access is unchanged). Its resolved config is
  // full, so the group check below passes.
  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    throw new GroupAccessDeniedError(group, false);
  }
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
  // MASTER_ADMIN passes as full access (Req 13.5); its config is full so
  // canManageGroup returns true below.
  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    throw new GroupAccessDeniedError(group, false);
  }
  if (canManageGroup(config, group)) return config;
  // Distinguish view-only (has access, no write) from no-access.
  throw new GroupAccessDeniedError(group, hasGroupAccess(config, group));
}

/**
 * Result-style wrapper around {@link assertGroupManage} for server actions that
 * return an `ActionResult`-shaped value. Returns `{ ok: true }` when the caller
 * may write to `group`, otherwise `{ ok: false, error }` with a user-facing
 * message (read-only vs no-access). Callers do:
 *
 *   const gate = await checkGroupManage("customers");
 *   if (!gate.ok) return { success: false, error: gate.error };
 */
export async function checkGroupManage(
  group: OperationsGroup,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertGroupManage(group);
    return { ok: true };
  } catch (err) {
    if (err instanceof GroupAccessDeniedError) {
      return {
        ok: false,
        error: err.readOnly
          ? "You have read-only access to this section."
          : "You do not have permission to perform this action.",
      };
    }
    throw err;
  }
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
  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    redirect("/unauthorized");
  }
  if (!hasGroupAccess(config, group)) redirect(landingRouteFor(config.level));
  return config;
}

/**
 * Redirect-style page guard for the "customers" group that ADDITIONALLY
 * admits a Dietitian (dietitian-management, Req 16.1). `hasGroupAccess`
 * returns `false` for the `dietitian` level by design (Req 26.5, 26.6 — it
 * grants no operations group), so a plain `guardAdminGroup("customers")`
 * would redirect a Dietitian away from `/admin/customers` even though
 * `DIETITIAN_ALLOWED_PREFIXES` explicitly permits that path. This guard
 * exists ONLY for that one page family; every other operations-group page
 * keeps using `guardAdminGroup` unchanged.
 *
 * Returns `{ config, isDietitian }` so the caller (the customers pages) can
 * thread `isDietitian` down to `CustomerDashboard`/`Customer360Dashboard` to
 * drive the read-only rendering (Req 16.1) without a second context
 * resolution.
 */
export async function guardCustomersWorkspace(): Promise<{
  config: AccessConfiguration;
  isDietitian: boolean;
}> {
  const { roleCode, config } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    redirect("/unauthorized");
  }
  const isDietitian = isDietitianLevel(config);
  if (!isDietitian && !hasGroupAccess(config, "customers")) {
    redirect(landingRouteFor(config.level));
  }
  return { config, isDietitian };
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

/**
 * Redirect-style page guard for a Franchise_Portal group-gated surface — the
 * Dietitian Activity page (dietitian-management, Req 24.1, 24.3). Resolves the
 * caller's franchise session the same way `franchise/(main)/layout.tsx` does
 * (role must be `FRANCHISE_ADMIN`, the Franchise must exist, not be suspended,
 * and carry a `franchise_id`), applies the Franchise_Owner override
 * (Req 21.6), then checks `hasGroupAccess(config, group)` — a Franchise user
 * whose Access_Level does not grant `group` is redirected away (Req 24.3),
 * even though this route is otherwise "neutral" to the portal path gate.
 *
 * Lives here (not in `src/app/franchise`) so it stays shared, portal-neutral
 * code the Franchise_Portal may import without violating Req 23.7.
 *
 * Postcondition:
 *   - not signed in, not FRANCHISE_ADMIN, no franchise, or franchise
 *     suspended                                -> redirect("/unauthorized")
 *   - resolved configuration does not grant
 *     `group`                                  -> redirect(landingRouteFor(config.level))
 *   - otherwise                                 -> { config, franchiseId }
 */
export async function guardFranchiseGroupAccess(
  group: OperationsGroup,
): Promise<{ config: AccessConfiguration; franchiseId: string }> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/unauthorized");

  const { data: userProfileData } = await supabase
    .from("users")
    .select(
      "id, franchise_id, admin_access_level, admin_operations_access, roles(code)",
    )
    .eq("auth_user_id", user.id)
    .single();

  const roles = userProfileData?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "FRANCHISE_ADMIN") redirect("/unauthorized");

  const franchiseId = userProfileData?.franchise_id;
  if (!franchiseId) redirect("/unauthorized");

  const { data: franchise } = await supabase
    .from("franchises")
    .select("status, owner_user_id")
    .eq("id", franchiseId)
    .single();

  if (franchise?.status === "suspended") redirect("/unauthorized");

  const isFranchiseOwner =
    typeof franchise?.owner_user_id === "string" &&
    franchise.owner_user_id === userProfileData?.id;
  const config: AccessConfiguration = isFranchiseOwner
    ? { level: "inventory_operations", groups: {} }
    : resolveAccessConfiguration(
        userProfileData?.admin_access_level,
        userProfileData?.admin_operations_access,
      );

  if (!hasGroupAccess(config, group)) {
    redirect(landingRouteFor(config.level));
  }

  return { config, franchiseId };
}

// ─── Warehouse access guards ──────────────────────────────────────────────────

/**
 * Thrown by `assertWarehouseAccess` when the caller lacks the requested
 * warehouse capability. Carries the denied capability for error handling.
 */
export class WarehouseAccessDeniedError extends Error {
  readonly capability: WarehouseCapability;
  constructor(capability: WarehouseCapability) {
    super(`Warehouse access denied for capability: ${capability}`);
    this.name = "WarehouseAccessDeniedError";
    this.capability = capability;
  }
}

/**
 * Throw-style guard for warehouse actions. Resolves the current user's role and
 * access level, then delegates to the pure `resolveWarehouseAuthorization`
 * decision function.
 *
 * Throws `WarehouseAccessDeniedError` when the caller may not perform the
 * requested capability — no mutation, no revalidation should follow.
 */
export async function assertWarehouseAccess(
  capability: WarehouseCapability,
): Promise<void> {
  const { roleCode, accessLevel } = await getCurrentAdminContext();
  const authorized = resolveWarehouseAuthorization(
    roleCode,
    accessLevel,
    capability,
  );
  if (!authorized) {
    throw new WarehouseAccessDeniedError(capability);
  }
}

/**
 * Result-style guard for warehouse server actions that return an
 * `ActionResult`-shaped value. Returns `{ ok: true }` when the caller is
 * authorized, otherwise `{ ok: false, error }` with a stable, user-facing
 * denial message.
 *
 * Usage:
 *   const gate = await checkWarehouseAccess("product_management");
 *   if (!gate.ok) return { success: false, error: gate.error };
 */
export async function checkWarehouseAccess(
  capability: WarehouseCapability,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertWarehouseAccess(capability);
    return { ok: true };
  } catch (err) {
    if (err instanceof WarehouseAccessDeniedError) {
      return {
        ok: false,
        error: "You do not have permission to perform this action.",
      };
    }
    throw err;
  }
}
// ─── Dietitian guards (dietitian-management) ─────────────────────────────────
//
// A Dietitian is a `users` row whose resolved access level is `dietitian` and
// whose role is `ADMIN` (Core_Business, admin portal) or `FRANCHISE_ADMIN`
// (Franchise, franchise portal). Reachability of a Dietitian's *pages* is the
// allow-list gate in `adminAccessCore` (DIETITIAN_ALLOWED_PREFIXES); the guards
// below are the request-scoped counterparts:
//
//   * `guardDietitianPage()`      — redirect-style page guard (Req 5.3)
//   * `checkDietitianScope(id)`   — result-style action guard and the single
//                                   choke point for Req 5.8, 5.9, 5.10, 16.5
//
// The scope predicate itself lives in `@/lib/dietitian/scope` (the twin of the
// `dietitian_can_read_customer` RLS helper) and is reused verbatim here so the
// guard and the policies can never disagree.

/** The role codes a Dietitian account may carry. */
const DIETITIAN_ROLE_CODES = ["ADMIN", "FRANCHISE_ADMIN"] as const;

/** The portal each Dietitian role signs in to (Req 5.1, 5.2, 5.3). */
const DIETITIAN_ROLE_PORTAL: Record<DietitianRoleCode, PortalBase> = {
  ADMIN: "/admin",
  FRANCHISE_ADMIN: "/franchise",
};

export type DietitianRoleCode = (typeof DIETITIAN_ROLE_CODES)[number];

/**
 * The request-scoped identity of the signed-in Dietitian.
 *
 * `clinicId` is `users.dietitian_clinic_id` (null when the Dietitian_Clinic_Link
 * is empty, Req 4.4); `franchiseId` is `users.franchise_id` (null for a
 * Core_Business Dietitian).
 */
export interface DietitianContext {
  userId: string; // public.users.id
  roleCode: DietitianRoleCode;
  clinicId: string | null; // users.dietitian_clinic_id
  franchiseId: string | null; // users.franchise_id
}

/** Thrown by `assertDietitianScope` when the customer is outside the scope. */
export class DietitianScopeError extends Error {
  constructor(message: string = CUSTOMER_NOT_IN_SCOPE) {
    super(message);
    this.name = "DietitianScopeError";
  }
}

function isDietitianRoleCode(value: unknown): value is DietitianRoleCode {
  return (
    typeof value === "string" &&
    (DIETITIAN_ROLE_CODES as readonly string[]).includes(value)
  );
}

/** Postgres uuid text form — the only shape a profile id may take. */
const UUID_TEXT =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * The readable scope of a Dietitian context, in the shape
 * `@/lib/dietitian/scope` consumes (`applyDietitianScope`, `dietitianCanRead`).
 *
 * A non-null `franchiseId` yields a `franchise` scope (tenant-wide read), any
 * other context yields a `core` scope (Dietitian_Link plus the linked Clinic).
 */
export function dietitianScopeFromContext(ctx: DietitianContext): DietitianScope {
  return dietitianScopeFromUser({
    id: ctx.userId,
    franchise_id: ctx.franchiseId,
    dietitian_clinic_id: ctx.clinicId,
  });
}

/**
 * Resolve the signed-in user as a Dietitian, mirroring the
 * `public.current_dietitian()` security-definer helper: a row is returned only
 * for an ACTIVE user whose access level is `dietitian` and whose role is one of
 * the two Dietitian role codes.
 *
 * Postcondition: returns `null` (never throws) when there is no session, the
 *                user row cannot be read, the user is inactive, the level is not
 *                `dietitian`, or the role is not a Dietitian role — exactly the
 *                cases in which `current_dietitian()` yields no rows.
 */
export async function getCurrentDietitianContext(): Promise<DietitianContext | null> {
  // Lazy import keeps `next/headers` out of the module's top-level graph.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select(
      "id, admin_access_level, franchise_id, dietitian_clinic_id, is_active, roles(code)",
    )
    .eq("auth_user_id", user.id)
    .single();

  if (!data) return null;

  const roles = data.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (!isDietitianRoleCode(roleCode)) return null;
  if (data.is_active === false) return null;
  if (!isDietitianLevel(resolveAccessLevel(data.admin_access_level))) return null;
  if (typeof data.id !== "string" || data.id.length === 0) return null;

  return {
    userId: data.id,
    roleCode,
    clinicId: (data.dietitian_clinic_id as string | null) ?? null,
    franchiseId: (data.franchise_id as string | null) ?? null,
  };
}

/**
 * Redirect-style page guard for the Dietitian-only surfaces (Log Customer,
 * Report_Card). Defense in depth behind the middleware allow-list gate.
 *
 * Postcondition (Req 5.3):
 *   - caller is not an active Dietitian        -> redirect("/unauthorized")
 *   - `base` given and the Dietitian's role
 *     belongs to the other portal             -> redirect("/unauthorized")
 *   - otherwise                               -> the resolved DietitianContext
 *
 * `base` is optional so a portal-neutral page can call `guardDietitianPage()`;
 * a portal page passes its own base to pin the role↔portal pairing.
 */
export async function guardDietitianPage(
  base?: PortalBase,
): Promise<DietitianContext> {
  const ctx = await getCurrentDietitianContext();
  if (!ctx) redirect("/unauthorized");
  if (base !== undefined && DIETITIAN_ROLE_PORTAL[ctx.roleCode] !== base) {
    redirect("/unauthorized");
  }
  return ctx;
}

/**
 * Result-style guard every Dietitian action funnels through before touching a
 * Customer_Record. It is the single choke point for Req 5.8 (write access is
 * limited to the readable scope), Req 5.9 (the pinned scope-miss message),
 * Req 5.10 and Req 16.5 (a Dietitian may never write customer-owned data —
 * callers only ever gain a Health_Log write right from an `ok: true`).
 *
 * The customer row is read through the SSR client, so RLS applies first: a row
 * hidden by the policies simply is not returned. The application predicate
 * `dietitianCanRead` is then applied to the row, which makes the decision the
 * intersection of both gates — if either says no, the answer is no (Req 5.7).
 *
 * Postcondition:
 *   - caller is not an active Dietitian -> { ok: false, error: <no permission> }
 *   - id is not a uuid / row unreadable -> { ok: false, error: CUSTOMER_NOT_IN_SCOPE }
 *   - row outside the readable scope    -> { ok: false, error: CUSTOMER_NOT_IN_SCOPE }
 *   - otherwise                         -> { ok: true, ctx }
 */
export async function checkDietitianScope(
  customerProfileId: string,
): Promise<
  { ok: true; ctx: DietitianContext } | { ok: false; error: string }
> {
  const ctx = await getCurrentDietitianContext();
  if (!ctx) {
    return {
      ok: false,
      error: "You do not have permission to perform this action.",
    };
  }

  // A malformed id can never name a readable row; deny without a round trip and
  // without disclosing that the id is invalid rather than out of scope.
  if (typeof customerProfileId !== "string" || !UUID_TEXT.test(customerProfileId)) {
    return { ok: false, error: CUSTOMER_NOT_IN_SCOPE };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data } = await supabase
    .from("customer_profiles")
    .select("id, clinic_id, franchise_id, dietitian_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  // Not found, or hidden by RLS: indistinguishable on purpose (no existence
  // disclosure), and in both cases out of scope.
  if (!data) return { ok: false, error: CUSTOMER_NOT_IN_SCOPE };

  const inScope = dietitianCanRead(dietitianScopeFromContext(ctx), {
    clinic_id: (data.clinic_id as string | null) ?? null,
    franchise_id: (data.franchise_id as string | null) ?? null,
    dietitian_id: (data.dietitian_id as string | null) ?? null,
  });

  if (!inScope) return { ok: false, error: CUSTOMER_NOT_IN_SCOPE };
  return { ok: true, ctx };
}

/**
 * Throw-style twin of {@link checkDietitianScope} for call sites that prefer an
 * exception (services composing several guards). Throws `DietitianScopeError`
 * carrying the same message the result form returns.
 */
export async function assertDietitianScope(
  customerProfileId: string,
): Promise<DietitianContext> {
  const gate = await checkDietitianScope(customerProfileId);
  if (!gate.ok) throw new DietitianScopeError(gate.error);
  return gate.ctx;
}
