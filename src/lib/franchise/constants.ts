// src/lib/franchise/constants.ts
// Franchise feature flag and configuration constants

import type { FranchiseStatus } from "@/types/franchise";

/**
 * Pure resolver for the franchise feature flag.
 *
 * The flag is ON only when the environment value is exactly the string "true".
 * Any other value — including `undefined` (the variable being unset), an empty
 * string, "false", "1", "TRUE", etc. — resolves to `false`. Keeping this as a
 * standalone pure function lets the unset → false rule (Requirement 18.4) be
 * tested independently of `process.env` (see Property 36 / task 14.3).
 *
 * @param envValue The raw `process.env.FRANCHISE_FEATURES_ENABLED` value.
 * @returns `true` only when `envValue === "true"`, otherwise `false`.
 */
export function resolveFranchiseFeatureFlag(
  envValue: string | undefined,
): boolean {
  return envValue === "true";
}

/**
 * Feature flag — gates all franchise behavior.
 * When false: middleware skips franchise logic, Supabase clients don't set session vars.
 * When true: franchise routing active, session context injected, RLS enforced (if enabled).
 *
 * Resolved once at module load from the environment via the pure
 * {@link resolveFranchiseFeatureFlag} so that an unset variable deterministically
 * resolves to `false` (Requirement 18.4).
 */
export const FRANCHISE_FEATURES_ENABLED = resolveFranchiseFeatureFlag(
  process.env.FRANCHISE_FEATURES_ENABLED,
);

/**
 * Runtime guard for all franchise-specific reads, writes, and side effects.
 *
 * Returns the resolved franchise feature flag. When this returns `false`
 * (the production default — and the value whenever the env var is unset), the
 * system MUST perform NO franchise-specific reads, writes, or side effects:
 * routing enumerates only Core Clinics (`franchise_id IS NULL`), stamping writes
 * a `NULL` franchise_id, and every franchise-gated code path stays present but
 * inert so it still compiles and deploys (Requirements 18.3, 18.4, 18.5).
 *
 * Use this as the single predicate that gates any optional franchise table read
 * or franchise side effect on a path that also runs in core operation.
 */
export function isFranchiseRuntimeEnabled(): boolean {
  return FRANCHISE_FEATURES_ENABLED;
}

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
