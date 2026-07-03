// src/test/customer-pin-auth/pin-throttle.property.test.ts
// Feature: customer-pin-auth, Properties 6–10: PinThrottleService state machine
//
// Property 6: Incorrect PIN increments failed_attempts
// Property 7: Lockout engages at threshold (5 failures)
// Property 8: Locked state rejects all PIN attempts
// Property 9: Lock expiry resets throttle and allows attempts
// Property 10: Correct PIN resets failed_attempts
//
// APPROACH: Mock the Supabase admin client with an in-memory store keyed by
// mobile number. Each property test drives the PinThrottleService functions
// (checkThrottle, incrementFailure, resetThrottle) against the mock store and
// verifies the state transitions match the spec's requirements.
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── In-memory throttle store ────────────────────────────────────────────────

interface ThrottleRow {
  mobile: string;
  failed_attempts: number;
  locked_until: string | null;
  window_started_at: string;
  updated_at: string;
}

let throttleStore: Record<string, ThrottleRow> = {};

// ─── Mock the Supabase admin client ──────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => {
            const row = throttleStore[val] ?? null;
            return { data: row ? { ...row } : null, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_col: string, val: string) => {
          if (throttleStore[val]) {
            throttleStore[val] = { ...throttleStore[val], ...payload } as ThrottleRow;
          }
          return { error: null };
        },
      }),
      upsert: (payload: Record<string, unknown>, _opts?: unknown) => {
        const mobile = payload.mobile as string;
        throttleStore[mobile] = payload as unknown as ThrottleRow;
        return { error: null };
      },
    }),
  }),
}));

import {
  checkThrottle,
  incrementFailure,
  resetThrottle,
} from "@/services/PinThrottleService";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// Valid 10-digit Indian mobile number (starts with 6-9).
const validMobile: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 6, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  throttleStore = {};
});

// ─── Property 6: Incorrect PIN increments failed_attempts ────────────────────

