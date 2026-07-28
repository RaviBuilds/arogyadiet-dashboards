/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/dietitian-field-derivation.property.test.ts
// Feature: dietitian-management, Property 5
//
// Property 5 (design.md): "For any Clinic, creating or reassigning a
// Dietitian for that Clinic yields role `ADMIN` with `franchise_id` NULL when
// the Clinic's `franchise_id` is NULL, and role `FRANCHISE_ADMIN` with
// `franchise_id` equal to the Clinic's `franchise_id` otherwise; in both
// cases the stored Dietitian_Clinic_Link equals the Clinic and an
// `admin_activity_logs` entry records the acting user, the Dietitian and the
// Clinic."
// Validates: Requirements 2.9, 2.10, 3.6, 22.3
//
// `createDietitian`/`updateDietitian` (src/services/DietitianAccountService.ts)
// perform I/O only through the Supabase admin client (`@/lib/supabase/admin`).
// We mock that single seam with an in-memory fake DB so `deriveRoleAndFranchise`
// runs for real inside `createDietitian`/`updateDietitian` against arbitrary
// Clinics (`franchise_id` null vs set), and assert on the persisted `users`
// row (role/franchise_id/dietitian_clinic_id) plus the recorded
// `admin_activity_logs` entry — without touching any other module.
//
// vitest + fast-check, >=100 runs per property.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => {
  const db: any = {};
  const calls: any = {};

  function reset() {
    db.clinics = [] as Array<{ id: string; name: string; franchise_id: string | null }>;
    db.roles = [
      { id: "role-admin", code: "ADMIN" },
      { id: "role-franchise-admin", code: "FRANCHISE_ADMIN" },
    ];
    db.users = [] as any[];
    db.activityLogs = [] as any[];
    db.authUsers = new Map<string, unknown>();
    db.seq = 0;
    calls.createUser = [];
    calls.deleteUser = [];
  }

  function roleIdFor(code: string) {
    return db.roles.find((r: any) => r.code === code)?.id ?? null;
  }
  function roleCodeFor(id: string) {
    return db.roles.find((r: any) => r.id === id)?.code ?? null;
  }

  /**
   * Real Supabase embeds the joined `roles(code)` relation on a `users`
   * select. The fake DB only stores `role_id`, so any row handed back from a
   * `users` query is stamped with the equivalent `roles: { code }` embed here
   * — this is what lets `extractRoleCode` (dietitianRepository) resolve the
   * real role for the assertions below.
   */
  function withRolesEmbed(row: any) {
    return { ...row, roles: { code: roleCodeFor(row.role_id) } };
  }

  // Minimal chainable query builder covering exactly the calls
  // DietitianAccountService + dietitianRepository issue.
  function makeUsersBuilder() {
    const state: any = { filters: {} as Record<string, unknown> };
    const applyFilters = (rows: any[]) =>
      rows.filter((row) =>
        Object.entries(state.filters).every(([k, v]) => row[k] === v),
      );

    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return b;
      },
      insert: (payload: any) => {
        state.insertPayload = payload;
        return b;
      },
      update: (payload: any) => {
        state.updatePayload = payload;
        return b;
      },
      order: () => b,
      in: () => b,
      single: async () => {
        if (state.insertPayload) {
          const id = `user-${++db.seq}`;
          const row = { id, created_at: new Date().toISOString(), ...state.insertPayload };
          db.users.push(row);
          return { data: withRolesEmbed(row), error: null };
        }
        if (state.updatePayload) {
          const matches = applyFilters(db.users);
          if (matches.length !== 1) {
            return { data: null, error: { message: "row not found" } };
          }
          Object.assign(matches[0], state.updatePayload);
          return { data: withRolesEmbed(matches[0]), error: null };
        }
        return { data: null, error: { message: "unsupported single()" } };
      },
      maybeSingle: async () => {
        const matches = applyFilters(db.users);
        return { data: matches[0] ? withRolesEmbed(matches[0]) : null, error: null };
      },
    };
    return b;
  }

  function makeRolesBuilder() {
    const state: any = { filters: {} as Record<string, unknown> };
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return b;
      },
      single: async () => {
        const row = db.roles.find((r: any) =>
          Object.entries(state.filters).every(([k, v]) => (r as any)[k] === v),
        );
        return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
      },
    };
    return b;
  }

  function makeClinicsBuilder() {
    // Two distinct call shapes hit the "clinics" table:
    //   listClinicsWithFranchiseName: .select("id, name, franchise_id").order(...)
    //   resolveClinicNames (dietitianRepository): .select("id, name").in("id", ids)
    const b: any = {
      select: () => b,
      order: async () => ({ data: db.clinics, error: null }),
      in: async (_col: string, ids: string[]) => ({
        data: db.clinics.filter((c: any) => ids.includes(c.id)),
        error: null,
      }),
    };
    return b;
  }

  function makeFranchisesBuilder() {
    // resolveFranchiseNames: .select("id, name").in("id", ids). No Franchise
    // rows are seeded in this test's fake DB — the derived franchise_id is
    // asserted directly against the Clinic's own franchise_id, not against a
    // resolved Franchise name.
    const b: any = {
      select: () => b,
      in: async () => ({ data: [], error: null }),
    };
    return b;
  }

  function makeActivityLogsBuilder() {
    const b: any = {
      insert: async (payload: any) => {
        db.activityLogs.push(payload);
        return { data: null, error: null };
      },
    };
    return b;
  }

  function makeFakeAdmin() {
    return {
      from: (table: string) => {
        if (table === "users") return makeUsersBuilder();
        if (table === "roles") return makeRolesBuilder();
        if (table === "clinics") return makeClinicsBuilder();
        if (table === "franchises") return makeFranchisesBuilder();
        if (table === "admin_activity_logs") return makeActivityLogsBuilder();
        throw new Error(`Unmocked table: ${table}`);
      },
      auth: {
        admin: {
          createUser: async (args: any) => {
            calls.createUser.push(args);
            const id = `auth-${++db.seq}`;
            db.authUsers.set(id, args);
            return { data: { user: { id } }, error: null };
          },
          deleteUser: async (id: string) => {
            calls.deleteUser.push(id);
            db.authUsers.delete(id);
            return { data: null, error: null };
          },
        },
      },
    };
  }

  reset();
  return { db, calls, reset, makeFakeAdmin, roleIdFor, roleCodeFor };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────
