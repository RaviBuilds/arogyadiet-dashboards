/**
 * OTP login policy state machine (pure, deterministic).
 *
 * Spec: customer-mobile-onboarding — Task 3.3
 * Requirements: 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10
 *
 * This module owns the *policy* semantics of the mobile OTP login flow. SMS
 * delivery, code generation, and code matching are performed by Supabase Auth;
 * this function only decides — given a persisted throttle record and the current
 * clock — whether a send / resend / verify is permitted and what the next
 * throttle state should be.
 *
 * It is a pure function of `(state, action, now)`, so it is fully deterministic
 * and property-testable independent of Supabase or any I/O.
 *
 * Timekeeping: all timestamps (`now` and the `*At` fields on the state) are
 * epoch milliseconds. The `otpThrottleRepository` is responsible for converting
 * between these numbers and the `TIMESTAMPTZ` columns of `otp_login_throttle`
 * (`window_started_at`, `failed_attempts`, `resend_count`, `last_sent_at`,
 * `locked_until`).
 *
 * Commit contract for the `SEND` action (Requirement 2.8): the returned
 * `state` for a `SENT` decision MUST be persisted by the caller ONLY after the
 * SMS is confirmed delivered. If delivery fails, the caller keeps the prior
 * state (or evaluates a `DELIVERY_FAILED` action, which returns the state
 * unchanged) so that a delivery failure never consumes a resend.
 */

// ---------------------------------------------------------------------------
// Policy constants (Requirements 2.3, 2.5, 2.7, 2.9)
// ---------------------------------------------------------------------------

/** A generated passcode is valid for 300 seconds from the time it was sent. (Req 2.3, 2.6) */
export const OTP_VALIDITY_SECONDS = 300;

/** Reaching the failed-attempt cap locks the mobile for 900 seconds. (Req 2.7) */
export const OTP_LOCKOUT_SECONDS = 900;

/** Number of failed verifications within a window that triggers a lockout. (Req 2.5, 2.7) */
export const OTP_MAX_FAILED_ATTEMPTS = 5;

/** Minimum gap enforced between two consecutive sends/resends. (Req 2.9, 2.10) */
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

/** Maximum number of resends permitted within a single policy window. (Req 2.9, 2.10) */
export const OTP_MAX_RESENDS_PER_WINDOW = 3;

/** Length of the rolling policy window used for resend + attempt counting. (Req 2.7, 2.9) */
export const OTP_WINDOW_SECONDS = 900;

const SECOND_MS = 1_000;
const OTP_VALIDITY_MS = OTP_VALIDITY_SECONDS * SECOND_MS;
const OTP_LOCKOUT_MS = OTP_LOCKOUT_SECONDS * SECOND_MS;
const OTP_RESEND_COOLDOWN_MS = OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS;
const OTP_WINDOW_MS = OTP_WINDOW_SECONDS * SECOND_MS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Persisted throttle record for a single mobile number. Mirrors the
 * `otp_login_throttle` table columns (timestamps as epoch milliseconds).
 */
export interface OtpThrottleState {
  /** Start of the current rolling 900s policy window (`window_started_at`). */
  windowStartedAt: number | null;
  /** Failed verifications accumulated in the current window (`failed_attempts`). */
  failedAttempts: number;
  /** Resends issued in the current window, excluding the first send (`resend_count`). */
  resendCount: number;
  /** Timestamp of the most recent passcode send (`last_sent_at`). Drives validity + cooldown. */
  lastSentAt: number | null;
  /** When set and in the future, all sends and verifies are blocked (`locked_until`). */
  lockedUntil: number | null;
}

/**
 * The event being evaluated against the current throttle state.
 * - `SEND`: a request to send a passcode. The first send in a window is free;
 *   any subsequent send is treated as a resend subject to cooldown + cap.
 * - `DELIVERY_FAILED`: the SMS provider reported the passcode could not be
 *   delivered. Leaves the throttle state unchanged (Requirement 2.8).
 * - `VERIFY`: the customer submitted a passcode. `matched` reflects whether the
 *   underlying code matched (as determined by Supabase Auth).
 */
export type OtpAction =
  | { type: "SEND" }
  | { type: "DELIVERY_FAILED" }
  | { type: "VERIFY"; matched: boolean };

/** Decision returned for `SEND` / `DELIVERY_FAILED` actions. */
export type OtpSendDecision =
  | "SENT"
  | "COOLDOWN"
  | "RESEND_EXCEEDED"
  | "LOCKED"
  | "SEND_FAILED";

/** Decision returned for `VERIFY` actions. */
export type OtpVerifyDecision = "OK" | "INVALID" | "EXPIRED" | "LOCKED";

export type OtpDecision = OtpSendDecision | OtpVerifyDecision;

export interface OtpPolicyResult {
  /** The policy decision for the evaluated action. */
  decision: OtpDecision;
  /** The throttle state to persist for this decision (see commit contract for `SENT`). */
  state: OtpThrottleState;
  /** Seconds the caller must wait before the blocked action is permitted, when applicable. */
  retryAfterSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A pristine throttle state anchored at `now` (no code sent, no lockout). */
export function initialOtpThrottleState(now: number): OtpThrottleState {
  return {
    windowStartedAt: now,
    failedAttempts: 0,
    resendCount: 0,
    lastSentAt: null,
    lockedUntil: null,
  };
}

/** Whole seconds remaining until `deadline`, never negative. */
function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / SECOND_MS));
}

