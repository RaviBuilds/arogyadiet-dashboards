// Feature: core-clinic-architecture, Property 14: Rider has at most one clinic, replaced on reassignment
//
// Property test for the single Rider ↔ Clinic linkage invariant, exercised
// through the admin-portal Server Action
// `assignRiderToClinic` (src/actions/admin-actions/riderClinicActions.ts).
//
// Property 14: Rider has at most one clinic, replaced on reassignment
//   For any sequence of assign/reassign operations against existing active
//   clinics, each Rider retains at most one active clinic linkage, and after a
//   reassignment the single remaining linkage equals the most recently
//   assigned clinic. Because the linkage lives in the single
//   `rider_profiles.clinic_id` column, every successful assignment OVERWRITES
//   any prior linkage — a single column can hold at most one value, so a rider
//   can never have two simultaneous clinic linkages.
//
// Because a live Supabase connection is not available in unit tests, the
// `rider_profiles` table is modeled by an IN-MEMORY store. `@/lib/supabase/admin`
// `createAdminClient` is mocked to back the action with this store (select
// id/clinic_id by id; update clinic_id by id), `@/repositories/clinic/clinicRepository`
// `getClinicById` is mocked to resolve every generated clinic id as an existing
// (active) clinic, auth is mocked as an ADMIN caller, and `next/cache` +
// `@/lib/logger` are stubbed.
//
// Validates: Requirements 8.1, 8.3

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so the mock factory can close over it) ───

const store = vi.hoisted(() => {
  // A single `rider_profiles`-shaped table holding only the columns the action
  // reads/writes for linkage: id and clinic_id.
  interface RiderProfileRow {
    id: string;
    clinic_id: string | null;
    [key: string]: unknown;
  }

  const rows: RiderProfileRow[] = [];

  return {
    rows,
    reset: () => {
      rows.length = 0;
    },
    seedRider: (id: string, clinicId: string | null = null) => {
      rows.push({ id, clinic_id: clinicId });
    },
    getRider: (id: string) => rows.find((r) => r.id === id),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Next.js cache revalidation is a no-op outside a request scope.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// Admin-action audit logging is a side effect irrelevant to the invariant.
vi.mock("@/lib/logger", () => ({
  logAdminAction: async () => {},
}));

// Every generated clinic id resolves to an existing, active clinic, so the
// validity guard in `assignRiderToClinic` always passes and the linkage write
// proceeds (the focus of Property 14).
vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: async (id: string) => ({
    id,
    name: `Clinic ${id}`,
    address: "addr",
    latitude: 0,
    longitude: 0,
    kitchen_id: "kitchen-1",
    franchise_id: null,
    created_at: "",
    updated_at: "",
  }),
}));

// Authorize every call as a global ADMIN, mirroring the user/roles lookup chain
// in `assertCallerCanManageRiders`.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-admin" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "admin-user", roles: { code: "ADMIN" } },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

// Back the rider-clinic action with the in-memory store. The fake query builder
// reproduces exactly the chains used by `riderClinicActions`:
//   - read:  from("rider_profiles").select("id, clinic_id").eq("id", id).maybeSingle()
//   - write: from("rider_profiles").update({ clinic_id }).eq("id", id)
vi.mock("@/lib/supabase/admin", () => {
  class TableQuery {
    private op: "select" | "update" | null = null;
    private updateData: Record<string, unknown> | null = null;
    private filters: Array<[string, unknown]> = [];

    update(data: Record<string, unknown>) {
      this.op = "update";
      this.updateData = data;
      return this;
    }

    select(_cols?: string) {
      if (!this.op) this.op = "select";
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push([col, val]);
      return this;
    }

    maybeSingle() {
      return this.exec("maybe");
    }

    single() {
      return this.exec("single");
    }

    // Awaiting the builder directly (update) executes the operation.
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.exec("multi").then(onfulfilled, onrejected);
    }

    private matches(row: Record<string, unknown>) {
      return this.filters.every(([col, val]) => row[col] === val);
    }

    private async exec(mode: "single" | "maybe" | "multi") {
      const rows = store.rows;

      if (this.op === "update") {
        const targets = rows.filter((r) => this.matches(r));
        const patch = this.updateData!;
        for (const r of targets) Object.assign(r, patch);
        return { data: null, error: null };
      }

      // select
      const result = rows.filter((r) => this.matches(r));
      if (mode === "single") {
        if (result.length === 0) {
          return { data: null, error: { code: "PGRST116", message: "no rows" } };
        }
        return { data: result[0], error: null };
      }
      // maybe
      return { data: result[0] ?? null, error: null };
    }
  }

  return {
    createAdminClient: () => ({
      from: (_table: string) => new TableQuery(),
    }),
  };
});

// Import AFTER the mocks so the action binds to the fake admin client.
import { assignRiderToClinic } from "../riderClinicActions";

// ─── Generators ────────────────────────────────────────────────────────────

// A small clinic pool so reassignments to a different clinic happen frequently.
const arbClinic = fc.constantFrom(
  "clinic-A",
  "clinic-B",
  "clinic-C",
  "clinic-D"
);

// A non-empty sequence of clinic ids to assign to the same rider in order.
const arbClinicSequence = fc.array(arbClinic, { minLength: 1, maxLength: 20 });

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 14: Rider has at most one clinic, replaced on reassignment", () => {
  it("after each assign/reassign the rider has exactly one linkage equal to the just-assigned clinic, and the final linkage equals the last assigned clinic", async () => {
    await fc.assert(
      fc.asyncProperty(arbClinicSequence, async (clinics) => {
        store.reset();

        const riderId = "rider-1";
        // Rider starts with no linkage.
        store.seedRider(riderId, null);

        let lastAssigned: string | null = null;

        for (const clinicId of clinics) {
          const result = await assignRiderToClinic(riderId, clinicId);

          // Every clinic in the sequence exists/active, so each assignment
          // succeeds (Req 8.2 path) and the linkage is written.
          expect(result.success).toBe(true);
          lastAssigned = clinicId;

          // At most one linkage: the single `clinic_id` column physically
          // cannot hold two values. After a (re)assignment the single
          // remaining linkage equals the most recently assigned clinic
          // (Req 8.1, 8.3).
          const rider = store.getRider(riderId)!;
          expect(rider.clinic_id).toBe(clinicId);

          // There is exactly one rider row for this rider — no second linkage
          // record is ever created.
          expect(store.rows.filter((r) => r.id === riderId).length).toBe(1);
        }

        // After the full sequence, the single linkage equals the last assigned
        // clinic (Req 8.3).
        const rider = store.getRider(riderId)!;
        expect(rider.clinic_id).toBe(lastAssigned);
      }),
      { numRuns: 200 }
    );
  });
});
