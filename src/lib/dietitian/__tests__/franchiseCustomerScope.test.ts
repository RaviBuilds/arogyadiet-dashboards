// src/lib/dietitian/__tests__/franchiseCustomerScope.test.ts
//
// SECURITY REGRESSION TESTS for the franchise customers directory read scope.
//
// THE BUG THESE PIN: `src/app/franchise/(main)/customers/page.tsx` reads through
// the service-role client, so RLS — and therefore
// `public.dietitian_can_read_customer` — is bypassed. The page applied only the
// tenant filter `.eq("franchise_id", …)`, never selected `dietitian_id`, and
// discarded the guard's `userId`. A Franchise Dietitian was therefore served
// EVERY customer of their franchise.
//
// This is the application-layer half of
// `scripts/allow-multiple-franchise-dietitians.sql`, which narrowed the database
// predicate so a franchise can run a team of Dietitians without each reading
// their colleagues' customers. On any surface that bypasses RLS, that migration
// does nothing on its own.
//
// The predicate itself is already pinned by
// `src/test/dietitian/scope-soundness.property.test.ts` against an independent
// transcription of the SQL. These tests cover the wiring around it: the
// not-a-Dietitian passthrough, the fail-closed branch, and the tenant conjunct
// being supplied rather than left undefined.

import { describe, it, expect } from "vitest";
import {
  scopeFranchiseCustomersForDietitian,
  type DietitianScopeContext,
} from "../franchiseCustomerScope";

const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
const DIETITIAN_1 = "33333333-3333-4333-8333-333333333333";
const DIETITIAN_2 = "44444444-4444-4444-8444-444444444444";
const CLINIC_1 = "55555555-5555-4555-8555-555555555555";

interface Row {
  id: string;
  clinic_id: string | null;
  dietitianId?: string | null;
}

const rows: Row[] = [
  { id: "assigned-to-1", clinic_id: CLINIC_1, dietitianId: DIETITIAN_1 },
  { id: "assigned-to-2", clinic_id: CLINIC_1, dietitianId: DIETITIAN_2 },
  { id: "unassigned", clinic_id: CLINIC_1, dietitianId: null },
  { id: "no-clinic-assigned-to-1", clinic_id: null, dietitianId: DIETITIAN_1 },
  { id: "field-absent", clinic_id: CLINIC_1 },
];

const franchiseDietitian: DietitianScopeContext = {
  userId: DIETITIAN_1,
  franchiseId: FRANCHISE_A,
  clinicId: CLINIC_1,
};

const idsOf = (result: Row[]) => result.map((r) => r.id).sort();

describe("scopeFranchiseCustomersForDietitian", () => {
  describe("a non-Dietitian franchise user (owner / operations)", () => {
    it("receives every row unchanged — the tenant filter is their whole scope", () => {
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        false,
        null,
      );
      expect(idsOf(result)).toEqual(idsOf(rows));
    });

    it("is unaffected by a Dietitian context being present", () => {
      // Belt-and-braces: `isDietitian` is the authority, not the presence of a
      // context, so an owner is never narrowed by a stray resolution.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        false,
        franchiseDietitian,
      );
      expect(idsOf(result)).toEqual(idsOf(rows));
    });

    it("does not hand back the caller's own array instance", () => {
      // The page passes this straight to a Client Component; returning the input
      // array would let a later mutation here surprise the caller.
      const input = [...rows];
      const result = scopeFranchiseCustomersForDietitian(
        input,
        FRANCHISE_A,
        false,
        null,
      );
      expect(result).not.toBe(input);
      expect(result).toEqual(input);
    });
  });

  describe("a Franchise Dietitian", () => {
    it("sees ONLY the customers assigned to them", () => {
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        franchiseDietitian,
      );
      expect(idsOf(result)).toEqual(["assigned-to-1", "no-clinic-assigned-to-1"]);
    });

    it("does NOT see a colleague's customer in the same franchise", () => {
      // The whole point of allowing multiple dietitians per franchise.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        franchiseDietitian,
      );
      expect(result.some((r) => r.id === "assigned-to-2")).toBe(false);
    });

    it("does NOT see an unassigned customer, nor one missing the field entirely", () => {
      // An unassigned franchise customer is invisible to every Dietitian until
      // an operator assigns them — the documented consequence of shipping no
      // backfill with the migration.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        franchiseDietitian,
      );
      expect(result.some((r) => r.id === "unassigned")).toBe(false);
      expect(result.some((r) => r.id === "field-absent")).toBe(false);
    });

    it("is not widened by sharing a clinic with the customer", () => {
      // Every row here carries CLINIC_1, the Dietitian's own clinic. If the
      // clinic were still a disjunct, `assigned-to-2` and `unassigned` would
      // come back too.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        franchiseDietitian,
      );
      expect(idsOf(result)).not.toContain("assigned-to-2");
      expect(idsOf(result)).not.toContain("unassigned");
    });

    it("sees nothing when the directory belongs to a different franchise", () => {
      // The tenant conjunct. Passing the wrong franchiseId must not fall through
      // to a link-only match — this is what proves the tenant value is really
      // supplied to the predicate rather than left `undefined`.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_B,
        true,
        franchiseDietitian,
      );
      expect(result).toEqual([]);
    });
  });

  describe("fail-closed behaviour", () => {
    it("returns an EMPTY list when the Dietitian context cannot be resolved", () => {
      // The case a naive `if (ctx) { filter }` gets wrong: falling through would
      // hand a Dietitian the entire tenant, which is exactly the bug.
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        null,
      );
      expect(result).toEqual([]);
    });

    it("returns an empty list rather than throwing on an empty directory", () => {
      expect(
        scopeFranchiseCustomersForDietitian([], FRANCHISE_A, true, franchiseDietitian),
      ).toEqual([]);
      expect(
        scopeFranchiseCustomersForDietitian([], FRANCHISE_A, false, null),
      ).toEqual([]);
    });
  });

  describe("a CORE Dietitian context arriving on the franchise surface", () => {
    it("matches on the Dietitian_Link alone, ignoring the tenant", () => {
      // `franchiseId: null` yields a `core` scope from `dietitianScopeFromUser`.
      // This should not arise on this page — the guard admits only
      // FRANCHISE_ADMIN, whose `users.franchise_id` is non-null — but the
      // behaviour is asserted so the fallback is deliberate and visible rather
      // than accidental, and so it can never silently widen to the whole tenant.
      const coreDietitian: DietitianScopeContext = {
        userId: DIETITIAN_1,
        franchiseId: null,
        clinicId: CLINIC_1,
      };
      const result = scopeFranchiseCustomersForDietitian(
        rows,
        FRANCHISE_A,
        true,
        coreDietitian,
      );
      expect(idsOf(result)).toEqual(["assigned-to-1", "no-clinic-assigned-to-1"]);
    });
  });
});
