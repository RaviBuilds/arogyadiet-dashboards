// src/lib/onboarding/discount.ts
//
// Shared rules for the optional manual Discount an admin can grant during Quick
// Onboarding, at the Payment & Review step, for MEAL and KIT customers only.
//
// THE RULE
// The discount is a rupee amount the admin types, and it is absorbed ENTIRELY by
// the subscription charge and its GST. Delivery charges and miscellaneous
// charges are never reduced. Total_Payable therefore drops by EXACTLY the amount
// entered — which is what an admin quoting a figure at the counter expects.
//
// WHY THE DISCOUNT COMES OFF THE GST-INCLUSIVE AMOUNT
// The alternative — subtracting from the pre-tax base and re-deriving GST on top
// (which is what the customer-side coupon flow does in step-5-preview.tsx) —
// makes the payable fall by discount x 1.05. An admin who types 2,000 and
// watches the total drop by 2,100 will reasonably conclude the form is broken.
// So the discount is taken off the inclusive amount and the result is re-split
// into taxable value + GST, which keeps the payable honest AND keeps GST charged
// correctly on the reduced taxable value.
//
// Worked example — plan Rs.14,333 inclusive at 5%, discount Rs.2,000:
//   discountedGross      = 12,333.00   (payable falls by exactly 2,000)
//   taxableAmount        = 11,745.71
//   taxAmount            =    587.29
//   originalTaxableAmount= 13,650.48
//   originalTaxAmount    =    682.52
//   baseRelief           =  1,904.77   (the 2,000 splits into these two)
//   taxRelief            =     95.23
//
// This module is intentionally dependency-free apart from the shared rounding
// helper, so the same bounds, the same arithmetic and the same messages are used
// by the client wizard and by the server action. That is what keeps the inline
// field error identical to the server rejection, and the live "Amount breakup"
// panel identical to what actually gets written to the database.

import { roundHalfUp } from "@/lib/delivery/deliveryCharge";

/** Upper bound for the discount, matching chk_*_discount_amount_range in the DB. */
export const DISCOUNT_MAX = 9_999_999.99;

/**
 * The categories a manual discount may be granted for.
 *
 * ACCOMMODATION is deliberately absent: stay pricing lives in `stay_entries`,
 * is settled through `record_stay_payment_transaction`, and carries 18% GST
 * rather than 5% — none of the arithmetic in this module applies to it.
 */
export const DISCOUNTABLE_CATEGORIES = ["MEAL", "KIT"] as const;

export type DiscountableCategory = (typeof DISCOUNTABLE_CATEGORIES)[number];

/** True when a manual discount may be granted for this customer category. */
export function isDiscountableCategory(
  category: string | null | undefined,
): category is DiscountableCategory {
  return (
    category === "MEAL" ||
    category === "KIT"
  );
}

/** Money compared in paise — float rupees leave ~1e-13 residue on subtraction. */
export function toPaise(value: number): number {
  return Math.round(value * 100);
}

/**
 * The maximum discount grantable against a subscription.
 *
 * This is the GST-inclusive subscription amount, NOT Total_Payable. The discount
 * can only be absorbed by the subscription charge and its GST, so allowing more
 * than the subscription is worth would force it to eat into the delivery or
 * miscellaneous charge — which the business rule forbids outright.
 *
 * The bound is also automatically <= Total_Payable, so it satisfies "the discount
 * cannot exceed the total payable" without needing a second check.
 *
 * A discount equal to the full amount is allowed: the subscription becomes free
 * and the customer still pays delivery and miscellaneous charges.
 */
export function resolveMaxDiscount(grossSubscriptionAmount: number): number {
  if (!Number.isFinite(grossSubscriptionAmount) || grossSubscriptionAmount <= 0) {
    return 0;
  }
  return Math.min(roundHalfUp(grossSubscriptionAmount, 2), DISCOUNT_MAX);
}

/**
 * Validates a raw discount string as typed by the admin.
 *
 * @param rawValue    the input value, exactly as typed
 * @param grossSubscriptionAmount the GST-inclusive plan / kit price the discount
 *        is being granted against, or `null` when no plan or product has been
 *        chosen yet (in which case only shape is checked, not the ceiling)
 * @returns `null` when acceptable (including an empty string, meaning "no
 *          discount"), otherwise a user-facing error message.
 */
export function validateDiscountAmount(
  rawValue: string,
  grossSubscriptionAmount: number | null,
): string | null {
  if (rawValue.trim() === "") return null;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return "Discount must be a valid number";
  }
  if (parsed < 0) {
    return "Discount cannot be negative";
  }

  const decimals = rawValue.split(".")[1];
  if (decimals && decimals.length > 2) {
    return "Discount cannot have more than 2 decimal places";
  }

  if (parsed > DISCOUNT_MAX) {
    return `Discount cannot exceed ₹${DISCOUNT_MAX.toLocaleString("en-IN")}`;
  }

  // The ceiling is only knowable once a plan or kit product has been selected.
  if (grossSubscriptionAmount != null && grossSubscriptionAmount > 0) {
    const max = resolveMaxDiscount(grossSubscriptionAmount);
    if (toPaise(parsed) > toPaise(max)) {
      return `Discount cannot exceed the subscription charge of ₹${max.toLocaleString(
        "en-IN",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      )}`;
    }
  }

  return null;
}

