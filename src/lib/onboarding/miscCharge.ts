// src/lib/onboarding/miscCharge.ts
//
// Shared rules for the optional Miscellaneous_Charge an admin can add during
// Quick Onboarding on top of the plan price and the delivery charge (e.g.
// "Additional product charges").
//
// The admin supplies BOTH an amount and a name. The name is what the customer's
// invoice prints — the word "Miscellaneous" is internal-only and never shown to
// the customer.
//
// This module is intentionally dependency-free so the same bounds and messages
// are used by the client form and by the server action, keeping the inline
// field errors and the server rejection identical.

/** Upper bound for the charge, matching chk_*_misc_charge_range in the DB. */
export const MISC_CHARGE_MAX = 999999.99;

/** Max length of the admin-supplied name, matching chk_*_misc_charge_label. */
export const MISC_CHARGE_LABEL_MAX_LENGTH = 100;

/**
 * Validates a raw amount string as typed by the admin.
 *
 * @returns `null` when acceptable (including an empty string, meaning "no
 *          charge"), otherwise a user-facing error message.
 */
export function validateMiscChargeAmount(rawValue: string): string | null {
  if (rawValue.trim() === "") return null;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return "Miscellaneous charge must be a valid number";
  }
  if (parsed < 0) {
    return "Miscellaneous charge cannot be negative";
  }
  if (parsed > MISC_CHARGE_MAX) {
    return `Miscellaneous charge cannot exceed ₹${MISC_CHARGE_MAX.toLocaleString("en-IN")}`;
  }

  const decimals = rawValue.split(".")[1];
  if (decimals && decimals.length > 2) {
    return "Miscellaneous charge cannot have more than 2 decimal places";
  }

  return null;
}

/**
 * Validates the admin-supplied name against the amount. A name is REQUIRED once
 * an amount is charged, because it is the invoice line-item description.
 *
 * @returns `null` when acceptable, otherwise a user-facing error message.
 */
export function validateMiscChargeLabel(
  rawLabel: string,
  amount: number | null,
): string | null {
  const label = rawLabel.trim();

  if (label.length > MISC_CHARGE_LABEL_MAX_LENGTH) {
    return `Name must be at most ${MISC_CHARGE_LABEL_MAX_LENGTH} characters`;
  }
  if (amount != null && amount > 0 && label === "") {
    return "Enter a name for this charge (it appears on the invoice)";
  }

  return null;
}
