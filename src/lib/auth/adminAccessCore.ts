// src/lib/auth/adminAccessCore.ts
//
// Pure, environment-agnostic admin access-level utilities. This module has NO
// server-only / next/headers dependency so it is safe to import from the edge
// middleware bundle, server components, and unit tests alike.
//
// The server-only context resolver + guards live in `adminAccess.ts`, which
// re-exports everything here so callers can keep importing from a single entry
// point where convenient.

// ─── Access levels & areas ──────────────────────────────────────────────────

/**
 * The admin access levels (sub-classification of the ADMIN role).
 *
 * `dietitian` (Req 1.1) is an ALLOW-LIST level: it grants no capability area and
 * no operations group, and is instead gated by DIETITIAN_ALLOWED_PREFIXES.
 */
export const ADMIN_ACCESS_LEVELS = [
  "inventory",
  "operations",
  "inventory_operations",
  "dietitian",
] as const;

export type AdminAccessLevel = (typeof ADMIN_ACCESS_LEVELS)[number];

/** The Dietitian access level, as a narrow literal for call sites. */
export const DIETITIAN_ACCESS_LEVEL = "dietitian" as const;

/** Capability area an admin route belongs to. */
export type AccessArea = "operations" | "inventory";

/** Human-readable labels (used in UI + notification copy). */
export const ACCESS_LEVEL_LABELS: Record<AdminAccessLevel, string> = {
  inventory: "Inventory only",
  operations: "Operations only",
  inventory_operations: "Inventory + Operations (Full Access)",
  dietitian: "Dietitian",
};

/** Backward-compatible default applied to NULL / unknown values. */
export const DEFAULT_ACCESS_LEVEL: AdminAccessLevel = "inventory_operations";

// ─── Resolution & permission (pure) ──────────────────────────────────────────

/**
 * Normalize a raw DB value into a concrete access level.
 * Backward compatibility: NULL / unknown / non-string => full access.
 *
 * Precondition:  raw is the users.admin_access_level value (any/unknown).
 * Postcondition: returns a valid AdminAccessLevel; never throws.
 *   - raw ∈ ADMIN_ACCESS_LEVELS            => raw (unchanged, case-sensitive)
 *   - raw === null | undefined | invalid   => DEFAULT_ACCESS_LEVEL
 *   - raw of any non-string type           => DEFAULT_ACCESS_LEVEL
 */
export function resolveAccessLevel(raw: unknown): AdminAccessLevel {
  return typeof raw === "string" &&
    (ADMIN_ACCESS_LEVELS as readonly string[]).includes(raw)
    ? (raw as AdminAccessLevel)
    : DEFAULT_ACCESS_LEVEL;
}

/**
 * Does the given level grant access to the given area?
 * Total over the AdminAccessLevel enum — always returns a boolean.
 *
 * Postcondition (truth table):
 *   inventory             -> inventory:true,  operations:false
 *   operations            -> inventory:false, operations:true
 *   inventory_operations  -> inventory:true,  operations:true
 *   dietitian             -> inventory:false, operations:false  (Req 26.5, 26.6)
 */
export function canAccess(level: AdminAccessLevel, area: AccessArea): boolean {
  switch (level) {
    case "inventory":
      return area === "inventory";
    case "operations":
      return area === "operations";
    case "inventory_operations":
      return true;
    case "dietitian":
      // Grants no capability area; reachability is decided by the allow-list.
      return false;
    default:
      // Unreachable for valid AdminAccessLevel; deny by default.
      return false;
  }
}

// ─── Path classification & gate (pure) ────────────────────────────────────────

/**
 * Path prefixes (relative to the rewritten /admin base) that are INVENTORY area.
 */
const INVENTORY_PREFIXES = ["/admin/inventory"] as const;

/**
 * Operations route prefixes. /admin/dashboard is classified as OPERATIONS
 * (it shows operations KPIs), so inventory-only admins are redirected away
 * from it to their own landing route (/inventory).
 */
const OPERATIONS_PREFIXES = [
  "/admin/dashboard",
  "/admin/customers",
  "/admin/subscriptions",
  "/admin/riders",
  "/admin/operations",
  "/admin/kitchen-shop",
  "/admin/franchises",
] as const;

/**
 * Match a prefix at a path-segment boundary (case-sensitive): the prefix must
 * be immediately followed by either the end of the path or a `/`.
 */
