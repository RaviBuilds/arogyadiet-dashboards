/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/creation-atomicity.property.test.ts
// Feature: dietitian-management, Property 7
//
// Property 7: Account and onboarding creation are atomic
//
// For any choice of failing step after the authentication account is
// created, the observable end state contains neither the authentication
// account nor a `users` row; and for any failing step during onboarding, the
// end state contains neither a Customer_Record nor a Dietitian_Link. On
// success the Customer_Record and its Dietitian_Link are both present.
//
// Validates: Requirements 2.14, 7.7, 9.4, 22.7
//
// Two halves, mirroring the two atomic-creation flows in the design:
//
//   (a) DietitianAccountService.createDietitian — the Supabase Auth identity
//       is created FIRST, then the `users` row is inserted. `insertDietitian`
//       is the only step that can fail after the auth identity exists; it is
//       mocked (like `onboardCustomerAtomic` is mocked in
//       onboardingService.property.test.ts) to fail with each of the
//       classified reasons (generic DB error, mobile unique violation,
//       franchise-cardinality violation) so every post-auth failing step is
//       exercised. On any such failure the auth identity must be compensated
//       away (`safeDeleteAuthUser`) and no `users` row must exist.
//
//   (b) OnboardingService.onboard — the Supabase Auth identity is created
//       FIRST, then the atomic `onboard_customer` RPC (mocked here as
//       `onboardCustomerAtomic`, an in-memory model of the transaction) is
//       invoked with `profile.dietitian_id` set from the onboarding payload
//       (Req 7.7, 9.4 — the Dietitian_Link is persisted in the SAME atomic
//       write that creates the Customer_Record). Failure is injected at each
//       step that follows the identity being resolvable — the auth-identity
//       creation itself, and the atomic RPC (generic error, duplicate
//       mobile, email in use) — asserting neither a Customer_Record nor its
//       Dietitian_Link (a column on that same row) is ever observable on
//       failure, and both are present together on success.
//
// vitest + fast-check, >=100 runs per property.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { format, startOfDay } from "date-fns";

// ─── Shared in-memory world (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const cfg: any = {};
  const db: any = {};
  const calls: any = {};

  function resetCfg() {
    // ── Part (a): DietitianAccountService.createDietitian ──
    cfg.dietitianCreateUserShouldFail = false;
    cfg.insertDietitianShouldFail = null; // null | { message: string }

    // ── Part (b): OnboardingService.onboard ──
    cfg.clinicResolution = { type: "resolved", clinic_id: "clinic-1" };
    cfg.franchiseId = null;
    cfg.roleId = "role-customer";
    cfg.plan = {
      price: 1000,
      base_price: null,
      tax_amount: null,
      duration_days: 30,
      pause_credits: 4,
    };
    cfg.onboardCreateUserShouldFail = false;
    cfg.onboardShouldFail = null; // null | { reason, message }
  }

  function resetDb() {
    // Auth identities shared across both flows (distinct id prefixes).
    db.authUsers = new Map<string, unknown>();
    db.seq = 0;

    // Part (a): the Dietitian `users` rows.
    db.dietitianUsers = [];

    // Part (b): the onboarding-created rows.
    db.users = [];
    db.profiles = [];
    db.subscriptions = [];
    db.payments = [];
    db.addresses = [];

    calls.createUser = [];
    calls.deleteUser = [];
    calls.insertDietitian = [];
    calls.onboard = [];
  }

  function reset() {
    resetCfg();
    resetDb();
  }

  // Reads issued by OnboardingService's helper lookups + generateUniqueCustomerCode.
  function resolveRead(table: string, filters: any) {
    if (table === "clinics") {
      return cfg.franchiseId !== undefined ? { franchise_id: cfg.franchiseId } : null;
    }
    if (table === "roles") return cfg.roleId != null ? { id: cfg.roleId } : null;
    if (table === "meal_categories") {
      const code = filters["code"];
      return code ? { id: `mealcat-${code}` } : null;
    }
    if (table === "subscription_plans") return cfg.plan;
    if (table === "customer_profiles") {
      // Uniqueness probe from the real generateUniqueCustomerCode — never
      // collides in this test, atomicity is the property under test.
      return null;
    }
    return null;
  }

  function makeBuilder(table: string) {
    const filters: any = {};
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        filters[c] = v;
        return b;
      },
      in: () => b,
      order: () => b,
      maybeSingle: async () => ({ data: resolveRead(table, filters), error: null }),
      insert: async () => ({ data: null, error: null }),
    };
    return b;
  }

  function makeFakeAdmin() {
    return {
      from: (t: string) => makeBuilder(t),
      auth: {
        admin: {
          createUser: async (args: any) => {
            calls.createUser.push(args);
            const failFlag = args?.phone
              ? cfg.onboardCreateUserShouldFail
              : cfg.dietitianCreateUserShouldFail;
            if (failFlag) {
              return { data: null, error: { message: "auth create failed" } };
            }
            const id = `auth-${++db.seq}`;
            db.authUsers.set(id, args);
            return { data: { user: { id } }, error: null };
          },
          deleteUser: async (id: string) => {
            calls.deleteUser.push(id);
            db.authUsers.delete(id);
            return { data: null, error: null };
          },
        },
      },
    };
  }

  reset();
  return { cfg, db, calls, reset, makeFakeAdmin };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// Part (a): model the `insertDietitian` write — the only step in
