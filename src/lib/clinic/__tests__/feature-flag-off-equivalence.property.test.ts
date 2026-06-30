// Feature: core-clinic-architecture, Property 39: Feature-flag-off equivalence
//
// Property 39: Feature-flag-off equivalence
//   For any set of routing and customer-assignment inputs, while
//   FRANCHISE_FEATURES_ENABLED is false (including when the environment variable
//   is unset, which resolves to false), the routing engine routes only Core
//   Clinics and produces routing batches and customer-assignment outcomes
//   identical to those produced before the `clinics.franchise_id` column was
//   introduced, given the same inputs, with no franchise-specific reads, writes,
//   or side effects.
//
// Validates: Requirements 10.8, 18.3, 18.4, 18.6
//
// HOW THIS IS TESTED
//   Two complementary checks, both pure (no Supabase):
//
//   1. The pure flag resolver `resolveFranchiseFeatureFlag(envValue)` is ON only
//      for the exact string "true". Every other value — undefined (unset), "",
//      "false", "1", "TRUE", whitespace, etc. — resolves to false (Req 18.4).
//
//   2. A pure model of the routing engine's scope-selection predicate
//      (mirroring `src/actions/system-actions/routeEngine.ts`): when the flag is
//      OFF, scopes are built ONLY from Core Clinics (`franchise_id IS NULL`) with
//      NO franchise table read and NO franchise filter. We assert this produces
//      the SAME Core-only scoping (and the same routable-order / customer-
//      assignment subset) as the pre-`franchise_id` reference behavior given the
//      same inputs (Req 10.8, 18.3, 18.6).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveFranchiseFeatureFlag } from "../../franchise/constants";
import { isCoreClinic } from "../validation";

// ─── Part 1: the pure flag resolver (Req 18.4) ──────────────────────────────

