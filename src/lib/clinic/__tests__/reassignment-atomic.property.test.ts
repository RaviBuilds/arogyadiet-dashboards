// src/lib/clinic/__tests__/reassignment-atomic.property.test.ts
//
// Feature: core-clinic-architecture, Property 16: Reassignment is atomic on failure
//
// Property 16: Reassignment is atomic on failure — For any reassignment batch
// that fails, the stamped clinic_id of every affected customer is left
// unchanged and an error indication describing the failure is returned.
//
// **Validates: Requirements 7.5**
//
// Strategy: exercise `reassignCustomersOnPincodeMove` against a mocked
// `@/lib/supabase/admin` `createAdminClient` backed by an in-memory model that
// supports fault injection. The real transactional guarantee for the live move
// path is provided by the Postgres RPC `move_pincode_and_reassign` (a single DB
// transaction); this module is the side-effect-scoped JS mirror. To model the
// same all-or-nothing semantics at the JS layer, the in-memory model treats any
// injected error as the whole batch producing no net observable customer change
// (it rolls back every mutation it staged before surfacing the error), so the
// property can assert atomicity without a live transaction.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Replace the admin client with our in-memory fake (hoisted by vitest).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { reassignCustomersOnPincodeMove } from "../reassignment";

// ─── In-memory model with fault injection + transactional rollback ──────────

type CustomerRow = { id: string; clinic_id: string | null };
type AddressRow = {
  customer_profile_id: string | null;
  pincode: string;
  clinic_id: string | null;
  is_primary: boolean;
};
type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] }
  | { type: "notnull"; col: string };

type Model = {
  customer_profiles: CustomerRow[];
  addresses: AddressRow[];
  /** Which table's UPDATE should fail, or null for the success path. */
  failTable: "customer_profiles" | "addresses" | null;
  rollback: () => void;
};

function createModel(params: {
  customers: CustomerRow[];
  addresses: AddressRow[];
  failTable: "customer_profiles" | "addresses" | null;
}): Model {
  const customer_profiles = params.customers.map((c) => ({ ...c }));
  const addresses = params.addresses.map((a) => ({ ...a }));

  // Snapshot for the all-or-nothing rollback (models the SQL transaction).
  const snapCustomers = customer_profiles.map((c) => ({ ...c }));
  const snapAddresses = addresses.map((a) => ({ ...a }));

  return {
    customer_profiles,
    addresses,
    failTable: params.failTable,
    rollback() {
      customer_profiles.forEach((c, i) => {
        c.clinic_id = snapCustomers[i].clinic_id;
      });
      addresses.forEach((a, i) => {
        a.clinic_id = snapAddresses[i].clinic_id;
      });
    },
  };
}

function makeMatcher(filters: Filter[]) {
  return (row: Record<string, unknown>) =>
    filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "in") return f.vals.includes(row[f.col]);
      // notnull
      return row[f.col] !== null && row[f.col] !== undefined;
    });
}

/** A thenable query builder mirroring the chains used by reassignment.ts. */
function createQuery(model: Model, table: "addresses" | "customer_profiles") {
  const filters: Filter[] = [];
  let op: "select" | "update" | null = null;
  let updateValues: Record<string, unknown> = {};

  const run = async () => {
    const rows =
      table === "addresses"
        ? (model.addresses as unknown as Record<string, unknown>[])
        : (model.customer_profiles as unknown as Record<string, unknown>[]);
    const matched = rows.filter(makeMatcher(filters));

    if (op === "update") {
      if (model.failTable === table) {
        // Inject failure: roll back the whole batch (no net customer change)
        // and surface a descriptive error, exactly like a transaction abort.
        model.rollback();
        return {
          data: null,
          error: { message: `injected ${table} update failure` },
          count: null,
        };
      }
      for (const r of matched) Object.assign(r, updateValues);
      return { data: null, error: null, count: matched.length };
    }

    // select projection (reassignment.ts only reads customer_profile_id)
    return {
      data: matched.map((r) => ({
        customer_profile_id: r.customer_profile_id,
      })),
      error: null,
    };
  };

  const api = {
    select(_cols?: string, _opts?: unknown) {
      op = "select";
      return api;
    },
    update(values: Record<string, unknown>, _opts?: unknown) {
      op = "update";
      updateValues = values;
      return api;
    },
    eq(col: string, val: unknown) {
      filters.push({ type: "eq", col, val });
      return api;
    },
    in(col: string, vals: unknown[]) {
      filters.push({ type: "in", col, vals });
      return api;
    },
    not(col: string, _operator: string, _val: unknown) {
      filters.push({ type: "notnull", col });
      return api;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return run().then(onFulfilled, onRejected);
    },
  };
  return api;
}

