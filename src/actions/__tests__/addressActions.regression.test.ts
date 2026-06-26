// src/actions/__tests__/addressActions.regression.test.ts
// Regression tests for `saveAddressAction` (Requirement 6.7).
//
// Task 5.2 wired clinic stamping into `saveAddressAction`. Req 6.7 requires that
// the action's accepted inputs, outcomes, and completion behavior remain
// UNCHANGED aside from the added `stampCustomerClinic` call. These example-based
// tests pin that contract:
//   - Unauthorized (no user) still throws.
//   - Invalid pincode / over-limit still return the same `{ error }` shapes.
//   - A valid create still returns `{ success: true }`, inserts the address,
//     and fires `notifyAddressSaved` + `revalidatePath`.
//   - A valid edit still returns `{ success: true }` and updates the row.
//   - `stampCustomerClinic` (the only addition) is invoked, but its result does
//     NOT change the action's return shape.
//
// All external dependencies are replaced with in-memory fakes/spies so the test
// exercises the real control flow of `saveAddressAction` and the real
// `addressSchema` validation, without a live Supabase connection.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Shared, test-controllable state (hoisted so the vi.mock factories can
//     close over the same refs vitest hoists above the imports) ──────────────
const h = vi.hoisted(() => ({
  authUser: { current: { id: "auth-1" } as { id: string } | null },
  state: {
    current: null as null | {
      idCounter: number;
      dbUser: { id: string } | null;
      profile: { id: string } | null;
      addresses: Record<string, unknown>[];
      inserts: Record<string, unknown>[];
      updates: { table: string; payload: unknown; filters: Record<string, unknown> }[];
    },
  },
  pincodeOk: { current: true },
  serviceAreaPincodes: { current: ["500081"] as string[] },
  notifySpy: vi.fn(),
  revalidateSpy: vi.fn(),
  stampSpy: vi.fn(),
}));

// ─── Mock: Supabase server client with the exact chains saveAddressAction uses ──
vi.mock("@/lib/supabase/server", () => {
  function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
    return Object.entries(filters).every(([col, val]) => row[col] === val);
  }

  function resolve(table: string, ctx: {
    op: "select" | "insert" | "update";
    selectCount: boolean;
    payload: Record<string, unknown> | null;
    filters: Record<string, unknown>;
  }) {
    const state = h.state.current!;

    if (ctx.op === "insert") {
      if (table === "addresses") {
        const id = `addr-${++state.idCounter}`;
        const row = { id, ...(ctx.payload ?? {}) };
        state.addresses.push(row);
        state.inserts.push(row);
        return { data: { id }, error: null };
      }
      return { data: null, error: null };
    }

    if (ctx.op === "update") {
      const target = state.addresses.filter((r) => matches(r, ctx.filters));
      for (const r of target) Object.assign(r, ctx.payload ?? {});
      state.updates.push({ table, payload: ctx.payload, filters: ctx.filters });
      return { data: null, error: null };
    }

    // select
    if (ctx.selectCount) {
      const count = state.addresses.filter((r) => matches(r, ctx.filters)).length;
      return { count, data: null, error: null };
    }
    if (table === "users") return { data: state.dbUser, error: null };
    if (table === "customer_profiles") return { data: state.profile, error: null };
    return { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const ctx = {
      op: "select" as "select" | "insert" | "update",
      selectCount: false,
      payload: null as Record<string, unknown> | null,
      filters: {} as Record<string, unknown>,
    };
    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head && opts?.count) ctx.selectCount = true;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        ctx.op = "insert";
        ctx.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        ctx.op = "update";
        ctx.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        ctx.filters[col] = val;
        return builder;
      },
      single() {
        return Promise.resolve(resolve(table, ctx));
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(resolve(table, ctx)).then(onF, onR);
      },
    };
    return builder;
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: h.authUser.current }, error: null }),
      },
      from: (table: string) => makeBuilder(table),
    }),
  };
});

