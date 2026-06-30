// Feature: master-inventory-management, Property 8: Revalidation targets match the initiating portal context
//
// Property 8: For any set of affected warehouse areas,
// `resolveRevalidationTargets(portal, areas)` yields only the Master workspace
// paths for those areas when `portal` is `"master"`, only the Admin paths when
// `portal` is `"admin"`, and the union of both portals' paths when `portal` is
// `"unknown"`; the result never contains the other portal's paths in the
// `"master"` and `"admin"` cases.
//
// Validates: Requirements 7.1, 7.2, 7.4

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveRevalidationTargets,
  type PortalContext,
  type WarehouseArea,
} from "@/lib/inventory/warehouse-access";

// ─── Path tables (mirroring the implementation for assertion reference) ────────

const ADMIN_PATHS: Record<WarehouseArea, string> = {
  catalog: "/admin/inventory",
  manufacturing: "/admin/inventory/manufacturing",
  mappings: "/admin/inventory/mappings",
};

const MASTER_PATHS: Record<WarehouseArea, string> = {
  catalog: "/inventory/warehouse",
  manufacturing: "/inventory/warehouse/manufacturing",
  mappings: "/inventory/warehouse/mappings",
};

// ─── Generators ───────────────────────────────────────────────────────────────

const ALL_AREAS: WarehouseArea[] = ["catalog", "manufacturing", "mappings"];

/** Power set of warehouse areas (all possible subsets including empty). */
const arbAreaSubset: fc.Arbitrary<WarehouseArea[]> = fc.subarray(ALL_AREAS);

/** Portal context drawn from the three valid values. */
const arbPortalContext: fc.Arbitrary<PortalContext> = fc.constantFrom<PortalContext>(
  "admin",
  "master",
  "unknown",
);

// ─── Property test ────────────────────────────────────────────────────────────

describe("Property 8: Revalidation targets match the initiating portal context", () => {
  it("returns only the correct portal paths for the given areas, with no duplicates", () => {
    fc.assert(
      fc.property(arbPortalContext, arbAreaSubset, (portal, areas) => {
        const result = resolveRevalidationTargets(portal, areas);

        // ── Assert: empty areas input returns empty array ──
        if (areas.length === 0) {
          expect(result).toEqual([]);
          return;
        }

        // ── Assert: no duplicates in the returned array ──
        const unique = new Set(result);
        expect(unique.size).toBe(result.length);

        // ── Assert: portal-specific path correctness ──
        if (portal === "admin") {
          // All returned paths start with `/admin/inventory`
          for (const path of result) {
            expect(path.startsWith("/admin/inventory")).toBe(true);
          }
          // Must not contain any master paths
          for (const area of areas) {
            expect(result).not.toContain(MASTER_PATHS[area]);
          }
          // Must contain exactly the admin paths for the given areas
          const expectedAdmin = areas.map((a) => ADMIN_PATHS[a]);
          expect(result.sort()).toEqual([...new Set(expectedAdmin)].sort());
        } else if (portal === "master") {
          // All returned paths start with `/inventory/warehouse`
          for (const path of result) {
            expect(path.startsWith("/inventory/warehouse")).toBe(true);
          }
          // Must not contain any admin paths
          for (const area of areas) {
            expect(result).not.toContain(ADMIN_PATHS[area]);
          }
          // Must contain exactly the master paths for the given areas
          const expectedMaster = areas.map((a) => MASTER_PATHS[a]);
          expect(result.sort()).toEqual([...new Set(expectedMaster)].sort());
        } else {
          // portal === "unknown": returns the union of both portals' paths
          const expectedAdmin = areas.map((a) => ADMIN_PATHS[a]);
          const expectedMaster = areas.map((a) => MASTER_PATHS[a]);
          const expectedUnion = [...new Set([...expectedAdmin, ...expectedMaster])];

          expect(result.sort()).toEqual(expectedUnion.sort());

          // All admin paths for the areas are present
          for (const area of areas) {
            expect(result).toContain(ADMIN_PATHS[area]);
          }
          // All master paths for the areas are present
          for (const area of areas) {
            expect(result).toContain(MASTER_PATHS[area]);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
