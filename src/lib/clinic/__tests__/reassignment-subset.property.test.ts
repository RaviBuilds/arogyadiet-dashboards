// Feature: core-clinic-architecture, Property 12: Customer auto-reassignment selects exactly the matching subset
//
// Property test for `reassignCustomersOnPincodeMove`
// (src/lib/clinic/reassignment.ts).
//
// Property 12: Customer auto-reassignment selects exactly the matching subset
//   For any set of customers and a pincode move A→B, exactly the customers
//   whose stamped address pincode equals the moved pincode AND whose current
//   stamped clinic is A are reassigned to B (both their clinic_id and matching
//   address clinic_id become B); all others are left unchanged; the returned
//   count equals the matching subset size (0 when none).
//
// A live Supabase connection is not available in unit tests, so
// `@/lib/supabase/admin`'s `createAdminClient` is mocked with an in-memory
// model of the `addresses` and `customer_profiles` tables. The fake supports
// the exact query chains used by the module:
//   .from("addresses").select("customer_profile_id")
//        .eq("pincode", ..).eq("clinic_id", ..).not("customer_profile_id","is",null)
//   .from("customer_profiles").update({clinic_id},{count:"exact"})
//        .in("id", ..).eq("clinic_id", ..)
//   .from("addresses").update({clinic_id})
//        .in("customer_profile_id", ..).eq("pincode", ..).eq("clinic_id", ..)
//
// Validates: Requirements 7.1, 7.2, 7.3

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Mock: in-memory Supabase admin client ──────────────────────────────────

vi.mock("@/lib/supabase/admin", () => {
  type Row = Record<string, unknown>;
  interface State {
    addresses: Row[];
    customer_profiles: Row[];
  }

  const state: State = { addresses: [], customer_profiles: [] };

  // A minimal query builder that is thenable (so `await chain` resolves) and
  // supports the eq/in/not filter chains plus select/update operations used by
  // reassignCustomersOnPincodeMove.
  class QueryBuilder {
    private op: "select" | "update" | null = null;
    private updateValues: Row = {};
    private countExact = false;
    private filters: Array<(row: Row) => boolean> = [];

    constructor(private state: State, private table: keyof State) {}

    select() {
      this.op = "select";
      return this;
    }

    update(values: Row, opts?: { count?: string }) {
      this.op = "update";
      this.updateValues = values;
      this.countExact = opts?.count === "exact";
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }

    in(col: string, vals: unknown[]) {
      const set = new Set(vals);
      this.filters.push((row) => set.has(row[col]));
      return this;
    }

    not(col: string, operator: string, val: unknown) {
      // Only the "is null" negation is used: keep rows where col is set.
      if (operator === "is" && val === null) {
        this.filters.push(
          (row) => row[col] !== null && row[col] !== undefined
        );
      }
      return this;
    }

    private matches(row: Row) {
      return this.filters.every((f) => f(row));
    }

    private execute() {
      const rows = this.state[this.table];
      if (this.op === "select") {
        return { data: rows.filter((r) => this.matches(r)), error: null };
      }
      if (this.op === "update") {
        let count = 0;
        for (const r of rows) {
          if (this.matches(r)) {
            Object.assign(r, this.updateValues);
            count++;
          }
        }
        return this.countExact
          ? { error: null, count }
          : { error: null };
      }
      return { data: null, error: null };
    }

    then(
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      try {
        return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
      } catch (err) {
        return Promise.reject(err).then(onFulfilled, onRejected);
      }
    }
  }

  return {
    __state: state,
    __setState: (addresses: Row[], profiles: Row[]) => {
      state.addresses = addresses;
      state.customer_profiles = profiles;
    },
    createAdminClient: () => ({
      from: (table: keyof State) => new QueryBuilder(state, table),
    }),
  };
});

// Import AFTER the mock is registered so the module binds to the fake client.
import { reassignCustomersOnPincodeMove } from "../reassignment";
import * as adminMock from "@/lib/supabase/admin";