/** The full before-and-after picture of a discounted subscription charge. */
export interface DiscountedSubscriptionPricing {
  /** GST-inclusive subscription amount before any discount. */
  grossAmount: number;
  /** The discount actually applied, clamped to `grossAmount`. */
  discountApplied: number;
  /** GST-inclusive subscription amount after the discount. */
  discountedGross: number;
  /** Taxable value after the discount — what `payments.base_amount` stores. */
  taxableAmount: number;
  /** GST after the discount — what `payments.tax_amount` stores. */
  taxAmount: number;
  /** The GST rate as a percentage (e.g. 5), for `payments.tax_percent`. */
  taxPercent: number;
  /** Taxable value before the discount — the invoice's "Base Price" row. */
  originalTaxableAmount: number;
  /** GST before the discount. */
  originalTaxAmount: number;
  /** Portion of the discount that came off the taxable value. */
  baseRelief: number;
  /** Portion of the discount that came off GST. `baseRelief + taxRelief === discountApplied`. */
  taxRelief: number;
}

/**
 * Splits a GST-inclusive subscription amount into taxable value and GST, after
 * applying a manual discount.
 *
 * `taxAmount` is derived by SUBTRACTION (`discountedGross - taxableAmount`)
 * rather than by multiplying the taxable value by the rate. That guarantees
 * `taxableAmount + taxAmount === discountedGross` to the paisa, so the invoice
 * reconciles exactly instead of drifting by a rounding unit. The same reasoning
 * applies to `taxRelief`, derived as `discountApplied - baseRelief`, which keeps
 * the two halves of the concession summing to the figure the admin typed.
 *
 * A discount larger than the amount is CLAMPED rather than rejected — callers
 * validate first (`validateDiscountAmount`), and clamping means this function
 * can never return a negative price if a caller forgets.
 *
 * @param grossSubscriptionAmount GST-inclusive plan price or kit product price
 * @param discount                the admin-entered concession (0 for none)
 * @param taxRate                 GST as a fraction, e.g. 0.05 for 5%
 */
export function applySubscriptionDiscount(
  grossSubscriptionAmount: number,
  discount: number,
  taxRate: number,
): DiscountedSubscriptionPricing {
  const grossAmount = roundHalfUp(
    Number.isFinite(grossSubscriptionAmount) && grossSubscriptionAmount > 0
      ? grossSubscriptionAmount
      : 0,
    2,
  );

  const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0;

  const requested =
    Number.isFinite(discount) && discount > 0 ? roundHalfUp(discount, 2) : 0;
  const discountApplied = Math.min(requested, grossAmount);

  const discountedGross = roundHalfUp(grossAmount - discountApplied, 2);

  const taxableAmount = roundHalfUp(discountedGross / (1 + rate), 2);
  const taxAmount = roundHalfUp(discountedGross - taxableAmount, 2);

  const originalTaxableAmount = roundHalfUp(grossAmount / (1 + rate), 2);
  const originalTaxAmount = roundHalfUp(grossAmount - originalTaxableAmount, 2);

  const baseRelief = roundHalfUp(originalTaxableAmount - taxableAmount, 2);
  const taxRelief = roundHalfUp(discountApplied - baseRelief, 2);

  return {
    grossAmount,
    discountApplied,
    discountedGross,
    taxableAmount,
    taxAmount,
    taxPercent: roundHalfUp(rate * 100, 2),
    originalTaxableAmount,
    originalTaxAmount,
    baseRelief,
    taxRelief,
  };
}

/**
 * Rebuilds the before-discount figures from what was actually stored on a
 * payment row — the inverse of {@link applySubscriptionDiscount}.
 *
 * Used by invoice rendering, which reads `base_amount` / `tax_amount` (both
 * stored NET of the discount) and `discount_amount` (the gross concession), and
 * needs the original taxable value to show a truthful "Base Price → Discount →
 * Price After Discount" progression.
 *
 * Relies on the storage identity documented in
 * scripts/add-discount-to-subscriptions-and-payments.sql:
 *   base_amount + tax_amount + discount_amount = original gross
 *
 * @param netTaxableAmount `payments.base_amount` (post-discount)
 * @param netTaxAmount     `payments.tax_amount` (post-discount)
 * @param grossDiscount    `payments.discount_amount`
 * @param taxPercent       `payments.tax_percent`, e.g. 5
 */
export function reconstructPreDiscountPricing(
  netTaxableAmount: number,
  netTaxAmount: number,
  grossDiscount: number,
  taxPercent: number,
): {
  originalTaxableAmount: number;
  baseRelief: number;
  taxRelief: number;
} {
  const discountedGross = roundHalfUp(netTaxableAmount + netTaxAmount, 2);
  const grossAmount = roundHalfUp(discountedGross + grossDiscount, 2);
  const rate = Number.isFinite(taxPercent) && taxPercent > 0 ? taxPercent / 100 : 0;

  const originalTaxableAmount = roundHalfUp(grossAmount / (1 + rate), 2);
  const baseRelief = roundHalfUp(originalTaxableAmount - netTaxableAmount, 2);
  const taxRelief = roundHalfUp(grossDiscount - baseRelief, 2);

  return { originalTaxableAmount, baseRelief, taxRelief };
}
