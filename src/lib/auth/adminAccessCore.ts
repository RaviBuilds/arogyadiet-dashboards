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

/** The three admin access levels (sub-classification of the ADMIN role). */
export const ADMIN_ACCESS_LEVELS = [
  "inventory",
  "operations",
  "inventory_operations",
] as const;

export type AdminAccessLevel = (typeof ADMIN_ACCESS_LEVELS)[number];

/** Capability area an admin route belongs to. */
export type AccessArea = "operations" | "inventory";

/** Human-readable labels (used in UI + notification copy). */
export const ACCESS_LEVEL_LABELS: Record<AdminAccessLevel, string> = {
  inventory: "Inventory only",
  operations: "Operations only",
  inventory_operations: "Inventory + Operations (Full Access)",
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
 */
export function canAccess(level: AdminAccessLevel, area: AccessArea): boolean {
  switch (level) {
    case "inventory":
      return area === "inventory";
    case "operations":
      return area === "operations";
    case "inventory_operations":
      return true;
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
 * The landing/home route for an access level.
 *
 * Postcondition (case-sensitive):
 *   - inventory             -> "/inventory"
 *   - operations            -> "/dashboard"
 *   - inventory_operations  -> "/dashboard"
 */
export function landingRouteFor(
  level: AdminAccessLevel,
): "/dashboard" | "/inventory" {
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
 *   - groups === {} for `inventory` / `inventory_operations`
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
  return false; // inventory
}

/** Does the configuration grant manage (write) access to the group (Req 5)? */
export function canManageGroup(
  config: AccessConfiguration,
  group: OperationsGroup,
): boolean {
  if (config.level === "inventory_operations") return true;
  if (config.level === "operations") return config.groups[group] === "manage";
  return false; // inventory
}

/**
 * Configuration-aware path gate. Accepts EITHER a legacy `AdminAccessLevel`
 * (coarse inventory-vs-operations area gate, preserved for existing callers)
 * OR an `AccessConfiguration` (group-aware gate).
 *
 * Config-aware postcondition (Req 2.3, 3, 6, 8):
 *   - neutral path                         -> true
 *   - inventory-area path                  -> level grants inventory
 *   - operations group page                -> hasGroupAccess(config, group)
 *   - operations-area non-group (dashboard)-> level is operations or full
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

  const config = levelOrConfig;
  const area = classifyAdminPath(pathname);
  if (area === null) return true; // neutral (profile, unclassified)
  if (area === "inventory") {
    return config.level === "inventory" || config.level === "inventory_operations";
  }
  // Operations area: gate by specific group when the path maps to one;
  // otherwise it is an operations-neutral page (e.g. /admin/dashboard).
  const group = classifyOperationsGroup(pathname);
  if (group !== null) return hasGroupAccess(config, group);
  return config.level === "operations" || config.level === "inventory_operations";
}
