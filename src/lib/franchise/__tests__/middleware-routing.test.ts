// src/lib/franchise/__tests__/middleware-routing.test.ts
// Property tests for routing middleware logic
//
// Property 7: Routing soundness — FRANCHISE_ADMIN always routed to franchise workspace,
// prevented from admin/master; Core_Admin routed to admin; undefined subdomain exposes no data

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { FranchiseRole } from "@/types/franchise";

// ─── Pure routing logic extraction ────────────────────────────────────────

type RoutingDecision =
  | { action: "allow" }
  | { action: "redirect"; target: "unauthorized" | "franchise-portal" }
  | { action: "no-portal" };

const PORTALS: Record<string, string> = {
  customer: "/customer",
  deliverypartner: "/rider",
  admin: "/admin",
  master: "/master",
  franchies: "/franchise",
};

/**
 * Pure function replicating the middleware gatekeeper logic.
 */
function resolveRouting(
  subdomain: string | undefined,
  roleCode: string | null
): RoutingDecision {
  // No subdomain match → no portal routing
  if (!subdomain || !PORTALS[subdomain]) {
    return { action: "no-portal" };
  }

  // Not authenticated
  if (!roleCode) {
    return { action: "redirect", target: "unauthorized" };
  }

  // Admin portal: only ADMIN allowed
  if (subdomain === "admin" && roleCode !== "ADMIN") {
    return { action: "redirect", target: "unauthorized" };
  }

  // Delivery partner portal: only RIDER allowed
  if (subdomain === "deliverypartner" && roleCode !== "RIDER") {
    return { action: "redirect", target: "unauthorized" };
  }

  // Master portal: only MASTER_ADMIN allowed
  if (subdomain === "master" && roleCode !== "MASTER_ADMIN") {
    return { action: "redirect", target: "unauthorized" };
  }

  // Franchise portal: only FRANCHISE_ADMIN allowed
  if (subdomain === "franchies" && roleCode !== "FRANCHISE_ADMIN") {
    return { action: "redirect", target: "unauthorized" };
  }

  // Customer portal: only CUSTOMER allowed
  if (subdomain === "customer" && roleCode !== "CUSTOMER") {
    return { action: "redirect", target: "unauthorized" };
  }

  return { action: "allow" };
}

// ─── Arbitrary generators ──────────────────────────────────────────────────

const arbRole = fc.constantFrom<FranchiseRole>(
  "ADMIN",
  "MASTER_ADMIN",
  "FRANCHISE_ADMIN",
  "RIDER",
  "CUSTOMER"
);

const arbSubdomain = fc.constantFrom(
  "admin",
  "master",
  "franchies",
  "deliverypartner",
  "customer"
);

const arbInvalidSubdomain = fc.constantFrom(
  "unknown",
  "test",
  "api",
  "www",
  undefined
);

// ─── Property Tests ────────────────────────────────────────────────────────

describe("Middleware Routing - Property Tests", () => {
  describe("Property 7: Routing soundness", () => {
    it("FRANCHISE_ADMIN is always allowed on franchies subdomain", () => {
      const result = resolveRouting("franchies", "FRANCHISE_ADMIN");
      expect(result.action).toBe("allow");
    });

    it("FRANCHISE_ADMIN is always DENIED on admin subdomain", () => {
      const result = resolveRouting("admin", "FRANCHISE_ADMIN");
      expect(result.action).toBe("redirect");
    });

    it("FRANCHISE_ADMIN is always DENIED on master subdomain", () => {
      const result = resolveRouting("master", "FRANCHISE_ADMIN");
      expect(result.action).toBe("redirect");
    });

    it("ADMIN is always allowed on admin subdomain", () => {
      const result = resolveRouting("admin", "ADMIN");
      expect(result.action).toBe("allow");
    });

    it("MASTER_ADMIN is always allowed on master subdomain", () => {
      const result = resolveRouting("master", "MASTER_ADMIN");
      expect(result.action).toBe("allow");
    });

    it("RIDER is always allowed on deliverypartner subdomain", () => {
      const result = resolveRouting("deliverypartner", "RIDER");
      expect(result.action).toBe("allow");
    });

    it("undefined subdomain exposes no portal (no-portal action)", () => {
      fc.assert(
        fc.property(arbRole, (role) => {
          const result = resolveRouting(undefined, role);
          expect(result.action).toBe("no-portal");
        }),
        { numRuns: 50 }
      );
    });

    it("unknown subdomain exposes no portal", () => {
      fc.assert(
        fc.property(arbRole, arbInvalidSubdomain, (role, subdomain) => {
          const result = resolveRouting(subdomain, role);
          expect(result.action).toBe("no-portal");
        }),
        { numRuns: 100 }
      );
    });

    it("each role is allowed on exactly one portal (mutual exclusion)", () => {
      const rolePortalMap: Record<string, string> = {
        ADMIN: "admin",
        MASTER_ADMIN: "master",
        FRANCHISE_ADMIN: "franchies",
        RIDER: "deliverypartner",
        CUSTOMER: "customer",
      };

      fc.assert(
        fc.property(arbRole, (role) => {
          const validPortals = Object.keys(PORTALS);
          let allowedCount = 0;

          for (const portal of validPortals) {
            const result = resolveRouting(portal, role);
            if (result.action === "allow") {
              allowedCount++;
              expect(portal).toBe(rolePortalMap[role]);
            }
          }

          // Each role should be allowed on exactly 1 portal
          expect(allowedCount).toBe(1);
        }),
        { numRuns: 50 }
      );
    });

    it("no role can access a portal that isn't theirs", () => {
      fc.assert(
        fc.property(arbRole, arbSubdomain, (role, subdomain) => {
          const rolePortalMap: Record<string, string> = {
            ADMIN: "admin",
            MASTER_ADMIN: "master",
            FRANCHISE_ADMIN: "franchies",
            RIDER: "deliverypartner",
            CUSTOMER: "customer",
          };

          const result = resolveRouting(subdomain, role);

          if (subdomain === rolePortalMap[role]) {
            expect(result.action).toBe("allow");
          } else {
            expect(result.action).toBe("redirect");
          }
        }),
        { numRuns: 200 }
      );
    });

    it("unauthenticated user (null role) is redirected on all portals", () => {
      fc.assert(
        fc.property(arbSubdomain, (subdomain) => {
          const result = resolveRouting(subdomain, null);
          expect(result.action).toBe("redirect");
        }),
        { numRuns: 50 }
      );
    });
  });
});