function matchesPrefixAtBoundary(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Length of the longest matching prefix in `prefixes`, or -1 if none match. */
function longestMatch(pathname: string, prefixes: readonly string[]): number {
  let best = -1;
  for (const prefix of prefixes) {
    if (matchesPrefixAtBoundary(pathname, prefix) && prefix.length > best) {
      best = prefix.length;
    }
  }
  return best;
}

/**
 * Classify a rewritten admin pathname into an AccessArea, or null if it is a
 * shared/neutral path (e.g. /admin/profile, /admin/login) loadable by every
 * admin.
 *
 * Rules:
 *   - case-sensitive, path-segment boundary matching
 *   - longest matching prefix wins; inventory wins ties
 *   - empty / null / non-string / non-absolute paths => neutral (null)
 */
export function classifyAdminPath(pathname: unknown): AccessArea | null {
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    !pathname.startsWith("/")
  ) {
    return null;
  }

  const inventoryLen = longestMatch(pathname, INVENTORY_PREFIXES);
  const operationsLen = longestMatch(pathname, OPERATIONS_PREFIXES);

  if (inventoryLen === -1 && operationsLen === -1) return null;
  // Tie (or inventory-only match) resolves to inventory.
  return inventoryLen >= operationsLen ? "inventory" : "operations";
}

/**
 * Decide whether a request to `pathname` is permitted for `level`.
 *
 * Postcondition:
 *   - neutral path                -> true
 *   - area path & canAccess       -> true
 *   - area path & !canAccess      -> false
 *
 * NOTE: the implementation lives below as an overload that also accepts an
 * AccessConfiguration (group-aware gate). The level-only form is preserved.
 */

/**
 * Path prefixes (relative to the canonical /admin base) a Dietitian may reach
 * (Req 5.4). The Report_Card lives at /admin/customers/[id]/report-card, so it
 * is covered by the customers prefix.
 */
export const DIETITIAN_ALLOWED_PREFIXES = [
  "/admin/customers",
  "/admin/log-customer",
  "/admin/profile",
] as const;

/**
 * Is this level (or configuration) the Dietitian allow-list level?
 * Total: never throws, returns false for anything else.
 */
export function isDietitianLevel(
  levelOrConfig: AdminAccessLevel | AccessConfiguration,
): boolean {
  if (typeof levelOrConfig === "string") {
    return levelOrConfig === DIETITIAN_ACCESS_LEVEL;
  }
  return (
    levelOrConfig !== null &&
    typeof levelOrConfig === "object" &&
    levelOrConfig.level === DIETITIAN_ACCESS_LEVEL
  );
}

/**
 * Is the (already canonicalised, /admin-based) path inside the Dietitian
 * allow-list? Case-sensitive, path-segment boundary matching — the same matcher
 * the area/group classifiers use.
 *
 * Postcondition: non-string / empty / non-absolute input => false (deny), since
 * a Dietitian's reachability is an allow-list rather than a deny-list.
 */
function isDietitianCanonicalPathAllowed(pathname: unknown): boolean {
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    !pathname.startsWith("/")
  ) {
    return false;
  }
  return DIETITIAN_ALLOWED_PREFIXES.some((prefix) =>
    matchesPrefixAtBoundary(pathname, prefix),
  );
}

/**
 * The landing/home route for an access level.
 *
 * Postcondition (case-sensitive):
 *   - inventory             -> "/inventory"
 *   - operations            -> "/dashboard"
 *   - inventory_operations  -> "/dashboard"
 *   - dietitian             -> "/customers"
 */
export function landingRouteFor(
  level: AdminAccessLevel,
): "/dashboard" | "/inventory" | "/customers" {
  if (level === DIETITIAN_ACCESS_LEVEL) return "/customers";
  return level === "inventory" ? "/inventory" : "/dashboard";
}

// ─── Operations groups, permissions & configuration (admin-access-control) ────
//
// The richer per-group model layered on top of the `operations` level. These
// primitives are ROLE-NEUTRAL: they operate purely on an AccessConfiguration
// and a path, with no assumption about the caller's role, so the same logic can
// later govern FRANCHISE_ADMIN without rework (Req 13.1, 13.4).

/** The six configurable operations capability groups (Req 4.1, 6.1). */
export const OPERATIONS_GROUPS = [
  "customers",
  "subscriptions",
  "riders",
  "operations",
  "franchises",
  "shop_products",
] as const;

export type OperationsGroup = (typeof OPERATIONS_GROUPS)[number];

