/* eslint-disable @typescript-eslint/no-explicit-any */
// src/actions/master-actions/__tests__/franchise-user-provisioning.property.test.ts
// Feature: dietitian-management, Property 34 (Task 11.4)
//
// Property 34: Franchise user provisioning derives role and tenant, and the
// Dietitian action reflects franchise state.
//
// For any Franchise, a user created through the Create Franchise User action
// (`createFranchiseUser`) receives role `FRANCHISE_ADMIN` and `franchise_id`
// equal to that Franchise, the Franchise Users section
// (`listFranchiseUsers`) lists exactly the `users` rows whose `franchise_id`
// equals the selected Franchise, and the Create Dietitian action
// (`createFranchiseDietitian`) succeeds — deriving role `FRANCHISE_ADMIN`,
// `franchise_id` and the Dietitian_Clinic_Link from the Franchise's own
// Clinic — iff the Franchise has a Clinic and no active Dietitian yet;
// otherwise it is rejected with the pinned message that backs the Master
// Portal's disabled/"Edit Dietitian" states (`Wire a clinic to this
// franchise first` with no Clinic, `This franchise already has a dietitian`
// when one already exists).
//
// Validates: Requirements 21.1, 21.3, 22.5, 22.6
//
// This file exercises the real Server Actions of
// `src/actions/master-actions/franchiseUserActions.ts` end to end, including
// the real `DietitianAccountService.createDietitian` delegation. I/O is
// modeled with an in-memory fake Postgres-ish admin client (mirroring
// `franchise-dietitian-cardinality.property.test.ts`) so `@/lib/supabase/admin`
// drives every repository (`franchiseRepository`, `franchiseClinicRepository`,
// `dietitianRepository`) deterministically. The caller's session
// (`@/lib/supabase/server`) is mocked as an authorized ADMIN so
// `resolveScope()` resolves to `full_network`, and the franchise feature flag
// is forced on.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { randomUUID } from "node:crypto";

// ─── Shared in-memory fake Postgres (hoisted so vi.mock factories can close
// over it) ────────────────────────────────────────────────────────────────────
const H = vi.hoisted(() => {
  const db: any = {
    users: [] as any[],
    clinics: [] as any[],
    franchises: [] as any[],
    roles: [] as any[],
    admin_activity_logs: [] as any[],
    authUsers: new Map<string, unknown>(),
    seq: 0,
  };

  function reset() {
    db.users = [];
    db.clinics = [];
    db.franchises = [];
    db.roles = [
      { id: "role-ADMIN", code: "ADMIN" },
      { id: "role-FRANCHISE_ADMIN", code: "FRANCHISE_ADMIN" },
    ];
    db.admin_activity_logs = [];
    db.authUsers = new Map<string, unknown>();
    db.seq = 0;
  }

  function genId(table: string): string {
    return `${table}-${++db.seq}`;
  }

  function matchesFilters(
    row: any,
    filters: Array<{ col: string; val: unknown; op: "eq" | "in" }>,
  ) {
    return filters.every((f) => {
      if (f.op === "eq") return row[f.col] === f.val;
      if (f.op === "in") return (f.val as unknown[]).includes(row[f.col]);
      return true;
    });
  }

  /** Attach the `roles(code)` embed Supabase would return for a `users` row. */
  function cloneRow(table: string, row: any): any {
    const clone = { ...row };
    if (table === "users") {
      const roleRow = db.roles.find((r: any) => r.id === row.role_id);
      clone.roles = roleRow ? { code: roleRow.code } : null;
    }
    return clone;
  }

  function makeBuilder(table: string) {
    const rows: any[] = (db as any)[table];
    const state: {
      op: "select" | "insert" | "update";
      filters: Array<{ col: string; val: unknown; op: "eq" | "in" }>;
      selectOpts: { count?: string; head?: boolean } | null;
      insertPayload: any;
      updatePayload: any;
      singleMode: "single" | "maybeSingle" | null;
    } = {
      op: "select",
      filters: [],
      selectOpts: null,
      insertPayload: null,
      updatePayload: null,
      singleMode: null,
    };

    async function execute(): Promise<any> {
      if (state.op === "insert") {
        const id = genId(table);
        const candidate = {
          id,
          created_at: new Date().toISOString(),
          ...state.insertPayload,
        };
        rows.push(candidate);
        const returned = cloneRow(table, candidate);
        return state.singleMode
          ? { data: returned, error: null }
          : { data: [returned], error: null };
      }

      if (state.op === "update") {
        const matched = rows.filter((r) => matchesFilters(r, state.filters));
        for (const row of matched) {
          Object.assign(row, state.updatePayload);
        }
        const returned = matched.map((r) => cloneRow(table, r));
        return state.singleMode
          ? { data: returned[0] ?? null, error: null }
          : { data: returned, error: null };
      }

      // select
      let filtered = rows.filter((r) => matchesFilters(r, state.filters));
      if (state.selectOpts?.count === "exact" && state.selectOpts?.head) {
        return { count: filtered.length, error: null, data: null };
      }
      filtered = filtered.map((r) => cloneRow(table, r));
      if (state.singleMode === "single") {
        if (filtered.length !== 1) {
          return {
            data: null,
            error: { message: filtered.length === 0 ? "No rows found" : "Multiple rows found" },
          };
        }
        return { data: filtered[0], error: null };
      }
      if (state.singleMode === "maybeSingle") {
        return { data: filtered[0] ?? null, error: null };
      }
      return { data: filtered, error: null };
    }

    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        state.selectOpts = opts ?? null;
        return builder;
      },
      insert(payload: any) {
        state.op = "insert";
        state.insertPayload = payload;
        return builder;
      },
      update(payload: any) {
        state.op = "update";
        state.updatePayload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val, op: "eq" });
        return builder;
      },
      in(col: string, val: unknown[]) {
        state.filters.push({ col, val, op: "in" });
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        state.singleMode = "single";
        return execute();
      },
      maybeSingle() {
        state.singleMode = "maybeSingle";
        return execute();
      },
      then(resolve: (v: any) => any, reject?: (e: any) => any) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  }

  function makeFakeAdmin() {
    return {
      from: (table: string) => makeBuilder(table),
      auth: {
        admin: {
          createUser: async (args: any) => {
            const id = `auth-${++db.seq}`;
            db.authUsers.set(id, args);
            return { data: { user: { id } }, error: null };
          },
          deleteUser: async (id: string) => {
            db.authUsers.delete(id);
            return { data: null, error: null };
          },
          updateUserById: async (id: string, patch: any) => {
            db.authUsers.set(id, { ...(db.authUsers.get(id) as any), ...patch });
            return { data: null, error: null };
          },
        },
      },
    };
  }

  reset();
  return { db, reset, makeFakeAdmin };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Franchise feature flag forced on so the action's assertFullNetworkScope
