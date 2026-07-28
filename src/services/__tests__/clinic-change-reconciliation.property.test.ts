/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/clinic-change-reconciliation.property.test.ts
// Feature: dietitian-management, Property 13

//
// Property 13: Clinic changes reconcile the Dietitian_Link by
// Customer_Category.
//
// "For any Customer_Category, current Dietitian_Link and (old Clinic, new
// Clinic) pair, changing the assigned Clinic sets the link to the new
// Clinic's sole active Dietitian when the category is `KIT` and exactly one
// exists, empties the link when the category is `KIT` and the existing link
// is not linked to the new Clinic, and leaves the link unchanged for `MEAL`
// and `ACCOMMODATION`."
//
// Validates: Requirements 7.3, 8.4, 8.5, 8.6
//
// `AssignmentService.reconcileOnClinicChange` composes
// `listActiveDietitiansForClinic`/`getDietitianById`
// (`src/repositories/dietitian/dietitianRepository.ts`) with
// `getDietitianLink`/`setDietitianLink`
// (`src/repositories/dietitian/assignmentRepository.ts`), all of which perform
// I/O via `@/lib/supabase/admin`'s `createAdminClient`. We MOCK that single
// dependency with an in-memory fake `users` / `customer_profiles` / `clinics`
// / `franchises` / `admin_activity_logs` store — the same `vi.hoisted`
// fake-DB pattern used by `dietitian-link-writes.property.test.ts` and
// `clinic-scoped-dietitian-options.property.test.ts` — so the reconciliation
// table runs deterministically end-to-end through the real repositories and
// service, with no real database involved.
//
// The (old Clinic, new Clinic) pair from the design statement is modelled by
// generating the pre-change Dietitian_Link (`currentDietitianId`)
// independently of the new Clinic's Dietitian pool: a link value that is
// null, linked to the new Clinic, or linked elsewhere/nowhere all arise
// naturally regardless of which Clinic previously held that link, so the old
// Clinic's identity itself does not need to be threaded into the assertions —
// only what the current link resolves to relative to the new Clinic's active
// Dietitians matters to `reconcileOnClinicChange`.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => {
  const db: any = {
    users: [] as any[],
    clinics: [] as any[],
    franchises: [] as any[],
    profiles: new Map<string, { id: string; dietitian_id: string | null }>(),
    activityLogs: [] as any[],
  };

  function reset() {
    db.users = [];
    db.clinics = [];
    db.franchises = [];
    db.profiles.clear();
    db.activityLogs.length = 0;
  }

  function seedProfile(id: string, dietitianId: string | null) {
    db.profiles.set(id, { id, dietitian_id: dietitianId });
  }

  /** Apply a filter map (`{ col: value }` or `{ col: { in: values } }`) to rows. */
  function applyFilters(rows: any[], filters: Record<string, unknown>) {
    return rows.filter((row) =>
      Object.entries(filters).every(([col, val]) => {
        if (val && typeof val === "object" && "in" in (val as any)) {
          return (val as any).in.includes(row[col]);
        }
        return row[col] === val;
      }),
    );
  }

  /**
   * A minimal fake PostgREST query builder covering every chain shape used
   * by `dietitianRepository` and `assignmentRepository`:
   *   - `users`/`clinics`/`franchises` reads terminate on `maybeSingle()` or
   *     resolve via the thenable (`order()`/`in()` with no explicit terminal,
   *     mirroring supabase-js's own thenable query builders).
   *   - `customer_profiles` reads terminate on `maybeSingle()`; writes go
   *     through `update(...).eq(...).select(...).single()`.
   *   - `admin_activity_logs` writes go through a directly-awaited `insert()`.
   */
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let updatePayload: Record<string, unknown> | undefined;

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters[col] = { in: vals };
        return builder;
      },
      order: () => builder,
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return builder;
      },
      insert: async (obj: any) => {
        if (table === "admin_activity_logs") db.activityLogs.push(obj);
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === "customer_profiles") {
          const row = db.profiles.get(filters.id as string);
          return { data: row ? { dietitian_id: row.dietitian_id } : null, error: null };
        }
        const rows = applyFilters(db[table] ?? [], filters);
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        if (table === "customer_profiles" && updatePayload) {
          const id = filters.id as string;
          let row = db.profiles.get(id);
          if (!row) {
            row = { id, dietitian_id: null };
            db.profiles.set(id, row);
          }
          row.dietitian_id = (updatePayload.dietitian_id as string | null) ?? null;
          return { data: { dietitian_id: row.dietitian_id }, error: null };
        }
        return { data: null, error: { message: "not found" } };
      },
      // Thenable fallback for chains with no explicit terminal call
      // (`listActiveDietitiansForClinic`'s `.order(...)`,
      // `resolveClinicNames`/`resolveFranchiseNames`'s `.in(...)`).
      then: (resolve: (v: unknown) => void) => {
        const rows = applyFilters(db[table] ?? [], filters);
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function makeFakeAdmin() {
    return { from: (table: string) => makeBuilder(table) };
  }

  reset();
  return { db, reset, seedProfile, makeFakeAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────────
import { reconcileOnClinicChange, getDietitianLink } from "@/services/AssignmentService";

const { db } = H;

// ─── Generators ────────────────────────────────────────────────────────────────
const CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION"] as const;

/** A pool of 1-3 distinct Clinic ids. */
const arbClinicPool = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 });

