// src/actions/franchise-actions/__tests__/franchise-dietitian-assignment.test.ts
//
// franchise-scoped-access Task 10.
//
// The cross-tenant check on the CANDIDATE dietitian is the reason this suite
// exists. `AssignmentService.setDietitianLink` verifies only that the candidate
// IS a Dietitian — not that they belong to the caller's Franchise. Once Task 11
// makes a Franchise Dietitian's read scope key off `customer_profiles.dietitian_id`,
// linking a customer to ANOTHER franchise's Dietitian would hand that Dietitian
// read access to rows outside their own tenant. So the action must reject it, and
// these tests pin that.

import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const FRANCHISE_A = "11111111-1111-4111-8111-111111111111";
  const FRANCHISE_B = "22222222-2222-4222-8222-222222222222";
  const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
  const DIETITIAN_ID = "44444444-4444-4444-8444-444444444444";

  const state = {
    // Caller
    roleCode: "FRANCHISE_ADMIN" as string | null,
    adminAccessLevel: "operations" as string | null,
    adminOperationsAccess: { customers: "manage" } as Record<
      string,
      string
    > | null,
    callerFranchiseId: FRANCHISE_A as string | null,
    franchiseOwnerUserId: null as string | null,
    franchiseStatus: "active",
    // Target customer
    customerExists: true,
    customerFranchiseId: FRANCHISE_A as string | null,
    // Candidate dietitian
    candidateExists: true,
    candidateFranchiseId: FRANCHISE_A as string | null,
    candidateLevel: "dietitian" as string | null,
    candidateActive: true,
  };

  const defaults = { ...state };
  const calls = {
    setLink: [] as {
      customerProfileId: string;
      dietitianUserId: string | null;
      actingUserId: string | null;
    }[],
    listedFranchiseIds: [] as string[],
  };

  const reset = (overrides: Partial<typeof state> = {}) => {
    Object.assign(state, defaults, overrides);
    calls.setLink.length = 0;
    calls.listedFranchiseIds.length = 0;
  };

  type Result = { data: unknown; error: unknown };

  class FakeQuery implements PromiseLike<Result> {
    private result: Result = { data: null, error: null };
    private lastEqValue: unknown = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }
    eq(_column: string, value: unknown) {
      this.lastEqValue = value;
      return this;
    }
    single() {
      return this.resolveRow();
    }
    maybeSingle() {
      return this.resolveRow();
    }

    private resolveRow() {
      if (this.table === "customer_profiles") {
        this.result = {
          data: state.customerExists
            ? {
                id: PROFILE_ID,
                franchise_id: state.customerFranchiseId,
                clinic_id: null,
              }
            : null,
          error: null,
        };
      } else if (this.table === "franchises") {
        this.result = {
          data: {
            status: state.franchiseStatus,
            owner_user_id: state.franchiseOwnerUserId,
          },
          error: null,
        };
      } else if (this.table === "users") {
        // The same table serves two lookups: the CALLER (by auth_user_id) and
        // the CANDIDATE dietitian (by id). Disambiguate on the filter value.
        if (this.lastEqValue === DIETITIAN_ID) {
          this.result = {
            data: state.candidateExists
              ? {
                  id: DIETITIAN_ID,
                  franchise_id: state.candidateFranchiseId,
                  admin_access_level: state.candidateLevel,
                  is_active: state.candidateActive,
                }
              : null,
            error: null,
          };
        } else {
          this.result = {
            data: {
              id: "franchise-user-1",
              franchise_id: state.callerFranchiseId,
              admin_access_level: state.adminAccessLevel,
              admin_operations_access: state.adminOperationsAccess,
              roles: state.roleCode ? { code: state.roleCode } : null,
            },
            error: null,
          };
        }
      }
      return this;
    }

    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "auth-user-1" } },
        error: null,
      }),
    },
    from: (table: string) => new FakeQuery(table),
  };

  return {
    FRANCHISE_A,
    FRANCHISE_B,
    PROFILE_ID,
    DIETITIAN_ID,
    state,
    calls,
    reset,
    client,
  };
});

// Only the clients are faked — the REAL checkFranchiseGroupManage runs.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => H.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => H.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/services/AssignmentService", () => ({
  setDietitianLink: async (input: {
    customerProfileId: string;
    dietitianUserId: string | null;
    actingUserId: string | null;
  }) => {
    H.calls.setLink.push(input);
    return { ok: true, dietitianId: input.dietitianUserId, changed: true };
  },
}));