// gate and resolveFranchiseContext both proceed.
vi.mock("@/lib/franchise/constants", () => ({
  FRANCHISE_FEATURES_ENABLED: true,
  GLOBAL_ACCESS_ROLES: ["ADMIN", "MASTER_ADMIN"],
  FRANCHISE_SCOPED_ROLE: "FRANCHISE_ADMIN",
}));

// The caller's session: always an authorized ADMIN, so resolveScope()
// resolves to `full_network` (mirrors clinic-roundtrip.property.test.ts).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "acting-auth-id" } } }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "acting-user-id", franchise_id: null, roles: { code: "ADMIN" } },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// ─── System under test (imported after the mocks are registered) ─────────────
import {
  createFranchiseUser,
  createFranchiseDietitian,
  listFranchiseUsers,
} from "../franchiseUserActions";
import {
  WIRE_CLINIC_TO_FRANCHISE_FIRST,
} from "@/lib/dietitian/messages";

const { db } = H;

beforeEach(() => {
  H.reset();
});

// ─── Fixtures / generators ────────────────────────────────────────────────────

const trimmedNonEmpty = (maxLen: number): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: maxLen })
    .map((s) => s.trim())
    .filter((s) => s.length >= 1);

/** Whether the target Franchise has a Clinic, and — only meaningful when it
 * does — whether that Clinic already carries an active Dietitian (Req 22.4,
 * 22.5, 22.6). A Franchise Dietitian's franchise_id can only ever be derived
 * from a Clinic belonging to that Franchise, so "has an active Dietitian"
 * without a Clinic is not a reachable state. */
const arbFranchiseState: fc.Arbitrary<{ hasClinic: boolean; hasActiveDietitian: boolean }> =
  fc.oneof(
    fc.constant({ hasClinic: false, hasActiveDietitian: false }),
    fc.record({ hasClinic: fc.constant(true), hasActiveDietitian: fc.boolean() }),
  );

/** 0..2 unrelated Franchises with their own noise users, to exercise tenant
 * isolation of `listFranchiseUsers` (Req 21.1). */
const arbNoiseFranchiseCount = fc.integer({ min: 0, max: 2 });

let uniqueCounter = 0;
function nextUnique(): number {
  uniqueCounter += 1;
  return uniqueCounter;
}