/** Per-group permission: manage (read + write) or view (read-only). */
export const PERMISSION_LEVELS = ["manage", "view"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Per-group permissions; non-empty only for the `operations` level. */
export type OperationsAccess = Partial<Record<OperationsGroup, PermissionLevel>>;

/** A fully-resolved, always-valid access configuration for one admin. */
export interface AccessConfiguration {
  level: AdminAccessLevel;
  /** Empty object for `inventory` / `inventory_operations`. */
  groups: OperationsAccess;
}

/** Group → rewritten admin route prefix (Req 6.1). */
export const GROUP_ROUTE_PREFIX: Record<OperationsGroup, string> = {
  customers: "/admin/customers",
  subscriptions: "/admin/subscriptions",
  riders: "/admin/riders",
  operations: "/admin/operations",
  franchises: "/admin/franchises",
  shop_products: "/admin/kitchen-shop",
};

/** Human-readable group labels (master UI). */
export const GROUP_LABELS: Record<OperationsGroup, string> = {
  customers: "Customers",
  subscriptions: "Subscriptions",
  riders: "Riders",
  operations: "Operations",
  franchises: "Franchises",
  shop_products: "Shop Products",
};

// Membership test helpers (type guards) over the readonly tuples.
function isOperationsGroup(value: unknown): value is OperationsGroup {
  return (
    typeof value === "string" &&
    (OPERATIONS_GROUPS as readonly string[]).includes(value)
  );
}

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return (
    typeof value === "string" &&
    (PERMISSION_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Normalize raw DB values into an always-valid AccessConfiguration. Never
 * throws (Req 10.1, 10.3, 10.4).
 *
 * Postcondition:
 *   - level ∈ ADMIN_ACCESS_LEVELS (unknown/non-string => DEFAULT_ACCESS_LEVEL)
 *   - groups is populated ONLY when level === "operations"; each kept entry has
 *     key ∈ OPERATIONS_GROUPS and value ∈ PERMISSION_LEVELS (malformed dropped)
 *   - groups === {} for `inventory` / `inventory_operations` / `dietitian`
 *     (Req 1.5)
 *   - a string `rawGroups` is parsed as JSON; parse failure => {}
 */
export function resolveAccessConfiguration(
  rawLevel: unknown,
  rawGroups: unknown,
): AccessConfiguration {
  const level = resolveAccessLevel(rawLevel);
  if (level !== "operations") {
    return { level, groups: {} };
  }

  // Accept either a pre-parsed object (Supabase JSONB) or a JSON string.
  let source: unknown = rawGroups;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  const groups: OperationsAccess = {};
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (isOperationsGroup(key) && isPermissionLevel(value)) {
        groups[key] = value;
      }
    }
  }

  return { level, groups };
}

/** Result of strictly validating a submitted operations-access map. */
export type OperationsAccessValidation =
  | { ok: true; value: OperationsAccess }
  | { ok: false; error: string };

/**
 * Strictly validate a submitted operations-access map for persistence (Req 4.3,
 * 5.6). Unlike `resolveAccessConfiguration` (which leniently drops malformed
 * data when reading), this REJECTS an empty selection, unknown groups, and
 * invalid permissions so the master form cannot save a bad configuration.
 */
export function validateOperationsAccessInput(
  raw: unknown,
): OperationsAccessValidation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Select at least one operations group" };
  }
  const value: OperationsAccess = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!isOperationsGroup(key)) {
      return { ok: false, error: `Unknown operations group: ${key}` };
    }
    if (!isPermissionLevel(val)) {
      return { ok: false, error: `Invalid permission for ${key}` };
    }
    value[key] = val;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "Select at least one operations group" };
  }
  return { ok: true, value };
}

/**
 * Classify a rewritten admin pathname into an OperationsGroup, or null when the
 * path is not a group page. Case-sensitive, path-segment boundary matching,
 * longest-prefix wins (Req 6.4, 8.5).
 */
export function classifyOperationsGroup(pathname: unknown): OperationsGroup | null {
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    !pathname.startsWith("/")
  ) {
    return null;
  }

  let best: OperationsGroup | null = null;
  let bestLen = -1;
  for (const group of OPERATIONS_GROUPS) {
    const prefix = GROUP_ROUTE_PREFIX[group];
    if (matchesPrefixAtBoundary(pathname, prefix) && prefix.length > bestLen) {
      best = group;
      bestLen = prefix.length;
    }
  }
  return best;
}

/** Does the configuration grant any (read) access to the group (Req 5)? */
export function hasGroupAccess(
  config: AccessConfiguration,
  group: OperationsGroup,
): boolean {
  if (config.level === "inventory_operations") return true;
  if (config.level === "operations") return config.groups[group] !== undefined;
  return false; // inventory / dietitian
}

