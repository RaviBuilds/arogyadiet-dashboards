// src/lib/franchise/stamping.ts
// Data stamping utility — stamps records with the correct franchise_id
// based on the user's franchise context.

import type { FranchiseContext } from "@/types/franchise";
import { FRANCHISE_FEATURES_ENABLED } from "./constants";

/**
 * Stamps a record with the correct franchise_id based on user context.
 *
 * Logic:
 * - If franchise features are disabled → returns null (no stamping)
 * - If user is ADMIN/MASTER_ADMIN → returns null (core operation, unchanged behavior)
 * - If user is FRANCHISE_ADMIN → returns their franchise_id (ignores any payload value)
 * - If user is RIDER/CUSTOMER with franchise_id → returns their franchise_id
 * - If user is RIDER/CUSTOMER without franchise_id → returns null (core)
 * - If FRANCHISE_ADMIN has no franchise_id → throws (error state, should not happen)
 *
 * @param context - The resolved franchise context for the current user
 * @returns franchise_id to stamp on the record, or null for core operation
 * @throws If FRANCHISE_ADMIN has no assigned franchise (misconfigured user)
 */
export function stampFranchiseId(
  context: FranchiseContext | null
): string | null {
  // Feature flag off → no stamping, existing behavior preserved
  if (!FRANCHISE_FEATURES_ENABLED || !context) {
    return null;
  }

  const { role, franchise_id, is_franchise_scoped } = context;

  // ADMIN / MASTER_ADMIN → always null (core operation)
  if (role === "ADMIN" || role === "MASTER_ADMIN") {
    return null;
  }

  // FRANCHISE_ADMIN → must stamp with their franchise_id
  if (role === "FRANCHISE_ADMIN") {
    if (!franchise_id) {
      throw new Error(
        "FRANCHISE_ADMIN user has no assigned franchise_id. Cannot stamp records."
      );
    }
    return franchise_id;
  }

  // RIDER / CUSTOMER → stamp with their franchise_id (null = core)
  return franchise_id;
}

/**
 * Applies franchise_id stamp to a record object.
 * Returns a new object with franchise_id set.
 *
 * @param record - The record to stamp
 * @param context - The resolved franchise context
 * @returns New record object with franchise_id field added
 */
export function applyFranchiseStamp<T extends Record<string, any>>(
  record: T,
  context: FranchiseContext | null
): T & { franchise_id: string | null } {
  const franchiseId = stampFranchiseId(context);
  return { ...record, franchise_id: franchiseId };
}

/**
 * Validates that a FRANCHISE_ADMIN is not trying to write to a different franchise.
 * Used as a guard before insert/update operations.
 *
 * @param context - The franchise context
 * @param targetFranchiseId - The franchise_id in the payload/record
 * @returns true if write is allowed, error message if not
 */
export function validateFranchiseWriteAccess(
  context: FranchiseContext | null,
  targetFranchiseId: string | null | undefined
): { allowed: true } | { allowed: false; error: string } {
  if (!FRANCHISE_FEATURES_ENABLED || !context) {
    return { allowed: true };
  }

  // Global roles can write anywhere
  if (context.role === "ADMIN" || context.role === "MASTER_ADMIN") {
    return { allowed: true };
  }

  // FRANCHISE_ADMIN must write to their own franchise only
  if (context.role === "FRANCHISE_ADMIN") {
    if (!context.franchise_id) {
      return { allowed: false, error: "No franchise assigned to your account" };
    }

    // If target is specified and doesn't match → reject
    if (targetFranchiseId && targetFranchiseId !== context.franchise_id) {
      return {
        allowed: false,
        error: "Cannot write records for a different franchise",
      };
    }

    return { allowed: true };
  }

  // RIDER / CUSTOMER — allowed for their own scope
  return { allowed: true };
}
