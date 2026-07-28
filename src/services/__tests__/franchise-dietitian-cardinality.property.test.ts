/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/franchise-dietitian-cardinality.property.test.ts
// Feature: dietitian-management, Property 6
//
// Property 6 (design.md): "At most one active Dietitian per Franchise"
//
// For any sequence of Dietitian create, reassign, deactivate and reactivate
// operations across any set of Clinics and Franchises, the resulting state
// never contains two active Dietitians linked to the same Franchise, every
// rejected operation returns `This franchise already has a dietitian` and
// leaves the state unchanged, and Clinics whose `franchise_id` is NULL accept
// arbitrarily many active Dietitians.
//
// Validates: Requirements 2.11, 3.7, 10.1, 10.2, 10.3, 10.4, 10.6
//
// This file exercises the real orchestration/decision logic of
// `src/services/DietitianAccountService.ts` (`createDietitian`,
// `updateDietitian`, `toggleDietitianActive`) plus the real
// `assertFranchiseDietitianCardinality` pre-check. The service performs I/O
// through `@/lib/supabase/admin` (`createAdminClient`) — we MOCK that
// dependency with an in-memory fake Postgres-ish client so the cardinality
// decision logic runs deterministically and the database's partial unique
// index (`users_one_active_dietitian_per_franchise`) can be modeled as a
// pre-commit constraint check on the fake `users` table, mirroring how
// `onboardingService.property.test.ts` fakes `@/lib/supabase/admin`.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

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

  /**
   * Models the `users_one_active_dietitian_per_franchise` partial unique
   * index (design.md §Data Models): violated when the candidate `users` row
   * is an active Dietitian whose `franchise_id` is not null AND some OTHER
   * row already satisfies the same predicate for that franchise.
   */
  function violatesFranchiseCardinality(candidate: any, rows: any[]): boolean {
    if (candidate.admin_access_level !== "dietitian") return false;
    if (!candidate.is_active) return false;
    if (candidate.franchise_id === null || candidate.franchise_id === undefined) {
      return false;
    }
    return rows.some(
      (r) =>
        r.id !== candidate.id &&
        r.admin_access_level === "dietitian" &&
        r.is_active &&
        r.franchise_id === candidate.franchise_id,
    );
  }

  const FRANCHISE_UNIQUE_VIOLATION_ERROR = {
    code: "23505",
    message:
      'duplicate key value violates unique constraint "users_one_active_dietitian_per_franchise"',
  };

  function matchesFilters(row: any, filters: Array<{ col: string; val: unknown; op: "eq" | "in" }>) {
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
        if (table === "users" && violatesFranchiseCardinality(candidate, rows)) {
          return { data: null, error: FRANCHISE_UNIQUE_VIOLATION_ERROR };
        }
        rows.push(candidate);
        const returned = cloneRow(table, candidate);
        return state.singleMode
          ? { data: returned, error: null }
          : { data: [returned], error: null };
      }

      if (state.op === "update") {
        const matched = rows.filter((r) => matchesFilters(r, state.filters));
        if (matched.length === 0) {
          return { data: null, error: { message: "No matching row" } };
        }
        for (const row of matched) {
          const candidate = { ...row, ...state.updatePayload };
          if (table === "users" && violatesFranchiseCardinality(candidate, rows)) {
            return { data: null, error: FRANCHISE_UNIQUE_VIOLATION_ERROR };
          }
        }
        for (const row of matched) {
          Object.assign(row, state.updatePayload);
        }
        const returned = matched.map((r) => cloneRow(table, r));
        return state.singleMode
          ? { data: returned[0], error: null }
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────────
import {
  createDietitian,
  updateDietitian,
  toggleDietitianActive,
} from "@/services/DietitianAccountService";
import { FRANCHISE_ALREADY_HAS_DIETITIAN } from "@/lib/dietitian/messages";

const { db } = H;

beforeEach(() => {
  H.reset();
});

// ─── Fixtures / topology ──────────────────────────────────────────────────────

/** One Clinic per Franchise (Req 10.3) plus a pool of Core Clinics (`franchise_id` NULL). */
interface Topology {
  franchiseIds: string[];
  franchiseClinicIds: string[];
  coreClinicIds: string[];
}

function seedTopology(topology: Topology) {
  db.clinics = [
    ...topology.franchiseIds.map((franchiseId, i) => ({
      id: topology.franchiseClinicIds[i],
      name: `Franchise Clinic ${i}`,
      franchise_id: franchiseId,
    })),
    ...topology.coreClinicIds.map((id, i) => ({
      id,
      name: `Core Clinic ${i}`,
      franchise_id: null,
    })),
  ];
  db.franchises = topology.franchiseIds.map((id, i) => ({ id, name: `Franchise ${i}` }));
}

/** A clinic choice that resolves against a topology at apply-time (never a raw id, so
 *  fast-check can shrink it independently of the topology's own generated sizes). */
type ClinicChoice =
  | { kind: "none" }
  | { kind: "core"; idx: number }
  | { kind: "franchise"; idx: number };

function resolveClinicChoice(choice: ClinicChoice, topology: Topology): string | null {
  if (choice.kind === "none") return null;
  if (choice.kind === "core") {
    return topology.coreClinicIds[choice.idx % topology.coreClinicIds.length];
  }
  return topology.franchiseClinicIds[choice.idx % topology.franchiseClinicIds.length];
}

const arbTopology: fc.Arbitrary<Topology> = fc
  .integer({ min: 1, max: 3 })
  .chain((franchiseCount) =>
    fc.integer({ min: 1, max: 2 }).chain((coreCount) =>
      fc.record({
        franchiseIds: fc.array(fc.uuid(), { minLength: franchiseCount, maxLength: franchiseCount }),
        franchiseClinicIds: fc.array(fc.uuid(), {
          minLength: franchiseCount,
          maxLength: franchiseCount,
        }),
        coreClinicIds: fc.array(fc.uuid(), { minLength: coreCount, maxLength: coreCount }),
      }),
    ),
  );

const arbClinicChoice: fc.Arbitrary<ClinicChoice> = fc.oneof(
  fc.record({ kind: fc.constant("none" as const) }),
  fc.record({ kind: fc.constant("core" as const), idx: fc.nat() }),
  fc.record({ kind: fc.constant("franchise" as const), idx: fc.nat() }),
);

type Op =
  | { type: "create"; clinicChoice: ClinicChoice }
  | { type: "reassign"; dietitianRef: number; clinicChoice: ClinicChoice }
  | { type: "deactivate"; dietitianRef: number }
  | { type: "reactivate"; dietitianRef: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ type: fc.constant("create" as const), clinicChoice: arbClinicChoice }),
  fc.record({
    type: fc.constant("reassign" as const),
    dietitianRef: fc.nat(),
    clinicChoice: arbClinicChoice,
  }),
  fc.record({ type: fc.constant("deactivate" as const), dietitianRef: fc.nat() }),
  fc.record({ type: fc.constant("reactivate" as const), dietitianRef: fc.nat() }),
);

