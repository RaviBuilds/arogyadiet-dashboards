// src/lib/franchise/__tests__/stamping.test.ts
// Property tests for franchise data stamping
//
// Property 5: No cross-contamination on write — franchise user records always stamped with own franchise_id
// Property 6: Core records untouched — ADMIN/Core user records always get NULL franchise_id

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { FranchiseContext, FranchiseRole } from "@/types/franchise";

// Mock the feature flag to always be enabled for testing
vi.mock("../constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../constants")>();
  return {
    ...actual,
    FRANCHISE_FEATURES_ENABLED: true,
  };
});

import {
  stampFranchiseId,
  applyFranchiseStamp,
  validateFranchiseWriteAccess,
} from "../stamping";

// ─── Arbitrary generators ──────────────────────────────────────────────────

const arbUuid = fc.uuid();

function buildContext(
  role: FranchiseRole,
  franchiseId: string | null
): FranchiseContext {
  return {
    role,
    franchise_id: franchiseId,
    franchise_name: franchiseId ? "Test Franchise" : null,
    is_franchise_scoped: role === "FRANCHISE_ADMIN" || franchiseId !== null,
  };
}

// ─── Property Tests ────────────────────────────────────────────────────────

describe("Franchise Data Stamping - Property Tests", () => {
  describe("Property 5: No cross-contamination on write", () => {
    it("FRANCHISE_ADMIN always stamps with their own franchise_id, regardless of any other input", () => {
      fc.assert(
        fc.property(arbUuid, (franchiseId) => {
          const context = buildContext("FRANCHISE_ADMIN", franchiseId);
          const result = stampFranchiseId(context);

          // MUST be their own franchise_id — never null, never another ID
          expect(result).toBe(franchiseId);
        }),
        { numRuns: 300 }
      );
    });

    it("FRANCHISE_ADMIN stamp ignores any payload franchise_id — always uses context", () => {
      fc.assert(
        fc.property(arbUuid, arbUuid, (contextFranchiseId, payloadFranchiseId) => {
          const context = buildContext("FRANCHISE_ADMIN", contextFranchiseId);
          const record = { name: "test", franchise_id: payloadFranchiseId };
          const stamped = applyFranchiseStamp(record, context);

          // The stamped record MUST use the context franchise_id, not the payload
          expect(stamped.franchise_id).toBe(contextFranchiseId);
        }),
        { numRuns: 300 }
      );
    });

    it("FRANCHISE_ADMIN without franchise throws (error state)", () => {
      const context = buildContext("FRANCHISE_ADMIN", null);

      expect(() => stampFranchiseId(context)).toThrow(
        "FRANCHISE_ADMIN user has no assigned franchise_id"
      );
    });
  });

  describe("Property 6: Core records untouched", () => {
    it("ADMIN always stamps NULL regardless of context state", () => {
      fc.assert(
        fc.property(
          fc.oneof(arbUuid, fc.constant(null)),
          (possibleFranchiseId) => {
            // Even if somehow an ADMIN context had a franchise_id, stamp is NULL
            const context: FranchiseContext = {
              role: "ADMIN",
              franchise_id: possibleFranchiseId,
              franchise_name: null,
              is_franchise_scoped: false,
            };
            const result = stampFranchiseId(context);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 200 }
      );
    });

    it("MASTER_ADMIN always stamps NULL", () => {
      fc.assert(
        fc.property(
          fc.oneof(arbUuid, fc.constant(null)),
          (possibleFranchiseId) => {
            const context: FranchiseContext = {
              role: "MASTER_ADMIN",
              franchise_id: possibleFranchiseId,
              franchise_name: null,
              is_franchise_scoped: false,
            };
            const result = stampFranchiseId(context);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 200 }
      );
    });

    it("null context (feature off) always returns null", () => {
      const result = stampFranchiseId(null);
      expect(result).toBeNull();
    });

    it("core RIDER/CUSTOMER (null franchise_id) stamps NULL", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<FranchiseRole>("RIDER", "CUSTOMER"),
          (role) => {
            const context = buildContext(role, null);
            // Manually fix is_franchise_scoped for null case
            context.is_franchise_scoped = false;
            const result = stampFranchiseId(context);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Franchise-assigned RIDER/CUSTOMER stamps correctly", () => {
    it("franchise RIDER/CUSTOMER stamps with their franchise_id", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<FranchiseRole>("RIDER", "CUSTOMER"),
          arbUuid,
          (role, franchiseId) => {
            const context = buildContext(role, franchiseId);
            const result = stampFranchiseId(context);
            expect(result).toBe(franchiseId);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("validateFranchiseWriteAccess", () => {
    it("ADMIN/MASTER_ADMIN can write to any franchise", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<FranchiseRole>("ADMIN", "MASTER_ADMIN"),
          fc.oneof(arbUuid, fc.constant(null)),
          (role, targetId) => {
            const context = buildContext(role, null);
            context.is_franchise_scoped = false;
            const result = validateFranchiseWriteAccess(context, targetId);
            expect(result.allowed).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("FRANCHISE_ADMIN cannot write to a different franchise", () => {
      fc.assert(
        fc.property(arbUuid, arbUuid, (ownFranchise, targetFranchise) => {
          fc.pre(ownFranchise !== targetFranchise); // ensure they're different
          const context = buildContext("FRANCHISE_ADMIN", ownFranchise);
          const result = validateFranchiseWriteAccess(context, targetFranchise);
          expect(result.allowed).toBe(false);
        }),
        { numRuns: 300 }
      );
    });

    it("FRANCHISE_ADMIN can write to their own franchise", () => {
      fc.assert(
        fc.property(arbUuid, (franchiseId) => {
          const context = buildContext("FRANCHISE_ADMIN", franchiseId);
          const result = validateFranchiseWriteAccess(context, franchiseId);
          expect(result.allowed).toBe(true);
        }),
        { numRuns: 200 }
      );
    });
  });
});