// ─── Mock: pincode actions (assertDeliverablePincode / service-area lookup) ───
vi.mock("@/actions/pincodeActions", () => ({
  assertDeliverablePincode: async () =>
    h.pincodeOk.current
      ? { ok: true }
      : { ok: false, error: "Sorry, we don't deliver to pincode 999999." },
  getServiceAreaPincodesAction: async () => h.serviceAreaPincodes.current,
}));

// ─── Mock: customer notifications (spy only) ─────────────────────────────────
vi.mock("@/lib/customer/customerProfileNotifications", () => ({
  notifyAddressSaved: h.notifySpy,
  notifyAddressDeleted: vi.fn(),
}));

// ─── Mock: Next.js cache revalidation (spy only) ─────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: h.revalidateSpy,
}));

// ─── Mock: clinic stamping — the ONLY behavioral addition under test ─────────
vi.mock("@/lib/clinic/stamping", () => ({
  stampCustomerClinic: h.stampSpy,
}));

// `deleteCustomerAddress` is imported by the module but unused by
// `saveAddressAction`; stub it so the import graph stays inert.
vi.mock("@/lib/address/deleteCustomerAddress", () => ({
  deleteCustomerAddress: vi.fn(),
}));

import { saveAddressAction } from "@/actions/addressActions";
import type { AddressFormValues } from "@/validations/addressSchema";

// A valid, schema-passing address. Pincode 500081 is a 5-series pincode, so it
// passes `addressSchema` regardless of the service-area list.
function validAddress(overrides: Partial<AddressFormValues> = {}): AddressFormValues {
  return {
    tag: "Home",
    street_1: "123 Main Street",
    street_2: "",
    landmark: "",
    city: "Hyderabad",
    state: "Telangana",
    is_primary: true,
    pincode: "500081",
    lat: 17.4,
    lng: 78.4,
    ...overrides,
  };
}

beforeEach(() => {
  h.authUser.current = { id: "auth-1" };
  h.pincodeOk.current = true;
  h.serviceAreaPincodes.current = ["500081"];
  h.state.current = {
    idCounter: 0,
    dbUser: { id: "db-user-1" },
    profile: { id: "profile-1" },
    addresses: [],
    inserts: [],
    updates: [],
  };
  h.notifySpy.mockReset();
  h.revalidateSpy.mockReset();
  h.stampSpy.mockReset();
  // Default stamp outcome: resolved to one clinic.
  h.stampSpy.mockResolvedValue({ type: "stamped", clinic_id: "clinic-1" });
});

