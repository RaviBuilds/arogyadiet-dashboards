// src/test/customer-pin-auth/pin-mismatch-rejection.property.test.ts
// Feature: customer-pin-auth, Property 3: PIN mismatch rejection preserves state
//
// Property 3: PIN mismatch rejection preserves state — For any two DISTINCT
// valid 6-digit numeric PINs submitted as `newPin` and `confirmPin` to
// `setPermanentPinAction`, the action returns `{outcome: "MISMATCH"}` and the
// stored `pin_hash` and `is_temp_pin` values remain unchanged.
//
// APPROACH: `setPermanentPinAction` checks `newPin !== confirmPin` BEFORE
// calling `PinService.setPermanentPin`. We mock PinService and verify it is
// NEVER called when the two PINs don't match. The action returns MISMATCH
// immediately without touching the database, preserving all stored state.
//
// **Validates: Requirements 2.5**

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Mock dependencies — these should NOT be called when PINs don't match
// ---------------------------------------------------------------------------

const mockSetPermanentPin = vi.fn();
const mockVerifyPin = vi.fn();
const mockHashPin = vi.fn();
const mockResetPinToTemporary = vi.fn();

vi.mock("@/services/PinService", () => ({
  setPermanentPin: (...args: unknown[]) => mockSetPermanentPin(...args),
  verifyPin: (...args: unknown[]) => mockVerifyPin(...args),
  hashPin: (...args: unknown[]) => mockHashPin(...args),
  resetPinToTemporary: (...args: unknown[]) => mockResetPinToTemporary(...args),
}));

vi.mock("@/services/PinThrottleService", () => ({
  checkThrottle: vi.fn().mockResolvedValue({ status: "ALLOWED" }),
  incrementFailure: vi.fn(),
  resetThrottle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: vi.fn() },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/services/EligibilityChecker", () => ({
  EligibilityChecker: { check: vi.fn() },
}));

import { setPermanentPinAction } from "@/actions/pinAuthActions";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// A valid 6-digit numeric PIN (zero-padded).
const validPin = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => n.toString().padStart(6, "0"));

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 3: PIN mismatch rejection preserves state", () => {
  beforeEach(() => {
    mockSetPermanentPin.mockReset();
    mockVerifyPin.mockReset();
    mockHashPin.mockReset();
    mockResetPinToTemporary.mockReset();
  });

  it("returns MISMATCH and never calls setPermanentPin when newPin !== confirmPin", async () => {
    await fc.assert(
      fc.asyncProperty(validPin, validPin, async (pin1, pin2) => {
        // Precondition: the two PINs must be distinct.
        fc.pre(pin1 !== pin2);

        // Reset the mock call tracking for each iteration.
        mockSetPermanentPin.mockClear();

        // Call the action with a plausible mobile and two mismatched PINs.
        const result = await setPermanentPinAction("9876543210", pin1, pin2);

        // 1. Result must indicate MISMATCH with the expected message.
        expect(result.outcome).toBe("MISMATCH");
        expect(result).toHaveProperty("message", "PINs do not match");

        // 2. PinService.setPermanentPin must NOT have been called —
        //    state (pin_hash, is_temp_pin) is preserved.
        expect(mockSetPermanentPin).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
