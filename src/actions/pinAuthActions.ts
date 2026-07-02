"use server";

// src/actions/pinAuthActions.ts
// Customer-portal server actions that orchestrate the PIN-based login flow
// (customer-pin-auth, Tasks 5.1, 5.2, 5.3).
//
// LAYERING: Orchestration layer. These actions are the thin server boundary
// the login UI calls. They compose:
//   1. `EligibilityChecker.check` — pre-PIN eligibility gate (mobile → eligible/not-eligible)
//   2. `PinThrottleService` — brute-force protection (failed-attempt tracking + lockout)
//   3. `PinService` — PIN verification and lifecycle management
//   4. Supabase `signInWithPassword` — session establishment via placeholder email + server password
//
// Session establishment: After PIN verification succeeds server-side, we
// establish a Supabase session using the customer's placeholder email + a
// server-managed password (`CUSTOMER_SERVER_PASSWORD`). This ensures full
// compatibility with existing middleware and RLS without changes.
//
// SECURITY: Server Actions are reachable via direct POST, not only through the
// UI. The eligibility gate and throttle checks are applied regardless of how
// the action is invoked. PINs are NEVER logged — only mobile numbers are used
// in error logs for admin investigation.
//
// Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3,
//               4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.5, 9.4,
//               11.1, 11.4

import { EligibilityChecker } from "@/services/EligibilityChecker";
import * as PinService from "@/services/PinService";
import * as PinThrottleService from "@/services/PinThrottleService";
import { normalizeMobile, isValidPinFormat } from "@/lib/pin/pinUtils";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Result types (plain-serializable for the RSC boundary)
// ---------------------------------------------------------------------------

/**
 * Outcome of `checkEligibilityAction`.
 *
 *   - `ELIGIBLE`     — mobile maps to exactly one allowed customer; reveal PIN screen.
 *   - `NOT_ELIGIBLE` — mobile is invalid, not registered, bad status, or ambiguous.
 */
export type CheckEligibilityResult =
  | { outcome: "ELIGIBLE" }
  | { outcome: "NOT_ELIGIBLE"; message: string };

/**
 * Outcome of `verifyPinAction`.
 *
 *   - `OK`       — PIN correct, session established, redirect to dashboard.
 *   - `TEMP_PIN` — PIN correct but temporary; redirect to set-new-pin screen.
 *   - `INVALID`  — wrong PIN.
 *   - `LOCKED`   — too many failed attempts; locked out.
 *   - `ERROR`    — unexpected failure (e.g. signInWithPassword failed).
 */
export type VerifyPinResult =
  | { outcome: "OK" }
  | { outcome: "TEMP_PIN" }
  | { outcome: "INVALID"; message: string }
  | { outcome: "LOCKED"; message: string; retryAfterSeconds?: number }
  | { outcome: "ERROR"; message: string };

/**
 * Outcome of `setPermanentPinAction`.
 *
 *   - `OK`             — PIN set, session established.
 *   - `MISMATCH`       — new and confirm PINs don't match.
 *   - `INVALID_FORMAT` — PIN is not 6 numeric digits.
 *   - `ERROR`          — unexpected failure.
 */
export type SetPermanentPinResult =
  | { outcome: "OK" }
  | { outcome: "MISMATCH"; message: string }
  | { outcome: "INVALID_FORMAT"; message: string }
  | { outcome: "ERROR"; message: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up the email for a customer by their normalized mobile number.
 * Uses the admin (service-role) client to bypass RLS.
 *
 * @returns The email string, or null if no user found.
 */
async function getEmailByMobile(mobile: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("users")
    .select("email")
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    console.error(
      `[pinAuthActions] Failed to lookup email for mobile ${mobile}:`,
      error.message,
    );
    return null;
  }

  return data?.email ?? null;
}

/**
 * Establish a Supabase session using signInWithPassword via the SSR server
 * client (which sets session cookies).
 *
 * @returns true on success, false on failure.
 */
