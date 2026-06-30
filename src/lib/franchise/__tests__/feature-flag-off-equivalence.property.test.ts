// src/lib/franchise/__tests__/feature-flag-off-equivalence.property.test.ts
// Feature: core-clinic-architecture, Property 36: Feature-flag-off equivalence
//
// Property 36: Feature-flag-off equivalence — While FRANCHISE_FEATURES_ENABLED is
// false (including when the env var is unset, which resolves to false), the routing
// engine routes only Core Clinics and produces routing/customer-assignment outcomes
// identical to those produced before the clinics.franchise_id column was introduced,
// with no franchise-specific reads/writes/side effects.
//
// Validates: Requirements 10.8, 18.3, 18.4, 18.6
//
// ── Scope of THIS file ──────────────────────────────────────────────────────
// The "identical outcomes / only Core Clinics / no franchise side effects" aspects
// of Property 36 (Requirements 10.8, 18.3, 18.6) are exercised by the routing-engine
// property tests, which run with the feature flag OFF by default (e.g.
// routing-clinic-origin / routing-batch-count / routing-skip-scopes). Those tests
// rely on a single precondition: that the franchise feature flag resolves to OFF
// whenever the environment is in its default/unset state.
//
// THIS test pins that precondition (Requirement 18.4): the pure resolver
// `resolveFranchiseFeatureFlag(envValue)` returns the flag-ON state ONLY when the
// env value is exactly the string "true"; for ANY other value — undefined (unset),
// "", "false", "TRUE", "1", "yes", or arbitrary strings — it resolves to false
// (flag off). Because `isFranchiseRuntimeEnabled()` simply returns the value this
// resolver produced at module load, pinning the resolver pins the runtime guard
// that gates every franchise-specific read/write/side effect.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveFranchiseFeatureFlag } from "../constants";

describe("Property 36: Feature-flag-off equivalence", () => {
  // Generator over the full env-value input space: the spec-named values plus
  // arbitrary strings, with `undefined` (unset) explicitly represented.
  const arbEnvValue: fc.Arbitrary<string | undefined> = fc.oneof(
    fc.constant(undefined), // env var unset
    fc.constant(""),
    fc.constant("true"),
    fc.constant("false"),
    fc.constant("TRUE"),
    fc.constant("1"),
    fc.constant("yes"),
    fc.string(),
  );

  it('resolves to ON iff env value is exactly "true"; every other value is OFF', () => {
    fc.assert(
      fc.property(arbEnvValue, (envValue) => {
        expect(resolveFranchiseFeatureFlag(envValue)).toBe(envValue === "true");
      }),
      { numRuns: 100 },
    );
  });

  it("unset (undefined) and all non-\"true\" values resolve to false (flag off — Req 18.4)", () => {
    fc.assert(
      fc.property(
        arbEnvValue.filter((v) => v !== "true"),
        (envValue) => {
          expect(resolveFranchiseFeatureFlag(envValue)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the unset case specifically resolves to false (default = core operation)", () => {
    expect(resolveFranchiseFeatureFlag(undefined)).toBe(false);
  });
});