type Row = Record<string, unknown>;
const mock = adminMock as unknown as {
  __state: { addresses: Row[]; customer_profiles: Row[] };
  __setState: (addresses: Row[], profiles: Row[]) => void;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLINIC_A = "clinic-A"; // source clinic of the move
const CLINIC_B = "clinic-B"; // destination clinic of the move
const CLINIC_C = "clinic-C"; // an unrelated clinic
const MOVED_PINCODE = "500081"; // the pincode being moved
const OTHER_PINCODE = "500082"; // an unrelated pincode

// ─── Generators ──────────────────────────────────────────────────────────────
//
// Each customer owns exactly one address; the customer's stamped clinic mirrors
// the address clinic (the stamping invariant from Requirement 6). We vary both
// the address pincode and the stamped clinic across the move source (A), the
// destination (B), an unrelated clinic (C), and the unstamped (null) state.

const arbCustomerSpec = fc.record({
  pincode: fc.constantFrom(MOVED_PINCODE, OTHER_PINCODE),
  clinic: fc.constantFrom<string | null>(CLINIC_A, CLINIC_B, CLINIC_C, null),
});

const arbPopulation = fc.array(arbCustomerSpec, {
  minLength: 0,
  maxLength: 40,
});

// ─── Property Test ─────────────────────────────────────────────────────────────

describe("Customer auto-reassignment selects exactly the matching subset - Property 12", () => {
  it("reassigns exactly the (moved-pincode ∧ clinic-A) customers to B, leaves all others unchanged, and returns the subset size", async () => {
    await fc.assert(
      fc.asyncProperty(arbPopulation, async (specs) => {
        // Build fresh state for this run.
        const profiles: Row[] = specs.map((s, i) => ({
          id: `cust-${i}`,
          clinic_id: s.clinic,
        }));
        const addresses: Row[] = specs.map((s, i) => ({
          id: `addr-${i}`,
          customer_profile_id: `cust-${i}`,
          pincode: s.pincode,
          clinic_id: s.clinic,
        }));
        // An orphan address (no owning customer) that matches the move filter:
        // it must be ignored because customer_profile_id is null.
        addresses.push({
          id: "orphan-1",
          customer_profile_id: null,
          pincode: MOVED_PINCODE,
          clinic_id: CLINIC_A,
        });

        mock.__setState(addresses, profiles);

        // Expected matching subset: stamped pincode === moved AND clinic === A.
        const expectedSubset = new Set<number>(
          specs
            .map((s, i) => ({ s, i }))
            .filter(
              ({ s }) => s.pincode === MOVED_PINCODE && s.clinic === CLINIC_A
            )
            .map(({ i }) => i)
        );

        const result = await reassignCustomersOnPincodeMove({
          pincode: MOVED_PINCODE,
          fromClinicId: CLINIC_A,
          toClinicId: CLINIC_B,
        });

        // Req 7.3: clean run, count equals the matching subset size (0 = none).
        expect(result.error).toBeUndefined();
        expect(result.reassigned).toBe(expectedSubset.size);

        const finalProfiles = mock.__state.customer_profiles;
        const finalAddresses = mock.__state.addresses;

        for (let i = 0; i < specs.length; i++) {
          const prof = finalProfiles.find((p) => p.id === `cust-${i}`)!;
          const addr = finalAddresses.find((a) => a.id === `addr-${i}`)!;

          if (expectedSubset.has(i)) {
            // Req 7.1 / 7.2: both the customer stamp and matching address move to B.
            expect(prof.clinic_id).toBe(CLINIC_B);
            expect(addr.clinic_id).toBe(CLINIC_B);
            expect(addr.pincode).toBe(MOVED_PINCODE);
          } else {
            // Everyone else is left entirely unchanged.
            expect(prof.clinic_id).toBe(specs[i].clinic);
            expect(addr.clinic_id).toBe(specs[i].clinic);
            expect(addr.pincode).toBe(specs[i].pincode);
          }
        }

        // The orphan address is never touched (excluded by the not-null filter).
        const orphan = finalAddresses.find((a) => a.id === "orphan-1")!;
        expect(orphan.clinic_id).toBe(CLINIC_A);
      }),
      { numRuns: 200 }
    );
  });

  it("returns a count of zero when no customer matches the moved pincode", async () => {
    // No customer is stamped to clinic A on the moved pincode.
    mock.__setState(
      [
        {
          id: "addr-0",
          customer_profile_id: "cust-0",
          pincode: OTHER_PINCODE,
          clinic_id: CLINIC_A,
        },
        {
          id: "addr-1",
          customer_profile_id: "cust-1",
          pincode: MOVED_PINCODE,
          clinic_id: CLINIC_B,
        },
      ],
      [
        { id: "cust-0", clinic_id: CLINIC_A },
        { id: "cust-1", clinic_id: CLINIC_B },
      ]
    );

    const result = await reassignCustomersOnPincodeMove({
      pincode: MOVED_PINCODE,
      fromClinicId: CLINIC_A,
      toClinicId: CLINIC_B,
    });

    expect(result.error).toBeUndefined();
    expect(result.reassigned).toBe(0);
    // Nothing changed.
    expect(mock.__state.customer_profiles[0].clinic_id).toBe(CLINIC_A);
    expect(mock.__state.customer_profiles[1].clinic_id).toBe(CLINIC_B);
  });
});