/** A Dietitian `users` row: linked to one Clinic from the pool or unlinked, active or not. */
function arbDietitian(clinicPool: readonly string[]) {
  return fc.record({
    id: fc.uuid(),
    clinicId: fc.option(fc.constantFrom(...clinicPool), { nil: null }),
    isActive: fc.boolean(),
  });
}

/**
 * A full scenario: a Clinic pool, a Dietitian pool linked across it, the new
 * Clinic being assigned, the Customer_Category, and the pre-change
 * Dietitian_Link (null, one of the pool's Dietitians, or an id unrelated to
 * the pool entirely — modelling a Dietitian who used to be linked but is no
 * longer part of this scenario's pool).
 */
const arbScenario = arbClinicPool.chain((clinicPool) =>
  fc
    .tuple(
      fc.uniqueArray(arbDietitian(clinicPool), {
        minLength: 0,
        maxLength: 6,
        selector: (d) => d.id,
      }),
      fc.constantFrom(...clinicPool),
      fc.constantFrom(...CATEGORIES),
    )
    .chain(([dietitians, newClinicId, category]) => {
      const poolIds = dietitians.map((d) => d.id);
      const currentDietitianIdArb = fc.oneof(
        { arbitrary: fc.constant<string | null>(null), weight: 2 },
        ...(poolIds.length > 0
          ? [{ arbitrary: fc.constantFrom(...poolIds), weight: 3 }]
          : []),
        { arbitrary: fc.uuid(), weight: 1 },
      );
      return currentDietitianIdArb.map((currentDietitianId) => ({
        clinicPool,
        dietitians,
        newClinicId,
        category,
        currentDietitianId,
      }));
    }),
);

/** Seed the fake DB's `users`/`clinics`/`customer_profiles` tables from a scenario. */
function seed(
  scenario: {
    clinicPool: readonly string[];
    dietitians: readonly { id: string; clinicId: string | null; isActive: boolean }[];
    currentDietitianId: string | null;
  },
  profileId: string,
) {
  H.reset();
  db.clinics = scenario.clinicPool.map((id) => ({ id, name: id, franchise_id: null }));
  db.franchises = [];
  db.users = scenario.dietitians.map((d) => ({
    id: d.id,
    auth_user_id: `auth-${d.id}`,
    full_name: `Dietitian ${d.id}`,
    email: `${d.id}@example.com`,
    mobile: "9876543210",
    franchise_id: null,
    dietitian_clinic_id: d.clinicId,
    is_active: d.isActive,
    created_at: "2025-01-01T00:00:00.000Z",
    admin_access_level: "dietitian",
    roles: { code: "ADMIN" },
  }));
  H.seedProfile(profileId, scenario.currentDietitianId);
}

const profileIdArb = fc.uuid();

// ─── Property 13: Clinic changes reconcile the Dietitian_Link by Customer_Category ──
// Validates: Requirements 7.3, 8.4, 8.5, 8.6
describe("Property 13: Clinic changes reconcile the Dietitian_Link by Customer_Category", () => {
  it(
    "sets the link to the new Clinic's sole active Dietitian for KIT when exactly one exists, " +
      "empties the link for KIT when the current link is not on the new Clinic, and leaves " +
      "MEAL/ACCOMMODATION links unchanged regardless of the Clinic change",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbScenario, profileIdArb, async (scenario, profileId) => {
          seed(scenario, profileId);
          const { dietitians, newClinicId, category, currentDietitianId } = scenario;

          const activeForNewClinic = dietitians
            .filter((d) => d.clinicId === newClinicId && d.isActive)
            .map((d) => d.id);

          const result = await reconcileOnClinicChange(profileId, category, newClinicId, null);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // Persisted state must always agree with what the call reports.
          const persisted = await getDietitianLink(profileId);
          expect(persisted).toBe(result.dietitianId);

          if (category !== "KIT") {
            // MEAL/ACCOMMODATION: unchanged regardless of the Clinic change
            // or the new Clinic's Dietitian roster (Req 8.6).
            expect(result.dietitianId).toBe(currentDietitianId);
            expect(result.changed).toBe(false);
            return;
          }

          // category === "KIT"
          if (activeForNewClinic.length === 1) {
            // New Clinic has exactly one active Dietitian → set to that
            // Dietitian, regardless of the prior link (Req 8.4).
            expect(result.dietitianId).toBe(activeForNewClinic[0]);
            expect(result.changed).toBe(currentDietitianId !== activeForNewClinic[0]);
            return;
          }

          const isCurrentLinkOnNewClinic =
            currentDietitianId !== null && activeForNewClinic.includes(currentDietitianId);

          if (currentDietitianId !== null && !isCurrentLinkOnNewClinic) {
            // Existing link not linked to the new Clinic → emptied (Req 8.5).
            expect(result.dietitianId).toBeNull();
            expect(result.changed).toBe(true);
          } else {
            // Otherwise (empty link already, or the current link happens to
            // already be on the new Clinic while it has zero or several
            // active Dietitians) → left unchanged.
            expect(result.dietitianId).toBe(currentDietitianId);
            expect(result.changed).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it("is idempotent: reconciling twice in a row against the same new Clinic yields the same final link", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, profileIdArb, async (scenario, profileId) => {
        seed(scenario, profileId);
        const { newClinicId, category } = scenario;

        const first = await reconcileOnClinicChange(profileId, category, newClinicId, null);
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const second = await reconcileOnClinicChange(profileId, category, newClinicId, null);
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        expect(second.dietitianId).toBe(first.dietitianId);
        expect(second.changed).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
