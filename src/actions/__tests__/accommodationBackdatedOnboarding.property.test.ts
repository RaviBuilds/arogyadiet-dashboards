// src/actions/__tests__/accommodationBackdatedOnboarding.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 4: Server rejection of
// invalid backdated payloads (Task 7.7)
//
// Property 4: *For any* accommodation onboarding payload, the server SHALL
// reject it when the start date is before the current IST date and the
// Backdated_Stay_Toggle flag is false (indicating backdated entry must be
// enabled), and SHALL reject it when the start date is earlier than 30
// calendar days before the current IST date regardless of the toggle value,
// and SHALL NOT create a Stay_Entry, customer profile, or Payment_Transaction
// in either case.
//
// **Validates: Requirements 3.4, 3.5**
//
// `onboardAccommodationCustomerAction`'s very first step is
// `accommodationOnboardingSchema.safeParse(input)`, which runs before any
// Supabase Auth / DB access. For every invalid backdated payload this test
// constructs, the schema's `superRefine` (src/validations/accommodationSchema.ts)
// must reject the payload right there — so `createAdminClient` and
// `AccommodationService.createStay` must NEVER be invoked. Both are mocked as
// "tripwires" that throw if called at all, which turns "no DB access
// happened" into an assertion the test cannot silently pass by mistake: any
// path that slips past validation and reaches either surface fails loudly.
//
// The schema reads the real IST "today" through `getISTDateString(0)` inside
// its own `superRefine` (not an injectable parameter). Rather than rely on the
// wall clock at test-run time, `@/lib/dates/ist`'s `getISTDateString` and
// `addDaysToISODate` are mocked so the schema resolves a fixed, deterministic
// "today" — `REFERENCE_TODAY_IST` from the shared arbitraries — no matter when
// the suite runs. `addDaysToISODate` is mocked with the arbitraries' own pure
// `shiftISODate`, which is a different (independently written) implementation
// from the one under test, so the mock cannot inherit a bug from the code it
// stands in for.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Deterministic clock ─────────────────────────────────────────────────────
// Mocked before the action/schema modules are imported so every call to
// getISTDateString(0) inside the schema's superRefine resolves to the same
// fixed "today" the test's own date arithmetic uses. The shift function is
// re-declared inline (via vi.hoisted, so it is available inside the mock
// factory) rather than imported from the shared arbitraries module — pure
// UTC calendar-day arithmetic, independent of `@/lib/dates/ist`'s own
// implementation, so the mock cannot inherit a bug from the code it stands
// in for. `REFERENCE_TODAY_IST` itself is still asserted to match the shared
// arbitraries constant below, so the two never silently drift apart.
const CLOCK = vi.hoisted(() => {
  const REFERENCE_TODAY_IST = "2025-01-15";
  function pad2(value: number): string {
    return `${value}`.padStart(2, "0");
  }
  function shiftISODate(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(year, month - 1, day));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
      dt.getUTCDate(),
    )}`;
  }
  return { REFERENCE_TODAY_IST, shiftISODate };
});

vi.mock("@/lib/dates/ist", () => ({
  getISTDateString: (offsetDays = 0) =>
    CLOCK.shiftISODate(CLOCK.REFERENCE_TODAY_IST, offsetDays),
  addDaysToISODate: (dateStr: string, days: number) =>
    CLOCK.shiftISODate(dateStr, days),
}));

// ─── Tripwires: no DB access must occur for an invalid backdated payload ────
const H = vi.hoisted(() => ({
  createAdminClientCalls: 0,
  createStayCalls: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    H.createAdminClientCalls += 1;
    throw new Error(
      "TRIPWIRE: createAdminClient() was called — validation did not reject the invalid backdated payload before any DB access.",
    );
  },
}));

vi.mock("@/services/AccommodationService", () => ({
  createStay: () => {
    H.createStayCalls += 1;
    throw new Error(
      "TRIPWIRE: AccommodationService.createStay() was called — validation did not reject the invalid backdated payload before the stay/ledger write.",
    );
  },
}));

// getCurrentAdminContext is only reached after the stay is created in the
// real action; stub it defensively so an accidental reach doesn't throw a
// second, confusing error on top of the tripwires above.
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: async () => ({ userId: null }),
}));

// System under test, imported after every mock is registered.
import { onboardAccommodationCustomerAction } from "@/actions/accommodationOnboardingActions";
import {
  REFERENCE_TODAY_IST,
  REFERENCE_MAX_BACKDATED_DAYS,
  REFERENCE_MAX_FORWARD_START_DAYS,
  shiftISODate,
  arbTotalNights,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.createAdminClientCalls = 0;
  H.createStayCalls = 0;
});

// Guards against the hoisted mock's own "today" constant silently drifting
// from the shared arbitraries' constant of the same name.
if (CLOCK.REFERENCE_TODAY_IST !== REFERENCE_TODAY_IST) {
  throw new Error(
    "CLOCK.REFERENCE_TODAY_IST must match paymentArbitraries.REFERENCE_TODAY_IST",
  );
}

// ─── Fixed valid "rest of payload" — only the backdated-related fields vary ──

function buildPayload(overrides: {
  startDate: string;
  backdatedStayEnabled: boolean;
  totalNights: number;
}): Record<string, unknown> {
  return {
    fullName: "Property Four Guest",
    mobile: "9876543210",
    gender: "Male",
    dietaryPreference: "Veg",
    stayType: "AC Villa",
    occupancyType: "Single",
    mealPreference: "VEG",
    tempPin: "123456",
    totalStayAmount: 50000,
    advanceAmountPaid: 10000,
    isSharedPayment: false,
    startDate: overrides.startDate,
    totalNights: overrides.totalNights,
    backdatedStayEnabled: overrides.backdatedStayEnabled,
  };
}

// ─── The two rejection cases Property 4 names ───────────────────────────────

/**
 * Case A (Req 3.4): a past start date with the Backdated_Stay_Toggle off.
 * Drawn from [today - 400, today - 1] so it also covers dates that are
 * simultaneously past-the-30-day-window (Case A ∩ Case B), which the schema
 * flags with BOTH issues on `startDate` (Zod keeps every issue from the same
 * superRefine invocation; only the first is surfaced by the action's
 * fieldErrors reduction, but the schema-level parse still fails either way).
 */
const arbCaseAPastDateOffset: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constantFrom(-1, -2, -REFERENCE_MAX_BACKDATED_DAYS), weight: 3 },
  { arbitrary: fc.integer({ min: -400, max: -1 }), weight: 5 },
);

/**
 * Case B (Req 3.5): a start date earlier than 30 days before today,
 * regardless of the toggle value. Strictly beyond the backdating window.
 */
const arbCaseBTooFarPastOffset: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      -REFERENCE_MAX_BACKDATED_DAYS - 1,
      -REFERENCE_MAX_BACKDATED_DAYS - 2,
      -400,
    ),
    weight: 4,
  },
  {
    arbitrary: fc.integer({ min: -400, max: -REFERENCE_MAX_BACKDATED_DAYS - 1 }),
    weight: 5,
  },
);

async function assertRejectedWithoutDbAccess(
  payload: Record<string, unknown>,
  expectedMessageFragment: string,
): Promise<void> {
  const result = await onboardAccommodationCustomerAction(payload as never);

  // (1) Result is the { error, fieldErrors } shape, not success.
  expect("success" in result).toBe(false);
  expect("error" in result).toBe(true);

  if ("success" in result) return; // unreachable after the assertion above

  // (2) fieldErrors.startDate carries the exact pinned message for the rule.
  expect(result.fieldErrors?.startDate).toBe(expectedMessageFragment);

  // (3) & (4) Zero DB access — the tripwires would have thrown otherwise.
  expect(H.createAdminClientCalls).toBe(0);
  expect(H.createStayCalls).toBe(0);
}

describe("Feature: accommodation-payment-lifecycle, Property 4: Server rejection of invalid backdated payloads", () => {
  it("rejects a past start date with the Backdated_Stay_Toggle off (Req 3.4), creating no Stay_Entry, customer profile, or Payment_Transaction", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCaseAPastDateOffset,
        arbTotalNights,
        async (offset, totalNights) => {
          H.createAdminClientCalls = 0;
          H.createStayCalls = 0;

          const startDate = shiftISODate(REFERENCE_TODAY_IST, offset);
          // Only reject on the "toggle disabled" grounds when the date is
          // NOT also beyond the 30-day window (Case A ∩ Case B still
          // rejects, but the pinned message asserted here is Case A's).
          fc.pre(offset >= -REFERENCE_MAX_BACKDATED_DAYS);

          const payload = buildPayload({
            startDate,
            backdatedStayEnabled: false,
            totalNights,
          });

          await assertRejectedWithoutDbAccess(
            payload,
            "Backdated stay entry must be enabled to select a past start date.",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects a start date earlier than 30 days before today regardless of the toggle value (Req 3.5), creating no Stay_Entry, customer profile, or Payment_Transaction", async () => {
    // The schema's superRefine adds the toggle-off issue FIRST when the
    // toggle is off (see the nested `if` in accommodationSchema.ts), so a
    // date that is both toggle-off-invalid AND beyond the 30-day window
    // reports the toggle-off message on `fieldErrors.startDate` (the action
    // keeps only the first issue per field). With the toggle on, that first
    // branch is skipped, so the 30-day-range issue is the one reported.
    // Either way the payload is rejected before any DB access — which is
    // the substance of "regardless of the toggle value" in Req 3.5.
    await fc.assert(
      fc.asyncProperty(
        arbCaseBTooFarPastOffset,
        fc.boolean(),
        arbTotalNights,
        async (offset, backdatedStayEnabled, totalNights) => {
          H.createAdminClientCalls = 0;
          H.createStayCalls = 0;

          const startDate = shiftISODate(REFERENCE_TODAY_IST, offset);

          const payload = buildPayload({
            startDate,
            backdatedStayEnabled,
            totalNights,
          });

          const expectedMessage = backdatedStayEnabled
            ? "Start date exceeds the maximum 30-day backdated range."
            : "Backdated stay entry must be enabled to select a past start date.";

          await assertRejectedWithoutDbAccess(payload, expectedMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects the combination of both violations at once (past date, toggle off, beyond 30 days), creating no Stay_Entry, customer profile, or Payment_Transaction", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCaseBTooFarPastOffset,
        arbTotalNights,
        async (offset, totalNights) => {
          H.createAdminClientCalls = 0;
          H.createStayCalls = 0;

          const startDate = shiftISODate(REFERENCE_TODAY_IST, offset);

          const payload = buildPayload({
            startDate,
            backdatedStayEnabled: false,
            totalNights,
          });

          const result = await onboardAccommodationCustomerAction(
            payload as never,
          );

          expect("success" in result).toBe(false);
          expect("error" in result).toBe(true);
          if ("success" in result) return;

          // Both the toggle-off issue and the 30-day-range issue target
          // `startDate`; the action's fieldErrors reduction keeps the FIRST
          // issue Zod reports for that path (the toggle-off message, added
          // first in the schema's superRefine), but the parse still fails.
          expect(result.fieldErrors?.startDate).toBe(
            "Backdated stay entry must be enabled to select a past start date.",
          );

          expect(H.createAdminClientCalls).toBe(0);
          expect(H.createStayCalls).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("pins the exact boundary the requirements call out: today − 30 is NOT flagged by the 30-day rule, today − 31 is rejected by it", async () => {
    // today - 30 lies exactly ON the accepted backdating floor (Req 1.3). With
    // the toggle enabled, this payload is fully valid and would proceed to
    // DB access in the real action — asserting on the action's result here
    // would trip the tripwire for an unrelated (successful) reason, so this
    // half of the boundary is checked directly against the schema instead.
    const { accommodationOnboardingSchema } = await import(
      "@/validations/accommodationSchema"
    );
    const atBoundary = buildPayload({
      startDate: shiftISODate(REFERENCE_TODAY_IST, -REFERENCE_MAX_BACKDATED_DAYS),
      backdatedStayEnabled: true,
      totalNights: 3,
    });
    expect(accommodationOnboardingSchema.safeParse(atBoundary).success).toBe(
      true,
    );

    // today - 31 is one day beyond the floor — Case B fires (Req 3.5), even
    // with the toggle enabled — and the action rejects it before any DB
    // access.
    const beyondBoundary = buildPayload({
      startDate: shiftISODate(
        REFERENCE_TODAY_IST,
        -REFERENCE_MAX_BACKDATED_DAYS - 1,
      ),
      backdatedStayEnabled: true,
      totalNights: 3,
    });
    await assertRejectedWithoutDbAccess(
      beyondBoundary,
      "Start date exceeds the maximum 30-day backdated range.",
    );
  });
});