function seedNoise(noiseFranchiseCount: number): void {
  for (let i = 0; i < noiseFranchiseCount; i++) {
    const fid = `noise-franchise-${nextUnique()}`;
    db.franchises.push({
      id: fid,
      name: `Noise Franchise ${i}`,
      group_id: "group-noise",
      owner_user_id: "owner-noise",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    db.users.push({
      id: `noise-user-${nextUnique()}`,
      auth_user_id: `noise-auth-${nextUnique()}`,
      role_id: "role-FRANCHISE_ADMIN",
      full_name: `Noise User ${i}`,
      email: `noise-user-${nextUnique()}@example.com`,
      mobile: null,
      franchise_id: fid,
      dietitian_clinic_id: null,
      admin_access_level: "inventory_operations",
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }
  // A handful of core (franchise_id === null) users must never leak into any
  // Franchise's user list either.
  db.users.push({
    id: `core-user-${nextUnique()}`,
    auth_user_id: `core-auth-${nextUnique()}`,
    role_id: "role-ADMIN",
    full_name: "Core User",
    email: `core-user-${nextUnique()}@example.com`,
    mobile: null,
    franchise_id: null,
    dietitian_clinic_id: null,
    admin_access_level: "inventory_operations",
    is_active: true,
    created_at: new Date().toISOString(),
  });
}

// ─── Property 34 ────────────────────────────────────────────────────────────
describe("Property 34: Franchise user provisioning derives role and tenant, and the Dietitian action reflects franchise state", () => {
  it(
    "createFranchiseUser derives FRANCHISE_ADMIN + franchise_id; listFranchiseUsers is exact; createFranchiseDietitian succeeds iff Clinic present and no active Dietitian",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFranchiseState,
          arbNoiseFranchiseCount,
          fc.integer({ min: 0, max: 3 }),
          trimmedNonEmpty(60),
          trimmedNonEmpty(60),
          trimmedNonEmpty(60),
          async (
            state,
            noiseFranchiseCount,
            preexistingPlainUserCount,
            franchiseUserFullName,
            dietitianFullName,
            franchiseNameSuffix,
          ) => {
            H.reset();

            const franchiseId = `franchise-${nextUnique()}`;
            db.franchises.push({
              id: franchiseId,
              name: `Target Franchise ${franchiseNameSuffix}`,
              group_id: "group-target",
              owner_user_id: "owner-target",
              status: "active",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            let clinicId: string | null = null;
            if (state.hasClinic) {
              clinicId = randomUUID();
              db.clinics.push({
                id: clinicId,
                name: "Franchise Clinic",
                address: "Some address",
                latitude: 12.9,
                longitude: 77.6,
                kitchen_id: "kitchen-1",
                franchise_id: franchiseId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }

            // Pre-existing plain (non-Dietitian) users already tied to this
            // Franchise — must be included in listFranchiseUsers exactly once.
            const preexistingIds: string[] = [];
            for (let i = 0; i < preexistingPlainUserCount; i++) {
              const id = `preexisting-${nextUnique()}`;
              preexistingIds.push(id);
              db.users.push({
                id,
                auth_user_id: `preexisting-auth-${nextUnique()}`,
                role_id: "role-FRANCHISE_ADMIN",
                full_name: `Preexisting User ${i}`,
                email: `preexisting-${nextUnique()}@example.com`,
                mobile: null,
                franchise_id: franchiseId,
                dietitian_clinic_id: null,
                admin_access_level: "inventory_operations",
                is_active: true,
                created_at: new Date().toISOString(),
              });
            }

            let activeDietitianId: string | null = null;
            if (state.hasClinic && state.hasActiveDietitian) {
              activeDietitianId = `existing-dietitian-${nextUnique()}`;
              db.users.push({
                id: activeDietitianId,
                auth_user_id: `existing-dietitian-auth-${nextUnique()}`,
                role_id: "role-FRANCHISE_ADMIN",
                full_name: "Existing Dietitian",
                email: `existing-dietitian-${nextUnique()}@example.com`,
                mobile: "9000000001",
                franchise_id: franchiseId,
                dietitian_clinic_id: clinicId,
                admin_access_level: "dietitian",
                is_active: true,
                created_at: new Date().toISOString(),
              });
            }

            seedNoise(noiseFranchiseCount);

            // ── (a) listFranchiseUsers is exact (Req 21.1) ──────────────────
            const beforeCreateList = await listFranchiseUsers(franchiseId);
            expect(beforeCreateList.success).toBe(true);
            if (beforeCreateList.success) {
              const expectedIds = new Set([
                ...preexistingIds,
                ...(activeDietitianId ? [activeDietitianId] : []),
              ]);
              const actualIds = new Set(beforeCreateList.data.map((u) => u.id));
              expect(actualIds).toEqual(expectedIds);
              // Every row genuinely carries this Franchise's id — tenant
              // isolation invariant (Req 21.8, 21.11 companion at the action
              // layer).
              for (const row of beforeCreateList.data) {
                const raw = db.users.find((u: any) => u.id === row.id);
                expect(raw.franchise_id).toBe(franchiseId);
              }
            }

            // ── (b) createFranchiseUser derives role + tenant (Req 21.3) ────
            const mobileDigits = String(9100000000 + nextUnique());
            const franchiseUserResult = await createFranchiseUser({
              franchiseId,
              fullName: franchiseUserFullName,
              email: `franchise-user-${nextUnique()}@example.com`,
              mobile: mobileDigits,
              password: "password123",
              accessLevel: "inventory_operations",
            });

            expect(franchiseUserResult.success).toBe(true);
            if (franchiseUserResult.success) {
              const raw = db.users.find(
                (u: any) => u.id === franchiseUserResult.data.userId,
              );
              expect(raw).toBeDefined();
              expect(raw.franchise_id).toBe(franchiseId);
              expect(raw.role_id).toBe("role-FRANCHISE_ADMIN");

              // The newly created user is now visible in the Franchise Users
              // section, still scoped exactly to this Franchise.
              const afterCreateList = await listFranchiseUsers(franchiseId);
              expect(afterCreateList.success).toBe(true);
              if (afterCreateList.success) {
                expect(
                  afterCreateList.data.some((u) => u.id === franchiseUserResult.data.userId),
                ).toBe(true);
                for (const row of afterCreateList.data) {
                  const rawRow = db.users.find((u: any) => u.id === row.id);
                  expect(rawRow.franchise_id).toBe(franchiseId);
                }
              }
            }

            // ── (c) createFranchiseDietitian reflects franchise state ───────
            // (Req 22.4, 22.5, 22.6 — the Create/Edit Dietitian action gate).
            const dietitianMobile = String(9200000000 + nextUnique());
            const dietitianEmail = `new-dietitian-${nextUnique()}@example.com`;
            const dietitianResult = await createFranchiseDietitian({
              franchiseId,
              fullName: dietitianFullName,
              email: dietitianEmail,
              mobile: dietitianMobile,
              password: "password123",
            });

            if (!state.hasClinic) {
              // No Clinic wired → the Master Portal disables Create Dietitian
              // with this pinned message (Req 22.4); no Auth/users row is
              // created.
              expect(dietitianResult.success).toBe(false);
              if (!dietitianResult.success) {
                expect(dietitianResult.error).toBe(WIRE_CLINIC_TO_FRANCHISE_FIRST);
              }
              expect(
                db.users.some((u: any) => u.email === dietitianEmail),
              ).toBe(false);
            } else {
              // Clinic present → Create Dietitian succeeds, deriving role
              // FRANCHISE_ADMIN, franchise_id and the Dietitian_Clinic_Link from
              // the Franchise's own Clinic (Req 22.3, 22.5).
              //
              // UPDATED by franchise-scoped-access Task 11: this branch used to
              // split on `state.hasActiveDietitian` and expect a rejection with
              // FRANCHISE_ALREADY_HAS_DIETITIAN when one already existed. That
              // cap (the `users_one_active_dietitian_per_franchise` partial
              // unique index) has been DROPPED — a Franchise now needs a TEAM of
              // Dietitians, each reading only the Customer_Records assigned to
              // them. So creation succeeds whether or not the Franchise already
              // has one.
              expect(dietitianResult.success).toBe(true);
              if (dietitianResult.success) {
                expect(dietitianResult.data.roleCode).toBe("FRANCHISE_ADMIN");
                expect(dietitianResult.data.franchiseId).toBe(franchiseId);
                expect(dietitianResult.data.clinicId).toBe(clinicId);
                expect(dietitianResult.data.isActive).toBe(true);

                // A SECOND Dietitian for the same Franchise must now also
                // succeed — this is the behaviour change, asserted positively.
                const secondAttempt = await createFranchiseDietitian({
                  franchiseId,
                  fullName: "Second Dietitian",
                  email: `second-dietitian-${nextUnique()}@example.com`,
                  mobile: String(9300000000 + nextUnique()),
                  password: "password123",
                });
                expect(secondAttempt.success).toBe(true);
                if (secondAttempt.success) {
                  expect(secondAttempt.data.franchiseId).toBe(franchiseId);
                  expect(secondAttempt.data.clinicId).toBe(clinicId);
                }
              }
            }
          },
        ),
        { numRuns: 150 },
      );
    },
  );
});
