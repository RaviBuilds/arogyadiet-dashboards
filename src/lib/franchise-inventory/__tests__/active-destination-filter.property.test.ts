// src/lib/franchise-inventory/__tests__/active-destination-filter.property.test.ts
// Property-based test for the active-destination filter.
//
// **Property 9: Destination selector lists exactly the active franchises**
//
// For any set of franchises with arbitrary statuses, the dispatch
// Destination_Selector's franchise entries equal exactly the franchises whose
// status is `active`, and exclude every franchise whose status is `onboarding`,
// `suspended`, or any non-`active` value.
//
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  filterActiveDestinations,
  type FranchiseForDestination,
  type FranchiseDestination,
} from "../active-destination-filter";

// --- Arbitraries ---

/** Known non-active statuses that the requirements explicitly call out. */
const KNOWN_STATUSES = ["active", "onboarding", "suspended"];

/** Generates a random status string including known and arbitrary unknown ones. */
const arbStatus: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KNOWN_STATUSES),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "active"),
);

/** Generates a franchise with a random id, name, and status. */
const arbFranchise: fc.Arbitrary<FranchiseForDestination> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  status: arbStatus,
});

/** Generates an array of 0–30 franchises with random statuses. */
const arbFranchises: fc.Arbitrary<FranchiseForDestination[]> = fc.array(
  arbFranchise,
  { minLength: 0, maxLength: 30 },
);

// --- Property tests ---

describe("Property 9: Destination selector lists exactly the active franchises", () => {
  it("result contains exactly the franchises with status === 'active'", () => {
    fc.assert(
      fc.property(arbFranchises, (franchises) => {
        const result = filterActiveDestinations(franchises);
        const activeFranchises = franchises.filter((f) => f.status === "active");

        // Each active franchise should appear in the result with matching id and name
        for (const active of activeFranchises) {
          const found = result.find((r) => r.id === active.id && r.name === active.name);
          expect(found).toBeDefined();
        }

        // Each result entry should correspond to an active franchise
        for (const entry of result) {
          const source = activeFranchises.find(
            (f) => f.id === entry.id && f.name === entry.name,
          );
          expect(source).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("result excludes all non-active franchises", () => {
    fc.assert(
      fc.property(arbFranchises, (franchises) => {
        const result = filterActiveDestinations(franchises);
        const nonActiveFranchises = franchises.filter((f) => f.status !== "active");

        for (const nonActive of nonActiveFranchises) {
          const found = result.find((r) => r.id === nonActive.id);
          expect(found).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("result length equals the count of active franchises in the input", () => {
    fc.assert(
      fc.property(arbFranchises, (franchises) => {
        const result = filterActiveDestinations(franchises);
        const activeCount = franchises.filter((f) => f.status === "active").length;

        expect(result.length).toBe(activeCount);
      }),
      { numRuns: 100 },
    );
  });

  it("each result entry has only id and name (no status field)", () => {
    fc.assert(
      fc.property(arbFranchises, (franchises) => {
        const result = filterActiveDestinations(franchises);

        for (const entry of result) {
          const keys = Object.keys(entry);
          expect(keys).toContain("id");
          expect(keys).toContain("name");
          expect(keys).not.toContain("status");
          expect(keys.length).toBe(2);
        }
      }),
      { numRuns: 100 },
    );
  });
});
