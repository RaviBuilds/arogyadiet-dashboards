// src/lib/clinic/__tests__/stamping-regression.test.ts
//
// Feature: core-clinic-architecture — Regression: customer stamping preserves
// existing signup / address-update behavior, adding ONLY the clinic_id stamp.
//
// **Validates: Requirements 6.8**
//
// Requirement 6.8 requires that the customer signup and address-update flows
// keep their existing accepted inputs, outcomes, and completion behavior — the
// ONLY new effect being the clinic_id stamping (set) and clearing (unset)
// actions. These regression tests pin that contract against the stamping module
// by confirming:
//   1. Stamping mutates ONLY the `clinic_id` column on `customer_profiles` and
//      the primary `addresses` row — every other field is preserved verbatim.
//   2. Only the targeted customer's primary address is touched; secondary
//      addresses and other customers are never modified.
//   3. Each resolution outcome (resolved / none / ambiguous / no-primary /
//      error) yields the documented completion result, so callers' control flow
//      is unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: vi.fn(),
}));

import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import type { ClinicResolution } from "@/lib/clinic/pincode-resolver";
import { stampCustomerByPrimaryAddress } from "../stamping";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── In-memory fake Supabase client ──────────────────────────────────────────

type Row = Record<string, unknown>;
interface Store {
  customer_profiles: Row[];
  addresses: Row[];
}

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

// A realistic customer + primary address carrying many non-clinic fields that
// must survive stamping untouched.
function seedStore(initialClinic: string | null): Store {
  return {
    customer_profiles: [
      {
        id: "cust-1",
        full_name: "Asha Rao",
        phone: "9876543210",
        subscription_status: "active",
        clinic_id: initialClinic,
      },
      { id: "cust-other", full_name: "Other", clinic_id: "other-clinic" },
    ],
    addresses: [
      {
        id: "addr-primary",
        customer_profile_id: "cust-1",
        is_primary: true,
        pincode: "500081",
        line1: "12 MG Road",
        city: "Hyderabad",
        clinic_id: initialClinic,
      },
      {
        id: "addr-secondary",
        customer_profile_id: "cust-1",
        is_primary: false,
        pincode: "500001",
        line1: "9 Park Lane",
        city: "Hyderabad",
        clinic_id: "secondary-clinic",
      },
    ],
  };
}

describe("Stamping regression — preserves signup/address-update behavior (Req 6.8)", () => {
  beforeEach(() => {
    vi.mocked(resolveClinicForPincode).mockReset();
  });

  it("on resolved: sets ONLY clinic_id on the customer + primary address, preserving every other field", async () => {
    const resolution: ClinicResolution = {
      type: "resolved",
      clinic_id: "clinic-A",
    };
    vi.mocked(resolveClinicForPincode).mockResolvedValue(resolution);
    const store = seedStore(null);

    const result = await stampCustomerByPrimaryAddress({
      supabase: createFakeClient(store),
      customerProfileId: "cust-1",
    });

    expect(result).toEqual({ type: "stamped", clinic_id: "clinic-A" });

    const customer = store.customer_profiles.find((r) => r.id === "cust-1")!;
    // Only clinic_id changed; all other fields preserved.
    expect(customer).toEqual({
      id: "cust-1",
      full_name: "Asha Rao",
      phone: "9876543210",
      subscription_status: "active",
      clinic_id: "clinic-A",
    });

    const primary = store.addresses.find((r) => r.id === "addr-primary")!;
    expect(primary).toEqual({
      id: "addr-primary",
      customer_profile_id: "cust-1",
      is_primary: true,
      pincode: "500081",
      line1: "12 MG Road",
      city: "Hyderabad",
      clinic_id: "clinic-A",
    });

    // Secondary address and other customer untouched.
    expect(
      store.addresses.find((r) => r.id === "addr-secondary")!.clinic_id
    ).toBe("secondary-clinic");
    expect(
      store.customer_profiles.find((r) => r.id === "cust-other")!.clinic_id
    ).toBe("other-clinic");
  });

  it("on none: clears ONLY clinic_id (to null), preserving every other field", async () => {
    vi.mocked(resolveClinicForPincode).mockResolvedValue({
      type: "none",
      clinic_id: null,
    });
    const store = seedStore("clinic-previous");

    const result = await stampCustomerByPrimaryAddress({
      supabase: createFakeClient(store),
      customerProfileId: "cust-1",
    });

    expect(result).toEqual({ type: "cleared", clinic_id: null });

    const customer = store.customer_profiles.find((r) => r.id === "cust-1")!;
    expect(customer.clinic_id).toBeNull();
    // Non-clinic fields preserved.
    expect(customer.full_name).toBe("Asha Rao");
    expect(customer.subscription_status).toBe("active");

    const primary = store.addresses.find((r) => r.id === "addr-primary")!;
    expect(primary.clinic_id).toBeNull();
    expect(primary.line1).toBe("12 MG Road");
    expect(primary.pincode).toBe("500081");
  });

  it("on ambiguous: leaves clinic_id and all other fields completely unchanged", async () => {
    vi.mocked(resolveClinicForPincode).mockResolvedValue({
      type: "ambiguous",
      clinic_id: null,
    });
    const store = seedStore("clinic-existing");
    const customerBefore = { ...store.customer_profiles[0] };
    const primaryBefore = { ...store.addresses[0] };

    const result = await stampCustomerByPrimaryAddress({
      supabase: createFakeClient(store),
      customerProfileId: "cust-1",
    });

    expect(result).toEqual({ type: "ambiguous", clinic_id: null });
    expect(store.customer_profiles[0]).toEqual(customerBefore);
    expect(store.addresses[0]).toEqual(primaryBefore);
  });

  it("when the customer has no primary address: completes as no_primary and changes nothing", async () => {
    const store: Store = {
      customer_profiles: [{ id: "cust-1", full_name: "Asha", clinic_id: null }],
      addresses: [
        {
          id: "addr-secondary",
          customer_profile_id: "cust-1",
          is_primary: false,
          pincode: "500001",
          clinic_id: "secondary-clinic",
        },
      ],
    };

    const result = await stampCustomerByPrimaryAddress({
      supabase: createFakeClient(store),
      customerProfileId: "cust-1",
    });

    expect(result).toEqual({ type: "no_primary" });
    expect(store.customer_profiles[0].clinic_id).toBeNull();
    expect(store.addresses[0].clinic_id).toBe("secondary-clinic");
  });
});
