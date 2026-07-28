/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/unscoped-dietitian-clinic-options.property.test.ts
// Feature: dietitian-management, Property 12
//
// Property 12 (design.md): "For any set of Clinics, the Clinic option list
// contains every Clinic and shows the owning Franchise name exactly for
// Clinics whose `franchise_id` is set; and for any set of Dietitians, the
// clinic-independent Dietitian option list contains exactly the active
// Dietitians, each labelled with its assigned Clinic name or `Unassigned`.
// For any set of Dietitians, the Master warning banner appears iff at least
// one Dietitian has no Clinic and names exactly those Dietitians."
// Validates: Requirements 2.3, 3.3, 3.4, 3.5, 4.5, 9.2, 9.5, 20.1
//
// Parts (a) and (b) exercise the real data-access functions
// `listClinicsWithFranchiseName` and `listActiveDietitians`
// (src/repositories/dietitian/dietitianRepository.ts) against an in-memory
// fake of the Supabase admin client (`@/lib/supabase/admin` — the module's
// only I/O seam), mirroring the mocking style in
// `dietitian-field-derivation.property.test.ts`.
//
// LIMITATION (part c — the Master warning banner): the banner predicate is
// not an extracted, importable pure function. It lives inline in
// `src/shared/components/master/UserManagement.tsx` as
//   `const unassignedClinicDietitians = dietitians.filter((d) => d.clinicId === null);`
// with the JSX guard `unassignedClinicDietitians.length > 0` and the naming
// text built from `unassignedClinicDietitians.map((d) => d.fullName)`. There
// is no separate module or exported function to import and drive with
// fast-check without rendering the React component (which this test suite
// deliberately avoids, per the task instructions). Part (c) is therefore
// skipped here; the "no Clinic ⇒ named in the banner" invariant is only
// covered indirectly by part (b), which asserts exactly which Dietitians
// have `clinicId === null`.
//
// vitest + fast-check, >=100 runs per property.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => {
  const db: any = {};

  function reset() {
    db.clinics = [] as Array<{ id: string; name: string; franchise_id: string | null }>;
    db.franchises = [] as Array<{ id: string; name: string }>;
    db.users = [] as any[];
  }

  // Minimal chainable query builder covering exactly the calls
  // dietitianRepository issues: select().eq()*.order() and select().in().
  function makeTableBuilder(getRows: () => any[]) {
    const filters: Record<string, unknown> = {};
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      },
      order: async (col?: string) => {
        let rows = getRows().filter((row) =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        );
        if (col) {
          rows = [...rows].sort((a, b2) => {
            if (a[col] < b2[col]) return -1;
            if (a[col] > b2[col]) return 1;
            return 0;
          });
        }
        return { data: rows, error: null };
      },
      in: async (col: string, ids: readonly string[]) => {
        const rows = getRows().filter((row) => ids.includes(row[col]));
        return { data: rows, error: null };
      },
    };
    return b;
  }

  function makeFakeAdmin() {
    return {
      from: (table: string) => {
        if (table === "users") return makeTableBuilder(() => db.users);
        if (table === "clinics") return makeTableBuilder(() => db.clinics);
        if (table === "franchises") return makeTableBuilder(() => db.franchises);
        throw new Error(`Unmocked table: ${table}`);
      },
    };
  }

  reset();
  return { db, reset, makeFakeAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────
import {
  listClinicsWithFranchiseName,
  listActiveDietitians,
} from "@/repositories/dietitian/dietitianRepository";

const { db } = H;

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

const arbFranchise = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
});

/** A set of Franchises with unique ids. */
const arbFranchises = fc.uniqueArray(arbFranchise, {
  minLength: 0,
  maxLength: 5,
  selector: (f) => f.id,
});

/**
 * A set of Clinics with unique ids, each optionally owned by one of the
 * given Franchises (`null` models a Core_Business Clinic, Req 2.3/3.5/3.6).
 */
function arbClinicsFor(franchises: readonly { id: string; name: string }[]) {
  const franchiseIdArb =
    franchises.length > 0
      ? fc.option(fc.constantFrom(...franchises.map((f) => f.id)), { nil: null })
      : fc.constant(null);
  return fc.uniqueArray(
    fc
      .record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 30 }),
        franchiseId: franchiseIdArb,
      })
      .map((c) => ({ id: c.id, name: c.name, franchise_id: c.franchiseId })),
    { minLength: 0, maxLength: 8, selector: (c) => c.id },
  );
}

const arbFullName = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);
const arbMobile = fc
  .tuple(
    fc.constantFrom(6, 7, 8, 9),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
  )
  .map(([local, domain]) => `${local}@${domain}.com`);

