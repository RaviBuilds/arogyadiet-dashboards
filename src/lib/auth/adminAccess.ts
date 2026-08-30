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
  resolveReadableClinicId,
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
  /** The admin's Clinic_Scope_Assignment (`users.admin_clinic_id`); `null` for an unscoped admin. */
  clinicId: string | null;
}

/**
 * Resolve the signed-in user's role + access configuration via the Supabase SSR
 * client.
 *
 * Precondition:  called within a request scope where the SSR client can read
 *                the session (server component / server action / route handler).
 * Postcondition: config is always valid (NULL level coerced to full, malformed
 *                groups dropped); accessLevel mirrors config.level for back-compat;
 *                userId / roleCode / clinicId are null when no session can be
 *                resolved.
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
      clinicId: null,
    };
  }

  // Columns that must always resolve. `admin_clinic_id` is requested on top of
  // these, but is treated as OPTIONAL: it is introduced by
  // `scripts/add-admin-clinic-id-to-users.sql`, and while that migration is
  // unapplied PostgREST rejects the ENTIRE select with 42703 (undefined
  // column). That used to null out `roleCode`, so every guard built on this
  // context (`guardAdminGroup`, `guardAdminPage`, `guardDietitianPage`, the
  // inventory layout) redirected a perfectly valid ADMIN to /unauthorized.
  // Schema drift must degrade to "unscoped admin", never to "no permission".
  const REQUIRED_COLUMNS =
    "id, admin_access_level, admin_operations_access, roles(code)";

  const selectProfile = async (columns: string) =>
    (await supabase
      .from("users")
      .select(columns)
      .eq("auth_user_id", user.id)
      .single()) as unknown as {
      data: {
        id?: string | null;
        admin_access_level?: unknown;
        admin_operations_access?: unknown;
        admin_clinic_id?: string | null;
        roles?: { code: string }[] | { code: string } | null;
      } | null;
      error: { code?: string; message?: string } | null;
    };

  let { data, error } = await selectProfile(
    `${REQUIRED_COLUMNS}, admin_clinic_id`,
  );

  if (error?.code === "42703") {
    console.error(
      "[adminAccess] users.admin_clinic_id is missing — apply scripts/add-admin-clinic-id-to-users.sql. Resolving this admin as unscoped.",
    );
    ({ data, error } = await selectProfile(REQUIRED_COLUMNS));
  }

  if (error) {
    // Still surface anything else that went wrong (RLS, expired JWT, no row):
    // the caller will deny access, and a silent denial is impossible to debug.
    console.error(
      "[adminAccess] failed to resolve admin profile:",
      error.message ?? error,
    );
  }

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
    clinicId: (data?.admin_clinic_id as string | null) ?? null,
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
 * Returns `{ config, isDietitian, clinicId }` so the caller (the customers
 * pages) can thread `isDietitian` down to `CustomerDashboard`/
 * `Customer360Dashboard` to drive the read-only rendering (Req 16.1), and
 * `clinicId` (the admin's Clinic_Scope_Assignment) to confine the workspace's
 * own reads and lock its business-unit / clinic selectors to a single Core
 * Clinic, all without a second context resolution.
 */
export async function guardCustomersWorkspace(): Promise<{
  config: AccessConfiguration;
  isDietitian: boolean;
  clinicId: string | null;
}> {
  const { roleCode, config, clinicId } = await getCurrentAdminContext();
  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    redirect("/unauthorized");
  }
  const isDietitian = isDietitianLevel(config);
  if (!isDietitian && !hasGroupAccess(config, "customers")) {
    redirect(landingRouteFor(config.level));
  }
  return { config, isDietitian, clinicId };
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
  const ctx = await resolveFranchiseAccessContext();
  if (!ctx) redirect("/unauthorized");

  if (!hasGroupAccess(ctx.config, group)) {
    redirect(landingRouteFor(ctx.config.level));
  }

  return { config: ctx.config, franchiseId: ctx.franchiseId };
}

/**
 * The request-scoped identity of a signed-in Franchise_Portal user, with the
 * Franchise_Owner override already applied.
 */
export interface FranchiseAccessContext {
  /** `public.users.id`. */
  userId: string;
  franchiseId: string;
  /** Resolved configuration; forced to full access for the Franchise_Owner. */
  config: AccessConfiguration;
  /** `franchises.owner_user_id === users.id` (Req 21.6). */
  isOwner: boolean;
}

/**
 * Resolve the caller as a Franchise_Portal user, applying every eligibility
 * rule the Franchise_Portal layout applies (franchise-scoped-access Task 3).
 *
 * Extracted so the redirect-style page guard and the result-style action gates
 * below cannot drift apart on WHO counts as a valid franchise caller — the same
 * class of divergence that let franchise customer writes fail while the layout
 * happily rendered the page.
 *
 * Postcondition: returns `null` (never throws, never redirects) when there is
 * no session, the caller's role is not `FRANCHISE_ADMIN`, the caller has no
 * `franchise_id`, or the Franchise is suspended. Otherwise returns the context
 * with the Franchise_Owner override applied.
 */
