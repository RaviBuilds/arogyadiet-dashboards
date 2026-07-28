/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/clinic-scoped-dietitian-options.property.test.ts
// Feature: dietitian-management, Property 11
//
// Property 11: Clinic-scoped Dietitian options are complete and exclusive.
//
// "For any mapping of Clinics to Dietitians and any resolved Clinic, the
// offered option list equals exactly the active Dietitians linked to that
// Clinic, no Dietitian of another Clinic appears, a list of exactly one
// option is pre-selected, and submitting a Dietitian not linked to the
// resolved Clinic is rejected with `Selected dietitian does not belong to the
// resolved clinic`."
//
// Validates: Requirements 7.1, 7.4, 7.8, 8.2, 8.8
//
// This exercises the REAL `listActiveDietitiansForClinic`
// (`src/repositories/dietitian/dietitianRepository.ts`) and the REAL
// `validateDietitianForClinic` (`src/services/AssignmentService.ts`), which is
// itself backed by `getDietitianById` from the same repository. We mock only
// the I/O boundary — `@/lib/supabase/admin` — with an in-memory fake `users` /
// `clinics` / `franchises` table, mirroring the `vi.hoisted` fake-DB pattern
// used by `onboardingService.property.test.ts` and
// `dietitian-lifecycle-retention.property.test.ts`.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => {
  const db: any = { users: [], clinics: [], franchises: [] };

  function reset() {
    db.users = [];
    db.clinics = [];
    db.franchises = [];
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
   * A minimal fake PostgREST query builder. Non-terminal calls (`select`,
   * `eq`, `in`, `order`) mutate accumulated state and return `this`; the
   * builder itself is a thenable (mirrors supabase-js) so a chain with no
   * explicit terminal call (e.g. `.eq(...).eq(...).order(...)`) still resolves
   * to `{ data: <rows>, error: null }` when awaited directly. `maybeSingle`/
   * `single` are terminal and resolve immediately to a single row.
   */
  function makeBuilder(table: "users" | "clinics" | "franchises") {
    const filters: Record<string, unknown> = {};
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
      maybeSingle: async () => {
        const rows = applyFilters(db[table], filters);
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = applyFilters(db[table], filters);
        if (rows.length === 0) return { data: null, error: { message: "not found" } };
        return { data: rows[0], error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = applyFilters(db[table], filters);
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function makeFakeAdmin() {
    return {
      from: (table: "users" | "clinics" | "franchises") => makeBuilder(table),
    };
  }

  return { db, reset, makeFakeAdmin };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ────────────────
import { listActiveDietitiansForClinic } from "@/repositories/dietitian/dietitianRepository";
import { validateDietitianForClinic } from "@/services/AssignmentService";
import { DIETITIAN_NOT_IN_RESOLVED_CLINIC } from "@/lib/dietitian/messages";

const { db } = H;

// ─── Generators ────────────────────────────────────────────────────────────────

/** A pool of 1-4 distinct Clinic ids. */
const arbClinicPool = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 4 });

/**
 * A Dietitian `users` row: linked to one Clinic from the pool or unlinked
 * (`clinicId: null`), and either active or inactive.
 */
function arbDietitian(clinicPool: readonly string[]) {
  return fc.record({
    id: fc.uuid(),
    clinicId: fc.option(fc.constantFrom(...clinicPool), { nil: null }),
    isActive: fc.boolean(),
  });
}

/** A full scenario: a Clinic pool, a Dietitian pool linked across it, and a resolved Clinic. */
const arbScenario = arbClinicPool.chain((clinicPool) =>
  fc
    .tuple(
      fc.uniqueArray(arbDietitian(clinicPool), {
        minLength: 0,
        maxLength: 8,
        selector: (d) => d.id,
      }),
      fc.constantFrom(...clinicPool),
    )
    .map(([dietitians, resolvedClinicId]) => ({ clinicPool, dietitians, resolvedClinicId })),
);

/** Seed the fake DB's `users`/`clinics` tables from a scenario. */
function seed(scenario: {
  clinicPool: readonly string[];
  dietitians: readonly { id: string; clinicId: string | null; isActive: boolean }[];
}) {
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
}

// ─── Property 11 ────────────────────────────────────────────────────────────
describe("Property 11: Clinic-scoped Dietitian options are complete and exclusive", () => {
  it(
    "the offered option list equals exactly the active Dietitians linked to the resolved Clinic, " +
      "with none of another Clinic and a single option pre-selected when exactly one qualifies",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbScenario, async (scenario) => {
          seed(scenario);
          const { dietitians, resolvedClinicId } = scenario;

          const expectedIds = dietitians
            .filter((d) => d.clinicId === resolvedClinicId && d.isActive)
            .map((d) => d.id)
            .sort();

          const offered = await listActiveDietitiansForClinic(resolvedClinicId);
          const offeredIds = offered.map((o) => o.id).sort();

          // The option list equals exactly the active Dietitians linked to the
          // resolved Clinic (Req 7.1, 8.2) — no more, no less.
          expect(offeredIds).toEqual(expectedIds);

          // No Dietitian of another Clinic appears, and every offered option is
          // active and linked to the resolved Clinic.
          for (const option of offered) {
            expect(option.clinicId).toBe(resolvedClinicId);
            expect(option.isActive).toBe(true);
          }

          // Exactly one option is pre-selected when exactly one qualifies
          // (Req 7.4): the sole offered option is unambiguous.
          if (expectedIds.length === 1) {
            expect(offered).toHaveLength(1);
            expect(offered[0].id).toBe(expectedIds[0]);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    "validateDietitianForClinic accepts a Dietitian linked to the resolved Clinic and rejects one " +
      `that is not, with the message \`${DIETITIAN_NOT_IN_RESOLVED_CLINIC}\``,
    async () => {
      await fc.assert(
        fc.asyncProperty(arbScenario, async (scenario) => {
          seed(scenario);
          const { dietitians, resolvedClinicId } = scenario;

          for (const candidate of dietitians) {
            const result = await validateDietitianForClinic(candidate.id, resolvedClinicId);
            const belongsToResolvedClinic =
              candidate.clinicId === resolvedClinicId && candidate.isActive;

            if (belongsToResolvedClinic) {
              expect(result.ok).toBe(true);
            } else {
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.message).toBe(DIETITIAN_NOT_IN_RESOLVED_CLINIC);
              }
            }
          }

          // A `null` candidate always succeeds regardless of Clinic (Req 6.2,
          // 7.5) — no submission to reject.
          const nullResult = await validateDietitianForClinic(null, resolvedClinicId);
          expect(nullResult.ok).toBe(true);
        }),
        { numRuns: 100 },
      );
    },
  );
});
