/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/dietitian-lifecycle-retention.property.test.ts
// Feature: dietitian-management, Property 9
//
// Property 9: Clinical history and links survive every Dietitian lifecycle
// change.
//
// "For any set of Health_Logs, audit entries and Dietitian_Links belonging to
// a Dietitian, and any sequence of clinic reassignment, deactivation, ban and
// deletion operations on that Dietitian, the Health_Log and audit-entry
// multisets are unchanged; links are retained on reassignment and
// deactivation, and on deletion every referencing link becomes empty while
// every referencing Customer_Record is retained."
//
// Validates: Requirements 3.8, 3.10, 6.5
//
// This test exercises the REAL `DietitianAccountService.updateDietitian` /
// `toggleDietitianActive` / `deleteDietitian` and the REAL
// `AssignmentService.clearLinksForDeletedDietitian` (deleteDietitian calls it
// directly, so both services run unmocked together — retention is a property
// of what these services do NOT touch). We mock only the I/O boundary:
//   - `@/lib/supabase/admin`                          → fake createAdminClient
//     (auth.admin.updateUserById/deleteUser, `users` delete,
//     `admin_activity_logs` insert)
//   - `@/repositories/dietitian/dietitianRepository`  → in-memory dietitian
//     row + clinic list (`updateDietitian`, `listClinicsWithFranchiseName`,
//     `countActiveDietitiansForFranchise` always 0 so cardinality never
//     blocks a reassignment — Property 6 covers that rule separately)
//   - `@/repositories/dietitian/assignmentRepository` → in-memory
//     Customer_Record → Dietitian_Link map (`clearDietitianLinksForUser`)
//
// Health_Logs and Log_Audit_Trail entries are modelled as opaque in-memory
// arrays that NO function under test ever reads or writes — the property
// asserts they are byte-for-byte unchanged (via a deep-clone snapshot taken
// before the operation sequence) after every operation, including deletion.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const DIETITIAN_ID = "dietitian-under-test";
  const AUTH_USER_ID = "auth-under-test";
  const OTHER_DIETITIAN_ID = "some-other-dietitian";

  const db: any = {};
  const calls: any = { activityLogs: [] };

  function seed(scenario: any) {
    db.clinics = scenario.clinicPool;
    db.dietitian = {
      id: DIETITIAN_ID,
      authUserId: AUTH_USER_ID,
      fullName: "Test Dietitian",
      mobile: "9876543210",
      clinicId: null as string | null,
      franchiseId: null as string | null,
      isActive: true,
      roleCode: "ADMIN" as "ADMIN" | "FRANCHISE_ADMIN",
    };
    db.customerProfiles = new Map<string, { dietitianId: string | null }>();
    for (const id of scenario.linkedCustomerIds) {
      db.customerProfiles.set(id, { dietitianId: DIETITIAN_ID });
    }
    for (const id of scenario.unrelatedCustomerIds) {
      db.customerProfiles.set(id, { dietitianId: OTHER_DIETITIAN_ID });
    }
    db.healthLogs = scenario.healthLogs;
    db.auditEntries = scenario.auditEntries;
    db.usersDeleted = new Set<string>();
    db.authDeleted = new Set<string>();
    db.banned = new Map<string, boolean>();
    calls.activityLogs = [];
  }

  function makeFakeAdmin() {
    return {
      from: (table: string) => {
        if (table === "admin_activity_logs") {
          return {
            insert: (obj: unknown) => {
              calls.activityLogs.push(obj);
              return { error: null };
            },
          };
        }
        if (table === "users") {
          return {
            delete: () => ({
              eq: (col: string, val: string) => {
                if (col === "id" && db.dietitian && db.dietitian.id === val) {
                  db.usersDeleted.add(val);
                }
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`Unexpected table in test fake admin client: ${table}`);
      },
      auth: {
        admin: {
          updateUserById: async (authUserId: string, args: { ban_duration: string }) => {
            db.banned.set(authUserId, args.ban_duration !== "none");
            return { data: null, error: null };
          },
          deleteUser: async (authUserId: string) => {
            db.authDeleted.add(authUserId);
            return { data: null, error: null };
          },
        },
      },
    };
  }

  return { DIETITIAN_ID, AUTH_USER_ID, OTHER_DIETITIAN_ID, db, calls, seed, makeFakeAdmin };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

vi.mock("@/repositories/dietitian/dietitianRepository", () => ({
  countActiveDietitiansForFranchise: vi.fn(async () => 0),
  insertDietitian: vi.fn(),
  listDietitians: vi.fn(),
  getDietitianById: vi.fn(async () => null),
  listActiveDietitiansForClinic: vi.fn(async () => []),
  listClinicsWithFranchiseName: vi.fn(async () =>
    H.db.clinics.map((c: any) => ({
      id: c.id,
      name: c.id,
      franchiseId: c.franchiseId,
      franchiseName: null,
    })),
  ),
  updateDietitian: vi.fn(async (_id: string, input: any) => {
    const d = H.db.dietitian;
    if (input.fullName !== undefined) d.fullName = input.fullName;
    if (input.mobile !== undefined) d.mobile = input.mobile;
    if (input.clinicId !== undefined) d.clinicId = input.clinicId;
    if (input.franchiseId !== undefined) d.franchiseId = input.franchiseId;
    if (input.isActive !== undefined) d.isActive = input.isActive;
    if (input.roleCode !== undefined) d.roleCode = input.roleCode;
    return { ...d };
  }),
}));

vi.mock("@/repositories/dietitian/assignmentRepository", () => ({
  getDietitianLink: vi.fn(
    async (customerProfileId: string) =>
      H.db.customerProfiles.get(customerProfileId)?.dietitianId ?? null,
  ),
  listCustomerProfileIdsLinkedToDietitian: vi.fn(async () => []),
  setDietitianLink: vi.fn(),
  isDietitianUser: vi.fn(async () => true),
  clearDietitianLinksForUser: vi.fn(async (dietitianUserId: string) => {
    const cleared: string[] = [];
    for (const [id, rec] of H.db.customerProfiles as Map<string, { dietitianId: string | null }>) {
      if (rec.dietitianId === dietitianUserId) {
        rec.dietitianId = null;
        cleared.push(id);
      }
    }
    return cleared;
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────────
import {
  updateDietitian,
  toggleDietitianActive,
  deleteDietitian,
} from "@/services/DietitianAccountService";

// ─── Generators ────────────────────────────────────────────────────────────────

/** A pool of 1-4 distinct Clinics, each with a Franchise (`null` = Core_Business). */
const arbClinicPool = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 4 })
  .chain((ids) =>
    fc
      .array(fc.option(fc.uuid(), { nil: null }), {
        minLength: ids.length,
        maxLength: ids.length,
      })
      .map((franchiseIds) => ids.map((id, i) => ({ id, franchiseId: franchiseIds[i] }))),
  );

/** A clinic reassignment operation, or `targetIndex: null` for "unassign". */
const arbReassignOp = fc.record({
  type: fc.constant("REASSIGN" as const),
  targetIndex: fc.option(fc.nat({ max: 10 }), { nil: null }),
});

const arbOp = fc.oneof(
  arbReassignOp,
  fc.record({ type: fc.constant("DEACTIVATE" as const) }),
  fc.record({ type: fc.constant("REACTIVATE" as const) }),
);

/** An opaque Health_Log row, never read/written by any function under test. */
const arbHealthLog = fc.record({
  id: fc.uuid(),
  logDate: fc.string({ maxLength: 10 }),
  value: fc.integer(),
});

/** An opaque Log_Audit_Trail entry, never read/written by any function under test. */
const arbAuditEntry = fc.record({
  id: fc.uuid(),
  action: fc.constantFrom("CREATE", "UPDATE", "DELETE"),
  detail: fc.string({ maxLength: 20 }),
});

const arbScenario = fc
  .record({
    clinicPool: arbClinicPool,
    // Split into linked / unrelated below — drawn from one unique pool so the
    // two sets never overlap.
    customerIdPool: fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 8 }),
    healthLogs: fc.array(arbHealthLog, { maxLength: 5 }),
    auditEntries: fc.array(arbAuditEntry, { maxLength: 5 }),
    ops: fc.array(arbOp, { maxLength: 6 }),
    deleteAtEnd: fc.boolean(),
  })
  .map((s) => {
    const half = Math.floor(s.customerIdPool.length / 2);
    return {
      ...s,
      linkedCustomerIds: s.customerIdPool.slice(0, half),
      unrelatedCustomerIds: s.customerIdPool.slice(half),
    };
  });

/** Deep-clone via JSON round-trip — every generated row here is JSON-safe. */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ─── Property 9 ──────────────────────────────────────────────────────────────
describe("Property 9: Clinical history and links survive every Dietitian lifecycle change", () => {
  it(
    "retains Health_Logs, audit entries and Dietitian_Links across reassignment/deactivation, " +
      "and on deletion empties every referencing link while retaining every referencing Customer_Record",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbScenario, async (scenario) => {
          H.seed(scenario);

          const dietitianId = H.DIETITIAN_ID;
          const authUserId = H.AUTH_USER_ID;
          const actingUserId = "acting-admin";

          const healthLogsBefore = snapshot(H.db.healthLogs);
          const auditEntriesBefore = snapshot(H.db.auditEntries);

          let currentFranchiseId: string | null = H.db.dietitian.franchiseId;

          for (const op of scenario.ops) {
            if (op.type === "REASSIGN") {
              const clinic =
                op.targetIndex === null
                  ? null
                  : scenario.clinicPool[op.targetIndex % scenario.clinicPool.length];
              const clinicId = clinic ? clinic.id : null;

              const result = await updateDietitian(
                dietitianId,
                { fullName: H.db.dietitian.fullName, mobile: H.db.dietitian.mobile, clinicId },
                actingUserId,
                currentFranchiseId,
              );
              expect(result.success).toBe(true);
              if (result.success) currentFranchiseId = result.data.franchiseId;
            } else if (op.type === "DEACTIVATE") {
              const result = await toggleDietitianActive(dietitianId, authUserId, false, actingUserId);
              expect(result.success).toBe(true);
              // The auth account is banned in lock-step (Req 3.9).
              expect(H.db.banned.get(authUserId)).toBe(true);
            } else if (op.type === "REACTIVATE") {
              const result = await toggleDietitianActive(dietitianId, authUserId, true, actingUserId);
              expect(result.success).toBe(true);
              expect(H.db.banned.get(authUserId)).toBe(false);
            }

            // After every reassignment/deactivation/reactivation: Health_Logs and
            // audit entries are byte-for-byte unchanged (Req 3.10), and every
            // Dietitian_Link that referenced this Dietitian still does (Req 3.8).
            expect(H.db.healthLogs).toEqual(healthLogsBefore);
            expect(H.db.auditEntries).toEqual(auditEntriesBefore);
            for (const cid of scenario.linkedCustomerIds) {
              expect(H.db.customerProfiles.get(cid)?.dietitianId).toBe(dietitianId);
            }
            for (const cid of scenario.unrelatedCustomerIds) {
              expect(H.db.customerProfiles.get(cid)?.dietitianId).toBe(H.OTHER_DIETITIAN_ID);
            }
          }

          if (scenario.deleteAtEnd) {
            const result = await deleteDietitian(dietitianId, authUserId, actingUserId);
            expect(result.success).toBe(true);

            // Health_Logs and audit entries remain unchanged after deletion too.
            expect(H.db.healthLogs).toEqual(healthLogsBefore);
            expect(H.db.auditEntries).toEqual(auditEntriesBefore);

            // Every referencing link becomes empty, while every referencing
            // Customer_Record is retained (Req 6.5) — the row still exists in
            // the map, it is not deleted.
            for (const cid of scenario.linkedCustomerIds) {
              expect(H.db.customerProfiles.has(cid)).toBe(true);
              expect(H.db.customerProfiles.get(cid)?.dietitianId).toBeNull();
            }
            // Customer_Records that never referenced this Dietitian are
            // untouched by the deletion.
            for (const cid of scenario.unrelatedCustomerIds) {
              expect(H.db.customerProfiles.get(cid)?.dietitianId).toBe(H.OTHER_DIETITIAN_ID);
            }

            // The Dietitian account itself is gone (users row + auth identity).
            expect(H.db.usersDeleted.has(dietitianId)).toBe(true);
            expect(H.db.authDeleted.has(authUserId)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});