const arbOps = fc.array(arbOp, { minLength: 1, maxLength: 20 });

/** Invariant: never two active Dietitians linked to the same (non-null) Franchise. */
function assertCardinalityInvariant() {
  const counts = new Map<string, number>();
  for (const u of db.users) {
    if (u.admin_access_level === "dietitian" && u.is_active && u.franchise_id) {
      counts.set(u.franchise_id, (counts.get(u.franchise_id) ?? 0) + 1);
    }
  }
  for (const count of counts.values()) {
    expect(count).toBeLessThanOrEqual(1);
  }
}

/** Byte-for-byte snapshot of the persisted `users` table for before/after comparison. */
function snapshotUsers(): unknown {
  return JSON.parse(JSON.stringify(db.users));
}

interface TrackedDietitian {
  id: string;
  authUserId: string;
  fullName: string;
  mobile: string;
  franchiseId: string | null;
  clinicId: string | null;
  isActive: boolean;
}

// ─── Property 6 ────────────────────────────────────────────────────────────────
describe("Property 6: At most one active Dietitian per Franchise", () => {
  it(
    "any sequence of create/reassign/deactivate/reactivate never yields two active Dietitians for one Franchise, and every rejection is pinned + no-op",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbTopology, arbOps, async (topology, ops) => {
          H.reset();
          seedTopology(topology);

          const created: TrackedDietitian[] = [];
          let mobileCounter = 1_000_000_000;

          for (const op of ops) {
            const before = snapshotUsers();

            if (op.type === "create") {
              const clinicId = resolveClinicChoice(op.clinicChoice, topology);
              mobileCounter += 1;
              const mobile = String(mobileCounter);
              const email = `dietitian-${mobileCounter}@example.com`;

              const result = await createDietitian(
                {
                  fullName: `Dietitian ${created.length}`,
                  email,
                  mobile,
                  password: "password123",
                  clinicId,
                },
                "acting-user",
              );

              if (result.success) {
                created.push({
                  id: result.data.id,
                  authUserId: result.data.authUserId,
                  fullName: result.data.fullName,
                  mobile: result.data.mobile,
                  franchiseId: result.data.franchiseId,
                  clinicId: result.data.clinicId,
                  isActive: result.data.isActive,
                });
              } else {
                expect(result.error).toBe(FRANCHISE_ALREADY_HAS_DIETITIAN);
                expect(snapshotUsers()).toEqual(before);
              }
            } else if (created.length > 0) {
              const idx = op.dietitianRef % created.length;
              const d = created[idx];

              if (op.type === "reassign") {
                const clinicId = resolveClinicChoice(op.clinicChoice, topology);
                const result = await updateDietitian(
                  d.id,
                  { fullName: d.fullName, mobile: d.mobile, clinicId },
                  "acting-user",
                  d.franchiseId,
                );

                if (result.success) {
                  d.clinicId = result.data.clinicId;
                  d.franchiseId = result.data.franchiseId;
                } else {
                  expect(result.error).toBe(FRANCHISE_ALREADY_HAS_DIETITIAN);
                  expect(snapshotUsers()).toEqual(before);
                }
              } else if (op.type === "deactivate") {
                if (d.isActive) {
                  const result = await toggleDietitianActive(
                    d.id,
                    d.authUserId,
                    false,
                    "acting-user",
                  );
                  // Deactivating can never conflict with the cardinality rule.
                  expect(result.success).toBe(true);
                  if (result.success) d.isActive = false;
                }
              } else if (op.type === "reactivate") {
                if (!d.isActive) {
                  const result = await toggleDietitianActive(
                    d.id,
                    d.authUserId,
                    true,
                    "acting-user",
                  );
                  if (result.success) {
                    d.isActive = true;
                  } else {
                    expect(result.error).toBe(FRANCHISE_ALREADY_HAS_DIETITIAN);
                    expect(snapshotUsers()).toEqual(before);
                  }
                }
              }
            }

            // The invariant must hold after every single operation, accepted or rejected.
            assertCardinalityInvariant();
          }
        }),
        { numRuns: 200 },
      );
    },
  );

  it("permits arbitrarily many concurrently-active Dietitians on a Clinic whose franchise_id is NULL (Req 10.1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.uuid(),
        async (dietitianCount, coreClinicId) => {
          H.reset();
          db.clinics = [{ id: coreClinicId, name: "Core Clinic", franchise_id: null }];
          db.franchises = [];

          let mobileCounter = 2_000_000_000;
          const results: any[] = [];
          for (let i = 0; i < dietitianCount; i++) {
            mobileCounter += 1;
            const result = await createDietitian(
              {
                fullName: `Core Dietitian ${i}`,
                email: `core-dietitian-${mobileCounter}@example.com`,
                mobile: String(mobileCounter),
                password: "password123",
                clinicId: coreClinicId,
              },
              "acting-user",
            );
            results.push(result);
          }

          // Every create for a NULL-franchise Clinic succeeds, regardless of count.
          for (const result of results) {
            expect(result.success).toBe(true);
          }
          const activeCoreDietitians = db.users.filter(
            (u: any) => u.admin_access_level === "dietitian" && u.is_active && u.franchise_id === null,
          );
          expect(activeCoreDietitians).toHaveLength(dietitianCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