async function resolveFranchiseAccessContext(): Promise<FranchiseAccessContext | null> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

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

  if (roleCode !== "FRANCHISE_ADMIN") return null;

  const franchiseId = userProfileData?.franchise_id;
  if (!franchiseId) return null;

  const { data: franchise } = await supabase
    .from("franchises")
    .select("status, owner_user_id")
    .eq("id", franchiseId)
    .single();

  if (franchise?.status === "suspended") return null;

  const isOwner =
    typeof franchise?.owner_user_id === "string" &&
    franchise.owner_user_id === userProfileData?.id;

  const config: AccessConfiguration = isOwner
    ? { level: "inventory_operations", groups: {} }
    : resolveAccessConfiguration(
        userProfileData?.admin_access_level,
        userProfileData?.admin_operations_access,
      );

  return {
    userId: userProfileData?.id as string,
    franchiseId: franchiseId as string,
    config,
    isOwner,
  };
}

/**
 * Write guard for Franchise_Portal server actions — the franchise twin of
 * {@link assertGroupManage} (franchise-scoped-access Task 3).
 *
 * WHY A SEPARATE GATE RATHER THAN WIDENING `assertGroupManage`:
 * the admin gate's `roleCode !== "ADMIN"` rejection is load-bearing SECURITY,
 * not an oversight. `Customer360Dashboard` is shared and imports the admin
 * customer actions as fallbacks, so their server-action ids reach the franchise
 * client bundle and are directly invocable; those actions perform no franchise
 * ownership check, so that role rejection is the only thing preventing a
 * cross-tenant write. The franchise portal therefore gets its own gate over the
 * shared ungated cores instead (see `src/services/customerManagementCore.ts`).
 *
 * NOTE: this establishes PERMISSION only. Tenancy is a separate, independent
 * concern — callers must still verify the target row belongs to the caller's
 * Franchise (`guardProfile` / `guardAuthUser` / `guardEmail`).
 *
 * Throws `GroupAccessDeniedError`, with `readOnly` distinguishing "has view
 * access, attempted a write" from "no access to this group at all", so the
 * messages match the admin portal's exactly.
 */
export async function assertFranchiseGroupManage(
  group: OperationsGroup,
): Promise<FranchiseAccessContext> {
  const ctx = await resolveFranchiseAccessContext();
  // Not a valid franchise caller at all: indistinguishable from "no access".
  if (!ctx) throw new GroupAccessDeniedError(group, false);

  if (canManageGroup(ctx.config, group)) return ctx;

  throw new GroupAccessDeniedError(group, hasGroupAccess(ctx.config, group));
}

/**
 * Result-style twin of {@link assertFranchiseGroupManage} for franchise server
 * actions returning an `ActionResult`-shaped value. Returns the same two
 * user-facing messages the admin gate returns, so read-only feedback is
 * identical across portals.
 *
 * Usage:
 *   const gate = await checkFranchiseGroupManage("customers");
 *   if (!gate.ok) return { success: false, error: gate.error };
 */
export async function checkFranchiseGroupManage(
  group: OperationsGroup,
): Promise<
  { ok: true; ctx: FranchiseAccessContext } | { ok: false; error: string }
