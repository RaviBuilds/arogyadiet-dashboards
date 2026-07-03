// src/services/PinThrottleService.ts
// Brute-force protection service for PIN-based authentication. Manages
// failed-attempt tracking and lockout using the existing `otp_login_throttle`
// table.
//
// LAYERING: Business service. Reads and writes the `otp_login_throttle` table
// via service-role Supabase client (bypasses RLS). Only uses `failed_attempts`,
// `locked_until`, `window_started_at`, and `updated_at` columns — the
// `resend_count` and `last_sent_at` columns are OTP-specific and ignored.
//
// The `otp_login_throttle` table has RLS enabled with NO policies, so it is
// only reachable through the service-role (admin) client.
//
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 14.5

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Throttle status indicating whether a mobile number is allowed to attempt
 * PIN verification or is currently locked out.
 *
 * - `ALLOWED`: The mobile may proceed with PIN verification.
 * - `LOCKED`: The mobile is locked out due to excessive failed attempts.
 */
export type ThrottleStatus = "ALLOWED" | "LOCKED";

/**
 * Result of a throttle check or failure increment operation.
 *
 * - `status`: Whether the mobile is allowed or locked.
 * - `lockedUntil`: Present when status is LOCKED; the Date at which the lock expires.
 * - `retryAfterSeconds`: Present when status is LOCKED; seconds remaining until unlock.
 *
 * Validates: Requirements 5.2, 5.3.
 */