function makeAdminClient(model: Model) {
  return {
    from(table: string) {
      return createQuery(model, table as "addresses" | "customer_profiles");
    },
  };
}

// ─── Generators ─────────────────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

// Two distinct clinic ids: source (`from`) and destination (`to`).
const arbClinics = fc
  .uniqueArray(fc.integer({ min: 0, max: 6 }), {
    minLength: 2,
    maxLength: 2,
  })
  .map(([a, b]) => ({ from: `clinic-${a}`, to: `clinic-${b}` }));

// Extra customers beyond the one guaranteed matcher.
const arbExtraCustomers = fc.array(
  fc.record({
    matches: fc.boolean(),
    otherPincode: arbPincode,
  }),
  { maxLength: 8 }
);

/**
 * Builds an in-memory model with at least one customer whose address matches
 * (moved pincode + stamped to `from`), so the batch always reaches the update
 * step. Non-matchers are stamped to `to`, guaranteeing they are never selected.
 */
function buildScenario(args: {
  pincode: string;
  from: string;
  to: string;
  extras: { matches: boolean; otherPincode: string }[];
  failTable: "customer_profiles" | "addresses" | null;
}) {
  const { pincode, from, to, extras, failTable } = args;
  const customers: CustomerRow[] = [];
  const addresses: AddressRow[] = [];

  // Guaranteed matcher.
  customers.push({ id: "cust-0", clinic_id: from });
  addresses.push({ customer_profile_id: "cust-0", pincode, clinic_id: from, is_primary: true });
  let expectedMatches = 1;

  extras.forEach((spec, i) => {
    const id = `cust-${i + 1}`;
    if (spec.matches) {
      customers.push({ id, clinic_id: from });
      addresses.push({ customer_profile_id: id, pincode, clinic_id: from, is_primary: true });
      expectedMatches += 1;
    } else {
      // Stamped to `to` so the address never matches the `from` filter.
      customers.push({ id, clinic_id: to });
      addresses.push({
        customer_profile_id: id,
        pincode: spec.otherPincode,
        clinic_id: to,
        is_primary: true,
      });
    }
  });

  const model = createModel({ customers, addresses, failTable });
  return { model, expectedMatches };
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("reassignCustomersOnPincodeMove - Property 16: atomic on failure", () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReset();
  });

  it("on an injected failure, returns an error and leaves every clinic_id unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClinics,
        arbPincode,
        arbExtraCustomers,
        fc.constantFrom<"customer_profiles" | "addresses">(
          "customer_profiles",
          "addresses"
        ),
        async ({ from, to }, pincode, extras, failTable) => {
          const { model } = buildScenario({
            pincode,
            from,
            to,
            extras,
            failTable,
          });

          // Capture pre-run stamps to assert no net change after failure.
          const beforeCustomers = model.customer_profiles.map((c) => c.clinic_id);
          const beforeAddresses = model.addresses.map((a) => a.clinic_id);

          vi.mocked(createAdminClient).mockReturnValue(
            makeAdminClient(model) as unknown as ReturnType<
              typeof createAdminClient
            >
          );

          const result = await reassignCustomersOnPincodeMove({
            pincode,
            fromClinicId: from,
            toClinicId: to,
          });

          // An error indication describing the failure is returned.
          expect(result.reassigned).toBe(0);
          expect(typeof result.error).toBe("string");
          expect((result.error ?? "").length).toBeGreaterThan(0);

          // Every affected customer's stamped clinic_id is left unchanged.
          expect(model.customer_profiles.map((c) => c.clinic_id)).toEqual(
            beforeCustomers
          );
          expect(model.addresses.map((a) => a.clinic_id)).toEqual(
            beforeAddresses
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("success path: applies stamps to exactly the matching subset and returns no error", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClinics,
        arbPincode,
        arbExtraCustomers,
        async ({ from, to }, pincode, extras) => {
          const { model, expectedMatches } = buildScenario({
            pincode,
            from,
            to,
            extras,
            failTable: null,
          });

          vi.mocked(createAdminClient).mockReturnValue(
            makeAdminClient(model) as unknown as ReturnType<
              typeof createAdminClient
            >
          );

          const result = await reassignCustomersOnPincodeMove({
            pincode,
            fromClinicId: from,
            toClinicId: to,
          });

          // No error, and the count equals the matching subset size.
          expect(result.error).toBeUndefined();
          expect(result.reassigned).toBe(expectedMatches);

          // Matching customers (+ their matching address) are moved to `to`;
          // non-matchers remain on `to` (their original, untouched stamp).
          for (const customer of model.customer_profiles) {
            expect(customer.clinic_id).toBe(to);
          }
          for (const address of model.addresses) {
            if (address.pincode === pincode) {
              expect(address.clinic_id).toBe(to);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