// `createDietitian` that can fail after the auth identity is created.
vi.mock("@/repositories/dietitian/dietitianRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { cfg, db, calls } = H;
  return {
    ...actual,
    insertDietitian: vi.fn(async (input: any) => {
      calls.insertDietitian.push(input);
      if (cfg.insertDietitianShouldFail) {
        throw new Error(cfg.insertDietitianShouldFail.message);
      }
      const id = `dietuser-${++db.seq}`;
      const row = { id, ...input };
      db.dietitianUsers.push(row);
      return {
        id,
        authUserId: input.authUserId,
        fullName: input.fullName,
        email: input.email,
        mobile: input.mobile,
        roleCode: input.roleCode,
        clinicId: input.clinicId,
        clinicName: null,
        franchiseId: input.franchiseId,
        franchiseName: null,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }),
    listClinicsWithFranchiseName: vi.fn(async () => []),
    countActiveDietitiansForFranchise: vi.fn(async () => 0),
    listActiveDietitiansForFranchise: vi.fn(async () => []),
  };
});

// Part (b): the onboarding clinic resolver and the Dietitian-clinic-membership
// pre-check are pure pre-checks unrelated to atomicity — always pass so the
// atomic write is always reached with the submitted Dietitian.
vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: async () => H.cfg.clinicResolution,
}));

vi.mock("@/services/AssignmentService", () => ({
  validateDietitianForClinic: async () => ({ ok: true }),
}));

