// Feature: customer-pin-auth, Property 4: Set permanent PIN clears temp flag
//
// **Validates: Requirements 2.6**
//
// For any valid 6-digit numeric PIN, after calling `setPermanentPin(mobile, pin)`:
//   - The PIN hash stored in the DB verifies as `true` with `bcrypt.compare(pin, storedHash)`
//   - `is_temp_pin` is `false`
//   - `pin_set_at` is non-null and recent (within last few seconds)
//
// Since `setPermanentPin` hits the database, we MOCK the Supabase admin client
// with an in-memory store that captures the update call.

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

import { setPermanentPin } from "@/services/PinService";

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

describe("setPermanentPin — Property 4: Set permanent PIN clears temp flag", () => {
  it(
    "stores a bcrypt hash that verifies against the original PIN",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          await setPermanentPin("9876543210", pin);

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
    "sets is_temp_pin to false",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          await setPermanentPin("9876543210", pin);

          expect(lastUpdate).not.toBeNull();
          expect(lastUpdate!.is_temp_pin).toBe(false);
        }),
        { numRuns: 20 },
      );
    },
    30_000,
  );

  it(
    "sets pin_set_at to a valid ISO date string within the last 5 seconds",
    async () => {
      await fc.assert(
        fc.asyncProperty(validPin, async (pin) => {
          lastUpdate = null;

          const before = Date.now();
          await setPermanentPin("9876543210", pin);
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