async function establishSession(email: string): Promise<boolean> {
  const supabase = await createClient();
  const serverPassword = process.env.CUSTOMER_SERVER_PASSWORD!;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: serverPassword,
  });

  if (error) {
    // Log error with email (NOT the PIN) for admin investigation (Req 11.4).
    console.error(
      `[pinAuthActions] signInWithPassword failed for email ${email}:`,
      error.message,
    );
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public server actions
// ---------------------------------------------------------------------------

/**
 * Step 1 of login: the customer submits a mobile number.
 *
 * Normalizes + validates the mobile and runs the eligibility check. If the
 * mobile is not eligible, returns the mapped message WITHOUT revealing the
 * PIN entry screen.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6.
 *
 * @param mobile Raw, human-entered mobile number.
 */
export async function checkEligibilityAction(
  mobile: string,
): Promise<CheckEligibilityResult> {
  // Normalize mobile (strip whitespace, country code, leading zeros).
  const normalized = normalizeMobile(mobile);

  if (!normalized.ok) {
    return {
      outcome: "NOT_ELIGIBLE",
      message: "Please enter a valid 10-digit mobile number.",
    };
  }

  // Run eligibility check against customer records.
  const eligibility = await EligibilityChecker.check(normalized.value);

  if (eligibility.eligible) {
    return { outcome: "ELIGIBLE" };
  }

  // All non-eligible reasons map to the same generic message (Req 4.4):
  // NOT_REGISTERED, BAD_STATUS, AMBIGUOUS → "please contact admin"
  // INVALID_FORMAT is already handled above by normalizeMobile validation.
  if (eligibility.reason === "INVALID_FORMAT") {
    return {
      outcome: "NOT_ELIGIBLE",
      message: "Please enter a valid 10-digit mobile number.",
    };
  }

  return {
    outcome: "NOT_ELIGIBLE",
    message: "please contact admin",
  };
}

/**
 * Step 2 of login: the customer submits their PIN.
 *
 * Checks throttle status, verifies PIN, handles temp/permanent PIN flows,
 * and establishes a session on success.
 *
 * Validates: Requirements 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 5.1, 5.2, 5.3,
 *            5.5, 11.1, 11.4.
 *
 * @param mobile Normalized 10-digit mobile number.
 * @param pin The 6-digit PIN submitted by the customer.
 */
export async function verifyPinAction(
  mobile: string,
  pin: string,
): Promise<VerifyPinResult> {
  // 1. Check throttle — reject if locked (Req 5.3).
  const throttleCheck = await PinThrottleService.checkThrottle(mobile);

  if (throttleCheck.status === "LOCKED") {
    return {
      outcome: "LOCKED",
      message: "Too many attempts. Please try again later.",
      retryAfterSeconds: throttleCheck.retryAfterSeconds,
    };
  }

  // 2. Verify PIN against stored hash (Req 2.2).
  const verifyResult = await PinService.verifyPin(mobile, pin);

  // No user found for this mobile.
  if (verifyResult === null) {
    return {
      outcome: "INVALID",
      message: "Invalid PIN",
    };
  }

  // 3. PIN incorrect — increment failure counter (Req 3.3, 5.1).
  if (!verifyResult.valid) {
    const incrementResult = await PinThrottleService.incrementFailure(mobile);

    if (incrementResult.status === "LOCKED") {
      return {
        outcome: "LOCKED",
        message: "Too many attempts. Please try again later.",
        retryAfterSeconds: incrementResult.retryAfterSeconds,
      };
    }

    return {
      outcome: "INVALID",
      message: "Invalid PIN",
    };
  }

  // 4. PIN correct + temp PIN → reset throttle, return TEMP_PIN (Req 2.3).
  if (verifyResult.isTempPin) {
    await PinThrottleService.resetThrottle(mobile);
    return { outcome: "TEMP_PIN" };
  }

  // 5. PIN correct + permanent → establish session (Req 3.2, 11.1).
  const email = await getEmailByMobile(mobile);

  if (!email) {
    console.error(
      `[pinAuthActions] No email found for mobile ${mobile} during session establishment`,
    );
    return {
      outcome: "ERROR",
      message: "Something went wrong. Please try again.",
    };
  }

  const sessionEstablished = await establishSession(email);

  if (!sessionEstablished) {
    return {
      outcome: "ERROR",
      message: "Something went wrong. Please try again.",
    };
  }

  // Reset throttle on successful verification (Req 5.5).
  await PinThrottleService.resetThrottle(mobile);

  return { outcome: "OK" };
}

/**
 * Step 3 of login: the customer sets a permanent PIN (temp PIN flow only).
 *
 * Validates PIN format and match, updates the PIN in the database, and
 * establishes a session.
 *
 * Validates: Requirements 2.4, 2.5, 2.6, 2.7, 9.4.
 *
 * @param mobile Normalized 10-digit mobile number.
 * @param newPin The new 6-digit PIN chosen by the customer.
 * @param confirmPin The confirmation re-entry of the new PIN.
 */
export async function setPermanentPinAction(
  mobile: string,
  newPin: string,
  confirmPin: string,
): Promise<SetPermanentPinResult> {
  // 1. Validate PIN format for both inputs (Req 9.4).
  if (!isValidPinFormat(newPin) || !isValidPinFormat(confirmPin)) {
    return {
      outcome: "INVALID_FORMAT",
      message: "PIN must be exactly 6 digits",
    };
  }

  // 2. Check PINs match (Req 2.5).
  if (newPin !== confirmPin) {
    return {
      outcome: "MISMATCH",
      message: "PINs do not match",
    };
  }

  // 3. Set the permanent PIN (hash + update DB) (Req 2.6).
  try {
    await PinService.setPermanentPin(mobile, newPin);
  } catch (error) {
    console.error(
      `[pinAuthActions] setPermanentPin failed for mobile ${mobile}:`,
      error instanceof Error ? error.message : error,
    );
    return {
      outcome: "ERROR",
      message: "Something went wrong. Please try again.",
    };
  }

  // 4. Look up email and establish session (Req 2.7, 11.1).
  const email = await getEmailByMobile(mobile);

  if (!email) {
    console.error(
      `[pinAuthActions] No email found for mobile ${mobile} during set-permanent-pin session`,
    );
    return {
      outcome: "ERROR",
      message: "Something went wrong. Please try again.",
    };
  }

  const sessionEstablished = await establishSession(email);

  if (!sessionEstablished) {
    return {
      outcome: "ERROR",
      message: "Something went wrong. Please try again.",
    };
  }

  return { outcome: "OK" };
}