vi.mock("@/repositories/dietitian/dietitianRepository", () => ({
  listActiveDietitiansForFranchise: async (franchiseId: string) => {
    H.calls.listedFranchiseIds.push(franchiseId);
    return [
      { id: H.DIETITIAN_ID, fullName: "Dr. A", email: "a@example.com" },
    ];
  },
}));

import {
  franchiseAssignCustomerDietitian,
  franchiseListDietitians,
} from "@/actions/franchise-actions/franchiseDietitianAssignmentActions";

const READ_ONLY_MESSAGE = "You have read-only access to this section.";
const NO_PERMISSION_MESSAGE =
  "You do not have permission to perform this action.";

describe("franchiseAssignCustomerDietitian", () => {
  beforeEach(() => H.reset());

  it("assigns a same-franchise dietitian to a same-franchise customer", async () => {
    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(true);
    expect(H.calls.setLink).toEqual([
      {
        customerProfileId: H.PROFILE_ID,
        dietitianUserId: H.DIETITIAN_ID,
        actingUserId: "franchise-user-1",
      },
    ]);
  });

  it("clears the link when passed null — an empty link is legitimate", async () => {
    const result = await franchiseAssignCustomerDietitian(H.PROFILE_ID, null);

    expect(result.success).toBe(true);
    expect(H.calls.setLink[0].dietitianUserId).toBeNull();
  });

  // ── The cross-tenant guard this action exists for ─────────────────────────

  it("REJECTS a dietitian from another franchise", async () => {
    H.reset({ candidateFranchiseId: H.FRANCHISE_B });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("That dietitian does not belong to your franchise.");
    }
    // Nothing written: otherwise that Dietitian would gain read access to a row
    // outside their tenant once the scope narrows to dietitian_id.
    expect(H.calls.setLink).toEqual([]);
  });

  it("rejects a candidate who is not a dietitian", async () => {
    H.reset({ candidateLevel: "operations" });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });

  it("rejects an inactive dietitian", async () => {
    H.reset({ candidateActive: false });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });

  it("reports a non-existent candidate identically to an out-of-tenant one", async () => {
    H.reset({ candidateExists: false });
    const missing = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    H.reset({ candidateFranchiseId: H.FRANCHISE_B });
    const foreign = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    // No existence disclosure across tenants.
    expect(missing).toEqual(foreign);
  });

  // ── Customer tenancy ─────────────────────────────────────────────────────

  it("rejects a customer from another franchise", async () => {
    H.reset({ customerFranchiseId: H.FRANCHISE_B });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("This customer does not belong to your franchise.");
    }
    expect(H.calls.setLink).toEqual([]);
  });

  it("rejects a non-existent customer", async () => {
    H.reset({ customerExists: false });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });

  // ── Permission ───────────────────────────────────────────────────────────

  it("refuses a view-only franchise user", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(READ_ONLY_MESSAGE);
    expect(H.calls.setLink).toEqual([]);
  });

  it("refuses a franchise user without the customers group", async () => {
    H.reset({ adminOperationsAccess: { riders: "manage" } });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(NO_PERMISSION_MESSAGE);
  });

  it("refuses a Franchise Dietitian — they cannot reassign customers", async () => {
    H.reset({ adminAccessLevel: "dietitian", adminOperationsAccess: null });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });

  it("allows the Franchise_Owner", async () => {
    H.reset({
      franchiseOwnerUserId: "franchise-user-1",
      adminOperationsAccess: {},
    });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(true);
  });

  it("refuses a suspended franchise", async () => {
    H.reset({ franchiseStatus: "suspended" });

    const result = await franchiseAssignCustomerDietitian(
      H.PROFILE_ID,
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });

  it("rejects a malformed customer id before any lookup", async () => {
    const result = await franchiseAssignCustomerDietitian(
      "not-a-uuid",
      H.DIETITIAN_ID,
    );

    expect(result.success).toBe(false);
    expect(H.calls.setLink).toEqual([]);
  });
});

describe("franchiseListDietitians", () => {
  beforeEach(() => H.reset());

  it("lists only the caller's own franchise", async () => {
    const result = await franchiseListDietitians();

    expect(result.success).toBe(true);
    // The franchise id comes from the caller's session, never from a parameter,
    // so there is no way to enumerate another tenant's dietitians.
    expect(H.calls.listedFranchiseIds).toEqual([H.FRANCHISE_A]);
  });

  it("refuses a view-only franchise user", async () => {
    H.reset({ adminOperationsAccess: { customers: "view" } });

    const result = await franchiseListDietitians();

    expect(result.success).toBe(false);
    expect(H.calls.listedFranchiseIds).toEqual([]);
  });
});
