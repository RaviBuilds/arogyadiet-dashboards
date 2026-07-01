// src/lib/otp/__tests__/otpPolicy.property.test.ts
//
// Property tests for the OTP login policy state machine (`evaluateOtpPolicy`).
//
// This file is SHARED between spec tasks:
//   - Task 3.4 owns "Property 3: OTP validity window".
//   - Task 3.5 owns "Property 4: OTP throttle policy state machine" (below).
// Each task appends only its own property block; neither clobbers the other.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateOtpPolicy,
  OTP_LOCKOUT_SECONDS,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_MAX_RESENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_VALIDITY_SECONDS,
  OTP_WINDOW_SECONDS,
  type OtpThrottleState,
} from "@/lib/otp/otpPolicy";

// ─── Shared timing constants (milliseconds) ─────────────────────────────────
const SECOND_MS = 1_000;
const VALIDITY_MS = OTP_VALIDITY_SECONDS * SECOND_MS; // 300s
const LOCKOUT_MS = OTP_LOCKOUT_SECONDS * SECOND_MS; // 900s
const COOLDOWN_MS = OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS; // 30s
const WINDOW_MS = OTP_WINDOW_SECONDS * SECOND_MS; // 900s

// A fixed epoch anchor keeps generated timestamps deterministic and positive.
const BASE = 1_700_000_000_000;

// ============================================================================
// Feature: customer-mobile-onboarding, Property 4: OTP throttle policy state machine
//
// Property 4: OTP throttle policy state machine
// For any prior throttle state and clock time, `evaluateOtpPolicy` satisfies:
//   (a) a failed verification increments failed_attempts by exactly one and
//       leaves the current validity window unchanged;
//   (b) reaching 5 failed attempts within a window sets a 900s lockout that
//       blocks ALL submissions and resends;
//   (c) a resend is permitted ONLY IF >= 30s since the last send AND fewer than
//       3 resends have occurred in the current 900s window;
//   (d) a delivery-failure leaves resend_count unchanged (does not consume a
//       resend).
//
// Validates: Requirements 2.5, 2.7, 2.8, 2.9, 2.10
// ============================================================================

