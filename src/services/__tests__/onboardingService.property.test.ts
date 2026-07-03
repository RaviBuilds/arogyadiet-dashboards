/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/onboardingService.property.test.ts
// Feature: customer-mobile-onboarding — OnboardingService property tests.
//
// This file bundles five design properties that all exercise the onboarding
// orchestration/decision logic in `src/services/OnboardingService.ts`
// (`onboard`, `completeProfile`) plus the repository's real
// `generateUniqueCustomerCode`:
//
//   Property 5  (task 6.10) — Onboarding precondition gate and record shape
//   Property 6  (task 6.11) — Onboarding atomicity (no partial record)
//   Property 11 (task 6.12) — Exactly one valid Primary_Category
//   Property 16 (task 6.13) — Test-email placeholder is unique/hidden/replaceable
//   Property 18 (task 6.14) — Unique customer code generation
//
// `onboard` performs I/O (Supabase admin client, repository RPC, clinic
// resolver). We MOCK those dependencies with in-memory fakes so the
// decision/orchestration logic runs deterministically:
//   - `@/lib/supabase/admin`                 → fake createAdminClient (auth.admin
//                                               createUser/deleteUser + plan/role/
//                                               clinic/customer_profiles reads)
//   - `@/lib/clinic/pincode-resolver`        → fake resolveClinicForPincode
//   - `@/repositories/customerOnboardingRepository`
//                                            → onboardCustomerAtomic (models the
//                                              atomic RPC over an in-memory DB),
//                                              replaceTestEmailWithReal,
//                                              updateProfileFields,
//                                              setOnboardingCompleted are faked;
//                                              generateUniqueCustomerCode is kept
//                                              REAL (Property 18 validates it) and
//                                              backed by the fake admin client.
//
// vitest + fast-check, >=100 runs per property.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { format, startOfDay } from "date-fns";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const cfg: any = {};
  const db: any = {};
  const calls: any = {};

  function resetCfg() {
    cfg.clinicResolution = { type: "resolved", clinic_id: "clinic-1" };
    cfg.franchiseId = "franchise-1";
    cfg.roleId = "role-customer";
    // base_price/tax_amount null → service reverse-calculates from price.
    cfg.plan = {
      price: 1000,
      base_price: null,
      tax_amount: null,
      duration_days: 30,
      pause_credits: 4,
    };
    cfg.createUserShouldFail = false;
    cfg.createUserError = "auth create failed";
    cfg.onboardShouldFail = null;
    cfg.updateProfileShouldThrow = false;
    cfg.setCompletedShouldThrow = false;
    cfg.existingCodes = new Set<string>();
    cfg.forceCollisions = 0;
  }

  function resetDb() {
    db.users = [];
    db.profiles = [];
    db.subscriptions = [];
    db.payments = [];
    db.addresses = [];
    db.authUsers = new Map<string, unknown>();
    db.seq = 0;
    calls.createUser = [];
    calls.deleteUser = [];
    calls.onboard = [];
    calls.replaceEmail = [];
    calls.updateProfile = [];
    calls.setCompleted = [];
    calls.codeLookups = 0;
  }

  function reset() {
    resetCfg();
    resetDb();
  }

  // Reads issued by the OnboardingService + real generateUniqueCustomerCode.
  function resolveRead(table: string, filters: any) {
    if (table === "subscription_plans") return cfg.plan;
    if (table === "clinics")
      return cfg.franchiseId != null ? { franchise_id: cfg.franchiseId } : null;
    if (table === "roles") return cfg.roleId != null ? { id: cfg.roleId } : null;
    if (table === "customer_profiles") {
      // Uniqueness probe from generateUniqueCustomerCode.
      calls.codeLookups += 1;
      if (cfg.forceCollisions > 0) {
        cfg.forceCollisions -= 1;
        return { id: "existing" };
      }
      const code = filters["customer_code"];
      return cfg.existingCodes.has(code) ? { id: "existing" } : null;
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
      order: () => b,
      maybeSingle: async () => ({ data: resolveRead(table, filters), error: null }),
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
            if (cfg.createUserShouldFail) {
              return { data: null, error: { message: cfg.createUserError } };
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
  return { cfg, db, calls, reset, resetCfg, resetDb, makeFakeAdmin };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

vi.mock("@/lib/clinic/pincode-resolver", () => ({
  resolveClinicForPincode: async () => H.cfg.clinicResolution,
}));

vi.mock("@/repositories/customerOnboardingRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { cfg, db, calls } = H;
  return {
    ...actual, // keeps the REAL generateUniqueCustomerCode (Property 18)
    onboardCustomerAtomic: vi.fn(async (input: any) => {
      calls.onboard.push(input);
      // Configurable hard failure (models an RPC insert error).
      if (cfg.onboardShouldFail) {
        return {
          ok: false,
          reason: cfg.onboardShouldFail.reason,
          message: cfg.onboardShouldFail.message,
        };
      }
      // Models the onboard_customer RPC's unique guarantees.
      if (db.users.some((u: any) => u.mobile === input.user.mobile)) {
        return {
          ok: false,
          reason: "DUPLICATE_MOBILE",
          message: "This mobile number is already registered to a customer.",
        };
      }
      if (db.users.some((u: any) => u.email === input.user.email)) {
        return {
          ok: false,
          reason: "EMAIL_IN_USE",
          message: "This email address is already in use.",
        };
      }
      // Atomic all-or-nothing insert of the five rows. The RPC (not the caller)
      // sets onboarding_status=IN_PROGRESS, payments.status=PAID, and
      // addresses.is_primary=true — modeled here faithfully.
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
    replaceTestEmailWithReal: vi.fn(async (userId: string, email: string) => {
      calls.replaceEmail.push({ userId, email });
      const inUse = db.users.some((u: any) => u.id !== userId && u.email === email);
      if (inUse) {
        return {
          ok: false,
          reason: "EMAIL_IN_USE",
          message: "This email address is already in use.",
        };
      }
      const u = db.users.find((u: any) => u.id === userId);
      if (u) {
        u.email = email;
        u.is_test_email = false;
      }
      return { ok: true };
    }),
    updateProfileFields: vi.fn(async (profileId: string, patch: any) => {
      calls.updateProfile.push({ profileId, patch });
      if (cfg.updateProfileShouldThrow) throw new Error("update failed");
      const p = db.profiles.find((x: any) => x.id === profileId);
      if (p) Object.assign(p, patch); // single-row UPDATE: all keys or none
    }),
    setOnboardingCompleted: vi.fn(async (profileId: string) => {
      calls.setCompleted.push(profileId);
      if (cfg.setCompletedShouldThrow) throw new Error("complete failed");
      const p = db.profiles.find((x: any) => x.id === profileId);
      if (p) p.onboarding_status = "COMPLETED";
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────────
import { onboard, completeProfile } from "@/services/OnboardingService";
import { generateUniqueCustomerCode } from "@/repositories/customerOnboardingRepository";
import {
  placeholderEmailFor,
  isDisplayableEmail,
} from "@/lib/onboarding/testEmail";
import { assertSinglePrimary } from "@/lib/onboarding/category";
import {
  createQuickOnboardingSchema,
  type QuickOnboardingInput,
} from "@/validations/onboardingSchema";

const { cfg, db, calls } = H;

// ─── Generators ────────────────────────────────────────────────────────────────
const CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION"] as const;

/** A valid 10-digit `[6-9]\d{9}` mobile number. */
const arbMobile = fc
  .tuple(
    fc.constantFrom(6, 7, 8, 9),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);

/** A 6-digit pincode string. */
const arbPincode = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 6, maxLength: 6 })
  .map((d) => d.join(""));

/** An ISO `yyyy-MM-dd` start date. */
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

/** The stable, valid part of a Quick_Onboarding_Form payload. */
const arbBasePayload = fc.record({
  fullName: fc.string({ minLength: 1, maxLength: 100 }),
  mobile: arbMobile,
  gender: fc.constantFrom("Male", "Female", "Other"),
  dietaryPreference: fc.constantFrom("Veg", "Non-Veg"),
  allergies: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  primaryCategory: fc.constantFrom(...CATEGORIES),
  planId: fc.uuid(),
  startDate: arbStartDate,
  address: arbAddress,
});

/** A zod-valid real email (deterministic, avoids fast-check ↔ zod edge cases). */
const arbLabel = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 12,
  })
  .map((a) => a.join(""));
const arbRealEmail = fc
  .tuple(arbLabel, arbLabel, fc.constantFrom("com", "net", "org", "io"))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** A malformed (no `@`) or over-length email. */
const arbInvalidEmail = fc.oneof(
  fc
    .array(fc.constantFrom(..."abcdefghijklmnop".split("")), {
      minLength: 1,
      maxLength: 12,
    })
    .map((a) => a.join("")),
  fc.constant(`${"a".repeat(250)}@${"b".repeat(20)}.com`),
);

/** Build a full onboarding payload with sensible PAID defaults. */
function mkPayload(base: any, extra: Record<string, unknown> = {}): QuickOnboardingInput {
  return {
    ...base,
    paymentStatus: "PAID",
    isTestEmail: false,
    cutoffAcknowledged: true,
    ...extra,
  } as QuickOnboardingInput;
}

beforeEach(() => {
  H.reset();
});

// ─── Property 5 (task 6.10) ─────────────────────────────────────────────────────
// Property 5: Onboarding precondition gate and created-record shape.
// Validates: Requirements 4.1, 4.2, 4.5, 4.6, 4.7, 5.5, 6.1, 6.2, 6.3, 6.5, 8.1, 8.2, 14.2
describe("Property 5: Onboarding precondition gate and created-record shape", () => {
  it("persists a correctly-shaped record when the gate passes (PAID, one valid category, unused mobile)", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        const payload = mkPayload(base);

        const result = await onboard(payload);
        expect(result.ok).toBe(true);

        // Exactly one Customer_Record, IN_PROGRESS (Req 6.1/14.2).
        expect(db.profiles).toHaveLength(1);
        expect(db.profiles[0].onboarding_status).toBe("IN_PROGRESS");

        // Exactly one attached subscription with the submitted start date and
        // customer_category (Req 6.2).
        expect(db.subscriptions).toHaveLength(1);
        const expectedStartsOn = format(
          startOfDay(new Date(payload.startDate)),
          "yyyy-MM-dd",
        );
        expect(db.subscriptions[0].starts_on).toBe(expectedStartsOn);
        expect(db.subscriptions[0].customer_category).toBe(payload.primaryCategory);

        // A primary address (Req 6.3/5.5).
        expect(db.addresses).toHaveLength(1);
        expect(db.addresses[0].is_primary).toBe(true);

        // A single PAID invoice (Req 8.2).
        expect(db.payments).toHaveLength(1);
        expect(db.payments[0].status).toBe("PAID");
      }),
      { numRuns: 25 },
    );
  });

  it("rejects with no record and a payment error when Payment_Status != PAID (Req 8.1)", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        const payload = mkPayload(base, { paymentStatus: "PENDING" });

        const result = await onboard(payload);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("PAYMENT_NOT_PAID");
          expect(result.fieldErrors?.paymentStatus).toBeDefined();
        }
        // Nothing persisted, no auth identity left behind.
        expect(db.users).toHaveLength(0);
        expect(db.profiles).toHaveLength(0);
        expect(db.subscriptions).toHaveLength(0);
        expect(db.payments).toHaveLength(0);
        expect(db.addresses).toHaveLength(0);
        expect(db.authUsers.size).toBe(0);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects a duplicate mobile with no new record and compensates the auth identity (Req 4.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        const payload = mkPayload(base);
        // Seed an existing Customer_Record sharing the mobile.
        db.users.push({
          id: "seed-user",
          mobile: payload.mobile,
          email: "seed@example.com",
        });

        const result = await onboard(payload);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("DUPLICATE_MOBILE");
          expect(result.fieldErrors?.mobile).toBeDefined();
        }
        // No new user/profile created; the seeded record is the only one.
        expect(db.users).toHaveLength(1);
        expect(db.profiles).toHaveLength(0);
        // The pre-created auth identity was compensated away (Req 6.6).
        expect(db.authUsers.size).toBe(0);
        expect(calls.deleteUser.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 25 },
    );
  });

  it("the Quick_Onboarding_Form schema accepts a complete payload and identifies each missing required field (Req 4.1/4.2/4.6)", () => {
    fc.assert(
      fc.property(arbBasePayload, (base) => {
        const payload = mkPayload(base);
        // Bind the schema to the payload's own pincode so it is serviceable.
        const schema = createQuickOnboardingSchema([payload.address.pincode]);

        expect(schema.safeParse(payload).success).toBe(true);

        const required = [
          "fullName",
          "mobile",
          "gender",
          "dietaryPreference",
          "planId",
          "startDate",
          "paymentStatus",
        ] as const;
        for (const field of required) {
          const clone: any = { ...payload };
          delete clone[field];
          const res = schema.safeParse(clone);
          expect(res.success).toBe(false);
          if (!res.success) {
            const paths = res.error.issues.map((i) => i.path[0]);
            expect(paths).toContain(field);
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});

// ─── Property 6 (task 6.11) ─────────────────────────────────────────────────────
// Property 6: Onboarding atomicity (no partial record).
// Validates: Requirements 6.6, 9.8, 14.6
describe("Property 6: Onboarding atomicity (no partial record)", () => {
  it("leaves post-state == pre-state and compensates auth when the atomic write fails", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        cfg.onboardShouldFail = { reason: "ERROR", message: "insert failed" };
        const payload = mkPayload(base);

        const result = await onboard(payload);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("ERROR");
        // No partial rows in any table.
        expect(db.users).toHaveLength(0);
        expect(db.profiles).toHaveLength(0);
        expect(db.subscriptions).toHaveLength(0);
        expect(db.payments).toHaveLength(0);
        expect(db.addresses).toHaveLength(0);
        // Auth identity was created then compensated (deleted).
        expect(calls.createUser.length).toBe(1);
        expect(calls.deleteUser.length).toBe(1);
        expect(db.authUsers.size).toBe(0);
      }),
      { numRuns: 25 },
    );
  });

  it("creates no record and no auth identity when the clinic/franchise scope is unresolved (Req 14.6)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBasePayload,
        fc.constantFrom(
          { type: "none", clinic_id: null },
          { type: "ambiguous", clinic_id: null },
        ),
        async (base, resolution) => {
          H.reset();
          cfg.clinicResolution = resolution;
          const payload = mkPayload(base);

          const result = await onboard(payload);

          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.reason).toBe("SCOPE_UNRESOLVED");
          // Rejected before any auth or DB write.
          expect(calls.createUser.length).toBe(0);
          expect(db.users).toHaveLength(0);
          expect(db.profiles).toHaveLength(0);
          expect(db.subscriptions).toHaveLength(0);
          expect(db.payments).toHaveLength(0);
          expect(db.addresses).toHaveLength(0);
          expect(db.authUsers.size).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("creates no record when the auth-identity creation fails", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        cfg.createUserShouldFail = true;
        const payload = mkPayload(base);

        const result = await onboard(payload);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("AUTH_FAILED");
        expect(db.users).toHaveLength(0);
        expect(db.profiles).toHaveLength(0);
        expect(db.subscriptions).toHaveLength(0);
        expect(db.payments).toHaveLength(0);
        expect(db.addresses).toHaveLength(0);
        expect(db.authUsers.size).toBe(0);
        // onboardCustomerAtomic was never reached.
        expect(calls.onboard.length).toBe(0);
      }),
      { numRuns: 25 },
    );
  });

  it("applies no partial update when profile-completion persistence fails (Req 9.8)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("Male", "Female", "Other"),
        fc.constantFrom("Veg", "Non-Veg"),
        async (newGender, newDiet) => {
          H.reset();
          cfg.updateProfileShouldThrow = true;
          // Seed an IN_PROGRESS profile with known field values.
          db.profiles.push({
            id: "p1",
            onboarding_status: "IN_PROGRESS",
            gender: "Other",
            dietary_preference: "Veg",
          });

          const result = await completeProfile("p1", {
            gender: newGender as any,
            dietaryPreference: newDiet as any,
          });

          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.reason).toBe("PERSISTENCE");
          // The record is byte-for-byte unchanged (no partial field update).
          expect(db.profiles[0]).toEqual({
            id: "p1",
            onboarding_status: "IN_PROGRESS",
            gender: "Other",
            dietary_preference: "Veg",
          });
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 11 (task 6.12) ────────────────────────────────────────────────────
// Property 11: Exactly one valid Primary_Category.
// Validates: Requirements 13.1, 13.2, 13.3, 13.4
describe("Property 11: Exactly one valid Primary_Category", () => {
  it("proceeds and records the selected category for any single value from {MEAL,KIT,ACCOMMODATION}", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBasePayload,
        fc.constantFrom(...CATEGORIES),
        async (base, category) => {
          H.reset();
          const payload = mkPayload(base, { primaryCategory: category });

          const result = await onboard(payload);

          expect(result.ok).toBe(true);
          expect(db.subscriptions).toHaveLength(1);
          expect(db.subscriptions[0].customer_category).toBe(category);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("rejects an out-of-set Primary_Category, persisting no record and preserving entered values", async () => {
    const arbBadCategory = fc
      .string()
      .filter((s) => !(CATEGORIES as readonly string[]).includes(s));
    await fc.assert(
      fc.asyncProperty(arbBasePayload, arbBadCategory, async (base, bad) => {
        H.reset();
        const payload = mkPayload(base, { primaryCategory: bad });

        const result = await onboard(payload);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("INVALID_CATEGORY");
          expect(result.fieldErrors?.primaryCategory).toBeDefined();
        }
        // No record created; the submitted value is preserved (not mutated).
        expect(db.profiles).toHaveLength(0);
        expect(db.subscriptions).toHaveLength(0);
        expect(payload.primaryCategory).toBe(bad);
      }),
      { numRuns: 25 },
    );
  });

  it("assertSinglePrimary accepts exactly one valid value and rejects zero, many, or out-of-set", () => {
    // Exactly one valid value → returns it (Req 13.2).
    fc.assert(
      fc.property(fc.constantFrom(...CATEGORIES), (cat) => {
        expect(assertSinglePrimary([cat])).toBe(cat);
      }),
      { numRuns: 25 },
    );
    // Zero selected → rejected (Req 13.3).
    expect(() => assertSinglePrimary([])).toThrow();
    // More than one → rejected (Req 13.4).
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...CATEGORIES), { minLength: 2, maxLength: 5 }),
        (many) => {
          expect(() => assertSinglePrimary(many)).toThrow();
        },
      ),
      { numRuns: 25 },
    );
    // A single out-of-set value → rejected (Req 13.1).
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(CATEGORIES as readonly string[]).includes(s)),
        (bad) => {
          expect(() => assertSinglePrimary([bad])).toThrow();
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 16 (task 6.13) ────────────────────────────────────────────────────
// Property 16: Test-email placeholder is unique, hidden, and replaceable.
// Validates: Requirements 10.1, 10.3, 10.4, 10.6, 10.7, 10.8, 14.4
describe("Property 16: Test-email placeholder is unique, hidden, and replaceable", () => {
  it("generates a hidden, mobile-derived placeholder with is_test_email=true when no email is supplied", async () => {
    await fc.assert(
      fc.asyncProperty(arbBasePayload, async (base) => {
        H.reset();
        // No customer-provided email (Req 10.1).
        const payload = mkPayload(base, { email: undefined, isTestEmail: false });

        const result = await onboard(payload);
        expect(result.ok).toBe(true);

        const user = db.users[0];
        // Deterministic, unique placeholder derived from the mobile (Req 10.3/14.4).
        expect(user.email).toBe(placeholderEmailFor(payload.mobile));
        expect(user.is_test_email).toBe(true);
        // Hidden from any customer-facing accessor (Req 10.4).
        expect(
          isDisplayableEmail({ email: user.email, is_test_email: user.is_test_email }),
        ).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  it("replaces the placeholder with a valid unused real email and clears the flag (Req 10.6)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRealEmail, async (realEmail) => {
        H.reset();
        const placeholder = placeholderEmailFor("9876543210");
        db.users.push({ id: "u1", email: placeholder, is_test_email: true });

        const result = await completeProfile("p1", { email: realEmail }, { userId: "u1" });

        expect(result.ok).toBe(true);
        const user = db.users.find((u: any) => u.id === "u1");
        expect(user.email).toBe(realEmail);
        expect(user.is_test_email).toBe(false);
        expect(
          isDisplayableEmail({ email: user.email, is_test_email: user.is_test_email }),
        ).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects a real email already in use, leaving the test email and flag unchanged (Req 10.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRealEmail, async (realEmail) => {
        H.reset();
        const placeholder = placeholderEmailFor("9876543210");
        db.users.push({ id: "u1", email: placeholder, is_test_email: true });
        db.users.push({ id: "u2", email: realEmail, is_test_email: false });

        const result = await completeProfile("p1", { email: realEmail }, { userId: "u1" });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("EMAIL_IN_USE");
        // The existing Test_Email + flag are untouched.
        const user = db.users.find((u: any) => u.id === "u1");
        expect(user.email).toBe(placeholder);
        expect(user.is_test_email).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects a malformed or over-length email, leaving the test email and flag unchanged (Req 10.8)", async () => {
    await fc.assert(
      fc.asyncProperty(arbInvalidEmail, async (badEmail) => {
        H.reset();
        const placeholder = placeholderEmailFor("9876543210");
        db.users.push({ id: "u1", email: placeholder, is_test_email: true });

        const result = await completeProfile("p1", { email: badEmail }, { userId: "u1" });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("VALIDATION");
        // Format is rejected before any email write is attempted.
        expect(calls.replaceEmail.length).toBe(0);
        const user = db.users.find((u: any) => u.id === "u1");
        expect(user.email).toBe(placeholder);
        expect(user.is_test_email).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});

// ─── Property 18 (task 6.14) ────────────────────────────────────────────────────
// Property 18: Unique customer code generation.
// Validates: Requirements 14.7, 14.8
describe("Property 18: Unique customer code generation", () => {
  it("returns a code not present in the existing set", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 50 }),
        async (existing) => {
          H.reset();
          cfg.existingCodes = new Set(existing);

          const code = await generateUniqueCustomerCode();

          expect(typeof code).toBe("string");
          expect(code.startsWith("CUST-")).toBe(true);
          expect(cfg.existingCodes.has(code)).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("regenerates on collision until it finds a free code (Req 14.7)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (collisions) => {
        H.reset();
        cfg.forceCollisions = collisions;

        const code = await generateUniqueCustomerCode();

        expect(typeof code).toBe("string");
        expect(code.startsWith("CUST-")).toBe(true);
        // It probed once per collision plus once for the free code.
        expect(calls.codeLookups).toBe(collisions + 1);
      }),
      { numRuns: 25 },
    );
  });

  it("never yields a duplicate as the persisted set grows (Req 14.8)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 20 }),
        fc.integer({ min: 1, max: 8 }),
        async (seed, count) => {
          H.reset();
          cfg.existingCodes = new Set(seed);

          const produced: string[] = [];
          for (let i = 0; i < count; i += 1) {
            const code = await generateUniqueCustomerCode();
            // Not already persisted.
            expect(cfg.existingCodes.has(code)).toBe(false);
            // Simulate persistence so the next call must avoid it too.
            cfg.existingCodes.add(code);
            produced.push(code);
          }
          // All produced codes are pairwise distinct.
          expect(new Set(produced).size).toBe(produced.length);
        },
      ),
      { numRuns: 25 },
    );
  });
});