export interface ThrottleCheckResult {
  status: ThrottleStatus;
  lockedUntil?: Date;
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Table name for throttle records. */
const THROTTLE_TABLE = "otp_login_throttle";

/**
 * Maximum number of failed PIN attempts before lockout engages.
 *
 * Validates: Requirements 5.2.
 */
const MAX_FAILED_ATTEMPTS = 5;

/**
 * Lockout duration in seconds (15 minutes).
 *
 * Validates: Requirements 5.2.
 */
const LOCKOUT_DURATION_SECONDS = 900;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Raw shape of an `otp_login_throttle` row as returned by Supabase (only the
 * columns relevant to PIN throttling).
 */
interface ThrottleRow {
  mobile: string;
  failed_attempts: number;
  locked_until: string | null;
  window_started_at: string;
  updated_at: string;
}

/** Columns selected for PIN throttle operations. */
const THROTTLE_COLUMNS = "mobile, failed_attempts, locked_until, window_started_at, updated_at";

/**
 * Build a LOCKED result from a `locked_until` Date.
 */
function buildLockedResult(lockedUntil: Date): ThrottleCheckResult {
  const now = Date.now();
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((lockedUntil.getTime() - now) / 1000),
  );
  return {
    status: "LOCKED",
    lockedUntil,
    retryAfterSeconds,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a mobile number is currently locked out from PIN attempts.
 *
 * - If no throttle record exists, the mobile is ALLOWED (first-ever attempt).
 * - If `locked_until` is in the future, returns LOCKED.
 * - If `locked_until` is in the past (lock has expired), resets `failed_attempts`
 *   to 0, updates `window_started_at`, and returns ALLOWED.
 * - If `locked_until` is null (not locked), returns ALLOWED.
 *
 * @param mobile Normalized 10-digit mobile number.
 * @returns ThrottleCheckResult indicating ALLOWED or LOCKED status.
 *
 * Validates: Requirements 5.3, 5.4, 5.6, 5.7.
 */
export async function checkThrottle(mobile: string): Promise<ThrottleCheckResult> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from(THROTTLE_TABLE)
    .select(THROTTLE_COLUMNS)
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to check throttle for mobile ${mobile}: ${error.message}`,
    );
  }

  // No record exists — mobile has never attempted login; ALLOWED.
  if (!data) {
    return { status: "ALLOWED" };
  }

  const row = data as ThrottleRow;

  // If there is a lock, check if it's still active.
  if (row.locked_until) {
    const lockedUntil = new Date(row.locked_until);
    const now = new Date();

    if (lockedUntil > now) {
      // Lock is still active — reject attempts.
      return buildLockedResult(lockedUntil);
    }

    // Lock has expired — reset the throttle state and allow.
    const { error: resetError } = await admin
      .from(THROTTLE_TABLE)
      .update({
        failed_attempts: 0,
        locked_until: null,
        window_started_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("mobile", mobile);

    if (resetError) {
      throw new Error(
        `Failed to reset expired throttle for mobile ${mobile}: ${resetError.message}`,
      );
    }

    return { status: "ALLOWED" };
  }

  // No lock set — ALLOWED.
  return { status: "ALLOWED" };
}

/**
 * Increment the failed-attempt counter for a mobile number.
 *
 * - If no record exists, creates one with `failed_attempts = 1`.
 * - If `failed_attempts` reaches `MAX_FAILED_ATTEMPTS` (5), sets
 *   `locked_until` to `now + LOCKOUT_DURATION_SECONDS` (900s / 15 min).
 * - Returns the resulting throttle status (ALLOWED or LOCKED).
 *
 * @param mobile Normalized 10-digit mobile number.
 * @returns ThrottleCheckResult reflecting the new state after the increment.
 *
 * Validates: Requirements 5.1, 5.2, 5.6, 5.7.
 */
export async function incrementFailure(mobile: string): Promise<ThrottleCheckResult> {
  const admin = createAdminClient();
  const now = new Date();

  // Fetch current record (if any).
  const { data, error: fetchError } = await admin
    .from(THROTTLE_TABLE)
    .select(THROTTLE_COLUMNS)
    .eq("mobile", mobile)
    .maybeSingle();

  if (fetchError) {
    throw new Error(
      `Failed to fetch throttle for mobile ${mobile}: ${fetchError.message}`,
    );
  }

  let newFailedAttempts: number;
  let newLockedUntil: string | null = null;

  if (!data) {
    // No record — start with 1 failed attempt.
    newFailedAttempts = 1;

    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      newLockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_SECONDS * 1000).toISOString();
    }

    const { error: insertError } = await admin.from(THROTTLE_TABLE).upsert(
      {
        mobile,
        failed_attempts: newFailedAttempts,
        locked_until: newLockedUntil,
        window_started_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "mobile" },
    );

    if (insertError) {
      throw new Error(
        `Failed to insert throttle record for mobile ${mobile}: ${insertError.message}`,
      );
    }
  } else {
    const row = data as ThrottleRow;
    newFailedAttempts = row.failed_attempts + 1;

    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      newLockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_SECONDS * 1000).toISOString();
    }

    const { error: updateError } = await admin
      .from(THROTTLE_TABLE)
      .update({
        failed_attempts: newFailedAttempts,
        locked_until: newLockedUntil,
        updated_at: now.toISOString(),
      })
      .eq("mobile", mobile);

    if (updateError) {
      throw new Error(
        `Failed to increment throttle for mobile ${mobile}: ${updateError.message}`,
      );
    }
  }

  // Return new status.
  if (newLockedUntil) {
    return buildLockedResult(new Date(newLockedUntil));
  }

  return { status: "ALLOWED" };
}

/**
 * Reset the throttle state for a mobile number after a successful PIN
 * verification.
 *
 * Sets `failed_attempts` to 0 and clears `locked_until`. If no record exists,
 * this is a no-op (no record to reset).
 *
 * @param mobile Normalized 10-digit mobile number.
 *
 * Validates: Requirements 5.5, 5.6, 5.7.
 */
export async function resetThrottle(mobile: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date();

  const { error } = await admin
    .from(THROTTLE_TABLE)
    .update({
      failed_attempts: 0,
      locked_until: null,
      updated_at: now.toISOString(),
    })
    .eq("mobile", mobile);

  if (error) {
    throw new Error(
      `Failed to reset throttle for mobile ${mobile}: ${error.message}`,
    );
  }
}
