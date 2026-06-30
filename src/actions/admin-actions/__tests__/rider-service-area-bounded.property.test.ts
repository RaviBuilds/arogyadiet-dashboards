// Feature: core-clinic-architecture, Property 16: Service-area assignment is bounded by the rider's clinic
//
// Property test for the clinic-bounded rider service-area constraint exercised
// through the admin-portal rider↔clinic Server Actions
// (src/actions/admin-actions/riderClinicActions.ts):
// `getAssignablePincodesForRider` and `assignServiceAreaToRider`.
//
// Property 16: Service-area assignment is bounded by the rider's clinic
//   For any rider:
//     • If the rider has NO linked clinic, every service-area assignment is
//       rejected with a clinic-required error and NO change is made.
//     • If the rider IS linked to a clinic, the set of assignable pincodes
//       equals exactly that clinic's pincodes, an attempt to assign a pincode
//       inside the clinic succeeds (sets rider_id), and an attempt to assign
//       any pincode outside that clinic (or an unknown pincode) is rejected,
//       leaving existing associations unchanged.
//
// Because a live Supabase connection is not available in unit tests, the
// `rider_profiles` (id, clinic_id) and `rider_service_areas`
// (id, clinic_id, pincode, rider_id) tables are modeled by IN-MEMORY stores.
// `@/lib/supabase/admin` `createAdminClient` is mocked to back the actions with
// those stores, `@/lib/supabase/server` authorizes the caller as a global
// ADMIN, and `next/cache` + `@/lib/logger` are stubbed.
//
// Validates: Requirements 9.1, 9.2, 9.3

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so the mock factory can close over it) ───

const store = vi.hoisted(() => {
  interface RiderRow {
    id: string;
    clinic_id: string | null;
    [key: string]: unknown;
  }
  interface ServiceAreaRow {
    id: string;
    clinic_id: string | null;
    pincode: string;
    rider_id: string | null;
    [key: string]: unknown;
  }

  const riders: RiderRow[] = [];
  const areas: ServiceAreaRow[] = [];

  return {
    riders,
    areas,
    reset: () => {
      riders.length = 0;
      areas.length = 0;
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

// Back the rider↔clinic actions with the in-memory stores. The fake query
// builder reproduces the exact chains used by riderClinicActions:
//   rider_profiles    : select("id, clinic_id").eq("id", id).maybeSingle()
//   rider_service_areas: select("pincode").eq("clinic_id", c).order("pincode", …)
//   rider_service_areas: select("id, clinic_id").eq("pincode", p).maybeSingle()
//   rider_service_areas: update({ rider_id }).eq("id", id)
vi.mock("@/lib/supabase/admin", () => {
  class TableQuery {
    private rows: Array<Record<string, unknown>>;
    private op: "select" | "update" = "select";
    private updateData: Record<string, unknown> | null = null;
    private filters: Array<[string, unknown]> = [];
    private orderCol: string | null = null;

    constructor(rows: Array<Record<string, unknown>>) {
      this.rows = rows;
    }

    select(_cols?: string) {
      this.op = "select";
      return this;
    }

    update(data: Record<string, unknown>) {
      this.op = "update";
      this.updateData = data;
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push([col, val]);
      return this;
    }

    order(col: string, _opts?: { ascending?: boolean }) {
      this.orderCol = col;
      return this;
    }

    maybeSingle() {
      return this.exec("maybe");
    }

    single() {
      return this.exec("single");
    }

    // Awaiting the builder directly (update / ordered select) executes it.
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
      if (this.op === "update") {
        const targets = this.rows.filter((r) => this.matches(r));
        for (const r of targets) Object.assign(r, this.updateData!);
        return { data: null, error: null };
      }

      // select
      let result = this.rows.filter((r) => this.matches(r));
      if (this.orderCol) {
        const col = this.orderCol;
        result = [...result].sort((a, b) =>
          String(a[col]).localeCompare(String(b[col]))
        );
      }

      if (mode === "single") {
        if (result.length === 0) {
          return { data: null, error: { code: "PGRST116", message: "no rows" } };
        }
        return { data: result[0], error: null };
      }
      if (mode === "maybe") {
        return { data: result[0] ?? null, error: null };
      }
      return { data: result, error: null };
    }
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table === "rider_profiles") return new TableQuery(store.riders);
        if (table === "rider_service_areas") return new TableQuery(store.areas);
        throw new Error(`unexpected table ${table}`);
      },
    }),
  };
});

// Import AFTER the mocks so the actions bind to the fake admin client.
import {
  getAssignablePincodesForRider,
  assignServiceAreaToRider,
} from "../riderClinicActions";

// ─── Generators ────────────────────────────────────────────────────────────

// A small clinic pool so a rider's clinic frequently both owns some pincodes
// and excludes others.
const arbClinicId = fc.constantFrom("clinic-A", "clinic-B", "clinic-C");