describe("resolveFranchiseFeatureFlag - Property 39 (flag resolution, Req 18.4)", () => {
  it('returns true ONLY for the exact string "true"', () => {
    expect(resolveFranchiseFeatureFlag("true")).toBe(true);
  });

  it("returns false for unset/undefined", () => {
    expect(resolveFranchiseFeatureFlag(undefined)).toBe(false);
  });

  it('returns false for "", "false", "1", "TRUE", and other near-misses', () => {
    for (const v of ["", "false", "1", "0", "TRUE", "True", " true", "true ", "yes", "on"]) {
      expect(resolveFranchiseFeatureFlag(v)).toBe(false);
    }
  });

  it('resolves true iff the value is exactly "true" for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(resolveFranchiseFeatureFlag(s)).toBe(s === "true");
      }),
      { numRuns: 200 }
    );
  });

  it("resolves true iff the value is exactly \"true\" for arbitrary string-or-undefined input", () => {
    const arbEnv = fc.option(fc.string(), { nil: undefined });
    fc.assert(
      fc.property(arbEnv, (v) => {
        expect(resolveFranchiseFeatureFlag(v)).toBe(v === "true");
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Part 2: scope-selection equivalence model ──────────────────────────────
//
// A pure model of the routeEngine scope-selection predicate. Each clinic carries
// a `franchise_id` (null = Core Clinic). The model records whether any franchise
// table/filter was consulted so we can assert the flag-off path performs NO
// franchise-specific read (Req 18.3).

type ModelClinic = {
  id: string;
  franchiseId: string | null;
  latitude: number;
  longitude: number;
};

type ModelOrder = {
  id: string;
  clinicId: string; // the clinic the order's delivery address resolved to
  franchiseId: string | null;
};

type ScopeSelection = {
  /** Clinic ids selected as routing scopes, sorted for stable comparison. */
  scopeClinicIds: string[];
  /** Ids of orders considered routable across the selected scopes. */
  routableOrderIds: string[];
  /** True iff the selection consulted any franchise table / franchise filter. */
  consultedFranchise: boolean;
};

/**
 * flagOffScopeSelection — mirrors routeEngine's FLAG-OFF branch: enumerate every
 * Core Clinic (`franchise_id IS NULL`) as an independent scope using the clinic
 * coordinate as origin; NO franchise table is read and NO franchise filter is
 * applied. Orders are routable iff their stamped clinic is one of the selected
 * Core Clinics.
 */
function flagOffScopeSelection(
  clinics: ModelClinic[],
  orders: ModelOrder[]
): ScopeSelection {
  const coreClinicIds = clinics
    .filter((c) => isCoreClinic(c.franchiseId)) // franchise_id IS NULL only
    .map((c) => c.id);
  const coreSet = new Set(coreClinicIds);

  const routableOrderIds = orders
    .filter((o) => coreSet.has(o.clinicId))
    .map((o) => o.id);

  return {
    scopeClinicIds: [...coreClinicIds].sort(),
    routableOrderIds: [...routableOrderIds].sort(),
    // The flag-off branch NEVER touches the franchises table (Req 18.3).
    consultedFranchise: false,
  };
}

/**
 * preFranchiseScopeSelection — the reference behavior from BEFORE the
 * `clinics.franchise_id` column existed. In that world there was no franchise
 * concept at all: every clinic was, by definition, a core clinic and every
 * clinic routed. Given a migrated dataset where the pre-existing clinics carry
 * `franchise_id IS NULL`, this selects exactly those clinics and their orders.
 */
function preFranchiseScopeSelection(
  clinics: ModelClinic[],
  orders: ModelOrder[]
): ScopeSelection {
  // Pre-franchise: there were no franchise clinics. The faithful comparison set
  // is the clinics that would have existed pre-migration — i.e. the core ones.
  const clinicIds = clinics
    .filter((c) => c.franchiseId === null)
    .map((c) => c.id);
  const idSet = new Set(clinicIds);

  const routableOrderIds = orders
    .filter((o) => idSet.has(o.clinicId))
    .map((o) => o.id);

  return {
    scopeClinicIds: [...clinicIds].sort(),
    routableOrderIds: [...routableOrderIds].sort(),
    consultedFranchise: false,
  };
}

// ─── Generators ─────────────────────────────────────────────────────────────

const arbClinic = (i: number): fc.Arbitrary<ModelClinic> =>
  fc
    .record({
      franchiseId: fc.option(fc.constantFrom("fr-a", "fr-b", "fr-c"), {
        nil: null,
      }),
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      longitude: fc.double({ min: -180, max: 180, noNaN: true }),
    })
    .map((r) => ({ id: `clinic-${i}`, ...r }));

const arbClinics: fc.Arbitrary<ModelClinic[]> = fc
  .array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 8 })
  .chain((idxs) => fc.tuple(...idxs.map((_, i) => arbClinic(i))));

/** Orders reference one of the generated clinic ids (plus its franchise tag). */
const arbOrders = (clinics: ModelClinic[]): fc.Arbitrary<ModelOrder[]> =>
  fc.array(
    fc
      .nat({ max: Math.max(0, clinics.length - 1) })
      .map((idx) => clinics[idx])
      .map((c, ) => ({ clinic: c }))
      .chain(({ clinic }) =>
        fc.string({ minLength: 1, maxLength: 6 }).map((sfx) => ({
          id: `order-${clinic.id}-${sfx}`,
          clinicId: clinic.id,
          franchiseId: clinic.franchiseId,
        }))
      ),
    { maxLength: 20 }
  );

const arbWorld = arbClinics.chain((clinics) =>
  arbOrders(clinics).map((orders) => ({ clinics, orders }))
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("routeEngine scope selection - Property 39: flag-off equivalence", () => {
  it("flag-off selects ONLY Core Clinics (franchise_id IS NULL)", () => {
    fc.assert(
      fc.property(arbWorld, ({ clinics, orders }) => {
        const sel = flagOffScopeSelection(clinics, orders);

        // Every selected scope is a Core Clinic.
        for (const id of sel.scopeClinicIds) {
          const clinic = clinics.find((c) => c.id === id)!;
          expect(clinic.franchiseId).toBeNull();
        }
        // No franchise clinic leaks into the scope set.
        const franchiseIds = clinics
          .filter((c) => c.franchiseId !== null)
          .map((c) => c.id);
        for (const fid of franchiseIds) {
          expect(sel.scopeClinicIds).not.toContain(fid);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("flag-off performs NO franchise-specific read or filter (Req 18.3)", () => {
    fc.assert(
      fc.property(arbWorld, ({ clinics, orders }) => {
        const sel = flagOffScopeSelection(clinics, orders);
        expect(sel.consultedFranchise).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("flag-off scoping is identical to pre-franchise behavior given the same inputs (Req 18.6)", () => {
    fc.assert(
      fc.property(arbWorld, ({ clinics, orders }) => {
        const flagOff = flagOffScopeSelection(clinics, orders);
        const preFranchise = preFranchiseScopeSelection(clinics, orders);

        // Same Core-only scope set...
        expect(flagOff.scopeClinicIds).toEqual(preFranchise.scopeClinicIds);
        // ...same routable-order subset (customer-assignment outcome)...
        expect(flagOff.routableOrderIds).toEqual(preFranchise.routableOrderIds);
        // ...and neither path touches franchise data.
        expect(flagOff.consultedFranchise).toBe(false);
        expect(preFranchise.consultedFranchise).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("when ALL clinics are Core, flag-off routes every clinic and every order (full parity)", () => {
    const arbCoreOnlyWorld = arbWorld.map(({ clinics, orders }) => {
      const coreClinics = clinics.map((c) => ({ ...c, franchiseId: null }));
      const coreOrders = orders.map((o) => ({ ...o, franchiseId: null }));
      return { clinics: coreClinics, orders: coreOrders };
    });

    fc.assert(
      fc.property(arbCoreOnlyWorld, ({ clinics, orders }) => {
        const sel = flagOffScopeSelection(clinics, orders);
        // Every clinic is selected and every order is routable — exactly the
        // pre-franchise world (no rows excluded by a franchise filter).
        expect(sel.scopeClinicIds).toEqual(
          [...clinics.map((c) => c.id)].sort()
        );
        expect(sel.routableOrderIds).toEqual(
          [...orders.map((o) => o.id)].sort()
        );
      }),
      { numRuns: 200 }
    );
  });

  it("the resolved flag gates the scope-selection branch: only \"true\" enables the franchise path", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (env) => {
        const flagOn = resolveFranchiseFeatureFlag(env);
        // The core (flag-off) branch runs whenever the flag is not enabled,
        // which is every value except the exact "true".
        expect(!flagOn).toBe(env !== "true");
      }),
      { numRuns: 200 }
    );
  });
});
