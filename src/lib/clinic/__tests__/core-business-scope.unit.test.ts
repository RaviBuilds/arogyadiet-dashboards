// src/lib/clinic/__tests__/core-business-scope.unit.test.ts
// Feature: core-clinic-architecture, Task 14.2
//
// Example-based unit tests for the additive master-portal "Core Business"
// section. They cover the section's two defining behaviors with concrete cases
// drawn from the acceptance criteria:
//   - the section coexists with, and is purely additive to, the existing
//     untouched "Core Clinic Management" card (Req 21.1, 21.2, 21.7); and
//   - it is scoped to the Core business only (Req 21.3); and
//   - its Kitchen surface persists NO geo fields (Req 21.4/21.7, no-geo kitchen).
//
// The scope narrowing performed by the CoreBusinessSection RSC is extracted into
// the pure `selectCoreBusinessScope` helper so it is testable without Supabase /
// React. The no-geo kitchen surface is asserted against the canonical
// `kitchenSchema` (which the Core Business kitchen form mirrors).
//
// Validates: Requirements 21.1, 21.2, 21.3, 21.7

import { describe, it, expect } from "vitest";

import { selectCoreBusinessScope } from "../core-business-scope";
import { kitchenSchema } from "@/validations/clinic";
import type { Business, Kitchen, Clinic } from "@/types/clinic";

// ─── Fixtures: a mixed Core + Franchise hierarchy ───────────────────────────

const CORE_BUSINESS: Business = {
  id: "biz-core",
  name: "Core Hyderabad Business",
  type: "Core",
};
const FRANCHISE_BUSINESS: Business = {
  id: "biz-fr",
  name: "Some Franchise Business",
  type: "Franchise",
};

const businesses: Business[] = [CORE_BUSINESS, FRANCHISE_BUSINESS];

const kitchens: Kitchen[] = [
  // Core kitchen.
  {
    id: "kit-core",
    name: "Hyderabad Central Kitchen",
    business_id: "biz-core",
    city_id: "city-hyd",
  },
  // Second Core kitchen (multiple Core kitchens are allowed — Req 2.12).
  {
    id: "kit-core-2",
    name: "Secunderabad Kitchen",
    business_id: "biz-core",
    city_id: "city-hyd",
  },
  // Franchise-owned kitchen — must be excluded from the Core scope.
  {
    id: "kit-fr",
    name: "Franchise Kitchen",
    business_id: "biz-fr",
    city_id: "city-hyd",
  },
];

const clinics: Clinic[] = [
  // Core clinics under Core kitchens (franchise_id === null).
  {
    id: "clinic-madhapur",
    name: "Madhapur Clinic",
    address: "Madhapur, Hyderabad",
    latitude: 17.4486,
    longitude: 78.3908,
    kitchen_id: "kit-core",
    franchise_id: null,
  },
  {
    id: "clinic-uppal",
    name: "Uppal Clinic",
    address: "Uppal, Hyderabad",
    latitude: 17.4058,
    longitude: 78.5594,
    kitchen_id: "kit-core-2",
    franchise_id: null,
  },
  // Franchise clinic (non-null franchise_id) under a Core kitchen — excluded
  // because it is not a Core Clinic.
  {
    id: "clinic-fr-on-core-kitchen",
    name: "Franchise Clinic",
    address: "Somewhere",
    latitude: 17.0,
    longitude: 78.0,
    kitchen_id: "kit-core",
    franchise_id: "fr-1",
  },
  // Core clinic under a FRANCHISE kitchen — excluded because its kitchen is not
  // a Core kitchen.
  {
    id: "clinic-core-on-fr-kitchen",
    name: "Stray Core Clinic",
    address: "Elsewhere",
    latitude: 16.0,
    longitude: 77.0,
    kitchen_id: "kit-fr",
    franchise_id: null,
  },
];

// ─── Req 21.3: scope is the Core business only ──────────────────────────────

