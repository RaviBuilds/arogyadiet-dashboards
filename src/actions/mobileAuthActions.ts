"use server";

// src/actions/mobileAuthActions.ts
// Customer-portal server actions that orchestrate the mobile-first OTP login
// flow (customer-mobile-onboarding, Task 8.2).
//
// LAYERING: orchestration layer. These actions are the thin server boundary the
// login UI (Task 10.1) calls. They compose two pieces of already-implemented
// logic and add NO new policy of their own:
//
//   1. `EligibilityChecker.check` (src/services) decides — BEFORE any OTP is
//      sent — whether the submitted mobile maps to exactly one CUSTOMER record
//      in an allowed onboarding state (Req 3.1/3.4/12.1-12.4). On any
//      non-eligible outcome these actions return the mapped, user-facing
//      message and never reach the OTP service, so no passcode is sent and no
//      session is created (Req 3.4/12.1/12.2).
//   2. `OtpLoginService` (src/services) wraps Supabase phone OTP and applies the
//      pure throttle/validity policy, returning typed statuses
//      (SENT/COOLDOWN/LOCKED/RESEND_EXCEEDED/SEND_FAILED for send;
//      OK/INVALID/EXPIRED/LOCKED for verify) with an optional retry hint.
//
// Session establishment: `OtpLoginService.verifyOtp` calls Supabase
// `verifyOtp`, which — via the SSR server client — sets the session cookies on
// success. Per Task 8.2 these actions do NOT redirect; `verifyOtpAction`
// returns `{ outcome: "OK" }` so the client can perform the navigation to the
// customer dashboard itself.
//
// SECURITY: Server Actions are reachable via direct POST, not only through the
// UI (see Next.js "Mutating Data" guidance). The eligibility gate here is that
// authorization check for the login surface — an unregistered/ambiguous/bad
// mobile is rejected before any OTP send regardless of how the action is
// invoked (Req 12.1).
//
// Requirements: 2.2, 2.4, 2.5, 2.6, 2.9, 2.10, 3.1, 3.4, 12.1, 12.2, 12.3, 12.4

import {
  EligibilityChecker,
  type EligibilityReason,
} from "@/services/EligibilityChecker";
import { OtpLoginService } from "@/services/OtpLoginService";

// ---------------------------------------------------------------------------
// User-facing messages
// ---------------------------------------------------------------------------

/**
 * Map an eligibility rejection reason to the message the login screen shows.
 *
 *   - `NOT_REGISTERED` / `BAD_STATUS` → "please contact admin" (Req 3.4): the
 *     mobile is not associated with a usable Customer_Record, so the customer
 *     must be (re)onboarded by an admin. The two reasons collapse to the same
 *     message deliberately — we do not disclose account-state details to an
 *     unauthenticated caller.
 *   - `INVALID_FORMAT` → format guidance (Req 3.2).
 *   - `AMBIGUOUS` → resolution guidance (Req 3.6/12.4): more than one record
 *     shares the mobile and must be resolved before login can proceed.
 */
const ELIGIBILITY_MESSAGES: Record<EligibilityReason, string> = {
  INVALID_FORMAT: "Please enter a valid 10-digit mobile number.",
  NOT_REGISTERED: "please contact admin",
  BAD_STATUS: "please contact admin",
  AMBIGUOUS:
    "This account needs to be resolved before login can proceed. Please contact admin.",
};

/** Messages for OTP send-side throttle / delivery outcomes. */
const SEND_STATUS_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof OtpLoginService.requestOtp>>["status"],
    "SENT"
  >,
  string
> = {
  COOLDOWN: "Please wait before requesting another code.",
  RESEND_EXCEEDED:
    "You've requested too many codes. Please wait before trying again.",
  LOCKED: "Too many attempts. Login is temporarily locked. Please try later.",
  SEND_FAILED: "We couldn't send the code right now. Please try again.",
};

/** Messages for OTP verify-side outcomes. */
const VERIFY_STATUS_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof OtpLoginService.verifyOtp>>["status"],
    "OK"
  >,
  string
> = {
  INVALID: "The code you entered is incorrect. Please try again.",
  EXPIRED: "This code has expired. Please request a new one.",
  LOCKED: "Too many attempts. Login is temporarily locked. Please try later.",
};

// ---------------------------------------------------------------------------
// Action result types (all fields are plain-serializable for the RSC boundary)
// ---------------------------------------------------------------------------

/**
 * Outcome of `requestOtpAction` / `resendOtpAction`.
 *
 *   - `SENT`         — a passcode was delivered; the UI reveals OTP entry.
 *   - `NOT_ELIGIBLE` — the eligibility gate rejected the mobile; no OTP sent.
 *                      `reason` carries the machine code, `message` the copy.
 *   - `THROTTLED`    — a send was blocked by cooldown / resend cap / lockout.
 *                      `retryAfterSeconds` (when present) tells the UI when the
 *                      action becomes available again.
 *   - `SEND_FAILED`  — Supabase could not deliver the passcode (no resend
 *                      consumed).
 */
export type RequestOtpActionResult =
  | { outcome: "SENT" }
  | { outcome: "NOT_ELIGIBLE"; reason: EligibilityReason; message: string }
  | {
      outcome: "THROTTLED";
      status: "COOLDOWN" | "RESEND_EXCEEDED" | "LOCKED";
      message: string;
      retryAfterSeconds?: number;
    }
  | { outcome: "SEND_FAILED"; message: string };

