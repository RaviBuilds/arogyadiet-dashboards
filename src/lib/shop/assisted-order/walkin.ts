/**
 * Assisted shop-order — walk-in (non-subscriber) buyer details.
 *
 * Feature: admin-place-shop-order-for-customer (walk-in extension).
 *
 * A walk-in buyer purchases only a shop product: they have no meal / kit /
 * accommodation subscription and therefore no `customer_profiles` row. To keep
 * the stock movement accountable, the operator records the buyer's name (and
 * optionally a mobile number and address) and that detail is stored on the
 * `addon_orders` row itself.
 *
 * This module is dependency-free apart from the shared mobile normalizer and
 * performs NO I/O, so the rules below hold identically in the browser (for
 * inline feedback) and on the server (where they are authoritative).
 */

import { normalizeMobile } from "@/lib/mobile/normalizeMobile";

/** Minimum characters for a walk-in buyer name. */
export const MIN_WALKIN_NAME_CHARS = 2;
/** Maximum characters for a walk-in buyer name (matches the column's practical use). */
export const MAX_WALKIN_NAME_CHARS = 120;
/** Maximum characters for the optional free-text address. */
export const MAX_WALKIN_ADDRESS_CHARS = 500;

/** Raw walk-in details as captured from the operator's form. */
export type WalkInCustomerInput = {
  name: string;
  /** Optional — an admin often only gets a name at the counter. */
  mobile?: string | null;
  /** Optional free-text address, recorded for accountability only. */
  address?: string | null;
};

/**
 * Server-normalized walk-in details, ready to persist. `mobile` is the canonical
 * 10-digit form when supplied; blank optional fields collapse to `null` so the
 * database never stores empty strings.
 */
export type NormalizedWalkInCustomer = {
  name: string;
  mobile: string | null;
  address: string | null;
};

export type WalkInValidationResult =
  | { ok: true; value: NormalizedWalkInCustomer }
  | { ok: false; error: string };

const NAME_REQUIRED_ERROR = `Enter the customer's name (at least ${MIN_WALKIN_NAME_CHARS} characters) to record the sale.`;
const NAME_TOO_LONG_ERROR = `The name must be ${MAX_WALKIN_NAME_CHARS} characters or fewer.`;
const MOBILE_INVALID_ERROR =
  "Enter a valid 10-digit mobile number, or leave it blank.";
const ADDRESS_TOO_LONG_ERROR = `The address must be ${MAX_WALKIN_ADDRESS_CHARS} characters or fewer.`;

/**
 * Validate and normalize walk-in buyer details.
 *
 * - `name` is required (it is the accountability record) and is collapsed to
 *   single spaces so "  Ravi   Kumar " and "Ravi Kumar" store identically.
 * - `mobile` is optional. When present it must normalize to a valid Indian
 *   10-digit number via the shared {@link normalizeMobile}; a blank/whitespace
 *   value is treated as absent rather than invalid.
 * - `address` is optional free text, trimmed and length-capped.
 *
 * The function is total — it never throws.
 */
export function validateWalkInCustomer(
  input: WalkInCustomerInput,
): WalkInValidationResult {
  const rawName = typeof input?.name === "string" ? input.name : "";
  const name = rawName.trim().replace(/\s+/g, " ");

  if (name.length < MIN_WALKIN_NAME_CHARS) {
    return { ok: false, error: NAME_REQUIRED_ERROR };
  }
  if (name.length > MAX_WALKIN_NAME_CHARS) {
    return { ok: false, error: NAME_TOO_LONG_ERROR };
  }

  const rawMobile = typeof input?.mobile === "string" ? input.mobile.trim() : "";
  let mobile: string | null = null;
  if (rawMobile.length > 0) {
    const normalized = normalizeMobile(rawMobile);
    if (!normalized.ok) {
      return { ok: false, error: MOBILE_INVALID_ERROR };
    }
    mobile = normalized.value;
  }

  const rawAddress =
    typeof input?.address === "string" ? input.address.trim() : "";
  if (rawAddress.length > MAX_WALKIN_ADDRESS_CHARS) {
    return { ok: false, error: ADDRESS_TOO_LONG_ERROR };
  }
  const address = rawAddress.length > 0 ? rawAddress : null;

  return { ok: true, value: { name, mobile, address } };
}