import { createDietitian, updateDietitian } from "@/services/DietitianAccountService";

const { db, calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/** A Clinic with `franchise_id` either `null` (Core_Business) or a UUID (Franchise). */
const arbClinic = fc
  .record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    franchiseId: fc.option(fc.uuid(), { nil: null }),
  })
  .map((c) => ({ id: c.id, name: c.name, franchise_id: c.franchiseId }));

const arbFullName = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
const arbMobile = fc
  .tuple(fc.constantFrom(6, 7, 8, 9), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }))
  .map(([first, rest]) => `${first}${rest.join("")}`);
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
  )
  .map(([local, domain]) => `${local}@${domain}.com`);
const arbActingUserId = fc.option(fc.uuid(), { nil: null });

// ─── Property 5 ──────────────────────────────────────────────────────────────
// Property 5: Dietitian account fields are derived from the assigned Clinic.
// Validates: Requirements 2.9, 2.10, 3.6, 22.3
describe("Property 5: Dietitian account fields are derived from the assigned Clinic", () => {
  it("createDietitian derives role/franchise_id from the Clinic, links the Clinic, and logs the change", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClinic,
        arbFullName,
        arbEmail,
        arbMobile,
        arbActingUserId,
        async (clinic, fullName, email, mobile, actingUserId) => {
          H.reset();
          db.clinics.push(clinic);

          const result = await createDietitian(
            {
              fullName,
              email,
              mobile,
              password: "password123",
              clinicId: clinic.id,
            },
            actingUserId,
          );

          if (!result.success) {
            throw new Error(`createDietitian failed: ${JSON.stringify(result)}`);
          }
          expect(result.success).toBe(true);

          const isCore = clinic.franchise_id === null;

          // Resulting role and franchise_id (Req 2.9, 2.10, 22.3).
          expect(result.data.roleCode).toBe(isCore ? "ADMIN" : "FRANCHISE_ADMIN");
          expect(result.data.franchiseId).toBe(isCore ? null : clinic.franchise_id);

          // The stored Dietitian_Clinic_Link equals the Clinic.
          expect(result.data.clinicId).toBe(clinic.id);
          const storedUser = db.users.find((u: any) => u.id === result.data.id);
          expect(storedUser.dietitian_clinic_id).toBe(clinic.id);
          expect(storedUser.franchise_id).toBe(isCore ? null : clinic.franchise_id);
          expect(H.roleCodeFor(storedUser.role_id)).toBe(isCore ? "ADMIN" : "FRANCHISE_ADMIN");

          // An admin_activity_logs entry names the acting user, the Dietitian
          // and the Clinic (Req 2.13, 22.3).
          expect(db.activityLogs).toHaveLength(1);
          const logEntry = db.activityLogs[0];
          expect(logEntry.admin_id).toBe(actingUserId);
          expect(logEntry.entity_id).toBe(result.data.id);
          expect(logEntry.details.dietitian_id).toBe(result.data.id);
          expect(logEntry.details.clinic_id).toBe(clinic.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("createDietitian yields ADMIN/franchise_id=null and a null Dietitian_Clinic_Link when no Clinic is assigned", async () => {
    await fc.assert(
      fc.asyncProperty(arbFullName, arbEmail, arbMobile, arbActingUserId, async (fullName, email, mobile, actingUserId) => {
        H.reset();

        const result = await createDietitian(
          { fullName, email, mobile, password: "password123", clinicId: null },
          actingUserId,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.roleCode).toBe("ADMIN");
        expect(result.data.franchiseId).toBeNull();
        expect(result.data.clinicId).toBeNull();

        expect(db.activityLogs).toHaveLength(1);
        expect(db.activityLogs[0].details.clinic_id).toBeNull();
        expect(db.activityLogs[0].details.dietitian_id).toBe(result.data.id);
        expect(db.activityLogs[0].admin_id).toBe(actingUserId);
      }),
      { numRuns: 100 },
    );
  });

  it("updateDietitian re-derives role/franchise_id on reassignment, links the new Clinic, and logs the change", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClinic,
        arbClinic,
        arbFullName,
        arbMobile,
        arbActingUserId,
        async (initialClinic, newClinic, fullName, mobile, actingUserId) => {
          H.reset();
          db.clinics.push(initialClinic, newClinic);

          // Seed an existing Dietitian assigned to the initial Clinic.
          const initialRoleCode = initialClinic.franchise_id === null ? "ADMIN" : "FRANCHISE_ADMIN";
          const dietitianId = "seed-dietitian-1";
          db.users.push({
            id: dietitianId,
            auth_user_id: "seed-auth-1",
            full_name: "Seed Name",
            email: "seed@example.com",
            mobile: "9000000000",
            role_id: H.roleIdFor(initialRoleCode),
            franchise_id: initialClinic.franchise_id,
            dietitian_clinic_id: initialClinic.id,
            admin_access_level: "dietitian",
            is_active: true,
            created_at: new Date().toISOString(),
          });

          const result = await updateDietitian(
            dietitianId,
            { fullName, mobile, clinicId: newClinic.id },
            actingUserId,
            initialClinic.franchise_id,
          );

          if (!result.success) {
            throw new Error(`updateDietitian failed: ${JSON.stringify(result)}`);
          }
          expect(result.success).toBe(true);

          const isCore = newClinic.franchise_id === null;

          expect(result.data.roleCode).toBe(isCore ? "ADMIN" : "FRANCHISE_ADMIN");
          expect(result.data.franchiseId).toBe(isCore ? null : newClinic.franchise_id);
          expect(result.data.clinicId).toBe(newClinic.id);

          const storedUser = db.users.find((u: any) => u.id === dietitianId);
          expect(storedUser.dietitian_clinic_id).toBe(newClinic.id);
          expect(storedUser.franchise_id).toBe(isCore ? null : newClinic.franchise_id);
          expect(H.roleCodeFor(storedUser.role_id)).toBe(isCore ? "ADMIN" : "FRANCHISE_ADMIN");

          expect(db.activityLogs).toHaveLength(1);
          const logEntry = db.activityLogs[0];
          expect(logEntry.admin_id).toBe(actingUserId);
          expect(logEntry.entity_id).toBe(dietitianId);
          expect(logEntry.details.dietitian_id).toBe(dietitianId);
          expect(logEntry.details.clinic_id).toBe(newClinic.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});
