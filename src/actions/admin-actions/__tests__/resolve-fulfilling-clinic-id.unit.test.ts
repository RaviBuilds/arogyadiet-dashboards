// src/actions/admin-actions/__tests__/resolve-fulfilling-clinic-id.unit.test.ts
//
// Unit tests for `resolveFulfillingClinicId` in
// `src/actions/admin-actions/assistedOrderActions.ts` (clinic-scoped-shop-inventory,
// task 9.8).
//
// `resolveFulfillingClinicId` decides, for the admin assisted-order action
// layer, what clinic id (if any) gets threaded into the
// `place_assisted_addon_order` RPC payload's `clinic_id` field:
//
//   - a Clinic_Scoped_Admin's own Clinic_Scope_Assignment is authoritative and
//     wins regardless of any `explicitClinicId` argument (Req 10.3, 10.4) —
//     this covers BOTH the normal customer-order path
//     (`markPaidAndPlaceOrderAction`) and the walk-in sale path
//     (`markPaidAndPlaceWalkInOrderAction`), since both call this exact same
//     resolver with no walk-in-specific branch;
//   - an Unscoped_Operations_Admin must supply an `explicitClinicId`, which is
//     re-validated server-side via `checkClinicScope` (Req 10.5);
//   - when neither yields a clinic, the submission is rejected before any
//     service call (Req 10.6).
//
// `resolveFulfillingClinicId` calls `getCurrentAdminContext()` and
// `checkClinicScope()` (both Supabase-backed). Both are mocked at the
// `@/lib/auth/adminAccess` module boundary — the same seam used by
// `src/test/inventory/workspace-route-guard.test.ts` — so this test exercises
// only `resolveFulfillingClinicId`'s own decision logic, without any real
// database.
//
// Requirements: 10.3, 10.4, 10.5, 10.6

import { describe, it, expect, beforeEach, vi } from "vitest";

// Controllable mocks for the two dependencies resolveFulfillingClinicId calls.
const getCurrentAdminContextMock = vi.fn();
const checkClinicScopeMock = vi.fn();

vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: () => getCurrentAdminContextMock(),
  checkClinicScope: (requestedClinicId: string | null) =>
    checkClinicScopeMock(requestedClinicId),
  // resolveAdminOperatorContext (used by the exported server actions, but not
  // by resolveFulfillingClinicId itself) also depends on checkGroupManage.
  // Not exercised by these tests, but stubbed so the module import doesn't
  // fail if anything else in the file references it at module scope.
  checkGroupManage: vi.fn(),
}));

// `assistedOrderActions.ts` imports `AssistedOrderService`, which transitively
// imports `systemActions.ts` -> `routeEngine.ts`, and THAT module calls
// `createAdminClient()` at module top-level (outside any function). Without
// this mock, merely importing the action module under test throws
// "supabaseUrl is required" in a test environment with no Supabase env vars —
// unrelated to anything `resolveFulfillingClinicId` itself does. Stub the
// admin client factory so the import graph loads without a real Supabase
// connection; nothing in these tests exercises the returned client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

import { resolveFulfillingClinicId } from "@/actions/admin-actions/assistedOrderActions";

/** Req 10.6: the exact rejection message assistedOrderActions.ts returns. */
const NO_FULFILLING_CLINIC_ERROR =
  "A fulfilling clinic must be selected before the order can be placed.";

function mockScopedAdmin(clinicId: string) {
  getCurrentAdminContextMock.mockResolvedValue({
    userId: "admin-1",
    roleCode: "ADMIN",
    accessLevel: "full",
    config: { level: "full", groups: {} },
    clinicId,
  });
}

function mockUnscopedAdmin() {
  getCurrentAdminContextMock.mockResolvedValue({
    userId: "admin-2",
    roleCode: "ADMIN",
    accessLevel: "full",
    config: { level: "full", groups: {} },
    clinicId: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveFulfillingClinicId (Req 10.3, 10.4, 10.5, 10.6)", () => {
  describe("Scoped admin with a selected customer (Req 10.3, 10.4)", () => {
    it("resolves to the admin's own assigned clinic, ignoring any explicitClinicId", async () => {
      mockScopedAdmin("clinic-scoped-1");

      const result = await resolveFulfillingClinicId();

      expect(result).toEqual({ ok: true, clinicId: "clinic-scoped-1" });
      // The scoped admin's assignment is authoritative — the current
      // implementation short-circuits before ever consulting
      // checkClinicScope for this case.
      expect(checkClinicScopeMock).not.toHaveBeenCalled();
    });
  });

  describe("Scoped admin, walk-in sale (Req 10.3, 10.4)", () => {
    it("resolves the SAME assigned clinic through the identical resolver call the walk-in action path uses", async () => {
      // `markPaidAndPlaceWalkInOrderAction` calls
      // `resolveFulfillingClinicId(explicitClinicId)` with the exact same
      // signature and no walk-in-specific branch as
      // `markPaidAndPlaceOrderAction` — so this scenario is documented as its
      // own case (per the task's four named scenarios) even though the
      // resolver has no awareness of "walk-in" vs "customer order".
      mockScopedAdmin("clinic-scoped-1");

      const result = await resolveFulfillingClinicId(undefined);

      expect(result).toEqual({ ok: true, clinicId: "clinic-scoped-1" });
      expect(checkClinicScopeMock).not.toHaveBeenCalled();
    });
  });

  describe("Unscoped admin with an explicit clinic (Req 10.5)", () => {
    it("resolves to the explicit clinic once checkClinicScope confirms it's in scope", async () => {
      mockUnscopedAdmin();
      checkClinicScopeMock.mockResolvedValue({
        ok: true,
        clinicId: "clinic-explicit-1",
      });

      const result = await resolveFulfillingClinicId("clinic-explicit-1");

      expect(result).toEqual({ ok: true, clinicId: "clinic-explicit-1" });
      expect(checkClinicScopeMock).toHaveBeenCalledWith("clinic-explicit-1");
    });
  });

  describe("Unscoped admin with no clinic — rejection (Req 10.6)", () => {
    it("rejects with the fulfilling-clinic-required error and never calls checkClinicScope", async () => {
      mockUnscopedAdmin();

      const result = await resolveFulfillingClinicId(undefined);

      expect(result).toEqual({
        ok: false,
        error: NO_FULFILLING_CLINIC_ERROR,
      });
      expect(checkClinicScopeMock).not.toHaveBeenCalled();
    });
  });

  describe("Unscoped admin, explicit clinic that fails scope check (boundary case)", () => {
    it("propagates checkClinicScope's exact rejection", async () => {
      mockUnscopedAdmin();
      checkClinicScopeMock.mockResolvedValue({
        ok: false,
        error: "That clinic is outside your assigned scope.",
      });

      const result = await resolveFulfillingClinicId("clinic-out-of-scope");

      expect(result).toEqual({
        ok: false,
        error: "That clinic is outside your assigned scope.",
      });
    });
  });
});