// Part (b): model the atomic `onboard_customer` RPC over the in-memory `db`,
// persisting `profile.dietitian_id` (the Dietitian_Link) in the SAME write
// that creates the Customer_Record (Req 7.7, 9.4).
vi.mock("@/repositories/customerOnboardingRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { cfg, db, calls } = H;
  return {
    ...actual, // keeps the REAL generateUniqueCustomerCode
    onboardCustomerAtomic: vi.fn(async (input: any) => {
      calls.onboard.push(input);
      if (cfg.onboardShouldFail) {
        return {
          ok: false,
          reason: cfg.onboardShouldFail.reason,
          message: cfg.onboardShouldFail.message,
        };
      }
      const userId = `user-${++db.seq}`;
      const profileId = `profile-${++db.seq}`;
      const subscriptionId = `sub-${++db.seq}`;
      const paymentId = `pay-${++db.seq}`;
      const addressId = `addr-${++db.seq}`;
      db.users.push({ id: userId, ...input.user });
      db.profiles.push({
        id: profileId,
        ...input.profile,
        onboarding_status: "IN_PROGRESS",
      });
      db.subscriptions.push({ id: subscriptionId, ...input.subscription });
      db.payments.push({ id: paymentId, ...input.payment, status: "PAID" });
      db.addresses.push({ id: addressId, ...input.address, is_primary: true });
      return {
        ok: true,
        ids: {
          user_id: userId,
          profile_id: profileId,
          subscription_id: subscriptionId,
          payment_id: paymentId,
          address_id: addressId,
        },
      };
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ──────────────
import { createDietitian } from "@/services/DietitianAccountService";
import { onboard } from "@/services/OnboardingService";
import type { CreateDietitianInput } from "@/validations/dietitianSchema";
import type { QuickOnboardingInput } from "@/validations/onboardingSchema";

const { cfg, db, calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Generators ─────────────────────────────────────────────────────────────────

/** A 10-digit mobile number (dietitianMobileSchema only requires `\d{10}`). */
const arbDigits10 = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 10 })
  .map((d) => d.join(""));

/** A `[6-9]\d{9}` mobile number, required by the onboarding normalizer. */
const arbCustomerMobile = fc
  .tuple(
    fc.constantFrom(6, 7, 8, 9),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);

const arbLabel = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 12,
  })
  .map((a) => a.join(""));
const arbEmail = fc
  .tuple(arbLabel, arbLabel, fc.constantFrom("com", "net", "org", "io"))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const arbPincode = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 6, maxLength: 6 })
  .map((d) => d.join(""));

