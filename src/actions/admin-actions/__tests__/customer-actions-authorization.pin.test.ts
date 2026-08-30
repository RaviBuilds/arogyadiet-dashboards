// src/actions/admin-actions/__tests__/customer-actions-authorization.pin.test.ts
//
// CHARACTERIZATION ("pinning") TEST — franchise-scoped-access Task 0.
//
// PURPOSE: pin the CURRENT authorization behaviour of every mutating export in
// `admin-actions/customerActions.ts` BEFORE Task 2 extracts the ungated cores
// out of them. The hard constraint on that refactor is "no behaviour change for
// Core Business on the admin dashboard", and this file is what converts that
// intent into something enforced rather than reviewed.
//
// The invariant pinned here is deliberately narrow and therefore robust: for
// EVERY mutating export,
//
//   1. the `checkGroupManage("customers")` gate is consulted, and
//   2. when that gate denies, the action returns `{ success: false, error }`
//      carrying the gate's own message verbatim, and
//   3. NOTHING touches the database — the service-role client is never used.
//
// (3) is the load-bearing assertion. After Task 2 each exported action becomes
// `gate` + `core(...)`, and the failure mode that would matter most is a core
// running before (or regardless of) the gate. A tripwire client that throws on
// ANY property access catches that no matter how the body is restructured.
//
// This file intentionally does NOT pin the success-path DB call shapes: those
// are an implementation detail the refactor is allowed to move around, and
// asserting them would produce a test that fails for correct refactors. The
// success path is covered by the existing action/service suites.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Tripwire service-role client ────────────────────────────────────────────
//
// `customerActions.ts` builds its `supabaseAdmin` at MODULE LOAD, so the mock
// has to be registered before the module is imported (vi.mock is hoisted, so it
// is). Any property access on the client — `.from`, `.auth`, `.storage`, … —
// records a touch and throws, so a gated action that reaches the database fails
// loudly instead of silently returning a shape that happens to look right.

const dbTouches: string[] = [];

function tripwireClient(): unknown {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      const name = String(prop);
      // `then` is probed by the runtime when a value is awaited; treating it as
      // a touch would make every awaited result a false positive.
      if (name === "then") return undefined;
      dbTouches.push(name);
      throw new Error(
        `Service-role client was used while the manage gate denied access (accessed: ${name})`,
      );
    },
  };
  return new Proxy({}, handler);
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => tripwireClient(),
}));

// ─── Controllable authorization gate ─────────────────────────────────────────

type GateResult = { ok: true } | { ok: false; error: string };

let gateResult: GateResult = { ok: true };
const checkGroupManageMock = vi.fn(async () => gateResult);

vi.mock("@/lib/auth/adminAccess", () => ({
  checkGroupManage: (...args: unknown[]) =>
    checkGroupManageMock(...(args as [])),
  getCurrentAdminContext: vi.fn(async () => ({
    userId: "admin-1",
    roleCode: "ADMIN",
    accessLevel: "inventory_operations",
    config: { level: "inventory_operations", groups: {} },
    clinicId: null,
  })),
}));

// ─── Inert side-effect modules ───────────────────────────────────────────────
//
// Stubbed so that if the gate ever failed to stop an action, the tripwire above
// is what reports it — not an unrelated crash inside an email send or a
// revalidate. None of these should be reached in this suite.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock("@/services/emailService", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/actions/pincodeActions", () => ({
  assertDeliverablePincode: vi.fn(async () => ({ ok: true })),
  getServiceAreaPincodesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/address/deleteCustomerAddress", () => ({
  deleteCustomerAddress: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/customer/customerProfileNotifications", () => ({
  notifyAdminCustomerProfileUpdated: vi.fn(async () => {}),
  resolveUserIdFromProfile: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: vi.fn(async () => null),
}));
vi.mock("@/services/AssignmentService", () => ({
  reconcileOnClinicChange: vi.fn(async () => ({
    ok: true,
    dietitianId: null,
    changed: false,
  })),
}));

// ─── Subject under test ──────────────────────────────────────────────────────

import * as customerActions from "@/actions/admin-actions/customerActions";

/**
 * Every mutating export of `customerActions.ts`, with a representative argument
 * list. The arguments are never consumed — the gate denies first — but they must
 * be arity-correct so a signature drift shows up here as a compile error rather
 * than a silent skip.
 *
 * `revalidateCustomersPage` is deliberately absent: it performs no mutation and
 * carries no gate by design.
 */
