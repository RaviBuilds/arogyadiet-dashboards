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
 * Uses the Web Crypto API (`crypto.getRandomValues`) which is available in
 * both browser and Node.js (v15+) environments. This replaces the previous
 * Node-only `crypto.randomInt` which was not available in client bundles.
 *
 * The range [0, 999999] covers all possible 6-digit combinations; the result
 * is zero-padded to ensure exactly 6 characters.
 *
 * This function is suitable for generating admin-set temporary PINs during
 * customer onboarding or PIN reset flows.
 *
 * Validates: Requirements 6.2, 9.1.
 *
 * @returns a cryptographically random string of exactly 6 numeric digits
 */
export function generateTemporaryPin(): string {
  // Use a Uint32Array to get a cryptographically random 32-bit integer.
  // Modulo 1_000_000 gives a uniform value in [0, 999999].
  // (Bias is negligible: 2^32 / 1_000_000 ≈ 4294, so the maximum bias per
  // bucket is < 0.00003%.)
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  const raw = buf[0] % 1_000_000;

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
