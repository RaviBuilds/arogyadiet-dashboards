// Feature: customer-pin-auth, Property 13: Store temporary PIN produces verifiable hash with temp flag
//
// **Validates: Requirements 6.4, 6.6, 7.4**
//
// For any valid 6-digit numeric PIN passed through the `resetPinToTemporary` function
// (simulating the onboarding or admin-reset flow), the resulting hash verifies as `true`
// when compared with the original PIN via `bcrypt.compare`, and `is_temp_pin` is `true`.
//
// This tests the full round-trip: hashPin → store → verify. Since `resetPinToTemporary`
// internally hashes and stores, we test it directly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import bcrypt from "bcryptjs";

// ─── In-memory store to capture DB updates ───────────────────────────────────

let lastUpdate: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        lastUpdate = payload;
        return {
          eq: () => ({ error: null }),
        };
      },
    }),
  }),
}));

import { resetPinToTemporary } from "@/services/PinService";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Valid 6-digit numeric PIN (zero-padded) */
const validPin = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => n.toString().padStart(6, "0"));

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  lastUpdate = null;
});

// ─── Property test (20 iterations — bcrypt is expensive) ─────────────────────

describe("resetPinToTemporary — Property 13: Store temporary PIN produces verifiable hash with temp flag", () => {
  it(
    "stores a bcrypt hash that verifies against the original PIN",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          await resetPinToTemporary("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", pin);

          expect(lastUpdate).not.toBeNull();
          const storedHash = lastUpdate!.pin_hash as string;
          const matches = await bcrypt.compare(pin, storedHash);
          expect(matches).toBe(true);
        }),
        { numRuns: 20 },
      );
    },
    30_000,
  );

  it(
    "sets is_temp_pin to true",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          await resetPinToTemporary("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", pin);

          expect(lastUpdate).not.toBeNull();
          expect(lastUpdate!.is_temp_pin).toBe(true);
        }),
        { numRuns: 20 },
      );
    },
    30_000,
  );

  it(
    "sets pin_set_at to a valid ISO date string",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          const before = Date.now();
          await resetPinToTemporary("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", pin);
          const after = Date.now();

          expect(lastUpdate).not.toBeNull();

          const pinSetAt = lastUpdate!.pin_set_at as string;
          expect(pinSetAt).toBeDefined();
          expect(typeof pinSetAt).toBe("string");

          // Validate it's a valid ISO date
          const parsed = new Date(pinSetAt).getTime();
          expect(parsed).not.toBeNaN();

          // The timestamp should be within the test execution window (5s tolerance)
          expect(parsed).toBeGreaterThanOrEqual(before - 5000);
          expect(parsed).toBeLessThanOrEqual(after + 5000);
        }),
        { numRuns: 20 },
      );
    },
    30_000,
  );
});
