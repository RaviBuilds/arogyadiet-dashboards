// src/lib/franchise/server-stamp.ts
// Server-side franchise stamping helper.
// Call this in server actions to get the franchise_id to include in inserts.
//
// CRITICAL: Returns NULL when franchise features are off OR when user is ADMIN/MASTER_ADMIN.
// This means existing flows produce NULL franchise_id (correct for core operation).

import { FRANCHISE_FEATURES_ENABLED } from "./constants";
import { resolveFranchiseContext } from "./context";
import { stampFranchiseId } from "./stamping";

/**
 * Gets the franchise_id to stamp on a new record.
 * Safe to call in any server action — returns null when:
 * - Franchise features disabled
 * - User is ADMIN / MASTER_ADMIN (core operation)
 * - User has no franchise_id
 *
 * Only returns a non-null value for FRANCHISE_ADMIN users.
 */
export async function getStampFranchiseId(): Promise<string | null> {
  if (!FRANCHISE_FEATURES_ENABLED) return null;

  try {
    const context = await resolveFranchiseContext();
    return stampFranchiseId(context);
  } catch {
    // If stamping fails (e.g. FRANCHISE_ADMIN without franchise), return null
    // The server action should handle this separately if needed
    return null;
  }
}
