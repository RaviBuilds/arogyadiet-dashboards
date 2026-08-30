// src/actions/franchise-actions/__tests__/franchise-partial-payment.test.ts
//
// Scoping tests for the FRANCHISE Partial Payment board.
//
// WHY A SEPARATE ACTION EXISTS AT ALL (and why this test matters):
// `admin-actions/partialPaymentActions.getPartialPaymentBalancesAction` reads
// `subscription_payment_balances` / `stay_payment_balances` with NO tenant filter —
// its only confinement is `clinic_id`, and only for the MEAL half. It also opens
// with `guardCustomersWorkspace()`, which REDIRECTS a non-admin rather than
// returning an error. Widening that action to admit franchise callers would have
// handed every franchise the outstanding balances of every other tenant and of
// Core_Business. So the franchise board is its own action, and these tests pin the
// three things that keep it scoped:
//
//   1. PERMISSION  — read-capable, so view-only users and Dietitians are admitted.
//   2. TENANCY     — subscriptions filtered on customer_profiles.franchise_id
//                    BEFORE any ledger is read.
//   3. DIETITIAN_LINK — a Franchise Dietitian additionally sees only customers
//                    assigned to them.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const DIETITIAN_ID = "22222222-2222-4222-8222-222222222222";
  const SUB_ID = "33333333-3333-4333-8333-333333333333";
  const PROFILE_ID = "44444444-4444-4444-8444-444444444444";

  const state = {
    gateOk: true,
    gateError: "You do not have permission to perform this action.",
    isDietitian: false,
    franchiseId: FRANCHISE_A,
    userId: DIETITIAN_ID,
    /** Candidate ids from the balances view. */
    candidateIds: [SUB_ID] as string[],
    /** Whether the tenant-scoped subscription query returns the row. */
    subscriptionInScope: true,
    /** Ledger rows for the subscription. Empty => membership rule 1 drops it. */
    hasLedger: true,
    /** Remaining balance the derivation should produce. */
    remainingBalance: 500,
    /** Whether the profile snapshot read returns the row. */
    profileInTenant: true,
  };

  const defaults = { ...state };
  const calls = {
    /** Every `.eq(column, value)` applied, tagged by table. */
    filters: [] as { table: string; column: string; value: unknown }[],
    tablesRead: [] as string[],
  };

  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.filters.length = 0;
    calls.tablesRead.length = 0;
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    constructor(private readonly table: string) {
      calls.tablesRead.push(table);
    }
    select() { return this; }
    gt() { return this; }
    in() { return this; }
    eq(column?: string, value?: unknown) {
      if (typeof column === "string") {
        calls.filters.push({ table: this.table, column, value });
      }
      return this;
    }

    private get result(): Result {
      if (this.table === "subscription_payment_balances") {
        return {
          data: state.candidateIds.map((id) => ({ subscription_id: id })),
          error: null,
        };
      }
      if (this.table === "subscriptions") {
        return {
          data: state.subscriptionInScope
            ? [
                {
                  id: SUB_ID,
                  customer_profile_id: PROFILE_ID,
                  status: "ACTIVE",
                  customer_category: "MEAL",
                  starts_on: "2026-01-01",
                  effective_end_on: "2026-03-01",
                  ends_on: "2026-03-01",
                  total_payable: 1000,
                  subscription_plans: { name: "30 Day Plan" },
                  customer_profiles: {
                    franchise_id: FRANCHISE_A,
                    dietitian_id: state.isDietitian ? DIETITIAN_ID : null,
                  },
                },
              ]
            : [],
          error: null,
        };
      }
      if (this.table === "subscription_payment_transactions") {
        return {
          data: state.hasLedger
            ? [
                {
                  id: "txn-1",
                  subscription_id: SUB_ID,
                  transaction_type: "ADVANCE",
                  amount: 500,
                  transaction_date: "2026-01-01",
                  payment_method: "CASH",
                  comment: null,
                  remark: null,
                },
              ]
            : [],
          error: null,
        };
      }
      if (this.table === "customer_profiles") {
        return {
          data: state.profileInTenant
            ? [
                {
                  id: PROFILE_ID,
                  is_active: true,
                  dietary_preference: "Veg",
                  gender: "M",
                  date_of_birth: "1990-01-01",
                  allergies: null,
                  has_medical_history: false,
                  clinic_id: "clinic-1",
                  dietitian_id: state.isDietitian ? DIETITIAN_ID : null,
                  clinics: { name: "Vizag Clinic" },
                  users: {
                    full_name: "Owing Customer",
                    email: "owing@example.com",
                    mobile: "9876543210",
                  },
                  dietitian: null,
                  addresses: [
                    { pincode: "530008", is_primary: true, lat: 1, lng: 2 },
                  ],
                },
              ]
            : [],
          error: null,
        };
      }
      return { data: [], error: null };
    }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  return {
    FRANCHISE_A,
    DIETITIAN_ID,
    SUB_ID,
    PROFILE_ID,
    state,
    calls,
    reset,
    adminClient: { from: (table: string) => new FakeQuery(table) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.adminClient,
}));

vi.mock("@/lib/auth/adminAccess", () => ({
  checkFranchiseCustomersRead: async () =>
    H.state.gateOk
      ? {
          ok: true,
          isDietitian: H.state.isDietitian,
          ctx: { franchiseId: H.state.franchiseId, userId: H.state.userId },
        }
      : { ok: false, error: H.state.gateError },
}));

