// src/lib/onboarding/category.ts
// Pure Customer_Category logic for the mobile-first onboarding feature.
//
// The system models a customer's active services with exactly three
// categories — MEAL, KIT, and ACCOMMODATION. At onboarding the admin picks
// exactly one Primary_Category; the other two can be added later as paid
// add-ons. These helpers own the (pure) validation of those rules so both the
// server actions and the OnboardingService can share one definition.
//
// Requirements validated: 13.1, 13.2, 13.3, 13.4

/** The only Customer_Category values the system accepts (Req 13.1). */
export const CUSTOMER_CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION"] as const;

/** A valid Customer_Category. */
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

/**
 * Pure predicate: is `value` one of the three allowed Customer_Category values?
 * Narrows the type to `CustomerCategory` on success (Req 13.1).
 */
export function isValidCategory(value: unknown): value is CustomerCategory {
  return (
    typeof value === "string" &&
    (CUSTOMER_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Asserts that `value` is a valid Customer_Category, throwing a descriptive
 * error for any value outside the set (Req 13.1). On success the caller can
 * treat `value` as a `CustomerCategory`.
 */
export function assertValidCategory(
  value: unknown
): asserts value is CustomerCategory {
  if (!isValidCategory(value)) {
    throw new Error(
      `Invalid customer category "${String(value)}". Allowed values are: ${CUSTOMER_CATEGORIES.join(
        ", "
      )}.`
    );
  }
}

/**
 * Asserts that a Primary_Category selection contains exactly one valid
 * Customer_Category and returns it.
 *
 * - Zero selected  → error "exactly one Primary_Category must be selected" (Req 13.3)
 * - More than one  → error "only one Primary_Category is allowed" (Req 13.4)
 * - Any invalid value in the selection → error (Req 13.1)
 * - Exactly one valid value → returns that `CustomerCategory` (Req 13.2)
 */
export function assertSinglePrimary(
  selection: readonly unknown[]
): CustomerCategory {
  if (selection.length === 0) {
    throw new Error("Exactly one Primary_Category must be selected.");
  }
  if (selection.length > 1) {
    throw new Error("Only one Primary_Category is allowed.");
  }

  const [value] = selection;
  assertValidCategory(value);
  return value;
}
