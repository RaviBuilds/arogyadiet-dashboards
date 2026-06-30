// src/lib/auth/__tests__/scope-predicate.property.test.ts
// Feature: multi-tenant-franchise, Property 1: Tenant isolation soundness
//
// Property 1: Tenant isolation soundness — The pure app-layer scope predicate
// `scopePermits(scope, rowFranchiseId)` must agree, for every possible scope and
// row, with the database Row Level Security (RLS) predicate it mirrors:
//
//     is_global_role()
//       OR franchise_id = current_franchise_id()
//       OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
//
// so that no layer permits what the other denies (app-layer ≡ RLS-layer).
//
// Validates: Requirements 10.1, 10.2, 18.7

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { scopePermits } from "../scope-predicate";
import type { Scope } from "@/types/franchise";

// ─── Reference RLS predicate ────────────────────────────────────────────────
//
// Encodes the SQL USING / WITH CHECK clause exactly, in terms of the database's
// view of the world: the caller's (role, currentFranchiseId) and the row's
// franchise_id.
//   - is_global_role()          → role === "full_network"
//   - franchise_id = current_franchise_id()
//   - (franchise_id IS NULL AND current_franchise_id() IS NULL)
//
// `currentFranchiseId` is the franchise the session is pinned to:
//   - full_network → null (a global role is not pinned to any franchise)
//   - franchise(f) → f
//   - core         → null (the Core tenant: franchise_id IS NULL)
type Role = "full_network" | "franchise" | "core";

function rlsPermits(
  role: Role,
  currentFranchiseId: string | null,
  rowFranchiseId: string | null
): boolean {
  const isGlobalRole = role === "full_network";
  return (
    isGlobalRole ||
    rowFranchiseId === currentFranchiseId ||
    (rowFranchiseId === null && currentFranchiseId === null)
  );
}

/** Maps a Scope to the equivalent RLS (role, currentFranchiseId) pair. */
function rlsContextForScope(scope: Scope): {
  role: Role;
  currentFranchiseId: string | null;
} {
  switch (scope.kind) {
    case "full_network":
      return { role: "full_network", currentFranchiseId: null };
    case "franchise":
      return { role: "franchise", currentFranchiseId: scope.franchise_id };
    case "core":
      return { role: "core", currentFranchiseId: null };
  }
}

// ─── Arbitrary generators ───────────────────────────────────────────────────

/**
 * A small pool of uuid-like franchise ids. Kept small (and reused across scope
 * franchise_id and rowFranchiseId) so that the `franchise(f)` vs `rowFid === f`
 * case is meaningfully exercised — matches and mismatches both occur frequently.
 */
const FRANCHISE_POOL = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
] as const;

const arbFranchiseId: fc.Arbitrary<string> = fc.constantFrom(...FRANCHISE_POOL);

/** A scope of each kind; franchise scopes draw their id from the shared pool. */
const arbScope: fc.Arbitrary<Scope> = fc.oneof(
  fc.constant<Scope>({ kind: "full_network" }),
  arbFranchiseId.map<Scope>((franchise_id) => ({ kind: "franchise", franchise_id })),
  fc.constant<Scope>({ kind: "core" })
);

/** A row's franchise_id: drawn from the shared pool, or null (Core row). */
const arbRowFranchiseId: fc.Arbitrary<string | null> = fc.oneof(
  arbFranchiseId,
  fc.constant(null)
);

const NUM_RUNS = 200;

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 1: Tenant isolation soundness", () => {
  it("app-layer scopePermits ≡ RLS-layer predicate for every scope and row (Req 18.7)", () => {
    fc.assert(
      fc.property(arbScope, arbRowFranchiseId, (scope, rowFranchiseId) => {
        const { role, currentFranchiseId } = rlsContextForScope(scope);
        expect(scopePermits(scope, rowFranchiseId)).toBe(
          rlsPermits(role, currentFranchiseId, rowFranchiseId)
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("full_network permits every row (is_global_role — Req 10.1)", () => {
    fc.assert(
      fc.property(arbRowFranchiseId, (rowFranchiseId) => {
        expect(scopePermits({ kind: "full_network" }, rowFranchiseId)).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("franchise(f) permits a row iff rowFranchiseId === f (tenant isolation — Req 10.2)", () => {
    fc.assert(
      fc.property(arbFranchiseId, arbRowFranchiseId, (franchise_id, rowFranchiseId) => {
        const scope: Scope = { kind: "franchise", franchise_id };
        expect(scopePermits(scope, rowFranchiseId)).toBe(rowFranchiseId === franchise_id);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("core permits a row iff rowFranchiseId === null (Core tenant — Req 10.2)", () => {
    fc.assert(
      fc.property(arbRowFranchiseId, (rowFranchiseId) => {
        expect(scopePermits({ kind: "core" }, rowFranchiseId)).toBe(rowFranchiseId === null);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