describe("saveAddressAction — preserved behavior (Req 6.7)", () => {
  it("throws Unauthorized when there is no authenticated user", async () => {
    h.authUser.current = null;
    await expect(saveAddressAction(validAddress())).rejects.toThrow("Unauthorized");
    // No stamping or completion side effects on the unauthorized path.
    expect(h.stampSpy).not.toHaveBeenCalled();
    expect(h.notifySpy).not.toHaveBeenCalled();
  });

  it("returns the pincode error shape when the pincode is not deliverable", async () => {
    h.pincodeOk.current = false;
    const result = await saveAddressAction(validAddress({ pincode: "999999" }));
    expect(result).toEqual({ error: "Sorry, we don't deliver to pincode 999999." });
    expect(h.stampSpy).not.toHaveBeenCalled();
    expect(h.notifySpy).not.toHaveBeenCalled();
  });

  it("returns the over-limit error when creating a 3rd address (>=2 existing)", async () => {
    h.state.current!.addresses = [
      { id: "addr-a", customer_profile_id: "profile-1" },
      { id: "addr-b", customer_profile_id: "profile-1" },
    ];
    const result = await saveAddressAction(validAddress());
    expect(result).toEqual({ error: "Maximum 2 addresses allowed" });
    // Rejected before any new row is inserted or completion fires.
    expect(h.state.current!.inserts).toHaveLength(0);
    expect(h.notifySpy).not.toHaveBeenCalled();
    expect(h.stampSpy).not.toHaveBeenCalled();
  });

  it("creates a valid address: returns success, inserts the row, notifies, and revalidates", async () => {
    const result = await saveAddressAction(validAddress());

    expect(result).toEqual({ success: true });

    // Address inserted with the submitted values.
    expect(h.state.current!.inserts).toHaveLength(1);
    const inserted = h.state.current!.inserts[0];
    expect(inserted).toMatchObject({
      customer_profile_id: "profile-1",
      tag: "Home",
      street_1: "123 Main Street",
      pincode: "500081",
      is_primary: true,
    });

    // Completion behavior unchanged.
    expect(h.notifySpy).toHaveBeenCalledTimes(1);
    expect(h.notifySpy).toHaveBeenCalledWith("db-user-1", { isEdit: false, tag: "Home" });
    expect(h.revalidateSpy).toHaveBeenCalledWith("/profile");
  });

  it("edits a valid address: returns success and updates the existing row", async () => {
    h.state.current!.addresses = [
      { id: "addr-1", customer_profile_id: "profile-1", street_1: "old" },
    ];

    const result = await saveAddressAction(validAddress({ id: "addr-1", street_1: "456 New Road" }));

    expect(result).toEqual({ success: true });
    // No new row created on edit.
    expect(h.state.current!.inserts).toHaveLength(0);
    // The existing row was updated in place.
    const row = h.state.current!.addresses.find((r) => r.id === "addr-1");
    expect(row).toMatchObject({ street_1: "456 New Road" });
    // Completion behavior reports an edit.
    expect(h.notifySpy).toHaveBeenCalledWith("db-user-1", { isEdit: true, tag: "Home" });
    expect(h.revalidateSpy).toHaveBeenCalledWith("/profile");
  });
});

describe("saveAddressAction — clinic stamping is the only addition (Req 6.7)", () => {
  it("invokes stampCustomerClinic on a valid create with the resolved address id and pincode", async () => {
    const result = await saveAddressAction(validAddress());

    expect(result).toEqual({ success: true });
    expect(h.stampSpy).toHaveBeenCalledTimes(1);
    const arg = h.stampSpy.mock.calls[0][0];
    expect(arg).toMatchObject({
      customerProfileId: "profile-1",
      addressId: "addr-1",
      pincode: "500081",
    });
    expect(arg.supabase).toBeDefined();
  });

  it("invokes stampCustomerClinic on a valid edit with the edited address id", async () => {
    h.state.current!.addresses = [
      { id: "addr-1", customer_profile_id: "profile-1" },
    ];
    await saveAddressAction(validAddress({ id: "addr-1" }));

    expect(h.stampSpy).toHaveBeenCalledTimes(1);
    expect(h.stampSpy.mock.calls[0][0]).toMatchObject({ addressId: "addr-1" });
  });

  it("does not change the return shape regardless of the stamp outcome", async () => {
    // Stamp resolves to no clinic ("cleared").
    h.stampSpy.mockResolvedValue({ type: "cleared", clinic_id: null });
    expect(await saveAddressAction(validAddress())).toEqual({ success: true });

    // Stamp is ambiguous.
    h.state.current!.addresses = [];
    h.state.current!.inserts = [];
    h.stampSpy.mockResolvedValue({ type: "ambiguous", clinic_id: null });
    expect(await saveAddressAction(validAddress())).toEqual({ success: true });

    // Stamp reports an internal error — saveAddressAction still completes the
    // same way (its contract is unchanged; the stamp is best-effort).
    h.state.current!.addresses = [];
    h.state.current!.inserts = [];
    h.stampSpy.mockResolvedValue({ type: "error", error: "boom" });
    expect(await saveAddressAction(validAddress())).toEqual({ success: true });
  });
});
