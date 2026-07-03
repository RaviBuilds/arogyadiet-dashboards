// src/test/customer-pin-auth/pin-service-hash.property.test.ts
// Feature: customer-pin-auth, Properties 1 & 2: PinService hash/verify
//
// Property 1: PIN hash round-trip with minimum cost — For any valid 6-digit
// numeric PIN, hashing it with `PinService.hashPin` and then comparing the
// original PIN against the resulting hash with `bcrypt.compare` SHALL return
// `true`, and the hash string SHALL indicate a bcrypt cost factor of at least 10.
//
// Property 2: Distinct PINs never collide on comparison — For any two distinct
// 6-digit numeric PINs (pin1 ≠ pin2), `bcrypt.compare(pin1, hashPin(pin2))`
// SHALL return `false`.
//
// APPROACH: These tests call the REAL `hashPin` function which uses bcrypt
// internally. No mocking of the hashing logic. We mock ONLY `@/lib/supabase/admin`
// since PinService imports it (but `hashPin` doesn't use it). Because bcrypt is
// computationally expensive, we limit to 20 runs per property.
//
// Validates: Requirements 1.4, 2.2, 9.1, 9.5

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import bcrypt from "bcryptjs";

// Mock the supabase admin module since PinService imports it (even though
// hashPin doesn't use the DB client).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

import { hashPin } from "@/services/PinService";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// A valid 6-digit numeric PIN: integers [0, 999999] zero-padded to 6 chars.
const validPin = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => n.toString().padStart(6, "0"));

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 1: PIN hash round-trip with minimum cost", () => {
  /**
   * **Validates: Requirements 1.4, 2.2, 9.1, 9.5**
   *
   * For any valid 6-digit numeric PIN, `hashPin(pin)` produces a bcrypt hash
   * where `bcrypt.compare(pin, hash)` returns `true`, and the hash indicates
   * a bcrypt cost factor of at least 10.
   */
  it("hashPin produces a bcrypt hash that verifies against the original PIN with cost >= 10", { timeout: 60_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(validPin, async (pin) => {
        const hash = await hashPin(pin);

        // The hash must verify against the original PIN (round-trip).
        const matches = await bcrypt.compare(pin, hash);
        expect(matches).toBe(true);

        // The hash string must indicate a bcrypt cost factor of at least 10.
        // Bcrypt hashes have the format: $2a$XX$ or $2b$XX$ where XX is cost.
        const costMatch = hash.match(/^\$2[aby]?\$(\d{2})\$/);
        expect(costMatch).not.toBeNull();
        const cost = parseInt(costMatch![1], 10);
        expect(cost).toBeGreaterThanOrEqual(10);
      }),
      { numRuns: 20 },
    );
  });
});

describe("Property 2: Distinct PINs never collide on comparison", () => {
  /**
   * **Validates: Requirements 2.2, 3.3**
   *
   * For any two DISTINCT 6-digit numeric PINs (pin1 ≠ pin2),
   * `bcrypt.compare(pin1, await hashPin(pin2))` returns `false`.
   */
  it("bcrypt.compare(pin1, hashPin(pin2)) returns false when pin1 !== pin2", { timeout: 60_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(validPin, validPin, async (pin1, pin2) => {
        // Only test distinct PINs.
        fc.pre(pin1 !== pin2);

        const hash2 = await hashPin(pin2);

        // pin1 must NOT verify against the hash of pin2.
        const matches = await bcrypt.compare(pin1, hash2);
        expect(matches).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});