describe("Property 6: Incorrect PIN increments failed_attempts", () => {
  /**
   * **Validates: Requirements 3.3, 5.1**
   *
   * For any mobile number, calling incrementFailure on a fresh record (no
   * existing throttle row) SHALL create a row with failed_attempts = 1.
   * Calling incrementFailure again SHALL increment to 2, etc.
   */
  it("incrementFailure on a fresh mobile sets failed_attempts to 1", async () => {
    await fc.assert(
      fc.asyncProperty(validMobile, async (mobile) => {
        throttleStore = {};

        const result = await incrementFailure(mobile);

        expect(throttleStore[mobile]).toBeDefined();
        expect(throttleStore[mobile].failed_attempts).toBe(1);
        expect(result.status).toBe("ALLOWED");
      }),
      { numRuns: 100 },
    );
  });

  it("incrementFailure on an existing row increments failed_attempts by exactly 1", async () => {
    await fc.assert(
      fc.asyncProperty(
        validMobile,
        fc.integer({ min: 0, max: 3 }),
        async (mobile, initialAttempts) => {
          throttleStore = {};
          const now = new Date().toISOString();
          throttleStore[mobile] = {
            mobile,
            failed_attempts: initialAttempts,
            locked_until: null,
            window_started_at: now,
            updated_at: now,
          };

          await incrementFailure(mobile);

          expect(throttleStore[mobile].failed_attempts).toBe(initialAttempts + 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Lockout engages at threshold (5 failures) ──────────────────

describe("Property 7: Lockout engages at threshold", () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any mobile number, after exactly 5 consecutive failed attempts
   * (incrementFailure calls), the locked_until column SHALL be set to a
   * timestamp approximately 15 minutes (900 seconds) in the future, and
   * the status SHALL be LOCKED.
   */
  it("5th incrementFailure sets locked_until ~15min in future and returns LOCKED", async () => {
    await fc.assert(
      fc.asyncProperty(validMobile, async (mobile) => {
        throttleStore = {};
        const now = new Date().toISOString();
        // Start with 4 failed attempts (one short of lockout).
        throttleStore[mobile] = {
          mobile,
          failed_attempts: 4,
          locked_until: null,
          window_started_at: now,
          updated_at: now,
        };

        const before = Date.now();
        const result = await incrementFailure(mobile);
        const after = Date.now();

        // After the 5th failure, lockout should engage.
        expect(throttleStore[mobile].failed_attempts).toBe(5);
        expect(result.status).toBe("LOCKED");
        expect(result.lockedUntil).toBeDefined();

        // locked_until should be approximately 900s (15 min) from now.
        const lockedUntilMs = result.lockedUntil!.getTime();
        // Allow 5 seconds of tolerance for execution time.
        expect(lockedUntilMs).toBeGreaterThanOrEqual(before + 900 * 1000 - 5000);
        expect(lockedUntilMs).toBeLessThanOrEqual(after + 900 * 1000 + 5000);
      }),
      { numRuns: 100 },
    );
  });

  it("sequential incrementFailure from 0 to 5 engages lockout on the 5th call", async () => {
    await fc.assert(
      fc.asyncProperty(validMobile, async (mobile) => {
        throttleStore = {};

        let result;
        for (let i = 0; i < 5; i++) {
          result = await incrementFailure(mobile);
        }

        expect(throttleStore[mobile].failed_attempts).toBe(5);
        expect(result!.status).toBe("LOCKED");
        expect(throttleStore[mobile].locked_until).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Locked state rejects all PIN attempts ──────────────────────

describe("Property 8: Locked state rejects all PIN attempts", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any mobile number where locked_until is in the future, checkThrottle
   * SHALL return LOCKED with retryAfterSeconds indicating when retry is allowed.
   */
  it("checkThrottle returns LOCKED when locked_until is in the future", async () => {
    await fc.assert(
      fc.asyncProperty(
        validMobile,
        // Random future offset: 1 second to 14 minutes from now.
        fc.integer({ min: 1, max: 840 }),
        async (mobile, secondsInFuture) => {
          throttleStore = {};
          const now = new Date();
          const lockedUntil = new Date(now.getTime() + secondsInFuture * 1000);
          throttleStore[mobile] = {
            mobile,
            failed_attempts: 5,
            locked_until: lockedUntil.toISOString(),
            window_started_at: now.toISOString(),
            updated_at: now.toISOString(),
          };

          const result = await checkThrottle(mobile);

          expect(result.status).toBe("LOCKED");
          expect(result.lockedUntil).toBeDefined();
          expect(result.retryAfterSeconds).toBeDefined();
          expect(result.retryAfterSeconds!).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Lock expiry resets throttle and allows attempts ─────────────

describe("Property 9: Lock expiry resets throttle and allows attempts", () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * For any mobile number where locked_until is in the past, the next
   * checkThrottle call SHALL return ALLOWED and reset failed_attempts to 0.
   */
  it("checkThrottle returns ALLOWED and resets failed_attempts when locked_until is past", async () => {
    await fc.assert(
      fc.asyncProperty(
        validMobile,
        // Random past offset: 1 second to 60 minutes ago.
        fc.integer({ min: 1, max: 3600 }),
        async (mobile, secondsInPast) => {
          throttleStore = {};
          const now = new Date();
          const lockedUntil = new Date(now.getTime() - secondsInPast * 1000);
          throttleStore[mobile] = {
            mobile,
            failed_attempts: 5,
            locked_until: lockedUntil.toISOString(),
            window_started_at: new Date(now.getTime() - 1800 * 1000).toISOString(),
            updated_at: new Date(now.getTime() - secondsInPast * 1000).toISOString(),
          };

          const result = await checkThrottle(mobile);

          expect(result.status).toBe("ALLOWED");
          // After expiry, failed_attempts should be reset to 0.
          expect(throttleStore[mobile].failed_attempts).toBe(0);
          // locked_until should be cleared (null).
          expect(throttleStore[mobile].locked_until).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Correct PIN resets failed_attempts ─────────────────────────

describe("Property 10: Correct PIN resets failed_attempts", () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any mobile number with failed_attempts > 0, calling resetThrottle
   * SHALL set failed_attempts to 0.
   */
  it("resetThrottle sets failed_attempts to 0 for any mobile with prior failures", async () => {
    await fc.assert(
      fc.asyncProperty(
        validMobile,
        fc.integer({ min: 1, max: 4 }),
        async (mobile, priorFailures) => {
          throttleStore = {};
          const now = new Date().toISOString();
          throttleStore[mobile] = {
            mobile,
            failed_attempts: priorFailures,
            locked_until: null,
            window_started_at: now,
            updated_at: now,
          };

          await resetThrottle(mobile);

          expect(throttleStore[mobile].failed_attempts).toBe(0);
          expect(throttleStore[mobile].locked_until).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
