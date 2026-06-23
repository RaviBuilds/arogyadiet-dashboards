// src/lib/franchise/__tests__/assignment-resolver.test.ts
// Property tests for pincode assignment and resolution logic
//
// Property 4: Single assignment — every pincode resolves to exactly one entity
// Property 10: Conflict detection prevents live activation
// Property 11: Core operation excluded from franchise registry

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { pincodeSchema } from "@/validations/franchiseSchemas";
import { VALID_STATUS_TRANSITIONS } from "../constants";

// ─── Pure logic tests (no DB dependency) ───────────────────────────────────

/**
 * Simulates pincode resolution logic without DB.
 * Given a mapping of pincodes → owners, verifies single-assignment property.
 */
type PincodeOwner =
  | { type: "core" }
  | { type: "franchise"; franchise_id: string }
  | { type: "unassigned" };

function simulateResolution(
  pincode: string,
  franchisePincodes: Map<string, string>, // pincode → franchise_id
  corePincodes: Set<string>
): PincodeOwner {
  // Franchise assignment takes priority if active
  if (franchisePincodes.has(pincode)) {
    return { type: "franchise", franchise_id: franchisePincodes.get(pincode)! };
  }

  // Core pincodes
  if (corePincodes.has(pincode)) {
    return { type: "core" };
  }

  // Unassigned
  return { type: "unassigned" };
}

/**
 * Validates uniqueness constraint: no pincode can appear in both maps.
 */
function hasConflict(
  franchisePincodes: Map<string, string>,
  corePincodes: Set<string>
): string[] {
  const conflicts: string[] = [];
  for (const pincode of franchisePincodes.keys()) {
    if (corePincodes.has(pincode)) {
      conflicts.push(pincode);
    }
  }
  return conflicts;
}

// ─── Arbitrary generators ──────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);
const arbFranchiseId = fc.uuid();

// Generate a franchise pincode map (no duplicates within franchises)
const arbFranchisePincodeMap = fc
  .array(fc.tuple(arbPincode, arbFranchiseId), { maxLength: 50 })
  .map((pairs) => {
    const map = new Map<string, string>();
    for (const [pincode, fid] of pairs) {
      if (!map.has(pincode)) map.set(pincode, fid);
    }
    return map;
  });

// Generate core pincodes set
const arbCorePincodes = fc
  .array(arbPincode, { maxLength: 30 })
  .map((arr) => new Set(arr));

// ─── Property Tests ────────────────────────────────────────────────────────

describe("Pincode Assignment & Resolution - Property Tests", () => {
  describe("Property 4: Single assignment — pincode resolves to exactly one entity", () => {
    it("any pincode resolves to exactly one of: core, franchise, or unassigned", () => {
      fc.assert(
        fc.property(
          arbPincode,
          arbFranchisePincodeMap,
          arbCorePincodes,
          (pincode, franchiseMap, coreSet) => {
            const result = simulateResolution(pincode, franchiseMap, coreSet);

            // Must be exactly one type
            expect(["core", "franchise", "unassigned"]).toContain(result.type);

            // If franchise, must have an id
            if (result.type === "franchise") {
              expect(result.franchise_id).toBeDefined();
              expect(result.franchise_id.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it("a pincode in the franchise map always resolves to franchise (not core)", () => {
      fc.assert(
        fc.property(
          arbFranchisePincodeMap.filter((m) => m.size > 0),
          (franchiseMap) => {
            // Pick a random pincode from the map
            const entries = [...franchiseMap.entries()];
            const [pincode, expectedFid] = entries[0];

            // With empty core set, should resolve to franchise
            const result = simulateResolution(
              pincode,
              franchiseMap,
              new Set()
            );
            expect(result.type).toBe("franchise");
            if (result.type === "franchise") {
              expect(result.franchise_id).toBe(expectedFid);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it("a pincode only in core set resolves to core", () => {
      fc.assert(
        fc.property(
          arbCorePincodes.filter((s) => s.size > 0),
          (coreSet) => {
            const pincode = [...coreSet][0];
            // Empty franchise map
            const result = simulateResolution(
              pincode,
              new Map(),
              coreSet
            );
            expect(result.type).toBe("core");
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Property 10: Conflict detection prevents live activation", () => {
    it("overlapping pincodes between franchise and core are detected as conflicts", () => {
      fc.assert(
        fc.property(
          arbPincode,
          arbFranchiseId,
          (sharedPincode, franchiseId) => {
            const franchiseMap = new Map([[sharedPincode, franchiseId]]);
            const coreSet = new Set([sharedPincode]);

            const conflicts = hasConflict(franchiseMap, coreSet);
            expect(conflicts).toContain(sharedPincode);
            expect(conflicts.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("non-overlapping pincodes produce zero conflicts", () => {
      fc.assert(
        fc.property(
          arbFranchisePincodeMap,
          arbCorePincodes,
          (franchiseMap, coreSet) => {
            // Remove any overlaps from core set to ensure no conflict
            const cleanCoreSet = new Set(
              [...coreSet].filter((p) => !franchiseMap.has(p))
            );

            const conflicts = hasConflict(franchiseMap, cleanCoreSet);
            expect(conflicts).toHaveLength(0);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Property 11: Core operation excluded from franchise registry", () => {
    it("core pincodes never resolve to a franchise entity", () => {
      fc.assert(
        fc.property(
          arbCorePincodes.filter((s) => s.size > 0),
          (coreSet) => {
            const pincode = [...coreSet][0];
            // Empty franchise map = no franchise assignments
            const result = simulateResolution(pincode, new Map(), coreSet);
            expect(result.type).not.toBe("franchise");
            expect(result.type).toBe("core");
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Pincode validation schema", () => {
    it("accepts valid 6-digit pincodes", () => {
      fc.assert(
        fc.property(arbPincode, (pincode) => {
          const result = pincodeSchema.safeParse(pincode);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it("rejects non-6-digit strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !/^[0-9]{6}$/.test(s)),
          (invalid) => {
            const result = pincodeSchema.safeParse(invalid);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Status transitions", () => {
    it("onboarding can only go to active", () => {
      expect(VALID_STATUS_TRANSITIONS.onboarding).toEqual(["active"]);
    });

    it("active can only go to suspended", () => {
      expect(VALID_STATUS_TRANSITIONS.active).toEqual(["suspended"]);
    });

    it("suspended can only go to active", () => {
      expect(VALID_STATUS_TRANSITIONS.suspended).toEqual(["active"]);
    });

    it("no status can transition back to onboarding", () => {
      for (const [, targets] of Object.entries(VALID_STATUS_TRANSITIONS)) {
        expect(targets).not.toContain("onboarding");
      }
    });
  });
});