/** Does the configuration grant manage (write) access to the group (Req 5)? */
export function canManageGroup(
  config: AccessConfiguration,
  group: OperationsGroup,
): boolean {
  if (config.level === "inventory_operations") return true;
  if (config.level === "operations") return config.groups[group] === "manage";
  return false; // inventory / dietitian
}

// ─── Portal-neutral path gate ────────────────────────────────────────────────

/** The portal bases the same Access_Level gate governs (Req 21.5). */
export type PortalBase = "/admin" | "/franchise";

/**
 * Normalise a portal pathname onto the canonical `/admin` base so a single set
 * of area / group / allow-list tables serves both portals.
 *
 * Postcondition:
 *   - base "/admin"                      -> pathname unchanged (identity)
 *   - "/franchise"                       -> "/admin"
 *   - "/franchise/customers/1"           -> "/admin/customers/1"
 *   - a path not under `base`            -> pathname unchanged
 *
 * The identity on "/admin" is what keeps `isAdminPathAllowed` byte-identical for
 * every pre-existing caller and level (Req 26.5, 26.6).
 */
export function toCanonicalPath(
  pathname: string,
  base: PortalBase = "/admin",
): string {
  if (base === "/admin") return pathname;
  if (pathname === base) return "/admin";
  if (pathname.startsWith(base + "/")) {
    return "/admin" + pathname.slice(base.length);
  }
  return pathname;
}

/**
 * Portal-aware, configuration-aware path gate.
 *
 * Postcondition (Req 2.3, 3, 6, 8, 5.4, 21.5):
 *   - dietitian level                      -> canonical path is in
 *                                             DIETITIAN_ALLOWED_PREFIXES
 *                                             (everything else denied)
 *   - neutral path                         -> true
 *   - inventory-area path                  -> level grants inventory
 *   - operations group page                -> hasGroupAccess(config, group)
 *   - operations-area non-group (dashboard)-> level is operations or full
 */
export function isPortalPathAllowed(
  config: AccessConfiguration,
  pathname: unknown,
  base: PortalBase = "/admin",
): boolean {
  const canonical: unknown =
    typeof pathname === "string" ? toCanonicalPath(pathname, base) : pathname;

  // Dietitian short-circuits before any area / group classification.
  if (isDietitianLevel(config)) {
    return isDietitianCanonicalPathAllowed(canonical);
  }

  const area = classifyAdminPath(canonical);
  if (area === null) return true; // neutral (profile, unclassified)
  if (area === "inventory") {
    return config.level === "inventory" || config.level === "inventory_operations";
  }
  // Operations area: gate by specific group when the path maps to one;
  // otherwise it is an operations-neutral page (e.g. /admin/dashboard).
  const group = classifyOperationsGroup(canonical);
  if (group !== null) return hasGroupAccess(config, group);
  return config.level === "operations" || config.level === "inventory_operations";
}

/**
 * Admin-portal path gate. Accepts EITHER a legacy `AdminAccessLevel` (coarse
 * inventory-vs-operations area gate, preserved verbatim for existing callers)
 * OR an `AccessConfiguration`, in which case it is a thin `/admin` wrapper over
 * `isPortalPathAllowed`.
 */
export function isAdminPathAllowed(
  levelOrConfig: AdminAccessLevel | AccessConfiguration,
  pathname: unknown,
): boolean {
  // Legacy overload: bare level string uses the coarse area gate unchanged.
  if (typeof levelOrConfig === "string") {
    const area = classifyAdminPath(pathname);
    if (area === null) return true;
    return canAccess(levelOrConfig, area);
  }

  return isPortalPathAllowed(levelOrConfig, pathname, "/admin");
}

// ─── Clinic scoping (clinic-scoped-shop-inventory) ────────────────────────────
//
// A Clinic_Scoped_Admin is an `operations`-level admin whose Clinic_Scope_
// Assignment (`users.admin_clinic_id`) is set (Req 13 glossary). Clinic scoping
// confines Shop Products / Clinic_Shop_Ledger reads to that one Core Clinic;
// every other Operations_Group (customers, subscriptions, riders) stays
// unfiltered (Req 14.1-14.3, 14.9). These primitives are pure and have no
// database access — the Core-Clinic-only check (Req 13.12) is resolved by the
// caller (a single DB query) and passed in as a pre-resolved boolean.

/**
 * The four Operations_Groups offered to a Clinic_Scoped_Admin (Req 13.7, 13.8).
 * `operations` and `franchises` are deliberately excluded — Req 13.13 rejects a
 * write that pairs either with a Clinic_Scope_Assignment.
 */
export const CLINIC_SCOPED_GROUPS = [
  "customers",
  "subscriptions",
  "riders",
  "shop_products",
] as const satisfies readonly OperationsGroup[];

