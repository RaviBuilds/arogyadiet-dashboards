// src/lib/franchise/context.ts
// Resolves franchise context from authenticated user session.
// This is a utility — no existing code calls it until middleware integration (Phase 3).

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FranchiseContext, FranchiseRole } from "@/types/franchise";
import {
  FRANCHISE_FEATURES_ENABLED,
  GLOBAL_ACCESS_ROLES,
  FRANCHISE_SCOPED_ROLE,
} from "./constants";

/**
 * Resolves the franchise context for the currently authenticated user.
 *
 * Logic:
 * - ADMIN / MASTER_ADMIN → franchise_id = null (global access, sees everything)
 * - FRANCHISE_ADMIN → franchise_id = user's assigned franchise_id
 * - RIDER / CUSTOMER with null franchise_id → franchise_id = null (core operation)
 * - RIDER / CUSTOMER with franchise_id → franchise_id = their franchise_id
 *
 * Returns null if:
 * - Franchise features are disabled
 * - User is not authenticated
 * - User record not found
 */
export async function resolveFranchiseContext(): Promise<FranchiseContext | null> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return null;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, franchise_id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return null;

  // Extract role code (handles both array and object shapes from Supabase)
  const rolesData: any = userRecord.roles;
  const roleCode: string | null = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode) return null;

  const role = roleCode as FranchiseRole;

  // ADMIN / MASTER_ADMIN → global access, no franchise scoping
  if ((GLOBAL_ACCESS_ROLES as readonly string[]).includes(role)) {
    return {
      role,
      franchise_id: null,
      franchise_name: null,
      is_franchise_scoped: false,
    };
  }

  // FRANCHISE_ADMIN → scoped to their assigned franchise
  if (role === FRANCHISE_SCOPED_ROLE) {
    const franchiseId = userRecord.franchise_id;

    if (!franchiseId) {
      // FRANCHISE_ADMIN without an assigned franchise — error state
      return {
        role,
        franchise_id: null,
        franchise_name: null,
        is_franchise_scoped: true, // still franchise-scoped, but unassigned
      };
    }

    // Fetch franchise name for display purposes
    const { data: franchise } = await supabase
      .from("franchises")
      .select("name")
      .eq("id", franchiseId)
      .single();

    return {
      role,
      franchise_id: franchiseId,
      franchise_name: franchise?.name ?? null,
      is_franchise_scoped: true,
    };
  }

  // RIDER / CUSTOMER → return their franchise_id (null = core)
  return {
    role,
    franchise_id: userRecord.franchise_id ?? null,
    franchise_name: null,
    is_franchise_scoped: userRecord.franchise_id !== null,
  };
}

/**
 * Resolves franchise context using admin client (service role).
 * Use this in server actions where you already have the user's internal ID.
 *
 * @param userId - Internal user ID from the `users` table
 */
export async function resolveFranchiseContextByUserId(
  userId: string
): Promise<FranchiseContext | null> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return null;
  }

  const adminClient = createAdminClient();

  const { data: userRecord } = await adminClient
    .from("users")
    .select("id, franchise_id, roles(code)")
    .eq("id", userId)
    .single();

  if (!userRecord) return null;

  const rolesData: any = userRecord.roles;
  const roleCode: string | null = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode) return null;

  const role = roleCode as FranchiseRole;

  if ((GLOBAL_ACCESS_ROLES as readonly string[]).includes(role)) {
    return {
      role,
      franchise_id: null,
      franchise_name: null,
      is_franchise_scoped: false,
    };
  }

  if (role === FRANCHISE_SCOPED_ROLE) {
    const franchiseId = userRecord.franchise_id;

    if (!franchiseId) {
      return {
        role,
        franchise_id: null,
        franchise_name: null,
        is_franchise_scoped: true,
      };
    }

    const { data: franchise } = await adminClient
      .from("franchises")
      .select("name")
      .eq("id", franchiseId)
      .single();

    return {
      role,
      franchise_id: franchiseId,
      franchise_name: franchise?.name ?? null,
      is_franchise_scoped: true,
    };
  }

  return {
    role,
    franchise_id: userRecord.franchise_id ?? null,
    franchise_name: null,
    is_franchise_scoped: userRecord.franchise_id !== null,
  };
}

/**
 * Fetches core operation pincodes (pincodes served by riders with NULL franchise_id).
 * Used to prevent franchise pincode assignment conflicts.
 */
export async function getCoreServicePincodes(): Promise<string[]> {
  const adminClient = createAdminClient();

  const { data } = await adminClient
    .from("rider_service_areas")
    .select("pincode")
    .is("franchise_id", null);

  return data?.map((row) => row.pincode) ?? [];
}