// A small valid 6-digit pincode pool so generated service areas spread across
// clinics with frequent in/out boundary cases.
const arbPincode = fc.constantFrom(
  "500001",
  "500002",
  "500003",
  "500004",
  "500005",
  "500006",
  "500007",
  "500008"
);

// A pool of service-area rows. Each pincode appears at most once (one-pincode-
// one-clinic), assigned to some clinic, optionally pre-associated to a rider.
const arbAreaRows = fc.uniqueArray(
  fc.record({
    pincode: arbPincode,
    clinic: arbClinicId,
    preRider: fc.option(fc.constantFrom("rider-x", "rider-y"), { nil: null }),
  }),
  { selector: (r) => r.pincode, minLength: 0, maxLength: 8 }
);

// The rider under test: either unlinked or linked to one clinic from the pool.
const arbRider = fc.record({
  linked: fc.boolean(),
  clinic: arbClinicId,
});

// A pincode unknown to any clinic, used to exercise the unknown-pincode path.
const UNKNOWN_PINCODE = "999999";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seed(
  areaRows: Array<{ pincode: string; clinic: string; preRider: string | null }>,
  rider: { linked: boolean; clinic: string }
) {
  store.reset();
  areaRows.forEach((r, i) => {
    store.areas.push({
      id: `sa-${i}`,
      clinic_id: r.clinic,
      pincode: r.pincode,
      rider_id: r.preRider,
    });
  });
  store.riders.push({
    id: "rider-under-test",
    clinic_id: rider.linked ? rider.clinic : null,
  });
}

function riderIdSnapshot(): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const r of store.areas) m.set(r.id, r.rider_id as string | null);
  return m;
}

function expectUnchanged(before: Map<string, string | null>) {
  for (const r of store.areas) {
    expect(r.rider_id).toBe(before.get(r.id));
  }
}

const RIDER_ID = "rider-under-test";

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 16: Service-area assignment is bounded by the rider's clinic", () => {
  it("an unlinked rider can assign nothing (no change); a linked rider's assignable set equals its clinic's pincodes, in-clinic assigns succeed, out-of-clinic/unknown assigns are rejected unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbAreaRows, arbRider, async (areaRows, rider) => {
        seed(areaRows, rider);

        if (!rider.linked) {
          // ── Unlinked rider (Req 9.1) ──────────────────────────────────────
          // No clinic ⇒ nothing assignable: both reads/writes are rejected.
          const list = await getAssignablePincodesForRider(RIDER_ID);
          expect(list.success).toBe(false);

          // Attempting to assign ANY pincode (known or unknown) is rejected and
          // leaves every association unchanged.
          const before = riderIdSnapshot();
          const candidates = [
            ...areaRows.map((r) => r.pincode),
            UNKNOWN_PINCODE,
          ];
          for (const pincode of candidates) {
            const res = await assignServiceAreaToRider(RIDER_ID, pincode);
            expect(res.success).toBe(false);
          }
          expectUnchanged(before);
          return;
        }

        // ── Linked rider (Req 9.2, 9.3) ─────────────────────────────────────
        const clinic = rider.clinic;
        const inClinicPincodes = areaRows
          .filter((r) => r.clinic === clinic)
          .map((r) => r.pincode)
          .sort((a, b) => a.localeCompare(b));
        const outClinicPincodes = areaRows
          .filter((r) => r.clinic !== clinic)
          .map((r) => r.pincode);

        // Assignable set equals EXACTLY the linked clinic's pincodes (Req 9.2).
        const list = await getAssignablePincodesForRider(RIDER_ID);
        expect(list.success).toBe(true);
        if (list.success) {
          expect([...list.data].sort((a, b) => a.localeCompare(b))).toEqual(
            inClinicPincodes
          );
        }

        // Assigning a pincode INSIDE the clinic succeeds and sets rider_id on
        // exactly that pincode's row (Req 9.2).
        for (const pincode of inClinicPincodes) {
          const res = await assignServiceAreaToRider(RIDER_ID, pincode);
          expect(res.success).toBe(true);
          const row = store.areas.find((r) => r.pincode === pincode)!;
          expect(row.rider_id).toBe(RIDER_ID);
        }

        // Assigning a pincode OUTSIDE the clinic (another clinic's pincode) or
        // an UNKNOWN pincode is rejected, leaving all associations unchanged
        // (Req 9.3).
        const before = riderIdSnapshot();
        for (const pincode of [...outClinicPincodes, UNKNOWN_PINCODE]) {
          const res = await assignServiceAreaToRider(RIDER_ID, pincode);
          expect(res.success).toBe(false);
        }
        expectUnchanged(before);
      }),
      { numRuns: 200 }
    );
  });
});
