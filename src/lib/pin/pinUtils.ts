// src/lib/pin/pinUtils.ts
// Pure, side-effect-free PIN utility functions for the customer PIN-based
// authentication flow (customer-pin-auth, Requirements 3.5, 4.2, 6.2, 6.3,
// 7.3, 9.1). This module performs NO Supabase / network / IO work so it can
// be unit- and property-tested in isolation.
//
// The Customer_Portal and Admin_Dashboard both need to validate PIN format
// (exactly 6 numeric digits) and generate cryptographically secure temporary
// PINs. These utilities are shared across the PIN lifecycle:
//   - Admin onboarding (auto-generate temp PIN)
//   - Admin reset (auto-generate or validate manual entry)
//   - Customer login (validate submitted PIN format client-side)
//   - Server-side validation before bcrypt operations

import { randomInt } from "crypto";

/**
 * The canonical PIN format: exactly 6 numeric digits (0-9).
 * This mirrors the validation required by Requirements 3.5, 4.2, 6.3, 7.3.
 */
const PIN_FORMAT = /^\d{6}$/;

/**
 * Validate that a value is exactly 6 numeric digits.
 *
 * This function is total (never throws) and defensively guards against
 * non-string inputs that might slip past the type system (e.g. untyped form
 * payloads, JSON parsing). Any non-string input returns `false`.
 *
 * Validates: Requirements 3.5, 4.2, 6.3, 7.3.
 *
 * @param pin the value to validate as a 6-digit numeric PIN
 * @returns `true` if `pin` is a string matching `/^\d{6}$/`, `false` otherwise
 */
export function isValidPinFormat(pin: string): boolean {
  // Defensive: guard against non-string inputs slipping past the type system
  // (e.g. untyped form payloads) rather than throwing.
  if (typeof pin !== "string") {
    return false;
  }

  return PIN_FORMAT.test(pin);
}

/**
 * Generate a cryptographically random 6-digit numeric PIN.
 *
 * Uses Node.js `crypto.randomInt` which produces cryptographically secure
 * uniform random integers. The range [0, 999999] covers all possible 6-digit
 * combinations; the result is zero-padded to ensure exactly 6 characters.
 *
 * This function is suitable for generating admin-set temporary PINs during
 * customer onboarding or PIN reset flows.
 *
 * Validates: Requirements 6.2, 9.1.
 *
 * @returns a cryptographically random string of exactly 6 numeric digits
 */
export function generateTemporaryPin(): string {
  // randomInt(max) returns a uniform random integer in [0, max).
  // Range [0, 1_000_000) covers 000000 through 999999.
  const raw = randomInt(1_000_000);

  // Pad with leading zeros to guarantee exactly 6 digits.
  return raw.toString().padStart(6, "0");
}

/**
 * Normalize mobile number — delegates to the existing normalizeMobile utility.
 * Re-exported here for convenience so PIN-related modules can import all
 * validation/utility needs from a single location.
 *
 * Validates: Requirements 4.6.
 */
export { normalizeMobile } from "@/lib/mobile/normalizeMobile";
