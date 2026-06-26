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
 */
export function isAdminPathAllowed(
  level: AdminAccessLevel,
  pathname: unknown,
): boolean {
  const area = classifyAdminPath(pathname);
  if (area === null) return true;
  return canAccess(level, area);
}

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