const arbStartDate = fc
  .date({
    min: new Date("2025-01-01T00:00:00.000Z"),
    max: new Date("2027-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => format(d, "yyyy-MM-dd"));

const arbAddress = fc.record({
  tag: fc.constantFrom("Home", "Office"),
  flatNumber: fc.string({ minLength: 1, maxLength: 50 }),
  floorNumber: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  area: fc.string({ minLength: 1, maxLength: 20 }),
  city: fc.string({ minLength: 1, maxLength: 20 }),
  state: fc.string({ minLength: 1, maxLength: 20 }),
  pincode: arbPincode,
  lat: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
});

/** A non-blank name (trims to at least one non-whitespace character). */
const arbName = arbLabel.map((s) => `Dr ${s}`);

/** A valid `CreateDietitianInput` with `clinicId: null` (Core_Business, so
 * the franchise-cardinality pre-check trivially passes and every run reaches
 * the auth-creation + `insertDietitian` steps). */
const arbCreateDietitianInput: fc.Arbitrary<CreateDietitianInput> = fc.record({
  fullName: arbName,
  email: arbEmail,
  mobile: arbDigits10,
  password: arbLabel.map((s) => `password-${s}`),
  clinicId: fc.constant(null),
});

/** The stable part of a Quick_Onboarding_Form MEAL payload. */
const arbOnboardBase = fc.record({
  fullName: arbName,
  mobile: arbCustomerMobile,
  gender: fc.constantFrom("Male", "Female", "Other"),
  dietaryPreference: fc.constantFrom("Veg", "Non-Veg"),
  planId: fc.uuid(),
  dietitianId: fc.uuid(),
  startDate: arbStartDate,
  address: arbAddress,
});

function mkOnboardPayload(base: any): QuickOnboardingInput {
  return {
    ...base,
    primaryCategory: "MEAL",
    paymentStatus: "PAID",
    isTestEmail: false,
    cutoffAcknowledged: true,
    initialMealPreference: "VEG",
    pastDateEnabled: false,
  } as QuickOnboardingInput;
}

// ─── Property 7 (task 7.4) ──────────────────────────────────────────────────────
// Feature: dietitian-management, Property 7
// Property 7: Account and onboarding creation are atomic.
// Validates: Requirements 2.14, 7.7, 9.4, 22.7
describe("Property 7: Account and onboarding creation are atomic", () => {
  // ── (a) Dietitian account creation ──────────────────────────────────────────
  describe("(a) Dietitian account creation (DietitianAccountService.createDietitian)", () => {
    const FAILURE_MODES = [
      { kind: "GENERIC_ERROR", message: "unexpected database error" },
      {
        kind: "MOBILE_VIOLATION",
        message: 'duplicate key value violates unique constraint "users_mobile_key"',
      },
      {
        kind: "FRANCHISE_VIOLATION",
        message:
          'duplicate key value violates unique constraint "users_one_active_dietitian_per_franchise"',
      },
    ] as const;

    it("for any failing step after the auth identity is created, neither the auth identity nor a users row remains", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbCreateDietitianInput,
          fc.constantFrom(...FAILURE_MODES),
          async (input, mode) => {
            H.reset();
            cfg.insertDietitianShouldFail = { message: mode.message };

            const result = await createDietitian(input, null);

            expect(result.success).toBe(false);
            // The auth identity was created, then compensated away (Req 2.14, 22.7).
            expect(calls.createUser.length).toBe(1);
            expect(calls.deleteUser.length).toBe(1);
            expect(db.authUsers.size).toBe(0);
            // No `users` (Dietitian) row was left behind.
            expect(db.dietitianUsers).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("on success both the auth identity and the users row are present", async () => {
      await fc.assert(
        fc.asyncProperty(arbCreateDietitianInput, async (input) => {
          H.reset();

          const result = await createDietitian(input, null);

          expect(result.success).toBe(true);
          expect(calls.deleteUser.length).toBe(0);
          expect(db.authUsers.size).toBe(1);
          expect(db.dietitianUsers).toHaveLength(1);
          if (result.success) {
            expect(db.dietitianUsers[0].id).toBe(result.data.id);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ── (b) Onboarding creation with a Dietitian_Link ───────────────────────────
  describe("(b) Onboarding creation with a Dietitian_Link (OnboardingService.onboard)", () => {
    const FAILURE_MODES = [
      { kind: "AUTH_FAILED" },
      { kind: "RPC_ERROR", reason: "ERROR", message: "insert failed" },
      {
        kind: "RPC_DUPLICATE_MOBILE",
        reason: "DUPLICATE_MOBILE",
        message: "This mobile number is already registered to a customer.",
      },
      {
        kind: "RPC_EMAIL_IN_USE",
        reason: "EMAIL_IN_USE",
        message: "This email address is already in use.",
      },
    ] as const;

    it("for any failing step, the end state contains neither a Customer_Record nor a Dietitian_Link", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbOnboardBase,
          fc.constantFrom(...FAILURE_MODES),
          async (base, mode) => {
            H.reset();
            const payload = mkOnboardPayload(base);

            if (mode.kind === "AUTH_FAILED") {
              cfg.onboardCreateUserShouldFail = true;
            } else {
              cfg.onboardShouldFail = { reason: mode.reason, message: mode.message };
            }

            const result = await onboard(payload);

            expect(result.ok).toBe(false);
            // No Customer_Record — and since the Dietitian_Link is the
            // `dietitian_id` column ON that same row, no Customer_Record
            // means no Dietitian_Link either.
            expect(db.profiles).toHaveLength(0);
            expect(db.users).toHaveLength(0);
            // The pre-created auth identity, if any, was compensated away.
            expect(db.authUsers.size).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("on success the Customer_Record and its Dietitian_Link are both present", async () => {
      await fc.assert(
        fc.asyncProperty(arbOnboardBase, async (base) => {
          H.reset();
          const payload = mkOnboardPayload(base);

          const result = await onboard(payload);

          expect(result.ok).toBe(true);
          expect(db.profiles).toHaveLength(1);
          // The Dietitian_Link was persisted in the SAME atomic write that
          // created the Customer_Record (Req 7.7, 9.4).
          expect(db.profiles[0].dietitian_id).toBe(payload.dietitianId);
          expect(db.authUsers.size).toBe(1);

          if (result.ok) {
            expect(calls.onboard).toHaveLength(1);
            expect(calls.onboard[0].profile.dietitian_id).toBe(payload.dietitianId);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
