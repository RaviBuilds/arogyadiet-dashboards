// src/lib/address/validatePincode.ts
//
// Address validation logic with category-aware PIN code serviceability checks.
// This module provides both legacy validation (for MEAL category) and the new
// KIT category bypass that accepts any valid Indian PIN without serviceability.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4

import type { CustomerCategory } from "@/lib/onboarding/category";

export const PINCODE_FORMAT_REGEX = /^\d{6}$/;
export const FIVE_SERIES_PINCODE_REGEX = /^5\d{5}$/;

export function normalizePincode(pincode: string): string {
  return pincode.trim();
}

export function isFiveSeriesPincode(pincode: string): boolean {
  return FIVE_SERIES_PINCODE_REGEX.test(normalizePincode(pincode));
}

export function isDeliverablePincode(
  pincode: string,
  serviceAreaPincodes: Set<string> | string[],
): boolean {
  const normalized = normalizePincode(pincode);
  if (!PINCODE_FORMAT_REGEX.test(normalized)) return false;
  if (isFiveSeriesPincode(normalized)) return true;

  const serviceAreaSet =
    serviceAreaPincodes instanceof Set
      ? serviceAreaPincodes
      : new Set(serviceAreaPincodes.map(normalizePincode));

  return serviceAreaSet.has(normalized);
}

export function getPincodeValidationError(
  pincode: string,
  serviceAreaPincodes: Set<string> | string[],
): string | null {
  const normalized = normalizePincode(pincode);

  if (!PINCODE_FORMAT_REGEX.test(normalized)) {
    return "Pincode must be exactly 6 digits.";
  }

  if (isDeliverablePincode(normalized, serviceAreaPincodes)) {
    return null;
  }

  return `Sorry, we don't deliver to pincode ${normalized}. Use a 5xxxxx pincode or a pincode from our service areas.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category-Aware Address Validation (KIT Feature)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal address interface required for validation.
 * Uses the existing Address type structure from addressService.ts
 */
export interface AddressInput {
  pincode: string;
  city?: string;
  state?: string;
  street_1?: string;
}

/**
 * Validation result for KIT category addresses.
 * Only checks PIN format, skips serviceability.
 */
export interface KitValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validation result for MEAL category addresses.
 * Checks both PIN format AND serviceability.
 */
export interface MealValidationResult {
  valid: boolean;
  serviceable: boolean;
  error?: string;
}

/**
 * Union type for all validation results.
 */
export type AddressValidationResult = KitValidationResult | MealValidationResult;

/**
 * Category-aware address validation for Quick Onboarding.
 *
 * **KIT Category (Req 3.1, 3.2)**:
 * - Validates only PIN code format (6 digits)
 * - Skips serviceability check
 * - Accepts any valid Indian PIN code
 *
 * **MEAL Category (Req 3.3)**:
 * - Validates PIN code format (6 digits)
 * - Enforces serviceability check against service area
 * - Returns both format validity and serviceability status
 *
 * **ACCOMMODATION Category**:
 * - Falls back to MEAL validation rules (requires serviceability)
 *
 * @param address - The address to validate (only pincode is required)
 * @param category - The customer category (MEAL, KIT, or ACCOMMODATION)
 * @param serviceAreaPincodes - Optional array of serviceable pincodes (required for MEAL/ACCOMMODATION)
 * @returns Validation result with category-specific fields
 *
 * @example
 * // KIT customer - only format check
 * const kitResult = validateAddressForCategory(
 *   { pincode: '560001' },
 *   'KIT'
 * );
 * // Returns: { valid: true }
 *
 * @example
 * // MEAL customer - format + serviceability check
 * const mealResult = validateAddressForCategory(
 *   { pincode: '560001' },
 *   'MEAL',
 *   ['500001', '500002']
 * );
 * // Returns: { valid: true, serviceable: false, error: "..." }
 */
export function validateAddressForCategory(
  address: AddressInput,
  category: CustomerCategory,
  serviceAreaPincodes: string[] = [],
): AddressValidationResult {
  const normalized = normalizePincode(address.pincode);
  const isValidFormat = PINCODE_FORMAT_REGEX.test(normalized);

  // Requirement 3.1, 3.2: KIT category bypasses serviceability check
  if (category === "KIT") {
    if (!isValidFormat) {
      return {
        valid: false,
        error: "Pincode must be exactly 6 digits.",
      };
    }

    return { valid: true };
  }

  // Requirement 3.3: MEAL and ACCOMMODATION categories enforce serviceability
  if (category === "MEAL" || category === "ACCOMMODATION") {
    if (!isValidFormat) {
      return {
        valid: false,
        serviceable: false,
        error: "Pincode must be exactly 6 digits.",
      };
    }

    const serviceable = isDeliverablePincode(normalized, serviceAreaPincodes);

    if (!serviceable) {
      return {
        valid: true,
        serviceable: false,
        error: `Sorry, we don't deliver to pincode ${normalized}. This pincode is outside our current service area.`,
      };
    }

    return {
      valid: true,
      serviceable: true,
    };
  }

  // Fallback for unknown categories (should never happen with proper typing)
  return {
    valid: false,
    serviceable: false,
    error: `Unknown customer category: ${category}`,
  };
}
