// src/lib/auth/global-tables.ts
// Global_Table read/write guard for the multi-tenant-franchise spec
// (Task 3.5, Requirements 13.1 / 13.4 / 13.5).
//
// Global_Tables hold shared, system-wide configuration that is identical for
// every tenant (core + all franchises). Two rules follow from that:
//
//   • READS are identical for everyone (Req 13.1 / 13.5). A Global_Table read
//     needs NO `franchise_id` filter and NO scope-based narrowing — every
//     scope (full_network, franchise, core) sees exactly the same rows. This
//     module therefore intentionally exposes NO read filter: callers query
//     these tables directly with no scoping. (See `isGlobalTable` — its purpose
//     is identification, not filtering.)
//
//   • WRITES are restricted to the full-network scope (MASTER_ADMIN / ADMIN)
//     (Req 13.4). FRANCHISE_ADMIN (franchise scope) and core callers must NOT
//     be able to mutate shared configuration, because a change would leak
//     across every tenant.
//
// The write rule is enforced against the SAME Scope the Scope_Resolver produces
// for RLS (`resolveScope()` in `@/lib/auth/scope-resolver`), so the application
// layer and the database agree on who may modify shared config (Req 18.7).

import { resolveScope } from "@/lib/auth/scope-resolver";

/**
 * The canonical list of Global_Table names — shared, system-wide configuration
 * that is read identically by every scope and writable only by the full-network
 * scope (MASTER_ADMIN / ADMIN).
 *
 * Keep this list in sync with the global-config write paths wired to
 * {@link assertGlobalTableWriteAllowed}.
 */
export const GLOBAL_TABLES = [
  "system_settings",
  "roles",
  "subscription_plans",
  "meal_categories",
  "holidays",
  "products",
] as const;

/** A name of one of the {@link GLOBAL_TABLES}. */
export type GlobalTable = (typeof GLOBAL_TABLES)[number];

/**
 * The user-facing error returned when a non-full-network caller attempts to
 * mutate a Global_Table (Req 13.4).
 */
export const GLOBAL_TABLE_WRITE_DENIED =
  "Modifying shared configuration is not permitted." as const;

/**
 * Returns `true` when `table` is one of the shared {@link GLOBAL_TABLES}.
 *
 * This is an identification helper only. Global_Table READS require NO scoping
 * (every scope sees the same rows — Req 13.1 / 13.5), so this function is NOT a
 * read filter; it is used to recognise which tables are subject to the
 * full-network-only WRITE rule.
 */
export function isGlobalTable(table: string): boolean {
  return (GLOBAL_TABLES as readonly string[]).includes(table);
}

/**
 * Result of a Global_Table write authorization check.
 *   - `{ ok: true }`            — caller resolved to the full-network scope.
 *   - `{ ok: false, error }`    — caller is franchise/core scope, unresolved,
 *                                 or a FRANCHISE_ADMIN with no franchise.
 */
export type GlobalTableWriteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Guard for any Server Action that MUTATES a Global_Table (`system_settings`,
 * `roles`, `subscription_plans`, `meal_categories`, `holidays`, `products`).
 *
 * Call this at the TOP of the action, before performing the insert/update/
 * delete/upsert:
 *
 * ```ts
 * "use server";
 * export async function updateSharedAdminEmail(email: string) {
 *   const guard = await assertGlobalTableWriteAllowed();
 *   if (!guard.ok) return { success: false, error: guard.error };
 *   // ... safe to write system_settings ...
 * }
 * ```
 *
 * It resolves the caller's {@link import("@/lib/auth/scope-resolver").resolveScope}
 * Scope and permits the write ONLY for the full-network scope (MASTER_ADMIN /
 * ADMIN). Franchise scope, core scope, and any unresolved/no-franchise caller
 * are rejected with {@link GLOBAL_TABLE_WRITE_DENIED} (Req 13.4). Reads need no
 * guard — see the module header (Req 13.1 / 13.5).
 */
export async function assertGlobalTableWriteAllowed(): Promise<GlobalTableWriteResult> {
  const resolved = await resolveScope();

  // No resolvable scope (unresolved caller / FRANCHISE_ADMIN without a
  // franchise) cannot be full_network → deny.
  if (!resolved.ok) {
    return { ok: false, error: GLOBAL_TABLE_WRITE_DENIED };
  }

  // Only the full-network scope (MASTER_ADMIN / ADMIN) may modify shared config.
  if (resolved.scope.kind === "full_network") {
    return { ok: true };
  }

  // Franchise scope or core scope → not permitted (Req 13.4).
  return { ok: false, error: GLOBAL_TABLE_WRITE_DENIED };
}
