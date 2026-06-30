// src/lib/franchise-inventory/__tests__/permissions.property.test.ts
// Property-based test for the franchise permission predicate.
//
// **Property 8: Franchise permission predicate**
//
// For any franchise-portal action, the permission predicate permits it if and
// only if it is a Stock_In confirmation or a Stock_Out recording action; all
// create/edit/delete product-management actions are denied.
//
// **Validates: Requirements 4.2, 4.3**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { checkFranchisePermission } from "../permissions";

// --- Constants ---

/** Actions that must be permitted. */
const PERMITTED_ACTIONS = ["STOCK_IN_CONFIRM", "STOCK_OUT_RECORD"] as const;

/** Actions that must be denied (product-management). */
const DENIED_ACTIONS = [
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "PRODUCT_DELETE",
] as const;

/** All known actions combined. */
const ALL_KNOWN_ACTIONS = [...PERMITTED_ACTIONS, ...DENIED_ACTIONS] as const;

// --- Arbitraries ---

/** One of the permitted actions. */
const arbPermittedAction: fc.Arbitrary<string> = fc.constantFrom(
  ...PERMITTED_ACTIONS,
);

/** One of the denied product-management actions. */
const arbDeniedAction: fc.Arbitrary<string> = fc.constantFrom(
  ...DENIED_ACTIONS,
);

/** A random string that is NOT one of the known actions. */
const arbUnknownAction: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 100 })
  .filter((s) => !ALL_KNOWN_ACTIONS.includes(s as (typeof ALL_KNOWN_ACTIONS)[number]));

// --- Property tests ---

describe("Property 8: Franchise permission predicate", () => {
  it("STOCK_IN_CONFIRM and STOCK_OUT_RECORD return { permitted: true }", () => {
    fc.assert(
      fc.property(arbPermittedAction, (action) => {
        const result = checkFranchisePermission(action);

        expect(result).toEqual({ permitted: true });
      }),
      { numRuns: 100 },
    );
  });

  it("PRODUCT_CREATE, PRODUCT_EDIT, PRODUCT_DELETE return { permitted: false }", () => {
    fc.assert(
      fc.property(arbDeniedAction, (action) => {
        const result = checkFranchisePermission(action);

        expect(result.permitted).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("any other random string returns { permitted: false }", () => {
    fc.assert(
      fc.property(arbUnknownAction, (action) => {
        const result = checkFranchisePermission(action);

        expect(result.permitted).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("permitted actions are exactly STOCK_IN_CONFIRM and STOCK_OUT_RECORD (no others sneak through)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (action) => {
        const result = checkFranchisePermission(action);

        if (result.permitted) {
          // If anything is permitted, it must be one of the two allowed actions
          expect(PERMITTED_ACTIONS).toContain(action);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("denied actions include an error message", () => {
    fc.assert(
      fc.property(arbDeniedAction, (action) => {
        const result = checkFranchisePermission(action);

        expect(result.permitted).toBe(false);
        if (!result.permitted) {
          expect(result.error).toBeDefined();
          expect(result.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