/**
 * Outcome of `verifyOtpAction`.
 *
 *   - `OK`      — the passcode matched and the Supabase session is established;
 *                 the client should redirect to the customer dashboard.
 *   - `INVALID` — wrong passcode (failed-attempt counter incremented).
 *   - `EXPIRED` — passcode outside its validity window.
 *   - `LOCKED`  — the mobile is locked out; `retryAfterSeconds` when known.
 */
export type VerifyOtpActionResult =
  | { outcome: "OK" }
  | { outcome: "INVALID"; message: string }
  | { outcome: "EXPIRED"; message: string }
  | { outcome: "LOCKED"; message: string; retryAfterSeconds?: number };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run the eligibility gate and, when the mobile is eligible, delegate to the
 * OTP send service, translating its typed status into an action result.
 *
 * Shared by {@link requestOtpAction} and {@link resendOtpAction}: both run the
 * eligibility check first (Req 3.1/3.4/12.1) and then send/resend, since a
 * resend must also be denied for a mobile that is no longer eligible.
 */
async function checkEligibilityThenSend(
  mobile: string,
  send: (mobile: string) => ReturnType<typeof OtpLoginService.requestOtp>,
): Promise<RequestOtpActionResult> {
  // Gate: eligibility is decided before any OTP is sent. On rejection we return
  // the mapped message and never call the OTP service (Req 3.4/12.1/12.2).
  const eligibility = await EligibilityChecker.check(mobile);
  if (!eligibility.eligible) {
    return {
      outcome: "NOT_ELIGIBLE",
      reason: eligibility.reason,
      message: ELIGIBILITY_MESSAGES[eligibility.reason],
    };
  }

  // Eligible: request (or resend) the passcode. The service owns the throttle
  // and validity policy and only reports SENT after Supabase confirms delivery.
  const result = await send(mobile);

  if (result.status === "SENT") {
    return { outcome: "SENT" };
  }

  if (result.status === "SEND_FAILED") {
    return {
      outcome: "SEND_FAILED",
      message: SEND_STATUS_MESSAGES.SEND_FAILED,
    };
  }

  // Remaining statuses are throttle outcomes (cooldown / cap / lockout).
  return {
    outcome: "THROTTLED",
    status: result.status,
    message: SEND_STATUS_MESSAGES[result.status],
    ...(result.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: result.retryAfterSeconds }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Public server actions
// ---------------------------------------------------------------------------

/**
 * Step 1 of login: the customer submits a mobile number via "Next".
 *
 * Normalizes + validates the mobile and runs the eligibility check (both inside
 * `EligibilityChecker.check`). If the mobile is not eligible, returns the mapped
 * message WITHOUT sending an OTP (Req 3.4/12.1). If eligible, requests a
 * passcode through the OTP service and returns its typed status.
 *
 * Validates: Requirements 2.2, 2.5, 2.6, 2.9, 2.10, 3.1, 3.4, 12.1, 12.2, 12.4.
 *
 * @param mobile Raw, human-entered mobile number.
 */
export async function requestOtpAction(
  mobile: string,
): Promise<RequestOtpActionResult> {
  return checkEligibilityThenSend(mobile, OtpLoginService.requestOtp);
}

/**
 * Step 2 of login: the customer submits the 6-digit passcode.
 *
 * Delegates to `OtpLoginService.verifyOtp`, which verifies the code against
 * Supabase phone OTP and, on a match, establishes the Supabase session (the SSR
 * server client persists the session cookies). On `OK` this returns success so
 * the client can redirect to the customer dashboard (Req 2.4/2.6); otherwise it
 * returns the corresponding failure with a user-facing message.
 *
 * Validates: Requirements 2.4, 2.6.
 *
 * @param mobile Raw, human-entered mobile number.
 * @param code   The 6-digit passcode submitted by the customer.
 */
export async function verifyOtpAction(
  mobile: string,
  code: string,
): Promise<VerifyOtpActionResult> {
  const result = await OtpLoginService.verifyOtp(mobile, code);

  if (result.status === "OK") {
    // Session is established by the service via Supabase. The client redirects.
    return { outcome: "OK" };
  }

  if (result.status === "LOCKED") {
    return {
      outcome: "LOCKED",
      message: VERIFY_STATUS_MESSAGES.LOCKED,
      ...(result.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: result.retryAfterSeconds }
        : {}),
    };
  }

  // INVALID or EXPIRED.
  return {
    outcome: result.status,
    message: VERIFY_STATUS_MESSAGES[result.status],
  };
}

/**
 * Resend the passcode for a mobile that is mid-login.
 *
 * Re-runs the eligibility check (a mobile that is no longer eligible must not be
 * able to resend — Req 3.4/12.1) and then delegates to
 * `OtpLoginService.resendOtp`, which applies the 30s cooldown and the
 * max-3-resends-per-window cap.
 *
 * Validates: Requirements 2.5, 2.9, 2.10, 3.1, 3.4, 12.1.
 *
 * @param mobile Raw, human-entered mobile number.
 */
export async function resendOtpAction(
  mobile: string,
): Promise<RequestOtpActionResult> {
  return checkEligibilityThenSend(mobile, OtpLoginService.resendOtp);
}
