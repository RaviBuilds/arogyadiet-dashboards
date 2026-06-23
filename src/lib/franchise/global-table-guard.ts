// src/lib/franchise/global-table-guard.ts
// Prevents FRANCHISE_ADMIN from modifying global (shared) tables.
//
// Global tables are read-only for franchise users:
// - subscription_plans, meal_categories, holidays, products (catalog),
//   system_settings, kitchens

import { FRANCHISE_FEATURES_ENABLED } from "./constants";
import type { FranchiseContext } from "@/types/franchise";

/**
 * Global tables that FRANCHISE_ADMIN can READ but NOT modify.
 */
export const GLOBAL_TABLES = [
  "subscription_plans",
  "meal_categories",
  "holidays",
  "system_settings",
  "kitchens",
] as const;

/**
 * Checks if a franchise user is allowed to write to a table.
 * Returns true if allowed, false if blocked.
 *
 * Logic:
 * - If franchise features disabled → always allowed (existing behavior)
 * - If user is ADMIN/MASTER_ADMIN → always allowed
 * - If user is FRANCHISE_ADMIN and table is global → BLOCKED
 * - Otherwise → allowed
 */
export function canWriteToTable(
  context: FranchiseContext | null,
  tableName: string
): { allowed: true } | { allowed: false; error: string } {
  if (!FRANCHISE_FEATURES_ENABLED || !context) {
    return { allowed: true };
  }

  // Global roles can write anywhere
  if (context.role === "ADMIN" || context.role === "MASTER_ADMIN") {
    return { allowed: true };
  }

  // FRANCHISE_ADMIN cannot modify global tables
  if (context.role === "FRANCHISE_ADMIN") {
    if ((GLOBAL_TABLES as readonly string[]).includes(tableName)) {
      return {
        allowed: false,
        error: `Franchise admins cannot modify "${tableName}". This is a system-wide table managed by ArogyaDiet.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Quick guard function to use at the top of server actions that modify global tables.
 * Throws if the current user is a franchise admin.
 */
export function assertNotFranchiseAdmin(
  context: FranchiseContext | null,
  tableName: string
): void {
  const check = canWriteToTable(context, tableName);
  if (!check.allowed) {
    throw new Error(check.error);
  }
}
