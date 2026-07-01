// src/services/OtpLoginService.ts
// Application service that wraps Supabase phone-OTP auth and applies the pure
// OTP login policy (customer-mobile-onboarding, Task 6.3).
//
// LAYERING: business service. This module is the thin orchestration boundary
// described in the design ("Notes on the OTP orchestration boundary"):
//
//   - Supabase Auth (phone provider) performs SMS delivery, code generation,
//     and code verification. `shouldCreateUser: false` guarantees a mobile with
//     no pre-provisioned auth identity cannot self-register (Req 12.1) — the
//     onboarding step is the only path that creates the phone identity.
//   - The pure `evaluateOtpPolicy` state machine (src/lib/otp/otpPolicy.ts) owns
//     the exact policy semantics: 300s validity window, 5-attempt/900s lockout,
//     30s resend cooldown, and max-3-resends/900s window.
//   - `otpThrottleRepository` persists the throttle record keyed by normalized
//     mobile (service-role only, RLS-protected table).
//
// COMMIT CONTRACT (Req 2.8): the SENT throttle state is persisted ONLY after the
// SMS send is confirmed by Supabase. On a delivery failure the prior state is
// kept (evaluated via the `DELIVERY_FAILED` action, which is a no-op on state)
// so a delivery failure never consumes a resend.
//
// Requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.3, 3.6

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { normalizeMobile } from "@/lib/mobile/normalizeMobile";
import {
  evaluateOtpPolicy,
  initialOtpThrottleState,
  type OtpSendDecision,
  type OtpVerifyDecision,
  type OtpThrottleState,
} from "@/lib/otp/otpPolicy";
import { getThrottle, saveThrottle } from "@/repositories/otpThrottleRepository";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/**
 * Result of a passcode send / resend request.
 *
 *   - `SENT`             — a passcode was delivered; the customer may now verify.
 *   - `COOLDOWN`         — a resend was requested inside the 30s cooldown.
 *   - `RESEND_EXCEEDED`  — the max-3-resends-per-window cap was hit.
 *   - `LOCKED`           — the mobile is locked out after too many failed verifies.
 *   - `SEND_FAILED`      — Supabase could not deliver the SMS (no resend consumed).
 *
 * `retryAfterSeconds` is populated for `COOLDOWN`, `RESEND_EXCEEDED`, and
 * `LOCKED` to tell the UI when the blocked action becomes available again.
 */
export interface RequestOtpResult {
  status: OtpSendDecision;
  retryAfterSeconds?: number;
}

/**
 * Result of a passcode verification.
 *
 *   - `OK`      — the passcode matched; a session has been established.
 *   - `INVALID` — the passcode did not match (failed-attempt counter incremented).
 *   - `EXPIRED` — the passcode is outside its 300s validity window.
 *   - `LOCKED`  — the mobile is (now) locked out for 900s.
 *
 * `retryAfterSeconds` is populated for `LOCKED`.
 */