/**
 * A set of Dietitian `users` rows with unique ids, each optionally linked to
 * one of the given Clinics (`null` models an empty Dietitian_Clinic_Link,
 * Req 3.4) and independently active/inactive (Req 9.2, 20.1).
 */
function arbDietitianRowsFor(clinics: readonly { id: string; name: string }[]) {
  const clinicIdArb =
    clinics.length > 0
      ? fc.option(fc.constantFrom(...clinics.map((c) => c.id)), { nil: null })
      : fc.constant(null);
  return fc.uniqueArray(
    fc
      .record({
        id: fc.uuid(),
        fullName: arbFullName,
        email: arbEmail,
        mobile: arbMobile,
        clinicId: clinicIdArb,
        isActive: fc.boolean(),
      })
      .map((d) => ({
        id: d.id,
        auth_user_id: `auth-${d.id}`,
        full_name: d.fullName,
        email: d.email,
        mobile: d.mobile,
        franchise_id: null as string | null,
        dietitian_clinic_id: d.clinicId,
        is_active: d.isActive,
        created_at: new Date(2024, 0, 1).toISOString(),
        admin_access_level: "dietitian",
        roles: { code: "ADMIN" as const },
      })),
    { minLength: 0, maxLength: 12, selector: (d) => d.id },
  );
}

// ─── Property 12 ─────────────────────────────────────────────────────────────
describe("Property 12: Unscoped Dietitian and Clinic option lists are complete and correctly labelled", () => {
  it("(a) listClinicsWithFranchiseName returns every Clinic, labelled with the owning Franchise name exactly when franchise_id is set (Req 2.3, 3.5)", async () => {
    await fc.assert(
      fc.asyncProperty(arbFranchises, async (franchises) => {
        const clinics = fc.sample(arbClinicsFor(franchises), 1)[0];
        H.reset();
        db.franchises.push(...franchises);
        db.clinics.push(...clinics);

        const result = await listClinicsWithFranchiseName();

        // Contains every Clinic, no more, no less.
        expect(result).toHaveLength(clinics.length);
        const resultIds = new Set(result.map((r) => r.id));
        expect(resultIds).toEqual(new Set(clinics.map((c) => c.id)));

        const franchiseNameById = new Map(franchises.map((f) => [f.id, f.name]));
        for (const clinic of clinics) {
          const entry = result.find((r) => r.id === clinic.id);
          expect(entry).toBeDefined();
          expect(entry!.name).toBe(clinic.name);
          expect(entry!.franchiseId).toBe(clinic.franchise_id);
          if (clinic.franchise_id === null) {
            // Core_Business Clinic — no Franchise name (Req 3.6).
            expect(entry!.franchiseName).toBeNull();
          } else {
            // Franchise Clinic — the exact owning Franchise name (Req 2.3, 3.5).
            expect(entry!.franchiseName).toBe(franchiseNameById.get(clinic.franchise_id));
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("(b) listActiveDietitians returns exactly the active Dietitians, each labelled with its Clinic name or Unassigned (Req 3.3, 3.4, 9.2, 9.5, 20.1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 30 }) }),
          { minLength: 0, maxLength: 6, selector: (c) => c.id },
        ),
        async (clinics) => {
          const dietitianRows = fc.sample(arbDietitianRowsFor(clinics), 1)[0];
          H.reset();
          db.clinics.push(...clinics.map((c) => ({ ...c, franchise_id: null })));
          db.users.push(...dietitianRows);

          const result = await listActiveDietitians();

          const activeRows = dietitianRows.filter((d) => d.is_active);
          // Contains exactly the active Dietitians — no inactive ones, none missing.
          expect(result).toHaveLength(activeRows.length);
          const resultIds = new Set(result.map((r) => r.id));
          expect(resultIds).toEqual(new Set(activeRows.map((d) => d.id)));

          const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));
          for (const row of activeRows) {
            const entry = result.find((r) => r.id === row.id);
            expect(entry).toBeDefined();
            const expectedClinicName = row.dietitian_clinic_id
              ? clinicNameById.get(row.dietitian_clinic_id) ?? null
              : null;
            expect(entry!.clinicId).toBe(row.dietitian_clinic_id);
            expect(entry!.clinicName).toBe(expectedClinicName);
            // The Master_Portal label (UserManagement.tsx):
            // `dietitian.clinicName ?? "Unassigned"` (Req 3.4).
            const label = entry!.clinicName ?? "Unassigned";
            expect(label).toBe(row.dietitian_clinic_id ? expectedClinicName : "Unassigned");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // (c) The Master warning banner ("appears iff at least one Dietitian has no
  // Clinic and names exactly those Dietitians") is intentionally NOT tested
  // here — see the LIMITATION note at the top of this file. There is no
  // extractable pure function to drive without rendering
  // `UserManagement.tsx`, which is out of scope for this repository-level
  // property test.
});
