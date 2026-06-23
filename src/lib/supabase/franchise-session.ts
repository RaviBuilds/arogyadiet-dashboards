// src/lib/supabase/franchise-session.ts
// Sets PostgreSQL session variables for RLS policy evaluation.
//
// IMPORTANT: This is ONLY called when FRANCHISE_FEATURES_ENABLED=true.
// When the flag is off, no session variables are set — existing behavior preserved.

import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sets the RLS session context variables on a Supabase client connection.
 *
 * These variables are read by the RLS policies created in create-franchise-rls-policies.sql:
 * - app.role: User's role code (ADMIN, MASTER_ADMIN, FRANCHISE_ADMIN, RIDER, CUSTOMER)
 * - app.franchise_id: User's franchise_id (UUID or empty string for core/global)
 *
 * @param supabase - Supabase client instance
 * @param roleCode - User's role code from the roles table
 * @param franchiseId - User's franchise_id from the users table (null for core users)
 */
export async function setFranchiseSessionContext(
  supabase: SupabaseClient,
  roleCode: string,
  franchiseId: string | null
): Promise<void> {
  // Feature flag check — skip entirely when disabled
  if (!FRANCHISE_FEATURES_ENABLED) return;

  // For ADMIN/MASTER_ADMIN: set role only (they bypass isolation via is_global_role())
  // For FRANCHISE_ADMIN: set both role and franchise_id
  // For RIDER/CUSTOMER: set role and franchise_id (null = core)
  const fid = franchiseId ?? "";

  await supabase.rpc("set_franchise_context", {
    p_role: roleCode,
    p_franchise_id: fid,
  });
}

/**
 * SQL function that needs to be created in the database.
 * This is the target of the RPC call above.
 *
 * CREATE OR REPLACE FUNCTION public.set_franchise_context(p_role text, p_franchise_id text)
 * RETURNS void AS $$
 * BEGIN
 *   PERFORM set_config('app.role', p_role, true);
 *   PERFORM set_config('app.franchise_id', p_franchise_id, true);
 * END;
 * $$ LANGUAGE plpgsql SECURITY DEFINER;
 */