export type ClinicScopedGroup = (typeof CLINIC_SCOPED_GROUPS)[number];

/**
 * Is this admin a Clinic_Scoped_Admin?
 *
 * Precondition:  `clinicId` is the admin's Clinic_Scope_Assignment
 *                (`users.admin_clinic_id`), read alongside `cfg`.
 * Postcondition: total, never throws.
 *   - cfg.level === "operations" && clinicId !== null  -> true
 *   - otherwise                                         -> false
 */
export function isClinicScoped(
  cfg: AccessConfiguration,
  clinicId: string | null,
): boolean {
  return cfg.level === "operations" && clinicId !== null;
}

/** A submitted clinic-level-access configuration (Requirement 13). */
export interface ClinicScopeAssignmentCandidate {
  level: AdminAccessLevel;
  /** The User_Management_Form's Clinic_Access_Checkbox state. */
  clinicAccess: boolean;
  /** The selected Core Clinic, or `null` when the checkbox is unchecked. */
  clinicId: string | null;
  groups: OperationsAccess;
  /**
   * Whether `clinicId` (when non-null) resolves to an existing Clinic row
   * whose `franchise_id` is `NULL`. This module has no database access, so the
   * caller resolves this with one query before calling `validateClinicScope
   * Assignment`; the value is ignored when `clinicId` is `null` (Req 13.12).
   */
  isCoreClinic: boolean | null;
}

/** Result of validating a submitted clinic-level-access configuration. */
export type ClinicScopeAssignmentValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a submitted clinic-level-access configuration (Req 13.11-13.14).
 * Total: never throws, always returns a result.
 *
 * Precondition:  `input` reflects one User_Management_Form submission, with
 *                `isCoreClinic` pre-resolved by the caller for a non-null
 *                `clinicId`.
 * Postcondition (checked in this order):
 *   - clinicAccess && clinicId === null             -> reject (13.11)
 *   - clinicId !== null && level !== "operations"    -> reject (13.14)
 *   - clinicId !== null && isCoreClinic === false     -> reject (13.12)
 *   - clinicId !== null && groups holds "operations"
 *     or "franchises"                                 -> reject (13.13)
 *   - otherwise                                        -> ok
 */
export function validateClinicScopeAssignment(
  input: ClinicScopeAssignmentCandidate,
): ClinicScopeAssignmentValidation {
  const { level, clinicAccess, clinicId, groups, isCoreClinic } = input;

  if (clinicAccess && clinicId === null) {
    return {
      ok: false,
      error: "A clinic must be selected for clinic level access",
    };
  }

  if (clinicId !== null) {
    if (level !== "operations") {
      return {
        ok: false,
        error: "Clinic level access requires the operations access level",
      };
    }
    if (isCoreClinic === false) {
      return {
        ok: false,
        error: "The selected clinic is unavailable for clinic level access",
      };
    }
    if (groups.operations !== undefined || groups.franchises !== undefined) {
      return {
        ok: false,
        error:
          "The operations and franchises groups are unavailable for clinic level access",
      };
    }
  }

  return { ok: true };
}

/** Result of resolving which Core Clinic a caller's read is confined to. */
export type ReadableClinicIdResolution =
  | { ok: true; clinicId: string | null }
  | { ok: false; error: string };

/**
 * Resolve which Core Clinic a caller's Shop Products / ledger read is confined
 * to, given the caller's Clinic_Scope_Assignment (`assigned`) and the Core
 * Clinic named by the request (`requested`), if any. The single chokepoint for
 * Req 12.9, 14.4, 14.6, 14.7.
 *
 * Precondition:  `assigned` is `null` for an Unscoped_Operations_Admin and the
 *                assigned Core Clinic id for a Clinic_Scoped_Admin; `requested`
 *                is the Core Clinic id named by the request, or `null` when
 *                none was named.
 * Postcondition: total, never throws.
 *   - assigned === null                                -> ok, clinicId = requested
 *     (`null` means "no filter"; only reachable for an unscoped admin)
 *   - assigned !== null && (requested === null
 *       || requested === assigned)                      -> ok, clinicId = assigned
 *   - assigned !== null && requested !== assigned        -> reject (out of scope)
 */
export function resolveReadableClinicId(
  assigned: string | null,
  requested: string | null,
): ReadableClinicIdResolution {
  if (assigned === null) {
    return { ok: true, clinicId: requested };
  }
  if (requested === null || requested === assigned) {
    return { ok: true, clinicId: assigned };
  }
  return {
    ok: false,
    error: "The clinic is outside the admin's assigned scope",
  };
}
