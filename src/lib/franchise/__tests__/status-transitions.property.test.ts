// src/lib/franchise/__tests__/status-transitions.property.test.ts
// Feature: multi-tenant-franchise, Property 9: Franchise status transition validity
//
// Property 9: Franchise status transition validity — For any `from`/`to` pair
// over the three franchise statuses ('onboarding' | 'active' | 'suspended'),
// the pure predicate `isValidStatusTransition(from, to)` must agree with the
// reference lifecycle rule (Req 4.8, 15.6):
//   - activate / reactivate (to === 'active')    → valid iff from !== 'active'
//   - suspend               (to === 'suspended') → valid iff from !== 'suspended'
//   - to === 'onboarding'                        → never valid
// In particular, every no-op transition (from === to) is rejected so the
// lifecycle never "transitions" without changing the status (Req 4.8).
//
// The module under test (src/lib/franchise/status-transitions.ts) is PURE: it
// has no Supabase / auth / Next.js imports, so it is exercised here in complete
// isolation.
//
// Validates: Requirements 4.8, 15.6

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { FranchiseStatus } from "@/types/franchise";
import { isValidStatusTransition } from "@/lib/franchise/status-transitions";

// ─── Reference rule ──────────────────────────────────────────────────────────
//
// Independent re-statement of the lifecycle rule the predicate must satisfy
// (Req 4.8): a transition is valid only when it changes the status, and no
// transition ever targets `onboarding`.
function referenceValid(from: FranchiseStatus, to: FranchiseStatus): boolean {
  switch (to) {
    case "active":
      return from !== "active";
    case "suspended":
      return from !== "suspended";
    case "onboarding":
      return false;
  }
}

// ─── Arbitrary generators ──────────────────────────────────────────────────────

const STATUSES = ["onboarding", "active", "suspended"] as const;

const arbStatus: fc.Arbitrary<FranchiseStatus> = fc.constantFrom(...STATUSES);

const NUM_RUNS = 200;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 9: Franchise status transition validity", () => {
  it("isValidStatusTransition(from, to) ≡ reference lifecycle rule for every status pair (Req 4.8, 15.6)", () => {
    fc.assert(
      fc.property(arbStatus, arbStatus, (from, to) => {
        expect(isValidStatusTransition(from, to)).toBe(referenceValid(from, to));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every no-op transition (from === to) is rejected (Req 4.8)", () => {
    fc.assert(
      fc.property(arbStatus, (status) => {
        expect(isValidStatusTransition(status, status)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ── Targeted assertions over the full, small state space ──────────────────

  it("activate-when-active and suspend-when-suspended are rejected (Req 4.8)", () => {
    expect(isValidStatusTransition("active", "active")).toBe(false);
    expect(isValidStatusTransition("suspended", "suspended")).toBe(false);
  });

  it("onboarding→active, active→suspended, and suspended→active are accepted (Req 15.6)", () => {
    expect(isValidStatusTransition("onboarding", "active")).toBe(true);
    expect(isValidStatusTransition("active", "suspended")).toBe(true);
    expect(isValidStatusTransition("suspended", "active")).toBe(true);
  });

  it("no transition ever targets onboarding (Req 4.8)", () => {
    for (const from of STATUSES) {
      expect(isValidStatusTransition(from, "onboarding")).toBe(false);
    }
  });
});