// The real derivation is used for the arithmetic; only the balance figure is
// pinned here, since `SubscriptionPaymentService` has its own tests.
vi.mock("@/services/SubscriptionPaymentService", () => ({
  deriveSubscriptionBalance: () => ({
    totalPayable: 1000,
    totalPaid: 500,
    remainingBalance: H.state.remainingBalance,
  }),
}));

vi.mock("@/services/AccommodationService", () => ({
  toPaise: (rupees: number) => Math.round(rupees * 100),
}));

import { franchiseGetPartialPaymentBalances } from "@/actions/franchise-actions/franchisePartialPaymentActions";

const filtersFor = (table: string) =>
  H.calls.filters.filter((f) => f.table === table);

describe("franchiseGetPartialPaymentBalances", () => {
  beforeEach(() => H.reset());

  it("returns the franchise's outstanding MEAL balances", async () => {
    const result = await franchiseGetPartialPaymentBalances();

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].source).toBe("MEAL");
      expect(result.data[0].entityId).toBe(H.SUB_ID);
      expect(result.data[0].remainingBalance).toBe(500);
      expect(result.data[0].customerSnapshot.fullName).toBe("Owing Customer");
      // The row's own lifecycle, not the profile's, per-entity.
      expect(result.data[0].customerSnapshot.status).toBe("ACTIVE");
      expect(result.data[0].customerSnapshot.customerCategory).toBe("MEAL");
    }
  });

  describe("tenancy", () => {
    it("filters subscriptions on the caller's franchise_id", async () => {
      await franchiseGetPartialPaymentBalances();

      expect(filtersFor("subscriptions")).toEqual(
        expect.arrayContaining([
          {
            table: "subscriptions",
            column: "customer_profiles.franchise_id",
            value: H.FRANCHISE_A,
          },
        ]),
      );
    });

    it("restricts to MEAL by equality, so a new category cannot leak in", async () => {
      await franchiseGetPartialPaymentBalances();

      expect(filtersFor("subscriptions")).toEqual(
        expect.arrayContaining([
          {
            table: "subscriptions",
            column: "customer_category",
            value: "MEAL",
          },
        ]),
      );
    });

    it("re-filters the profile snapshot read on franchise_id (defence in depth)", async () => {
      await franchiseGetPartialPaymentBalances();

      expect(filtersFor("customer_profiles")).toEqual(
        expect.arrayContaining([
          {
            table: "customer_profiles",
            column: "franchise_id",
            value: H.FRANCHISE_A,
          },
        ]),
      );
    });

    it("NEVER reads the accommodation balances view", async () => {
      // Accommodation is not a franchise product; the STAY half is absent, not
      // merely filtered.
      await franchiseGetPartialPaymentBalances();
      expect(H.calls.tablesRead).not.toContain("stay_payment_balances");
      expect(H.calls.tablesRead).not.toContain("stay_entries");
      expect(H.calls.tablesRead).not.toContain("stay_payment_transactions");
    });

    it("returns nothing when no subscription is in the caller's tenant", async () => {
      H.reset({ subscriptionInScope: false });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
    });

    it("FAILS CLOSED when the profile snapshot is out of tenant", async () => {
      // A balance whose owner cannot be confirmed in-tenant is dropped rather
      // than rendered ownerless.
      H.reset({ profileInTenant: false });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
    });
  });

  describe("the Dietitian_Link", () => {
    it("adds a dietitian_id filter for a Franchise Dietitian", async () => {
      H.reset({ isDietitian: true });

      await franchiseGetPartialPaymentBalances();

      expect(filtersFor("subscriptions")).toEqual(
        expect.arrayContaining([
          {
            table: "subscriptions",
            column: "customer_profiles.dietitian_id",
            value: H.DIETITIAN_ID,
          },
        ]),
      );
    });

    it("does NOT add that filter for an owner or operations user", async () => {
      await franchiseGetPartialPaymentBalances();

      const dietitianFilters = filtersFor("subscriptions").filter(
        (f) => f.column === "customer_profiles.dietitian_id",
      );
      expect(dietitianFilters).toEqual([]);
    });
  });

  describe("membership rules", () => {
    it("drops a subscription with NO ledger rows", async () => {
      // Rule 1 — this is what keeps legacy ledger-less records off a collections
      // board. Must not be relaxed to `?? []`.
      H.reset({ hasLedger: false });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
    });

    it("drops a fully settled subscription", async () => {
      H.reset({ remainingBalance: 0 });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
    });

    it("drops an over-collected subscription (refund due, not a collection)", async () => {
      H.reset({ remainingBalance: -250 });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
    });

    it("short-circuits when the balances view yields no candidates", async () => {
      H.reset({ candidateIds: [] });
      const result = await franchiseGetPartialPaymentBalances();
      expect("error" in result).toBe(false);
      if (!("error" in result)) expect(result.data).toEqual([]);
      // No parent or ledger reads at all.
      expect(H.calls.tablesRead).not.toContain("subscriptions");
    });
  });

  describe("permission", () => {
    it("refuses a caller the read gate rejects, touching no table", async () => {
      H.reset({ gateOk: false });

      const result = await franchiseGetPartialPaymentBalances();

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toBe(
          "You do not have permission to perform this action.",
        );
      }
      expect(H.calls.tablesRead).toEqual([]);
    });
  });
});