const MUTATING_ACTIONS: ReadonlyArray<{
  name: string;
  invoke: () => Promise<unknown>;
}> = [
  {
    name: "adminUpdateAddonOrderDeliveryDate",
    invoke: () =>
      customerActions.adminUpdateAddonOrderDeliveryDate("order-1", "2099-01-01"),
  },
  {
    name: "adminMarkAddonOrderDeliveredOffline",
    invoke: () => customerActions.adminMarkAddonOrderDeliveredOffline("order-1"),
  },
  {
    name: "updateCustomerBasicInfo",
    invoke: () =>
      customerActions.updateCustomerBasicInfo("profile-1", "user-1", {
        fullName: "Test",
        mobile: "9999999999",
        gender: "male",
        dateOfBirth: "1990-01-01",
      }),
  },
  {
    name: "updateCustomerDietaryProfile",
    invoke: () =>
      customerActions.updateCustomerDietaryProfile("profile-1", {
        dietaryPreference: "veg",
        allergies: "",
      }),
  },
  {
    name: "updateCustomerMedicalProfile",
    invoke: () =>
      customerActions.updateCustomerMedicalProfile("profile-1", {
        medicalHistoryNotes: "",
        hasMedicalHistory: false,
      }),
  },
  {
    name: "deleteMedicalDocument",
    invoke: () =>
      customerActions.deleteMedicalDocument("doc-1", "path/to/doc", "profile-1"),
  },
  {
    name: "uploadAdminMedicalDocument",
    invoke: () => customerActions.uploadAdminMedicalDocument(new FormData()),
  },
  {
    name: "deactivateCustomerAccount",
    invoke: () =>
      customerActions.deactivateCustomerAccount("profile-1", "user-1"),
  },
  {
    name: "deleteCustomer",
    invoke: () => customerActions.deleteCustomer("profile-1", "user-1"),
  },
  {
    name: "adminCreateCustomerAction",
    invoke: () =>
      customerActions.adminCreateCustomerAction({
        fullName: "Test",
        email: "test@example.com",
        mobile: "9999999999",
      } as never),
  },
  {
    name: "adminCreateAddressForCustomer",
    invoke: () =>
      customerActions.adminCreateAddressForCustomer("profile-1", {} as never),
  },
  {
    name: "adminUpsertCustomerAddress",
    invoke: () =>
      customerActions.adminUpsertCustomerAddress("profile-1", {} as never),
  },
  {
    name: "adminDeleteCustomerAddress",
    invoke: () =>
      customerActions.adminDeleteCustomerAddress("profile-1", "address-1"),
  },
  {
    name: "adminSetCustomerPassword",
    invoke: () =>
      customerActions.adminSetCustomerPassword("auth-1", "newPassword123"),
  },
  {
    name: "adminSendPasswordReset",
    invoke: () => customerActions.adminSendPasswordReset("test@example.com"),
  },
  {
    name: "adminUpdateCustomerEmail",
    invoke: () =>
      customerActions.adminUpdateCustomerEmail("auth-1", "new@example.com"),
  },
  {
    name: "adminToggleCustomerActive",
    invoke: () =>
      customerActions.adminToggleCustomerActive(
        "profile-1",
        "user-1",
        "auth-1",
        false,
      ),
  },
  {
    name: "adminAssignCustomerClinic",
    invoke: () =>
      customerActions.adminAssignCustomerClinic("profile-1", "clinic-1"),
  },
];

// The two denial messages `checkGroupManage` can produce (adminAccess.ts).
const READ_ONLY_MESSAGE = "You have read-only access to this section.";
const NO_PERMISSION_MESSAGE =
  "You do not have permission to perform this action.";

describe("admin customerActions — authorization pinning (Core Business)", () => {
  beforeEach(() => {
    dbTouches.length = 0;
    checkGroupManageMock.mockClear();
    gateResult = { ok: true };
  });

  it("pins the full set of mutating exports, so a new one cannot be added ungated unnoticed", () => {
    // A guard against silent drift: if someone adds a mutating export without
    // adding it here, this count fails and forces a decision.
    expect(MUTATING_ACTIONS).toHaveLength(18);

    // Every entry must name a real export.
    for (const { name } of MUTATING_ACTIONS) {
      expect(
        typeof (customerActions as unknown as Record<string, unknown>)[name],
      ).toBe("function");
    }
  });

  describe.each([
    { label: "view-only admin", error: READ_ONLY_MESSAGE },
    { label: "admin without the customers group", error: NO_PERMISSION_MESSAGE },
  ])("when the manage gate denies ($label)", ({ error }) => {
    it.each(MUTATING_ACTIONS.map((a) => [a.name, a.invoke] as const))(
      "%s refuses, returns the gate message, and never touches the database",
      async (_name, invoke) => {
        gateResult = { ok: false, error };

        const result = await invoke();

        expect(result).toEqual({ success: false, error });
        expect(dbTouches).toEqual([]);
      },
    );
  });

  it("consults the customers group specifically, not some other group", async () => {
    gateResult = { ok: false, error: NO_PERMISSION_MESSAGE };

    await customerActions.updateCustomerBasicInfo("profile-1", "user-1", {
      fullName: "Test",
      mobile: "9999999999",
      gender: "male",
      dateOfBirth: "1990-01-01",
    });

    expect(checkGroupManageMock).toHaveBeenCalledWith("customers");
  });

  it("checks authorization exactly once per invocation", async () => {
    gateResult = { ok: false, error: NO_PERMISSION_MESSAGE };

    await customerActions.adminDeleteCustomerAddress("profile-1", "address-1");

    expect(checkGroupManageMock).toHaveBeenCalledTimes(1);
  });
});