describe("selectCoreBusinessScope — Core scope only (Req 21.3)", () => {
  it("keeps only Core businesses", () => {
    const { coreBusinesses } = selectCoreBusinessScope(
      businesses,
      kitchens,
      clinics
    );
    expect(coreBusinesses.map((b) => b.id)).toEqual(["biz-core"]);
    expect(coreBusinesses.every((b) => b.type === "Core")).toBe(true);
  });

  it("keeps only kitchens owned by a Core business (excludes franchise kitchens)", () => {
    const { coreKitchens } = selectCoreBusinessScope(
      businesses,
      kitchens,
      clinics
    );
    expect(coreKitchens.map((k) => k.id)).toEqual(["kit-core", "kit-core-2"]);
    expect(coreKitchens.some((k) => k.id === "kit-fr")).toBe(false);
  });

  it("keeps only Core Clinics (franchise_id === null) served by a Core kitchen", () => {
    const { coreClinics } = selectCoreBusinessScope(
      businesses,
      kitchens,
      clinics
    );
    // Excludes the franchise clinic on a Core kitchen AND the Core clinic on a
    // franchise kitchen.
    expect(coreClinics.map((c) => c.id)).toEqual([
      "clinic-madhapur",
      "clinic-uppal",
    ]);
    expect(coreClinics.every((c) => c.franchise_id === null)).toBe(true);
  });
});

// ─── Req 21.1, 21.2, 21.7: additive, coexists, alters nothing ───────────────

describe("selectCoreBusinessScope — purely additive (Req 21.1, 21.2, 21.7)", () => {
  it("does not mutate the input arrays or rows (existing data untouched)", () => {
    const businessesCopy = structuredClone(businesses);
    const kitchensCopy = structuredClone(kitchens);
    const clinicsCopy = structuredClone(clinics);

    selectCoreBusinessScope(businesses, kitchens, clinics);

    // The legacy/franchise data the existing card relies on is left intact.
    expect(businesses).toEqual(businessesCopy);
    expect(kitchens).toEqual(kitchensCopy);
    expect(clinics).toEqual(clinicsCopy);
  });

  it("references the original row objects (a filtered view, not a rebuilt copy)", () => {
    const { coreBusinesses, coreKitchens, coreClinics } =
      selectCoreBusinessScope(businesses, kitchens, clinics);

    expect(coreBusinesses[0]).toBe(CORE_BUSINESS);
    expect(coreKitchens[0]).toBe(kitchens[0]);
    expect(coreClinics[0]).toBe(clinics[0]);
  });

  it("franchise records are excluded from the section's view but remain in the source lists", () => {
    const { coreBusinesses, coreKitchens } = selectCoreBusinessScope(
      businesses,
      kitchens,
      clinics
    );
    // Not surfaced by the additive section...
    expect(coreBusinesses).not.toContain(FRANCHISE_BUSINESS);
    // ...yet still present for the existing/legacy flow.
    expect(businesses).toContain(FRANCHISE_BUSINESS);
    expect(kitchens.some((k) => k.id === "kit-fr")).toBe(true);
    expect(coreKitchens.some((k) => k.id === "kit-fr")).toBe(false);
  });

  it("returns empty Core slices when no Core business exists, without touching franchise data", () => {
    const onlyFranchise = [FRANCHISE_BUSINESS];
    const result = selectCoreBusinessScope(onlyFranchise, kitchens, clinics);
    expect(result.coreBusinesses).toEqual([]);
    expect(result.coreKitchens).toEqual([]);
    expect(result.coreClinics).toEqual([]);
  });
});

// ─── Req 21.4 / 21.7: Core Business kitchen surface carries NO geo ──────────

describe("Core Business kitchen surface has no geo fields (Req 21.4)", () => {
  it("the Kitchen rows in scope expose only name/business/city — no address, latitude, or longitude", () => {
    const { coreKitchens } = selectCoreBusinessScope(
      businesses,
      kitchens,
      clinics
    );
    for (const kitchen of coreKitchens) {
      const keys = Object.keys(kitchen);
      expect(keys).not.toContain("address");
      expect(keys).not.toContain("latitude");
      expect(keys).not.toContain("longitude");
      expect(keys.sort()).toEqual(["business_id", "city_id", "id", "name"]);
    }
  });

  it("the kitchen schema persists no geo: any address/lat/lng on input is stripped", () => {
    const parsed = kitchenSchema.parse({
      name: "Hyderabad Central Kitchen",
      business_id: "0f6c2d1e-1111-4444-8888-aaaaaaaaaaaa",
      city_id: "0f6c2d1e-2222-4444-8888-bbbbbbbbbbbb",
      // Geo fields a caller might erroneously include — must NOT be persisted.
      address: "should be ignored",
      latitude: 17.4,
      longitude: 78.4,
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty("address");
    expect(parsed).not.toHaveProperty("latitude");
    expect(parsed).not.toHaveProperty("longitude");
    expect(Object.keys(parsed).sort()).toEqual([
      "business_id",
      "city_id",
      "name",
    ]);
  });
});
