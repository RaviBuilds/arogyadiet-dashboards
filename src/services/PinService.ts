// src/services/PinService.ts
// Core PIN hashing, verification, and lifecycle management service for the
// customer-pin-auth feature.
//
// LAYERING: Business service. Composes bcrypt hashing with service-role
// Supabase access (bypasses RLS) to manage PIN_Hash, is_temp_pin, and
// pin_set_at columns on the `users` table. This service NEVER stores, logs,
// or returns a plaintext PIN — only bcrypt hashes are persisted.
//
// All database access uses `createAdminClient` (service-role key) to bypass
// RLS policies. The `users.pin_hash` and `users.is_temp_pin` columns are not
// exposed via any RLS policy and are only reachable through the service-role
// client.
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 2.2, 2.6, 7.4

import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPinFormat } from "@/lib/pin/pinUtils";

/**
 * Result of a PIN verification attempt.
 *
 * - `valid`: whether the submitted PIN matches the stored hash.
 * - `isTempPin`: whether the stored PIN is a temporary (admin-set) PIN that
 *   requires the customer to set a permanent PIN on next login.
 */
export interface PinVerifyResult {
  valid: boolean;
  isTempPin: boolean;
}

/**
 * Bcrypt cost factor for PIN hashing. A factor of 10 provides a good balance
 * between security and latency for a 6-digit numeric PIN (~100ms on modern
 * hardware).
 *
 * Validates: Requirements 9.1, 9.5.
 */
const BCRYPT_COST_FACTOR = 10;

/**
 * The `users` table name used for all queries.
 */
const USERS_TABLE = "users";

/**
 * Hash a PIN using bcrypt with cost factor 10.
 *
 * This function accepts a validated 6-digit numeric PIN, hashes it using
 * bcrypt, and returns the hash string. The plaintext PIN is NEVER stored,
 * logged, or returned beyond this function's input parameter.
 *
 * @param pin A valid 6-digit numeric PIN string.
 * @returns The bcrypt hash string (includes cost factor, salt, and hash).
 * @throws Error if the PIN does not pass format validation.
 *
 * Validates: Requirements 9.1, 9.4, 9.5.
 */
export async function hashPin(pin: string): Promise<string> {
  // Defensive input validation before hashing (Req 9.4 — never process
  // invalid input that might be logged in error traces).
  if (!isValidPinFormat(pin)) {
    throw new Error("Invalid PIN format: PIN must be exactly 6 numeric digits.");
  }

  const hash = await bcrypt.hash(pin, BCRYPT_COST_FACTOR);
  return hash;
}

/**
 * Verify a submitted PIN against the stored hash for a mobile number.
 *
 * Looks up the `pin_hash` and `is_temp_pin` columns from the `users` table
 * for the given mobile number using the service-role client (bypasses RLS).
 * If no user is found for the mobile, returns `null`. If the user has no
 * `pin_hash` set (null), returns `{ valid: false, isTempPin: false }`.
 *
 * Uses bcrypt.compare which provides constant-time comparison to prevent
 * timing-based side-channel attacks (Req 9.5).
 *
 * @param mobile Normalized 10-digit mobile number.
 * @param pin The 6-digit PIN submitted by the customer.
 * @returns `PinVerifyResult` with validity and temp flag, or `null` if no
 *          user exists for the given mobile.
 *
 * Validates: Requirements 2.2, 9.5, 9.6.
 */
export async function verifyPin(
  mobile: string,
  pin: string,
): Promise<PinVerifyResult | null> {
  // Defensive: validate PIN format before performing any DB lookup.
  if (!isValidPinFormat(pin)) {
    return { valid: false, isTempPin: false };
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from(USERS_TABLE)
    .select("pin_hash, is_temp_pin")
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to lookup PIN for mobile ${mobile}: ${error.message}`,
    );
  }

  // No user found for this mobile number.
  if (!data) {
    return null;
  }

  const { pin_hash, is_temp_pin } = data as {
    pin_hash: string | null;
    is_temp_pin: boolean;
  };

  // User exists but has no PIN set yet (should not happen in normal flow,
  // but handle gracefully).
  if (!pin_hash) {
    return { valid: false, isTempPin: is_temp_pin };
  }

  // Constant-time bcrypt comparison (Req 9.5).
  const valid = await bcrypt.compare(pin, pin_hash);

  return { valid, isTempPin: is_temp_pin };
}

/**
 * Set a permanent PIN for a customer (temp-to-permanent transition).
 *
 * Hashes the new PIN with bcrypt (cost 10), then updates the `users` row
 * matching the given mobile number:
 * - `pin_hash` ← new bcrypt hash
 * - `is_temp_pin` ← false
 * - `pin_set_at` ← current timestamp
 *
 * @param mobile Normalized 10-digit mobile number.
 * @param newPin The new 6-digit numeric PIN chosen by the customer.
 * @throws Error if PIN format is invalid or the database update fails.
 *
 * Validates: Requirements 2.6, 9.1, 9.4.
 */
export async function setPermanentPin(
  mobile: string,
  newPin: string,
): Promise<void> {
  // Defensive input validation (Req 9.4).
  if (!isValidPinFormat(newPin)) {
    throw new Error("Invalid PIN format: PIN must be exactly 6 numeric digits.");
  }

  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST_FACTOR);

  const admin = createAdminClient();

  const { error } = await admin
    .from(USERS_TABLE)
    .update({
      pin_hash: pinHash,
      is_temp_pin: false,
      pin_set_at: new Date().toISOString(),
    })
    .eq("mobile", mobile);

  if (error) {
    throw new Error(
      `Failed to set permanent PIN for mobile ${mobile}: ${error.message}`,
    );
  }
}

/**
 * Admin reset: replace the PIN hash and set `is_temp_pin = true`.
 *
 * Used from the Customer 360 "Reset PIN" action. After this operation the
 * customer will be forced to set a new permanent PIN on their next login.
 *
 * @param userId The UUID primary key of the user whose PIN is being reset.
 * @param newPin The new 6-digit numeric temporary PIN set by the admin.
 * @throws Error if PIN format is invalid or the database update fails.
 *
 * Validates: Requirements 7.4, 9.1, 9.4.
 */
export async function resetPinToTemporary(
  userId: string,
  newPin: string,
): Promise<void> {
  // Defensive input validation (Req 9.4).
  if (!isValidPinFormat(newPin)) {
    throw new Error("Invalid PIN format: PIN must be exactly 6 numeric digits.");
  }

  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST_FACTOR);

  const admin = createAdminClient();

  const { error } = await admin
    .from(USERS_TABLE)
    .update({
      pin_hash: pinHash,
      is_temp_pin: true,
      pin_set_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(
      `Failed to reset PIN to temporary for user ${userId}: ${error.message}`,
    );
  }
}
