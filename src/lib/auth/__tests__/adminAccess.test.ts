// src/lib/auth/__tests__/adminAccess.test.ts
//
// Property tests for the core admin access-level utilities.
//
// Task 2.2 — Property 10: Backward-compatible resolution
// Task 2.4 — Property 1/2/3/8: path classification + access gate

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ADMIN_ACCESS_LEVELS,
  type AdminAccessLevel,
  resolveAccessLevel,
  classifyAdminPath,
  isAdminPathAllowed,
} from "../adminAccessCore";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbValidLevel = fc.constantFrom<AdminAccessLevel>(...ADMIN_ACCESS_LEVELS);

// Inventory-area paths (boundary-correct).
const arbInventoryPath = fc.oneof(
  fc.constant("/admin/inventory"),
  fc
    .array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { minLength: 1, maxLength: 4 })
    .map((segs) => "/admin/inventory/" + segs.join("/")),
);

// Operations-area paths (boundary-correct).
const OPERATIONS_BASES = [
  "/admin/dashboard",
  "/admin/customers",
  "/admin/subscriptions",
  "/admin/riders",
  "/admin/operations",
  "/admin/kitchen-shop",
  "/admin/franchises",
];
const arbOperationsPath = fc
  .tuple(
    fc.constantFrom(...OPERATIONS_BASES),
    fc.array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { maxLength: 4 }),
  )
  .map(([base, segs]) => (segs.length ? base + "/" + segs.join("/") : base));

// Neutral paths: absolute paths that do NOT start with any classified prefix.
const arbNeutralPath = fc
  .array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { minLength: 1, maxLength: 4 })
  .map((segs) => "/" + segs.join("/"))
  .filter((p) => classifyAdminPath(p) === null);

// ─── Task 2.2 / Property 10: Backward-compatible resolution ───────────────────

describe("resolveAccessLevel — Property 10: backward-compatible resolution", () => {
  it("is idempotent on every valid access level", () => {
    fc.assert(
      fc.property(arbValidLevel, (level) => {
        expect(resolveAccessLevel(level)).toBe(level);
        // Idempotent: resolving the resolved value yields the same value.
        expect(resolveAccessLevel(resolveAccessLevel(level))).toBe(level);
      }),
      { numRuns: 200 },
    );
  });

  it("maps any non-matching input to inventory_operations and never throws/returns null", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(""),
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.object(),
          fc.array(fc.anything()),
          // near-misses (wrong case / whitespace) must NOT match
          fc.constantFrom(
            "Inventory",
            "OPERATIONS",
            " inventory",
            "inventory ",
            "inventory_operations\n",
            "full",
          ),
        ),
        (raw) => {
          // Skip inputs that happen to be exactly a valid level.
          fc.pre(
            !(
              typeof raw === "string" &&
              (ADMIN_ACCESS_LEVELS as readonly string[]).includes(raw)
            ),
          );
          const result = resolveAccessLevel(raw);
          expect(result).toBe("inventory_operations");
          expect(result).not.toBeNull();
          expect(result).not.toBeUndefined();
          expect(ADMIN_ACCESS_LEVELS).toContain(result);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("returns a valid level for absolutely any input without throwing", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const result = resolveAccessLevel(raw);
        expect(ADMIN_ACCESS_LEVELS).toContain(result);
      }),
      { numRuns: 500 },
    );
  });
});

// ─── Task 2.4 / Properties 1, 2, 3, 8: classification + gate ──────────────────

describe("Access gate — Property 1: inventory-only never reaches operations", () => {
  it("denies every operations-area path and permits every inventory-area path", () => {
    fc.assert(
      fc.property(arbOperationsPath, (path) => {
        expect(classifyAdminPath(path)).toBe("operations");
        expect(isAdminPathAllowed("inventory", path)).toBe(false);
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(arbInventoryPath, (path) => {
        expect(isAdminPathAllowed("inventory", path)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Access gate — Property 2: operations-only never reaches inventory", () => {
  it("denies every inventory-area path and permits every operations-area path", () => {
    fc.assert(
      fc.property(arbInventoryPath, (path) => {
        expect(classifyAdminPath(path)).toBe("inventory");
        expect(isAdminPathAllowed("operations", path)).toBe(false);
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(arbOperationsPath, (path) => {
        expect(isAdminPathAllowed("operations", path)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Access gate — Property 3: full access reaches everything", () => {
  it("permits inventory, operations, and neutral paths alike", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbInventoryPath, arbOperationsPath, arbNeutralPath),
        (path) => {
          expect(isAdminPathAllowed("inventory_operations", path)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("Access gate — Property 8: neutral paths are universally reachable", () => {
  it("permits neutral paths for every access level", () => {
    fc.assert(
      fc.property(arbValidLevel, arbNeutralPath, (level, path) => {
        expect(classifyAdminPath(path)).toBeNull();
        expect(isAdminPathAllowed(level, path)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("treats empty / non-absolute / non-string paths as neutral (reachable)", () => {
    fc.assert(
      fc.property(
        arbValidLevel,
        fc.oneof(
          fc.constant(""),
          fc.constant(null),
          fc.constant(undefined),
          fc.stringMatching(/^[a-z]{1,8}$/), // no leading slash
          fc.integer(),
        ),
        (level, path) => {
          expect(classifyAdminPath(path as unknown)).toBeNull();
          expect(isAdminPathAllowed(level, path as unknown)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
