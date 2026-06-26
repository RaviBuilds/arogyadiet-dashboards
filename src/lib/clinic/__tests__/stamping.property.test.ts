// src/lib/clinic/__tests__/stamping.property.test.ts
//
// Feature: core-clinic-architecture, Property 11: Customer clinic stamping reflects pincode resolution
//
// Property 11: Customer clinic stamping reflects pincode resolution —
//   For any pincode-to-clinic mapping, when a customer signs up or updates a
//   delivery address: if the pincode resolves to exactly one clinic, the
//   customer's stamped clinic_id and the matching address clinic_id equal that
//   clinic; if it resolves to no clinic, the stamped clinic_id is set to unset
//   (null); and the persisted value read back equals the value written at
//   operation time (not recomputed at read time).
//
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
//
// Strategy: `stampCustomerClinic` (src/lib/clinic/stamping.ts) takes the
// Supabase client as a parameter and calls `resolveClinicForPincode` from
// `@/lib/clinic/pincode-resolver`. We mock the resolver so it returns a
// generated resolution (resolved / none / ambiguous) and pass an in-memory
// fake Supabase client backing `customer_profiles` and `addresses`. The fake
// supports the exact write chain used by the module:
//   .from(table).update(values).eq("id", id)
// After the call we read the persisted rows back out of the fake store to
// confirm the stamp was written at operation time (Req 6.3 — not recomputed
// at read time).

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mock: pincode resolver ──────────────────────────────────────────────────
// The resolution is injected per-run via the mocked function below.
vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: vi.fn(),
}));

import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import type { ClinicResolution } from "@/lib/clinic/pincode-resolver";
import { stampCustomerClinic } from "../stamping";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── In-memory fake Supabase client ──────────────────────────────────────────

type Row = Record<string, unknown>;

interface Store {
  customer_profiles: Row[];
  addresses: Row[];
}

/**
 * A thenable query builder supporting `.update(values).eq("id", id)`. The
 * update persists `values` into every matching row of the in-memory store and
 * resolves to `{ error: null }` (matching the Supabase response shape used by
 * stampCustomerClinic).
 */
function createFakeClient(store: Store) {
  function query(table: keyof Store) {
    let updateValues: Row = {};
    const filters: Array<(row: Row) => boolean> = [];

    const builder = {
      update(values: Row) {
        updateValues = values;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      then(
        onFulfilled?: (value: { error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        try {
          for (const row of store[table]) {
            if (filters.every((f) => f(row))) {
              Object.assign(row, updateValues);
            }
          }
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        } catch (err) {
          return Promise.reject(err).then(onFulfilled, onRejected);
        }
      },
    };
    return builder;
  }

  return {
    from: (table: keyof Store) => query(table),
  } as unknown as SupabaseClient;
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbClinicId = fc.uuid();

// An initial (already-persisted) stamp the row carries before the operation.
// Includes null so we exercise both "previously stamped" and "never stamped".
const arbInitialClinic = fc.oneof(fc.uuid(), fc.constant<string | null>(null));

// The resolution the mocked resolver returns for this run.
const arbResolution: fc.Arbitrary<ClinicResolution> = fc.oneof(
  arbClinicId.map(
    (clinic_id): ClinicResolution => ({ type: "resolved", clinic_id })
  ),
  fc.constant<ClinicResolution>({ type: "none", clinic_id: null }),
  fc.constant<ClinicResolution>({ type: "ambiguous", clinic_id: null })
);

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

// ─── Property Test ────────────────────────────────────────────────────────────

describe("Customer clinic stamping reflects pincode resolution - Property 11", () => {
  beforeEach(() => {
    vi.mocked(resolveClinicForPincode).mockReset();
  });

  it("stamps both customer and address per the resolution, persists at write time, and surfaces the matching result", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbResolution,
        arbInitialClinic,
        arbInitialClinic,
        arbPincode,
        async (resolution, initialCustomerClinic, initialAddressClinic, pincode) => {
          const customerProfileId = "cust-1";
          const addressId = "addr-1";

          // Fresh in-memory store for this run.
          const store: Store = {
            customer_profiles: [
              { id: customerProfileId, clinic_id: initialCustomerClinic },
              // A bystander row that must never be touched.
              { id: "cust-other", clinic_id: "untouched-clinic" },
            ],
            addresses: [
              { id: addressId, clinic_id: initialAddressClinic },
              { id: "addr-other", clinic_id: "untouched-clinic" },
            ],
          };

          const supabase = createFakeClient(store);
          vi.mocked(resolveClinicForPincode).mockResolvedValue(resolution);

          const result = await stampCustomerClinic({
            supabase,
            customerProfileId,
            addressId,
            pincode,
          });

          // Read the persisted values back out of the store (Req 6.3).
          const customerRow = store.customer_profiles.find(
            (r) => r.id === customerProfileId
          )!;
          const addressRow = store.addresses.find((r) => r.id === addressId)!;

          if (resolution.type === "resolved") {
            // Req 6.1 / 6.2: both stamps equal the resolved clinic.
            expect(result).toEqual({
              type: "stamped",
              clinic_id: resolution.clinic_id,
            });
            expect(customerRow.clinic_id).toBe(resolution.clinic_id);
            expect(addressRow.clinic_id).toBe(resolution.clinic_id);
          } else if (resolution.type === "none") {
            // Req 6.4 / 6.5: both stamps cleared to null.
            expect(result).toEqual({ type: "cleared", clinic_id: null });
            expect(customerRow.clinic_id).toBeNull();
            expect(addressRow.clinic_id).toBeNull();
          } else {
            // Ambiguous: nothing persisted, both rows left unchanged.
            expect(result).toEqual({ type: "ambiguous", clinic_id: null });
            expect(customerRow.clinic_id).toBe(initialCustomerClinic);
            expect(addressRow.clinic_id).toBe(initialAddressClinic);
          }

          // Bystander rows are never affected regardless of resolution.
          expect(
            store.customer_profiles.find((r) => r.id === "cust-other")!.clinic_id
          ).toBe("untouched-clinic");
          expect(
            store.addresses.find((r) => r.id === "addr-other")!.clinic_id
          ).toBe("untouched-clinic");
        }
      ),
      { numRuns: 200 }
    );
  });
});
