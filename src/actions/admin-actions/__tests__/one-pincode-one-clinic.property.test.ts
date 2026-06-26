// Feature: core-clinic-architecture, Property 7: One pincode belongs to exactly one clinic
//
// Property test for the one-pincode-one-clinic invariant exercised through the
// admin-portal service-area Server Actions
// (src/actions/admin-actions/serviceAreaActions.ts): `addPincodeToClinic`,
// `editPincode`, `deletePincode`.
//
// Property 7: One pincode belongs to exactly one clinic
//   For any sequence of add/edit/delete operations across multiple clinics and
//   pincodes, each pincode is associated with at most one clinic. The database
//   UNIQUE constraint `uq_service_area_pincode` causes any operation that would
//   create a second association for an already-assigned pincode to be rejected
//   (current owner identified), leaving the existing association unchanged.
//
// Because a live Supabase connection is not available in unit tests, the
// `rider_service_areas` table is modeled by an IN-MEMORY store that simulates
// the `uq_service_area_pincode` UNIQUE constraint: any insert/update that would
// produce a duplicate pincode resolves with a Postgres unique-violation
// (`{ code: "23505" }`), exactly as Supabase surfaces it. `@/lib/supabase/admin`
// `createAdminClient` is mocked to back the actions with this store, auth is
// mocked as an ADMIN caller, and `next/cache` + `@/lib/logger` are stubbed.
//
// Validates: Requirements 4.1, 4.3, 5.3

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so the mock factory can close over it) ───

