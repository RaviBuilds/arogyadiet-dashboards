// src/lib/clinic/core-business-scope.ts
// Pure, side-effect-free narrowing of the full Business → Kitchen → Clinic
// hierarchy down to the additive master-portal "Core Business" section's scope
// (core-clinic-architecture, Requirement 21.3, 21.7).
//
// The "Core Business" section is a purely ADDITIVE surface that coexists with
// the existing, untouched "Core Clinic Management" card (Req 21.1, 21.2, 21.7).
// It is scoped to the Core business only (Req 21.3): Core businesses, the
// kitchens those businesses own, and the Core Clinics (franchise_id IS NULL)
// served by those kitchens.
//
// This module performs NO Supabase / React / network / IO work, so the
// CoreBusinessSection RSC can delegate its scope-narrowing here and it can be
// unit-tested in isolation. Inputs are never mutated; the result references the
// same row objects, filtered.

import type { Business, Kitchen, Clinic } from "@/types/clinic";

/** The Core-scoped slice handed to the Core Business section's client leaves. */
export interface CoreBusinessScope {
  /** Businesses whose type is exactly "Core" (Req 21.3). */
  coreBusinesses: Business[];
  /** Kitchens owned by a Core business — carry NO geo (Req 21.4, 2.5). */
  coreKitchens: Kitchen[];
  /** Core Clinics (franchise_id === null) served by a Core kitchen (Req 3.4, 21.3). */
  coreClinics: Clinic[];
}

/**
 * Narrow the full hierarchy to the Core Business scope.
 *
 * - `coreBusinesses` = businesses of type `"Core"`.
 * - `coreKitchens` = kitchens whose `business_id` belongs to a Core business.
 * - `coreClinics` = clinics that are Core (`franchise_id === null`) AND whose
 *   `kitchen_id` belongs to a Core kitchen.
 *
 * Pure: does not mutate its arguments and preserves input order. Franchise
 * businesses/kitchens and franchise clinics (non-null `franchise_id`) are
 * excluded from the result but left entirely untouched in the inputs — the
 * section never removes or alters the legacy/franchise flow (Req 21.7).
 */
export function selectCoreBusinessScope(
  businesses: Business[],
  kitchens: Kitchen[],
  clinics: Clinic[]
): CoreBusinessScope {
  const coreBusinesses = businesses.filter((b) => b.type === "Core");
  const coreBusinessIds = new Set(coreBusinesses.map((b) => b.id));

  const coreKitchens = kitchens.filter((k) => coreBusinessIds.has(k.business_id));
  const coreKitchenIds = new Set(coreKitchens.map((k) => k.id));

  const coreClinics = clinics.filter(
    (c) => c.franchise_id === null && coreKitchenIds.has(c.kitchen_id)
  );

  return { coreBusinesses, coreKitchens, coreClinics };
}
