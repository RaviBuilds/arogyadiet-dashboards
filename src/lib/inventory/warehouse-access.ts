// src/lib/inventory/warehouse-access.ts
//
// Pure, environment-agnostic warehouse access helpers. NO I/O, no server-only
// marker, no async — safe to import from edge middleware, server components,
// server actions, and unit/property tests alike.
//
// These functions encapsulate the authorization, portal-resolution, and
// revalidation-target logic so that the warehouse actions and UI can share a
// single source of truth without coupling to request-scoped I/O.

import { canAccess, type AdminAccessLevel } from "@/lib/auth/adminAccessCore";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The two capability tiers for warehouse authorization:
 * - `product_management` — register / edit / delete product (MASTER_ADMIN only)
 * - `inventory_operations` — receive/dispatch/bulk/manufacturing/mappings/read
 */
export type WarehouseCapability = "inventory_operations" | "product_management";

/** The portal that initiated a warehouse action, resolved from the Host header. */
export type PortalContext = "admin" | "master" | "unknown";

/** The logical warehouse areas whose route families may need revalidation. */
export type WarehouseArea = "catalog" | "manufacturing" | "mappings";

// ─── Authorization ────────────────────────────────────────────────────────────

/**
 * Pure authorization decision. Returns `true` when the caller is permitted to
 * perform the requested capability, `false` otherwise.
 *
 * Rules:
 * - `product_management`  → authorized for `MASTER_ADMIN` only
 * - `inventory_operations` → authorized for `MASTER_ADMIN`, or for `ADMIN`
 *   when `canAccess(accessLevel, "inventory")` is true
 *
 * Any other role (including null) is denied for both capabilities.
 */
export function resolveWarehouseAuthorization(
  roleCode: string | null,
  accessLevel: AdminAccessLevel,
  capability: WarehouseCapability,
): boolean {
  if (capability === "product_management") {
    return roleCode === "MASTER_ADMIN";
  }

  // inventory_operations
  if (roleCode === "MASTER_ADMIN") return true;
  if (roleCode === "ADMIN" && canAccess(accessLevel, "inventory")) return true;

  return false;
}

// ─── Portal resolution ────────────────────────────────────────────────────────

/**
 * Map a request `Host` header value to the initiating portal context. Pure.
 *
 * - Hosts starting with `admin.` → `"admin"`
 * - Hosts starting with `master.` → `"master"`
 * - Everything else (including null/empty) → `"unknown"`
 */
export function resolvePortalFromHost(host: string | null): PortalContext {
  if (!host) return "unknown";

  const normalized = host.toLowerCase().trim();
  if (normalized.startsWith("admin.")) return "admin";
  if (normalized.startsWith("master.")) return "master";

  return "unknown";
}

// ─── Revalidation targets ─────────────────────────────────────────────────────

/** Admin portal route paths per warehouse area. */
const ADMIN_PATHS: Record<WarehouseArea, string> = {
  catalog: "/admin/inventory",
  manufacturing: "/admin/inventory/manufacturing",
  mappings: "/admin/inventory/mappings",
};

/** Master portal route paths per warehouse area. */
const MASTER_PATHS: Record<WarehouseArea, string> = {
  catalog: "/inventory/warehouse",
  manufacturing: "/inventory/warehouse/manufacturing",
  mappings: "/inventory/warehouse/mappings",
};

/**
 * Resolve the set of route paths to revalidate for the portal that initiated
 * the action.
 *
 * - `"admin"`   → only admin paths for the given areas
 * - `"master"`  → only master workspace paths for the given areas
 * - `"unknown"` → both portals' paths (safe fallback, Req 7.4)
 *
 * Returns a de-duplicated array of paths.
 */
export function resolveRevalidationTargets(
  portal: PortalContext,
  areas: WarehouseArea[],
): string[] {
  const paths = new Set<string>();

  for (const area of areas) {
    if (portal === "admin" || portal === "unknown") {
      paths.add(ADMIN_PATHS[area]);
    }
    if (portal === "master" || portal === "unknown") {
      paths.add(MASTER_PATHS[area]);
    }
  }

  return Array.from(paths);
}