const store = vi.hoisted(() => {
  // A single `rider_service_areas`-shaped table. The UNIQUE pincode constraint
  // (`uq_service_area_pincode`) is enforced by the fake query builder below.
  interface ServiceAreaRow {
    id: string;
    clinic_id: string | null;
    pincode: string;
    area_name: string;
    rider_id: string | null;
    // Index signature so rows are assignable to the fake query builder's
    // generic `Record<string, unknown>` row access (e.g. `row[col]`,
    // `Object.assign(row, patch)`) without weakening the known fields.
    [key: string]: unknown;
  }

  const rows: ServiceAreaRow[] = [];
  // Optional clinic display names, used only to shape the `clinics(name)` join
  // in the "already assigned" error path.
  const clinicNames = new Map<string, string>();
  let counter = 0;

  return {
    rows,
    clinicNames,
    nextId: () => `sa-${++counter}`,
    reset: () => {
      rows.length = 0;
      clinicNames.clear();
      counter = 0;
    },
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

// Authorize every call as a global ADMIN, mirroring the user/roles lookup chain
// in `assertCallerCanManageServiceAreas`.
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

// Back the service-area actions with the in-memory store. The fake query
// builder reproduces the exact chains used by serviceAreaActions and simulates
// the `uq_service_area_pincode` UNIQUE constraint by resolving a Postgres
// unique-violation (`{ code: "23505" }`) for any duplicate-pincode write.
vi.mock("@/lib/supabase/admin", () => {
  const UNIQUE_VIOLATION = "23505";

  class TableQuery {
    private op: "select" | "insert" | "update" | "delete" | null = null;
    private cols: string | null = null;
    private insertData: Record<string, unknown> | null = null;
    private updateData: Record<string, unknown> | null = null;
    private filters: Array<[string, unknown]> = [];
    private limitN: number | null = null;

    insert(data: Record<string, unknown>) {
      this.op = "insert";
      this.insertData = data;
      return this;
    }

    update(data: Record<string, unknown>) {
      this.op = "update";
      this.updateData = data;
      return this;
    }

    delete() {
      this.op = "delete";
      return this;
    }

    select(cols?: string) {
      if (!this.op) this.op = "select";
      this.cols = cols ?? null;
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push([col, val]);
      return this;
    }

    not() {
      // `.not("rider_id", "is", null)` is unused by add/edit/delete; harmless.
      return this;
    }

    limit(n: number) {
      this.limitN = n;
      return this;
    }

    single() {
      return this.exec("single");
    }

    maybeSingle() {
      return this.exec("maybe");
    }

    // Awaiting the builder directly (update/delete) executes the operation.
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.exec("multi").then(onfulfilled, onrejected);
    }

    private matches(row: Record<string, unknown>) {
      return this.filters.every(([col, val]) => row[col] === val);
    }

    private shape(row: Record<string, unknown> | undefined) {
      if (!row) return row;
      if (this.cols && this.cols.includes("clinics(name)")) {
        const clinicId = row.clinic_id as string | null;
        return {
          clinic_id: clinicId,
          clinics: { name: clinicId ? store.clinicNames.get(clinicId) ?? null : null },
        };
      }
      return row;
    }

    private async exec(mode: "single" | "maybe" | "multi") {
      const rows = store.rows;

      if (this.op === "insert") {
        const data = this.insertData!;
        // Simulate uq_service_area_pincode: reject a duplicate pincode insert.
        if (rows.some((r) => r.pincode === data.pincode)) {
          return { data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate key" } };
        }
        const row = {
          id: store.nextId(),
          clinic_id: (data.clinic_id as string | null) ?? null,
          pincode: data.pincode as string,
          area_name: (data.area_name as string) ?? (data.pincode as string),
          rider_id: (data.rider_id as string | null) ?? null,
        };
        rows.push(row);
        return { data: { id: row.id }, error: null };
      }

      if (this.op === "update") {
        const targets = rows.filter((r) => this.matches(r));
        const patch = this.updateData!;
        if ("pincode" in patch) {
          const newPincode = patch.pincode;
          // Simulate uq_service_area_pincode against OTHER rows.
          if (rows.some((r) => r.pincode === newPincode && !targets.includes(r))) {
            return { data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate key" } };
          }
        }
        for (const r of targets) Object.assign(r, patch);
        return { data: null, error: null };
      }

      if (this.op === "delete") {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (this.matches(rows[i])) rows.splice(i, 1);
        }
        return { data: null, error: null };
      }

      // select
      let result = rows.filter((r) => this.matches(r));
      if (this.limitN != null) result = result.slice(0, this.limitN);

      if (mode === "single") {
        if (result.length === 0) {
          return { data: null, error: { code: "PGRST116", message: "no rows" } };
        }
        return { data: this.shape(result[0]), error: null };
      }
      if (mode === "maybe") {
        return { data: result[0] ? this.shape(result[0]) : null, error: null };
      }
      return { data: result.map((r) => this.shape(r)), error: null };
    }
  }

  return {
    createAdminClient: () => ({
      from: (_table: string) => new TableQuery(),
      rpc: async () => ({ data: 0, error: null }),
    }),
  };
});

// Import AFTER the mocks so the actions bind to the fake admin client.
import {
  addPincodeToClinic,
  editPincode,
  deletePincode,
} from "../serviceAreaActions";

// ─── Generators ────────────────────────────────────────────────────────────

// A small clinic pool so collisions across clinics happen frequently.
const arbClinic = fc.constantFrom("clinic-A", "clinic-B", "clinic-C");

// A small valid 6-digit pincode pool so add/edit operations collide often,
// exercising the UNIQUE-constraint rejection path.
const arbPincode = fc.constantFrom(
  "500001",
  "500002",
  "500003",
  "500004",
  "500005"
);

type Op =
  | { kind: "add"; clinic: string; pincode: string }
  | { kind: "edit"; idx: number; pincode: string }
  | { kind: "delete"; idx: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("add" as const),
    clinic: arbClinic,
    pincode: arbPincode,
  }),
  fc.record({
    kind: fc.constant("edit" as const),
    idx: fc.nat(),
    pincode: arbPincode,
  }),
  fc.record({ kind: fc.constant("delete" as const), idx: fc.nat() })
);

const arbOps = fc.array(arbOp, { minLength: 1, maxLength: 25 });

// ─── Invariant helper ────────────────────────────────────────────────────────

/**
 * Assert the global invariant: every pincode in the store maps to exactly one
 * clinic (no pincode appears under two different clinics, and no pincode is
 * duplicated). Returns a snapshot map pincode -> clinic_id.
 */
function assertSingleHomed(): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const row of store.rows) {
    expect(owners.has(row.pincode)).toBe(false); // no duplicate pincode rows
    owners.set(row.pincode, row.clinic_id);
  }
  return owners;
}

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 7: One pincode belongs to exactly one clinic", () => {
  it("each pincode maps to at most one clinic across any add/edit/delete sequence; an add of an already-owned pincode is rejected and leaves the prior association unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbOps, async (ops) => {
        store.reset();

        for (const op of ops) {
          if (op.kind === "add") {
            const before = assertSingleHomed();
            const ownedBefore = before.has(op.pincode);
            const ownerBefore = before.get(op.pincode);

            const result = await addPincodeToClinic(op.clinic, op.pincode);

            if (ownedBefore) {
              // Adding an already-assigned pincode must be rejected by the
              // UNIQUE constraint (Req 4.3, 5.3)...
              expect(result.success).toBe(false);
              // ...and the existing association must be unchanged (Req 4.1).
              const after = assertSingleHomed();
              expect(after.get(op.pincode)).toBe(ownerBefore);
            } else {
              // A fresh pincode is accepted and owned by the target clinic.
              expect(result.success).toBe(true);
              const after = assertSingleHomed();
              expect(after.get(op.pincode)).toBe(op.clinic);
            }
          } else if (op.kind === "edit") {
            if (store.rows.length === 0) continue;
            const target = store.rows[op.idx % store.rows.length];
            const targetId = target.id;
            const oldPincode = target.pincode;
            const before = assertSingleHomed();
            const collides =
              before.has(op.pincode) && op.pincode !== oldPincode;

            const result = await editPincode(targetId, op.pincode);

            if (collides) {
              // Editing onto another clinic's pincode is rejected; both the
              // edited row and the colliding owner are left unchanged.
              expect(result.success).toBe(false);
              const after = assertSingleHomed();
              expect(after.get(oldPincode)).toBe(before.get(oldPincode));
              expect(after.get(op.pincode)).toBe(before.get(op.pincode));
            } else {
              expect(result.success).toBe(true);
            }
          } else {
            if (store.rows.length === 0) continue;
            const target = store.rows[op.idx % store.rows.length];
            const targetId = target.id;
            const removedPincode = target.pincode;

            const result = await deletePincode(targetId);
            expect(result.success).toBe(true);
            const after = assertSingleHomed();
            // The pincode association is gone after deletion.
            expect(after.has(removedPincode)).toBe(false);
          }

          // The single-homed invariant holds after every operation.
          assertSingleHomed();
        }
      }),
      { numRuns: 200 }
    );
  });
});
