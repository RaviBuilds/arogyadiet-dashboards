// src/lib/mobile/normalizeMobile.ts
// Pure, side-effect-free mobile-number normalization for the customer
// mobile-first onboarding flow (customer-mobile-onboarding, Requirements 2.11,
// 3.2). This module performs NO Supabase / network / IO work so it can be
// unit- and property-tested in isolation.
//
// The Customer_Portal accepts mobile numbers in the loose formats a human
// might type (`+91 98765 43210`, `098765 43210`, `9876543210`, ...) and must
// normalize them to the canonical 10-digit form stored in `users.mobile`
// BEFORE the eligibility check and OTP send (Req 2.11). A value that cannot be
// reduced to a syntactically valid Indian mobile number — 10 numeric digits
// starting `[6-9]`, excluding any leading country code — is rejected (Req 3.2).

/**
 * The canonical Indian mobile pattern: exactly 10 digits, first digit 6-9.
 * This mirrors the format used by existing `users.mobile` records (Req 2.11)
 * and the syntactic-validity rule in Req 3.2.
 */
const CANONICAL_MOBILE = /^[6-9]\d{9}$/;

/**
 * The result of normalizing a raw, human-entered mobile string.
 *
 *   - `{ ok: true; value }`  — `value` is the canonical 10-digit `[6-9]\d{9}`
 *                              form, safe to compare against `users.mobile`.
 *   - `{ ok: false }`        — the input is not a syntactically valid mobile
 *                              number; no OTP should be sent (Req 3.2).
 */
export type NormalizeMobileResult =
  | { ok: true; value: string }
  | { ok: false };

/**
 * Normalize a raw, human-entered mobile number to the canonical 10-digit
 * `[6-9]\d{9}` form used by `users.mobile`.
 *
 * The reduction, in order, strips the noise a human commonly adds:
 *
 *   1. Remove all whitespace (spaces, tabs, newlines).
 *   2. Remove a single leading `+` (so `+91...` becomes `91...`).
 *   3. Strip leading zeros (so a trunk-prefixed `098765...` becomes `98765...`).
 *   4. If the result is a 12-digit string beginning with the `91` country code,
 *      drop that country code, leaving the 10-digit subscriber number.
 *   5. Validate the result against `[6-9]\d{9}`. Anything else is rejected.
 *
 * The function is total (never throws) and **idempotent**: for any input `x`
 * that normalizes successfully, `normalizeMobile(normalizeMobile(x).value)`
 * yields the same canonical value, because a canonical value has no whitespace,
 * no `+`, no leading zero, and is exactly 10 digits (so steps 1-4 are no-ops).
 *
 * Validates: Requirements 2.11, 3.2.
 *
 * @param raw the raw mobile string as submitted by the user
 */
export function normalizeMobile(raw: string): NormalizeMobileResult {
  // Defensive: guard against non-string inputs slipping past the type system
  // (e.g. untyped form payloads) rather than throwing.
  if (typeof raw !== "string") {
    return { ok: false };
  }

  // (1) Remove all whitespace.
  let digits = raw.replace(/\s+/g, "");

  // (2) Remove a single leading `+` (international prefix marker).
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  // (3) Strip leading zeros (trunk prefix / accidental leading zero).
  digits = digits.replace(/^0+/, "");

  // (4) Drop a leading `91` country code when the remaining value is a full
  //     12-digit country-code + subscriber number. This is length-guarded so a
  //     legitimate 10-digit number that happens to start with `91` (e.g.
  //     `919xxxxxxx`) is never mistaken for a country code.
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  // (5) Validate the canonical form.
  if (CANONICAL_MOBILE.test(digits)) {
    return { ok: true, value: digits };
  }

  return { ok: false };
}
