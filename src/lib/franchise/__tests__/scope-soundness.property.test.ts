// src/lib/franchise/__tests__/scope-soundness.property.test.ts
// Feature: multi-tenant-franchise, Property 2: Scope soundness / no leakage
//
// Property 2: Scope soundness / no leakage — For any non-global scope `s`
// (franchise(f) or core) and any dataset of rows carrying a `franchise_id`
// (null for core rows, or one of a small pool of franchise ids), the filtered
// set `dataset.filter(r => scopePermits(s, r.franchise_id))` must contain NO row
// that violates the scope:
//   - franchise(f): every surviving row has franchise_id === f
//                   (no core rows, no other-franchise rows leak through).
//   - core:         every surviving row has franchise_id === null
//                   (no franchise rows leak through).
// Additionally, `applyScope` must build the matching query filter:
//   - franchise(f)  → .eq('franchise_id', f)
//   - core          → .is('franchise_id', null)
//   - full_network  → no filter call
//
// Validates: Requirements 10.1, 10.4, 10.8
//
// The module under test (src/lib/auth/scope-predicate.ts) is PURE: it has no
// Supabase / auth / Next.js imports, so it is exercised here in complete
// isolation with a tiny in-memory dataset and a fake query-builder stub.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Scope } from "@/types/franchise";
import { scopePermits, applyScope } from "@/lib/auth/scope-predicate";

// Small fixed pool of franchise ids the dataset rows may carry.
const FRANCHISE_POOL = ["f1", "f2", "f3"] as const;

// A row's franchise_id is either null (core) or one of the pool.
const arbRowFranchiseId: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.constantFrom<string>(...FRANCHISE_POOL),
);

// A dataset is a list of rows, each with a franchise_id.
const arbDataset: fc.Arbitrary<{ franchise_id: string | null }[]> = fc.array(
  arbRowFranchiseId.map((franchise_id) => ({ franchise_id })),
  { maxLength: 30 },
);

// Non-global scopes only: franchise(f) over the pool, plus core.
const arbNonGlobalScope: fc.Arbitrary<Scope> = fc.oneof(
  fc
    .constantFrom<string>(...FRANCHISE_POOL)
    .map((franchise_id): Scope => ({ kind: "franchise", franchise_id })),
  fc.constant<Scope>({ kind: "core" }),
);

describe("Property 2: Scope soundness / no leakage", () => {
  it("a non-global scope's filtered set contains no row violating the scope", () => {
    fc.assert(
      fc.property(arbNonGlobalScope, arbDataset, (scope, dataset) => {
        const survivors = dataset.filter((r) => scopePermits(scope, r.franchise_id));

        if (scope.kind === "franchise") {
          // Every surviving row belongs to exactly franchise f — no core rows,
          // no other-franchise rows.
          for (const row of survivors) {
            expect(row.franchise_id).toBe(scope.franchise_id);
            expect(row.franchise_id).not.toBeNull();
          }
          // And nothing that should have survived was dropped (completeness of
          // the filter — no false negatives).
          const expected = dataset.filter((r) => r.franchise_id === scope.franchise_id);
          expect(survivors).toEqual(expected);
        } else {
          // core: every surviving row is a core row (franchise_id === null);
          // no franchise rows leak through.
          for (const row of survivors) {
            expect(row.franchise_id).toBeNull();
          }
          const expected = dataset.filter((r) => r.franchise_id === null);
          expect(survivors).toEqual(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("scopePermits never permits a core scope to see a franchise row and vice versa", () => {
    fc.assert(
      fc.property(arbNonGlobalScope, arbRowFranchiseId, (scope, rowFranchiseId) => {
        const permitted = scopePermits(scope, rowFranchiseId);
        if (scope.kind === "franchise") {
          expect(permitted).toBe(rowFranchiseId === scope.franchise_id);
        } else {
          expect(permitted).toBe(rowFranchiseId === null);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("applyScope builds the correct franchise_id filter (eq / is / none)", () => {
    // Fake query-builder stub that records the eq/is calls applyScope makes.
    interface Call {
      method: "eq" | "is";
      column: string;
      value: unknown;
    }
    const makeStub = () => {
      const calls: Call[] = [];
      const stub = {
        calls,
        eq(column: string, value: unknown) {
          calls.push({ method: "eq", column, value });
          return stub;
        },
        is(column: string, value: unknown) {
          calls.push({ method: "is", column, value });
          return stub;
        },
      };
      return stub;
    };

    fc.assert(
      fc.property(
        fc.oneof(
          arbNonGlobalScope,
          fc.constant<Scope>({ kind: "full_network" }),
        ),
        (scope) => {
          const stub = makeStub();
          const result = applyScope(stub, scope);

          if (scope.kind === "franchise") {
            expect(stub.calls).toEqual([
              { method: "eq", column: "franchise_id", value: scope.franchise_id },
            ]);
          } else if (scope.kind === "core") {
            expect(stub.calls).toEqual([
              { method: "is", column: "franchise_id", value: null },
            ]);
          } else {
            // full_network → no filter call, and the original query is returned.
            expect(stub.calls).toEqual([]);
            expect(result).toBe(stub);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