> {
  try {
    const ctx = await assertFranchiseGroupManage(group);
    return { ok: true, ctx };
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
 * READ gate for Franchise_Portal server actions scoped to the `customers`
 * group — the read-capable twin of {@link checkFranchiseGroupManage}.
 *
 * WHY A SEPARATE GATE RATHER THAN REUSING `checkFranchiseGroupManage`:
 * that one requires MANAGE, so a franchise user holding `customers: "view"` and
 * every Franchise Dietitian would be refused a plain READ. The Customer_360 KIT
 * tabs are mostly reads (KIT history, subscription history, eligibility, the KIT
 * product catalogue), and a view-only user is entitled to see them.
 *
 * WHY IT ADMITS DIETITIANS EXPLICITLY: `hasGroupAccess` returns `false` for the
 * `dietitian` level by design — a Dietitian holds no Operations_Group at all,
 * their reachability comes from DIETITIAN_ALLOWED_PREFIXES. Gating reads on
 * `hasGroupAccess` alone would therefore lock a Dietitian out of the very
 * customer records they are assigned to, which is the same trap
 * {@link guardFranchiseCustomersWorkspace} documents for the page guard.
 *
 * `isDietitian` is returned because tenancy is NOT sufficient for a Dietitian:
 * callers must additionally require the Dietitian_Link
 * (`customer_profiles.dietitian_id === ctx.userId`), matching
 * `dietitian_can_read_customer` and `scopeFranchiseCustomersForDietitian`.
 * Without that, one Dietitian could read a colleague's customer's history.
 *
 * NOTE: this establishes PERMISSION only. Tenancy remains the caller's job.
 */
export async function checkFranchiseCustomersRead(): Promise<
  | { ok: true; ctx: FranchiseAccessContext; isDietitian: boolean }
  | { ok: false; error: string }
> {
  const ctx = await resolveFranchiseAccessContext();
  if (!ctx) {
    return {
      ok: false,
      error: "You do not have permission to perform this action.",
    };
  }

  const isDietitian = isDietitianLevel(ctx.config);
  if (!isDietitian && !hasGroupAccess(ctx.config, "customers")) {
    return {
      ok: false,
      error: "You do not have permission to perform this action.",
    };
  }

  return { ok: true, ctx, isDietitian };
}

/**
 * Redirect-style page guard for the Franchise_Portal `customers` workspace —
 * the franchise twin of {@link guardCustomersWorkspace}
 * (franchise-scoped-access Task 5).
 *
 * WHY THIS IS NOT `guardFranchiseGroupAccess("customers")`:
 * `hasGroupAccess` returns `false` for the `dietitian` level by design (it
 * grants no Operations_Group; a Dietitian's reachability comes from
 * DIETITIAN_ALLOWED_PREFIXES instead). And `landingRouteFor("dietitian")` is
 * `"/customers"`. So gating this page with the plain group guard would redirect
 * a franchise Dietitian to the very page they were already requesting — an
 * INFINITE REDIRECT LOOP, not merely a lockout. This guard therefore admits the
 * Dietitian explicitly, exactly as the admin portal's workspace guard does.
 *
 * `guardFranchiseGroupAccess` keeps its dietitian-EXCLUDING behaviour untouched,
 * because the Dietitian Activity pages depend on it to keep Dietitians out.
 *
 * Returns everything the workspace needs from one context resolution:
 *   - `config`      the resolved configuration (Owner override applied)
 *   - `franchiseId` the tenant every read must be filtered by
 *   - `canManage`   drives read-only rendering; `false` for a Dietitian and for
 *                   any user holding `customers: "view"`
 *   - `isDietitian` selects the Dietitian read-only workspace
 *   - `userId`      `public.users.id`, used to resolve the Dietitian's own scope
 */
export async function guardFranchiseCustomersWorkspace(): Promise<{
  config: AccessConfiguration;
  franchiseId: string;
  canManage: boolean;
  isDietitian: boolean;
  userId: string;
}> {
  const ctx = await resolveFranchiseAccessContext();
  if (!ctx) redirect("/unauthorized");

  const isDietitian = isDietitianLevel(ctx.config);
  if (!isDietitian && !hasGroupAccess(ctx.config, "customers")) {
    redirect(landingRouteFor(ctx.config.level));
  }

  return {
    config: ctx.config,
    franchiseId: ctx.franchiseId,
    // A Dietitian never gains write access from this guard: `canManageGroup`
    // is false for the dietitian level, so the workspace renders read-only.
    canManage: canManageGroup(ctx.config, "customers"),
    isDietitian,
    userId: ctx.userId,
  };
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
// ─── Clinic scope guards (clinic-scoped-shop-inventory) ──────────────────────
//
// A Clinic_Scoped_Admin's Shop Products / Clinic_Shop_Ledger reads are confined
// to their Clinic_Scope_Assignment (`AdminContext.clinicId`); every other
// Operations_Group (customers, subscriptions, riders) stays unfiltered (Req
// 14.1-14.3, 14.9 — enforced simply by those pages never calling this guard).
// `resolveReadableClinicId` (adminAccessCore) is the single chokepoint for the
// scope decision itself; the guards below just resolve the caller's context and
// delegate to it, mirroring the assert/check pairing used for warehouse access.

/** Thrown by `assertClinicScope` when the requested clinic is out of scope. */
export class ClinicScopeDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClinicScopeDeniedError";
  }
}

/**
 * Throw-style guard for Shop Products / Clinic_Shop_Ledger reads. Resolves the
 * current admin's Clinic_Scope_Assignment and reconciles it against
 * `requestedClinicId` via `resolveReadableClinicId` (Req 14.6, 14.7).
 *
 * Postcondition: returns the clinic id the read is confined to when permitted
 *                (`null` means "no filter", only reachable for an unscoped
 *                admin); otherwise throws `ClinicScopeDeniedError` carrying the
 *                rejection message.
 */
export async function assertClinicScope(
  requestedClinicId: string | null,
): Promise<string | null> {
  const { clinicId } = await getCurrentAdminContext();
  const resolution = resolveReadableClinicId(clinicId, requestedClinicId);
  if (!resolution.ok) throw new ClinicScopeDeniedError(resolution.error);
  return resolution.clinicId;
}

/**
 * Result-style twin of {@link assertClinicScope} for server actions that
 * return an `ActionResult`-shaped value (Req 14.6, 14.7, 16.5). Returns
 * `{ ok: true, clinicId }` with the clinic the read is confined to, otherwise
 * `{ ok: false, error }` with the rejection message.
 *
 * Usage:
 *   const gate = await checkClinicScope(requestedClinicId);
 *   if (!gate.ok) return { success: false, error: gate.error };
 */
export async function checkClinicScope(
  requestedClinicId: string | null,
): Promise<
  { ok: true; clinicId: string | null } | { ok: false; error: string }
> {
  try {
    const clinicId = await assertClinicScope(requestedClinicId);
    return { ok: true, clinicId };
  } catch (err) {
    if (err instanceof ClinicScopeDeniedError) {
      return { ok: false, error: err.message };
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