describe("Property 4: OTP throttle policy state machine", () => {
  // ── (a) failed verification increments attempts by one, window unchanged ──
  // Constrain the state so the failed VERIFY lands in the INVALID branch:
  //   not locked, policy window not expired, and a passcode inside its 300s
  //   validity window, with failedAttempts strictly below the cap.
  it("(a) a failed verification increments failed_attempts by exactly one and preserves the validity window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: BASE, max: BASE + 10 * WINDOW_MS }),
        // elapsed since last send: inside the 300s validity window
        fc.integer({ min: 0, max: VALIDITY_MS - 1 }),
        // additional gap so windowStartedAt <= lastSentAt and window not expired
        fc.integer({ min: 0, max: WINDOW_MS - 1 }),
        // failedAttempts strictly below the cap so we stay in INVALID, not LOCKED
        fc.integer({ min: 0, max: OTP_MAX_FAILED_ATTEMPTS - 2 }),
        fc.integer({ min: 0, max: OTP_MAX_RESENDS_PER_WINDOW }),
        (now, sinceSent, windowExtra, failedAttempts, resendCount) => {
          const lastSentAt = now - sinceSent;
          // Keep the window open and anchored no later than the last send.
          const windowStartedAt = Math.min(
            lastSentAt,
            now - ((sinceSent + windowExtra) % WINDOW_MS),
          );

          const state: OtpThrottleState = {
            windowStartedAt,
            failedAttempts,
            resendCount,
            lastSentAt,
            lockedUntil: null,
          };

          const result = evaluateOtpPolicy(state, { type: "VERIFY", matched: false }, now);

          expect(result.decision).toBe("INVALID");
          // Incremented by exactly one.
          expect(result.state.failedAttempts).toBe(failedAttempts + 1);
          // Validity window (last send) and policy window are untouched.
          expect(result.state.lastSentAt).toBe(lastSentAt);
          expect(result.state.windowStartedAt).toBe(windowStartedAt);
          // A failed verify never consumes a resend or sets a lockout here.
          expect(result.state.resendCount).toBe(resendCount);
          expect(result.state.lockedUntil).toBeNull();
        },
      ),
      { numRuns: 25 },
    );
  });

  // ── (b) reaching 5 failed attempts locks out ALL actions for 900s ──
  it("(b) the 5th failed attempt triggers a 900s lockout that blocks all submissions and resends", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: BASE, max: BASE + 10 * WINDOW_MS }),
        fc.integer({ min: 0, max: VALIDITY_MS - 1 }),
        fc.integer({ min: 0, max: WINDOW_MS - 1 }),
        fc.integer({ min: 0, max: OTP_MAX_RESENDS_PER_WINDOW }),
        // how far into the lockout we probe follow-up actions
        fc.integer({ min: 0, max: LOCKOUT_MS - 1 }),
        (now, sinceSent, windowExtra, resendCount, probeOffset) => {
          const lastSentAt = now - sinceSent;
          const windowStartedAt = Math.min(
            lastSentAt,
            now - ((sinceSent + windowExtra) % WINDOW_MS),
          );

          // One below the cap: the next failed verify is the 5th.
          const state: OtpThrottleState = {
            windowStartedAt,
            failedAttempts: OTP_MAX_FAILED_ATTEMPTS - 1,
            resendCount,
            lastSentAt,
            lockedUntil: null,
          };

          const locked = evaluateOtpPolicy(state, { type: "VERIFY", matched: false }, now);

          expect(locked.decision).toBe("LOCKED");
          expect(locked.state.failedAttempts).toBe(OTP_MAX_FAILED_ATTEMPTS);
          expect(locked.state.lockedUntil).toBe(now + LOCKOUT_MS);
          expect(locked.retryAfterSeconds).toBe(OTP_LOCKOUT_SECONDS);

          // While locked, every action type is refused for the full 900s.
          const probe = now + probeOffset; // strictly before lockedUntil
          for (const action of [
            { type: "SEND" } as const,
            { type: "DELIVERY_FAILED" } as const,
            { type: "VERIFY", matched: true } as const,
            { type: "VERIFY", matched: false } as const,
          ]) {
            const blocked = evaluateOtpPolicy(locked.state, action, probe);
            expect(blocked.decision).toBe("LOCKED");
            expect(blocked.state.lockedUntil).toBe(now + LOCKOUT_MS);
            expect(blocked.retryAfterSeconds ?? 0).toBeGreaterThan(0);
          }

          // Once the lockout elapses (>= 900s later) it no longer blocks: a
          // fresh SEND is permitted again.
          const afterLock = evaluateOtpPolicy(locked.state, { type: "SEND" }, now + LOCKOUT_MS);
          expect(afterLock.decision).toBe("SENT");
        },
      ),
      { numRuns: 25 },
    );
  });

  // ── (c) resend permitted iff >=30s since last send AND resendCount < 3 ──
  it("(c) a resend is permitted only when >=30s since last send and fewer than 3 resends in the window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: BASE, max: BASE + 10 * WINDOW_MS }),
        // elapsed since the last send: spans below and above the 30s cooldown
        fc.integer({ min: 0, max: WINDOW_MS - 1 }),
        // resendCount spans below and above the max-3 cap
        fc.integer({ min: 0, max: OTP_MAX_RESENDS_PER_WINDOW + 2 }),
        fc.integer({ min: 0, max: OTP_MAX_FAILED_ATTEMPTS - 1 }),
        (now, sinceSent, resendCount, failedAttempts) => {
          const lastSentAt = now - sinceSent; // non-null => this SEND is a resend
          // Keep the policy window open and anchored at/just before lastSentAt.
          const windowStartedAt = lastSentAt;

          const state: OtpThrottleState = {
            windowStartedAt,
            failedAttempts,
            resendCount,
            lastSentAt,
            lockedUntil: null,
          };

          const result = evaluateOtpPolicy(state, { type: "SEND" }, now);

          const cooldownSatisfied = sinceSent >= COOLDOWN_MS;
          const underResendCap = resendCount < OTP_MAX_RESENDS_PER_WINDOW;
          const permitted = cooldownSatisfied && underResendCap;

          if (permitted) {
            expect(result.decision).toBe("SENT");
            // A permitted resend consumes exactly one resend and refreshes send time.
            expect(result.state.resendCount).toBe(resendCount + 1);
            expect(result.state.lastSentAt).toBe(now);
          } else {
            // Blocked resends do not send and do not mutate the counters.
            expect(result.decision).not.toBe("SENT");
            if (!cooldownSatisfied) {
              expect(result.decision).toBe("COOLDOWN");
            } else {
              expect(result.decision).toBe("RESEND_EXCEEDED");
            }
            expect(result.state.resendCount).toBe(resendCount);
            expect(result.state.lastSentAt).toBe(lastSentAt);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  // ── (d) delivery failure never consumes a resend ──
  // Over ANY prior state and clock, a DELIVERY_FAILED action leaves resend_count
  // (and the rest of the persisted state) untouched.
  const arbTimestampOrNull = fc.oneof(
    fc.constant(null),
    fc.integer({ min: BASE - 5 * WINDOW_MS, max: BASE + 5 * WINDOW_MS }),
  );

  const arbState: fc.Arbitrary<OtpThrottleState> = fc.record({
    windowStartedAt: arbTimestampOrNull,
    failedAttempts: fc.integer({ min: 0, max: 10 }),
    resendCount: fc.integer({ min: 0, max: 10 }),
    lastSentAt: arbTimestampOrNull,
    lockedUntil: arbTimestampOrNull,
  });

  it("(d) a delivery-failure leaves resend_count unchanged (does not consume a resend)", () => {
    fc.assert(
      fc.property(
        arbState,
        fc.integer({ min: BASE - 5 * WINDOW_MS, max: BASE + 6 * WINDOW_MS }),
        (state, now) => {
          const result = evaluateOtpPolicy(state, { type: "DELIVERY_FAILED" }, now);

          // resend_count is never consumed by a delivery failure.
          expect(result.state.resendCount).toBe(state.resendCount);
          // Nor are the other throttle counters mutated by a delivery failure.
          expect(result.state.failedAttempts).toBe(state.failedAttempts);
          expect(result.state.lastSentAt).toBe(state.lastSentAt);
          expect(result.state.windowStartedAt).toBe(state.windowStartedAt);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ============================================================================
// Feature: customer-mobile-onboarding, Property 3: OTP validity window
//
// Property 3: OTP validity window
// For any passcode generation time and any check time, a submitted passcode is
// treated as within its validity window IFF (checkTime - generationTime) < 300
// seconds; outside the window the submission is rejected as EXPIRED and no
// session is established.
//
// Validates: Requirements 2.3, 2.6
// ============================================================================

/**
 * A throttle state representing "a passcode was just sent at `sentAt`" with no
 * accumulated failures and no lockout, so the VERIFY decision is governed
 * solely by the validity window (isolating Property 3 from the throttle
 * machinery covered by Property 4).
 */
function freshlySentState(sentAt: number): OtpThrottleState {
  return {
    windowStartedAt: sentAt,
    failedAttempts: 0,
    resendCount: 0,
    lastSentAt: sentAt,
    lockedUntil: null,
  };
}

describe("Property 3: OTP validity window", () => {
  // Generation time as a positive epoch (ms), anchored around BASE so that
  // generationTime + delta stays a realistic, non-negative timestamp.
  const arbGenerationTime = fc.integer({ min: BASE, max: BASE + 10 * WINDOW_MS });
  // Elapsed time between generation and check, spanning both sides of the 300s
  // boundary: 0s .. 1000s (inside-window, at-boundary, and expired cases).
  const arbDeltaMs = fc.integer({ min: 0, max: 1_000 * SECOND_MS });

  it("treats a passcode as valid IFF (checkTime - generationTime) < 300s; otherwise EXPIRED with no session", () => {
    fc.assert(
      fc.property(
        arbGenerationTime,
        arbDeltaMs,
        fc.boolean(), // whether the underlying code matched
        (generationTime, deltaMs, matched) => {
          const checkTime = generationTime + deltaMs;
          const state = freshlySentState(generationTime);

          const result = evaluateOtpPolicy(
            state,
            { type: "VERIFY", matched },
            checkTime,
          );

          const withinWindow = deltaMs < VALIDITY_MS;

          if (!withinWindow) {
            // Outside the validity window: always rejected as expired and no
            // session is established, regardless of whether the code matched.
            expect(result.decision).toBe("EXPIRED");
            expect(result.decision).not.toBe("OK");
          } else if (matched) {
            // Inside the window with a matching code: session established.
            expect(result.decision).toBe("OK");
          } else {
            // Inside the window with a non-matching code: rejected as invalid,
            // NOT expired — the window is still open.
            expect(result.decision).toBe("INVALID");
            expect(result.decision).not.toBe("OK");
          }

          // Bi-conditional restated: EXPIRED occurs exactly when out-of-window.
          expect(result.decision === "EXPIRED").toBe(!withinWindow);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("rejects at the exact 300s boundary (delta == 300s is expired, delta == 300s - 1ms is not)", () => {
    fc.assert(
      fc.property(arbGenerationTime, (generationTime) => {
        const state = freshlySentState(generationTime);

        // Exactly at the boundary: 300s elapsed → expired (window is [0, 300s)).
        const atBoundary = evaluateOtpPolicy(
          state,
          { type: "VERIFY", matched: true },
          generationTime + VALIDITY_MS,
        );
        expect(atBoundary.decision).toBe("EXPIRED");

        // Just inside the boundary: 300s - 1ms elapsed → still valid.
        const justInside = evaluateOtpPolicy(
          state,
          { type: "VERIFY", matched: true },
          generationTime + VALIDITY_MS - 1,
        );
        expect(justInside.decision).toBe("OK");
      }),
      { numRuns: 25 },
    );
  });
});
