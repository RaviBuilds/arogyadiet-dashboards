// src/lib/clinic/__tests__/primary-address-stamping.property.test.ts
//
// Feature: core-clinic-architecture, Property 13: Customer clinic stamping reflects the Primary_Address pincode resolution
//
// Property 13: For any pincode-to-clinic mapping, when a customer signs up or
//   updates their Primary_Address: if the Primary_Address pincode resolves to
//   exactly one clinic the customer's stamped clinic_id and the primary address
//   clinic_id equal that clinic; if it resolves to no clinic the stamped
//   clinic_id is set to unset (null); if it resolves ambiguously the stamped
//   clinic_id is left unchanged; and the persisted value read back equals the
//   value written at operation time (not recomputed at read time).
//
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**
//
// Strategy: two complementary properties.
//   (A) The PURE decision — `resolveCustomerStamp(primaryAddressResolution,
//       currentClinicId)` maps resolved → { next: clinic_id }, none →
//       { next: null }, ambiguous → { unchanged: true }, independent of the
//       prior stamp value.
//   (B) The PERSISTED round-trip — `stampCustomerByPrimaryAddress` anchors on
//       the primary address, applies the pure decision, and writes the result
//       to BOTH customer_profiles and the primary address row; reading the rows
//       back confirms the value was written at operation time (Req 6.3).

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// The resolver is mocked so each run injects a generated resolution.
vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: vi.fn(),
}));

import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import type { ClinicResolution } from "@/lib/clinic/pincode-resolver";
import {
  resolveCustomerStamp,
  stampCustomerByPrimaryAddress,
} from "../stamping";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Generators ──────────────────────────────────────────────────────────────

const arbClinicId = fc.uuid();

// A customer's already-persisted stamp before the operation. Includes null so we
// exercise both "never stamped" and "previously stamped" customers.
const arbInitialClinic = fc.oneof(fc.uuid(), fc.constant<string | null>(null));

const arbResolution: fc.Arbitrary<ClinicResolution> = fc.oneof(
  arbClinicId.map(
    (clinic_id): ClinicResolution => ({ type: "resolved", clinic_id })
  ),
  fc.constant<ClinicResolution>({ type: "none", clinic_id: null }),
  fc.constant<ClinicResolution>({ type: "ambiguous", clinic_id: null })
);

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

// ─── In-memory fake Supabase client (for the persisted round-trip) ───────────

type Row = Record<string, unknown>;
interface Store {
  customer_profiles: Row[];
  addresses: Row[];
}

/**
 * Minimal thenable query builder supporting the exact chains used by
 * `stampCustomerByPrimaryAddress`:
 *   .select(...).eq(...).eq(...).maybeSingle()   (reads)
 *   .update(values).eq("id", id)                 (writes)
 */
function createFakeClient(store: Store) {
  function query(table: keyof Store) {
    let updateValues: Row | null = null;
    const filters: Array<(row: Row) => boolean> = [];

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      update(values: Row) {
        updateValues = values;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      maybeSingle() {
        const found = store[table].find((row) => filters.every((f) => f(row)));
        return Promise.resolve({ data: found ?? null, error: null });
      },
      then(
        onFulfilled?: (value: { error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        for (const row of store[table]) {
          if (filters.every((f) => f(row)) && updateValues) {
            Object.assign(row, updateValues);
          }
        }
        return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { from: (table: keyof Store) => query(table) } as unknown as SupabaseClient;
}

// ─── Property A: pure decision ───────────────────────────────────────────────

describe("Primary_Address stamping decision is pure and matches the resolution - Property 13", () => {
  it("maps resolved → next clinic, none → null, ambiguous → unchanged, regardless of prior stamp", () => {
    fc.assert(
      fc.property(arbResolution, arbInitialClinic, (resolution, currentClinicId) => {
        const decision = resolveCustomerStamp(resolution, currentClinicId);

        if (resolution.type === "resolved") {
          // Req 6.1 / 6.2: re-anchor to the resolved clinic.
          expect(decision).toEqual({ next: resolution.clinic_id });
        } else if (resolution.type === "none") {
          // Req 6.4 / 6.5: clear the stamp.
          expect(decision).toEqual({ next: null });
        } else {
          // Req 6.6: ambiguous leaves the stamp untouched.
          expect(decision).toEqual({ unchanged: true });
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Property B: persisted round-trip anchored on the primary address ────────

describe("Primary_Address stamping persists at write time and reads back equal - Property 13", () => {
  beforeEach(() => {
    vi.mocked(resolveClinicForPincode).mockReset();
  });

  it("writes the resolution to both customer and primary address, readable after the operation", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbResolution,
        arbInitialClinic,
        arbInitialClinic,
        arbPincode,
        async (resolution, initialCustomerClinic, initialAddressClinic, pincode) => {
          const customerProfileId = "cust-1";
          const primaryAddressId = "addr-primary";

          const store: Store = {
            customer_profiles: [
              { id: customerProfileId, clinic_id: initialCustomerClinic },
              { id: "cust-other", clinic_id: "untouched" },
            ],
            addresses: [
              {
                id: primaryAddressId,
                customer_profile_id: customerProfileId,
                is_primary: true,
                pincode,
                clinic_id: initialAddressClinic,
              },
              // A non-primary address that must never be stamped.
              {
                id: "addr-secondary",
                customer_profile_id: customerProfileId,
                is_primary: false,
                pincode: "999999",
                clinic_id: "untouched",
              },
            ],
          };

          const supabase = createFakeClient(store);
          vi.mocked(resolveClinicForPincode).mockResolvedValue(resolution);

          const result = await stampCustomerByPrimaryAddress({
            supabase,
            customerProfileId,
          });

          // Read persisted values back (Req 6.3 — not recomputed at read time).
          const customerRow = store.customer_profiles.find(
            (r) => r.id === customerProfileId
          )!;
          const primaryRow = store.addresses.find(
            (r) => r.id === primaryAddressId
          )!;
          const secondaryRow = store.addresses.find(
            (r) => r.id === "addr-secondary"
          )!;

          if (resolution.type === "resolved") {
            expect(result).toEqual({
              type: "stamped",
              clinic_id: resolution.clinic_id,
            });
            expect(customerRow.clinic_id).toBe(resolution.clinic_id);
            expect(primaryRow.clinic_id).toBe(resolution.clinic_id);
          } else if (resolution.type === "none") {
            expect(result).toEqual({ type: "cleared", clinic_id: null });
            expect(customerRow.clinic_id).toBeNull();
            expect(primaryRow.clinic_id).toBeNull();
          } else {
            expect(result).toEqual({ type: "ambiguous", clinic_id: null });
            expect(customerRow.clinic_id).toBe(initialCustomerClinic);
            expect(primaryRow.clinic_id).toBe(initialAddressClinic);
          }

          // The non-primary address is never touched by primary-address stamping.
          expect(secondaryRow.clinic_id).toBe("untouched");
          // Bystander customer untouched.
          expect(
            store.customer_profiles.find((r) => r.id === "cust-other")!.clinic_id
          ).toBe("untouched");
        }
      ),
      { numRuns: 200 }
    );
  });
});
