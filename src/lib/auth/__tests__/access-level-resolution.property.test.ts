// src/lib/auth/__tests__/access-level-resolution.property.test.ts
// Feature: dietitian-management, Property 1
//
// Property 1: Access_Level resolution round-trips and defaults safely.
//
// For any raw `users.admin_access_level` value — a recognised level, an
// unrecognised string, `null`, or a non-string — `resolveAccessLevel` returns
// that value unchanged when it is recognised and `inventory_operations`
// otherwise (Req 1.1, 1.4); for all recognised levels, resolving a persisted
// level and then persisting the resolved level yields the original stored value
// (Req 1.6). For any raw operations-group payload, `resolveAccessConfiguration`
// yields an empty group map for every level other than `operations`, including
// `dietitian` (Req 1.5), and `landingRouteFor` is total with
// `dietitian → /customers` (Req 1.6).
//
// The expected truth is derived from `TEST_ACCESS_LEVELS` in the shared
// arbitraries module — the four levels transcribed from the requirements — not
// from the module under test, so the property cannot inherit a bug from
// `ADMIN_ACCESS_LEVELS`.
//
// **Validates: Requirements 1.1, 1.4, 1.5, 1.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ADMIN_ACCESS_LEVELS,
  DEFAULT_ACCESS_LEVEL,
  DIETITIAN_ACCESS_LEVEL,
  OPERATIONS_GROUPS,
  canAccess,
  canManageGroup,
  hasGroupAccess,
  landingRouteFor,
  resolveAccessConfiguration,
  resolveAccessLevel,
  type AdminAccessLevel,
} from "../adminAccessCore";
import {
  TEST_ACCESS_LEVELS,
  accessLevelArb,
  operationsGroupsArb,
  rawAccessLevelArb,
  type TestAccessLevel,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference model ─────────────────────────────────────────────────────────
//
// The four recognised Access_Level values (Req 1.1), transcribed from the
// requirements rather than read from the implementation.
const RECOGNISED: readonly string[] = TEST_ACCESS_LEVELS;

/** What `resolveAccessLevel` must return, spelled out independently. */
function referenceResolve(raw: unknown): TestAccessLevel {
  if (typeof raw === "string" && RECOGNISED.includes(raw)) {
    return raw as TestAccessLevel;
  }
  return "inventory_operations";
}

/** A raw operations-group payload as it can arrive from the database. */
const rawGroupsArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: operationsGroupsArb as fc.Arbitrary<unknown>, weight: 4 },
  {
    arbitrary: operationsGroupsArb.map<unknown>((groups) =>
      JSON.stringify(groups),
    ),
    weight: 2,
  },
  {
    arbitrary: fc.constantFrom<unknown>(
      null,
      undefined,
      "",
      "not json",
      "[]",
      [],
      0,
      true,
      { customers: "delete" },
      { unknown_group: "manage" },
    ),
    weight: 3,
  },
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 1: Access_Level resolution round-trips and defaults safely", () => {
  it("recognises exactly the four Access_Levels, including dietitian (Req 1.1)", () => {
    expect([...ADMIN_ACCESS_LEVELS].sort()).toEqual([...RECOGNISED].sort());
    expect(ADMIN_ACCESS_LEVELS).toContain(DIETITIAN_ACCESS_LEVEL);
    expect(DEFAULT_ACCESS_LEVEL).toBe("inventory_operations");
  });

  it("returns every recognised level unchanged (Req 1.1)", () => {
    fc.assert(
      fc.property(accessLevelArb, (level) => {
        expect(resolveAccessLevel(level)).toBe(level);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("agrees with the reference model on every raw value, and never throws (Req 1.1, 1.4)", () => {
    fc.assert(
      fc.property(rawAccessLevelArb, (raw) => {
        const resolved = resolveAccessLevel(raw);
        expect(resolved).toBe(referenceResolve(raw));
        expect(ADMIN_ACCESS_LEVELS).toContain(resolved);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("coerces NULL, unknown and non-string values to inventory_operations (Req 1.4)", () => {
    fc.assert(
      fc.property(
        rawAccessLevelArb.filter(
          (raw) => !(typeof raw === "string" && RECOGNISED.includes(raw)),
        ),
        (raw) => {
          expect(resolveAccessLevel(raw)).toBe(DEFAULT_ACCESS_LEVEL);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("round-trips: resolving then persisting the resolved level is idempotent (Req 1.6)", () => {
    fc.assert(
      fc.property(rawAccessLevelArb, (raw) => {
        // Persisting the resolved level and resolving again must be a fixed
        // point — the stored value survives the round trip unchanged.
        const once = resolveAccessLevel(raw);
        expect(resolveAccessLevel(once)).toBe(once);
        expect(resolveAccessLevel(String(once))).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves dietitian to an empty operations-group map for any raw payload (Req 1.5)", () => {
    fc.assert(
      fc.property(rawGroupsArb, (rawGroups) => {
        const config = resolveAccessConfiguration(
          DIETITIAN_ACCESS_LEVEL,
          rawGroups,
        );
        expect(config.level).toBe(DIETITIAN_ACCESS_LEVEL);
        expect(config.groups).toEqual({});
        expect(Object.keys(config.groups)).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("populates the group map only for the operations level (Req 1.5)", () => {
    fc.assert(
      fc.property(rawAccessLevelArb, rawGroupsArb, (rawLevel, rawGroups) => {
        const config = resolveAccessConfiguration(rawLevel, rawGroups);
        expect(config.level).toBe(referenceResolve(rawLevel));
        if (config.level !== "operations") {
          expect(config.groups).toEqual({});
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("grants a dietitian no capability area and no operations group (Req 1.5)", () => {
    fc.assert(
      fc.property(rawGroupsArb, (rawGroups) => {
        const config = resolveAccessConfiguration(
          DIETITIAN_ACCESS_LEVEL,
          rawGroups,
        );
        expect(canAccess(config.level, "inventory")).toBe(false);
        expect(canAccess(config.level, "operations")).toBe(false);
        for (const group of OPERATIONS_GROUPS) {
          expect(hasGroupAccess(config, group)).toBe(false);
          expect(canManageGroup(config, group)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("landingRouteFor is total, with dietitian landing on /customers (Req 1.6)", () => {
    fc.assert(
      fc.property(rawAccessLevelArb, (raw) => {
        const level: AdminAccessLevel = resolveAccessLevel(raw);
        const route = landingRouteFor(level);
        expect(["/dashboard", "/inventory", "/customers"]).toContain(route);
        if (level === DIETITIAN_ACCESS_LEVEL) {
          expect(route).toBe("/customers");
        } else if (level === "inventory") {
          expect(route).toBe("/inventory");
        } else {
          expect(route).toBe("/dashboard");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