export interface VerifyOtpResult {
  status: OtpVerifyDecision;
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a canonical 10-digit Indian mobile number to the E.164 form Supabase
 * Auth expects for the phone provider (`+91XXXXXXXXXX`).
 */
function toE164(normalizedMobile: string): string {
  return `+91${normalizedMobile}`;
}

/** Resolve the Supabase client, preferring an injected one (used only for wiring). */
async function resolveClient(client?: SupabaseClient): Promise<SupabaseClient> {
  return client ?? (await createClient());
}

/**
 * Load the persisted throttle state for a mobile, seeding a pristine state when
 * no record exists yet (first-ever interaction for this number).
 */
async function loadState(mobile: string, now: number): Promise<OtpThrottleState> {
  const existing = await getThrottle(mobile);
  return existing ?? initialOtpThrottleState(now);
}

/** Strip a `null` retry value so the field is simply absent when not applicable. */
function withRetry<T extends { status: string }>(
  base: T,
  retryAfterSeconds: number | null,
): T & { retryAfterSeconds?: number } {
  return retryAfterSeconds === null ? base : { ...base, retryAfterSeconds };
}

// ---------------------------------------------------------------------------
// Send / resend
// ---------------------------------------------------------------------------

/**
 * Request a passcode for `mobile`. Handles both the initial send and resends —
 * the pure policy decides which (the first send in a window is free; subsequent
 * sends are resends subject to the 30s cooldown and 3-per-window cap).
 *
 * The SENT throttle state is committed only after Supabase confirms the send
 * (Req 2.8); a delivery failure returns `SEND_FAILED` without consuming a resend.
 *
 * @param mobile Raw or normalized mobile number (normalized internally).
 * @param client Optional Supabase client override (for wiring/tests).
 */
export async function requestOtp(
  mobile: string,
  client?: SupabaseClient,
): Promise<RequestOtpResult> {
  const normalized = normalizeMobile(mobile);
  if (!normalized.ok) {
    // Upstream (mobileAuthActions + EligibilityChecker) validates format before
    // reaching this service; treat a stray invalid value defensively as an
    // undeliverable send rather than sending to a malformed number.
    return { status: "SEND_FAILED" };
  }

  const now = Date.now();
  const state = await loadState(normalized.value, now);
  const decision = evaluateOtpPolicy(state, { type: "SEND" }, now);

  // Blocked before any SMS attempt (cooldown / cap / lockout): nothing to send,
  // state is unchanged so there is nothing to persist.
  if (decision.decision !== "SENT") {
    return withRetry(
      { status: decision.decision as OtpSendDecision },
      decision.retryAfterSeconds,
    );
  }

  // Policy permits a send. Attempt SMS delivery via Supabase phone OTP.
  const supabase = await resolveClient(client);
  const { error } = await supabase.auth.signInWithOtp({
    phone: toE164(normalized.value),
    options: { shouldCreateUser: false },
  });

  if (error) {
    // Delivery failed: DELIVERY_FAILED is a no-op on the throttle state, so the
    // prior state stands and no resend is consumed (Req 2.8). Do NOT persist.
    const failed = evaluateOtpPolicy(state, { type: "DELIVERY_FAILED" }, now);
    return { status: failed.decision as OtpSendDecision };
  }

  // Delivery confirmed: commit the SENT state (resend count / validity window).
  await saveThrottle(normalized.value, decision.state);
  return { status: "SENT" };
}

/**
 * Resend a passcode for `mobile`. This is semantically identical to
 * {@link requestOtp}: the pure policy classifies a send as a resend based on the
 * persisted state (a prior send in the current window), applying the 30s
 * cooldown and 3-per-window cap. Exposed separately to match the login UI's
 * explicit "Resend" affordance.
 *
 * @param mobile Raw or normalized mobile number (normalized internally).
 * @param client Optional Supabase client override (for wiring/tests).
 */
export async function resendOtp(
  mobile: string,
  client?: SupabaseClient,
): Promise<RequestOtpResult> {
  return requestOtp(mobile, client);
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a submitted passcode for `mobile`.
 *
 * The pure policy is consulted twice around the Supabase call:
 *   1. A gate probe (evaluated as if the code matched) surfaces the
 *      match-independent outcomes — an active lockout (`LOCKED`) or an expired
 *      passcode (`EXPIRED`) — so Supabase is not called when it cannot succeed.
 *   2. When the gate is clear, Supabase `verifyOtp` establishes (or rejects) the
 *      session, and the real match result is fed back through the policy to
 *      derive the final decision and the throttle state to persist (a match
 *      resets throttling; a miss increments failed attempts and may lock out).
 *
 * @param mobile Raw or normalized mobile number (normalized internally).
 * @param code   The 6-digit passcode submitted by the customer.
 * @param client Optional Supabase client override (for wiring/tests).
 */
export async function verifyOtp(
  mobile: string,
  code: string,
  client?: SupabaseClient,
): Promise<VerifyOtpResult> {
  const normalized = normalizeMobile(mobile);
  if (!normalized.ok) {
    // Defensive: a malformed mobile cannot correspond to any pending passcode.
    return { status: "INVALID" };
  }

  const now = Date.now();
  const state = await loadState(normalized.value, now);

  // Gate probe: evaluating with `matched: true` returns exactly the
  // match-independent outcomes — LOCKED (pre-existing lockout) or EXPIRED
  // (outside the validity window) — or OK when a real match would be accepted.
  const gate = evaluateOtpPolicy(state, { type: "VERIFY", matched: true }, now);
  if (gate.decision === "LOCKED" || gate.decision === "EXPIRED") {
    // Match-independent rejection: no Supabase call, state left unchanged.
    return withRetry(
      { status: gate.decision as OtpVerifyDecision },
      gate.retryAfterSeconds,
    );
  }

  // Gate is clear (within validity, not locked): perform the real verification.
  const supabase = await resolveClient(client);
  const { error } = await supabase.auth.verifyOtp({
    phone: toE164(normalized.value),
    token: code,
    type: "sms",
  });
  const matched = !error;

  // Feed the real match result back through the policy for the final decision
  // and the throttle state to persist (reset on OK; increment/lock on miss).
  const result = evaluateOtpPolicy(state, { type: "VERIFY", matched }, now);
  await saveThrottle(normalized.value, result.state);

  return withRetry(
    { status: result.decision as OtpVerifyDecision },
    result.retryAfterSeconds,
  );
}

// ---------------------------------------------------------------------------
// Bundled service object (for call sites that prefer a namespaced import)
// ---------------------------------------------------------------------------

export const OtpLoginService = {
  requestOtp,
  resendOtp,
  verifyOtp,
} as const;
