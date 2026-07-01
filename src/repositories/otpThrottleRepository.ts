// src/repositories/otpThrottleRepository.ts
// Data-access layer for the `otp_login_throttle` table (customer-mobile-onboarding).
//
// LAYERING: Data-access ONLY. This module reads and writes the persisted OTP
// throttle record for a mobile number and converts between the DB `TIMESTAMPTZ`
// columns and the epoch-millisecond fields of `OtpThrottleState`. The policy
// semantics (validity window, lockout, resend cooldown/cap) live in the pure
// state machine `evaluateOtpPolicy` (src/lib/otp/otpPolicy.ts); the action layer
// (`mobileAuthActions`) orchestrates the two.
//
// The `otp_login_throttle` table has RLS enabled with NO policies, so it is only
// reachable through the service-role (admin) client, which bypasses RLS.
//
// Requirements: 2.5, 2.7, 2.9, 2.10

import { createAdminClient } from "@/lib/supabase/admin";
import type { OtpThrottleState } from "@/lib/otp/otpPolicy";

const THROTTLE_TABLE = "otp_login_throttle";
const THROTTLE_COLUMNS =
  "mobile, window_started_at, failed_attempts, resend_count, last_sent_at, locked_until";

/**
 * Raw shape of an `otp_login_throttle` row as returned by Supabase. Timestamp
 * columns are ISO-8601 strings (or `null`); counters are integers.
 */
interface OtpThrottleRow {
  mobile: string;
  window_started_at: string | null;
  failed_attempts: number;
  resend_count: number;
  last_sent_at: string | null;
  locked_until: string | null;
}

/** Convert a nullable `TIMESTAMPTZ` string to epoch milliseconds (or `null`). */
function toEpochMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  return new Date(value).getTime();
}

/** Convert a nullable epoch-millisecond value to an ISO-8601 string (or `null`). */
function toIso(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  return new Date(value).toISOString();
}

/** Map a DB row to the epoch-ms `OtpThrottleState` consumed by the policy machine. */
function rowToState(row: OtpThrottleRow): OtpThrottleState {
  return {
    windowStartedAt: toEpochMs(row.window_started_at),
    failedAttempts: row.failed_attempts,
    resendCount: row.resend_count,
    lastSentAt: toEpochMs(row.last_sent_at),
    lockedUntil: toEpochMs(row.locked_until),
  };
}

/**
 * Fetch the persisted throttle state for a (normalized) mobile number.
 *
 * Returns `null` when no throttle record exists yet for the mobile — the caller
 * seeds a fresh state via `initialOtpThrottleState(now)` in that case.
 *
 * @param mobile Normalized 10-digit mobile number (primary key).
 */
export async function getThrottle(mobile: string): Promise<OtpThrottleState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(THROTTLE_TABLE)
    .select(THROTTLE_COLUMNS)
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch OTP throttle for ${mobile}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return rowToState(data as OtpThrottleRow);
}

/**
 * Persist the throttle state for a (normalized) mobile number, inserting a new
 * row or overwriting the existing one. Converts the epoch-ms `OtpThrottleState`
 * fields back to `TIMESTAMPTZ` values and stamps `updated_at`.
 *
 * @param mobile Normalized 10-digit mobile number (primary key).
 * @param state  The throttle state to persist (as returned by `evaluateOtpPolicy`).
 */
export async function saveThrottle(mobile: string, state: OtpThrottleState): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from(THROTTLE_TABLE).upsert(
    {
      mobile,
      window_started_at: toIso(state.windowStartedAt),
      failed_attempts: state.failedAttempts,
      resend_count: state.resendCount,
      last_sent_at: toIso(state.lastSentAt),
      locked_until: toIso(state.lockedUntil),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mobile" },
  );

  if (error) {
    throw new Error(`Failed to save OTP throttle for ${mobile}: ${error.message}`);
  }
}
