// src/lib/franchise/constants.ts
// Franchise feature flag and configuration constants

import type { FranchiseStatus } from "@/types/franchise";

/**
 * Feature flag — gates all franchise behavior.
 * When false: middleware skips franchise logic, Supabase clients don't set session vars.
 * When true: franchise routing active, session context injected, RLS enforced (if enabled).
 */
export const FRANCHISE_FEATURES_ENABLED =
  process.env.FRANCHISE_FEATURES_ENABLED === "true";

/**
 * Core operation pincodes (Hyderabad).
 * These are NOT available for franchise assignment.
 * Managed here as a reference — also enforced at DB level via unique constraint.
 */
export const CORE_PINCODES: string[] = [
  // Populated from rider_service_areas where franchise_id IS NULL
  // This list is loaded dynamically at runtime via getCoreServicePincodes()
];

/**
 * Valid status transitions for franchise lifecycle
 */
export const VALID_STATUS_TRANSITIONS: Record<FranchiseStatus, FranchiseStatus[]> = {
  onboarding: ["active"],
  active: ["suspended"],
  suspended: ["active"],
};

/**
 * Franchise portal subdomain identifier
 */
export const FRANCHISE_SUBDOMAIN = "franchies";

/**
 * Franchise portal path prefix
 */
export const FRANCHISE_PORTAL_PATH = "/franchise";

/**
 * Roles that have unrestricted data access (see all franchises + core)
 */
export const GLOBAL_ACCESS_ROLES = ["ADMIN", "MASTER_ADMIN"] as const;

/**
 * Role that is scoped to a single franchise
 */
export const FRANCHISE_SCOPED_ROLE = "FRANCHISE_ADMIN" as const;