/** True when the rolling policy window has elapsed (or was never started). */
function isWindowExpired(state: OtpThrottleState, now: number): boolean {
  return state.windowStartedAt === null || now - state.windowStartedAt >= OTP_WINDOW_MS;
}

/** True when the current passcode is still inside its 300s validity window. (Req 2.3) */
function isWithinValidityWindow(state: OtpThrottleState, now: number): boolean {
  return state.lastSentAt !== null && now - state.lastSentAt < OTP_VALIDITY_MS;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleSend(working: OtpThrottleState, now: number): OtpPolicyResult {
  // The first send in a window is not counted against the resend cap. (Req 2.9)
  const isFirstSend = working.lastSentAt === null;
  if (isFirstSend) {
    return {
      decision: "SENT",
      state: {
        ...working,
        windowStartedAt: working.windowStartedAt ?? now,
        lastSentAt: now,
      },
      retryAfterSeconds: null,
    };
  }

  // Every subsequent send is a resend: enforce the 30s cooldown first. (Req 2.9, 2.10)
  const elapsedSinceLastSend = now - (working.lastSentAt as number);
  if (elapsedSinceLastSend < OTP_RESEND_COOLDOWN_MS) {
    return {
      decision: "COOLDOWN",
      state: working,
      retryAfterSeconds: secondsUntil((working.lastSentAt as number) + OTP_RESEND_COOLDOWN_MS, now),
    };
  }

  // Then enforce the max-3-resends-per-window cap. (Req 2.9, 2.10)
  if (working.resendCount >= OTP_MAX_RESENDS_PER_WINDOW) {
    const windowEnd = (working.windowStartedAt ?? now) + OTP_WINDOW_MS;
    return {
      decision: "RESEND_EXCEEDED",
      state: working,
      retryAfterSeconds: secondsUntil(windowEnd, now),
    };
  }

  // Permitted resend: consume one resend and refresh the validity window.
  return {
    decision: "SENT",
    state: {
      ...working,
      resendCount: working.resendCount + 1,
      lastSentAt: now,
    },
    retryAfterSeconds: null,
  };
}

function handleVerify(working: OtpThrottleState, matched: boolean, now: number): OtpPolicyResult {
  // A passcode outside its 300s validity window (or absent) is expired. (Req 2.6)
  if (!isWithinValidityWindow(working, now)) {
    return { decision: "EXPIRED", state: working, retryAfterSeconds: null };
  }

  // A correct, in-window passcode establishes the session and resets throttling. (Req 2.4)
  if (matched) {
    return { decision: "OK", state: initialOtpThrottleState(now), retryAfterSeconds: null };
  }

  // An incorrect passcode increments the failed-attempt count by exactly one and
  // preserves the current validity window. (Req 2.5)
  const failedAttempts = working.failedAttempts + 1;

  // Reaching the cap locks the mobile for 900s, blocking further sends/verifies. (Req 2.7)
  if (failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    return {
      decision: "LOCKED",
      state: { ...working, failedAttempts, lockedUntil: now + OTP_LOCKOUT_MS },
      retryAfterSeconds: OTP_LOCKOUT_SECONDS,
    };
  }

  return {
    decision: "INVALID",
    state: { ...working, failedAttempts },
    retryAfterSeconds: null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate the OTP login policy for a single action against the persisted
 * throttle state at time `now` (epoch ms).
 *
 * The function first applies the lockout gate, then rolls an expired window /
 * clears an expired lockout, then dispatches on the action.
 *
 * @param state Current persisted throttle record for the mobile number.
 * @param action The send / resend / verify / delivery-failure event.
 * @param now Current time in epoch milliseconds.
 */
export function evaluateOtpPolicy(
  state: OtpThrottleState,
  action: OtpAction,
  now: number,
): OtpPolicyResult {
  // 1. Active lockout blocks every action until it expires. (Req 2.7)
  if (state.lockedUntil !== null && now < state.lockedUntil) {
    return {
      decision: "LOCKED",
      state,
      retryAfterSeconds: secondsUntil(state.lockedUntil, now),
    };
  }

  // 2. Normalize the window: an expired lockout or an elapsed 900s window resets
  //    the failed-attempt and resend counters for a fresh cycle. (Req 2.7, 2.9)
  const lockoutJustExpired = state.lockedUntil !== null && now >= state.lockedUntil;
  const working: OtpThrottleState =
    lockoutJustExpired || isWindowExpired(state, now) ? initialOtpThrottleState(now) : state;

  // 3. Dispatch.
  switch (action.type) {
    case "SEND":
      return handleSend(working, now);
    case "DELIVERY_FAILED":
      // Delivery failure never consumes a resend or mutates counters. (Req 2.8)
      return { decision: "SEND_FAILED", state, retryAfterSeconds: null };
    case "VERIFY":
      return handleVerify(working, action.matched, now);
  }
}
