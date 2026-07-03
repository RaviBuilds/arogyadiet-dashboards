/**
 * Serviceable-pincode gate logic for the map-based Address_Capture component.
 *
 * Pure decision logic (no I/O) backing the admin quick-onboarding address save:
 *  - Requirement 5.6: a captured address whose pincode is outside the franchise's
 *    serviceable pincodes must surface a not-serviceable warning naming that pincode,
 *    and the address must not be saveable until a serviceable pincode is selected.
 *  - Requirement 5.8: an address with an empty flat number must not be saveable, and
 *    the save must be rejected with a flat-number-required error.
 *  - Requirements 3.1, 3.2, 3.3: KIT category customers bypass serviceability validation,
 *    while MEAL category customers enforce serviceability checks.
 *
 * Validates: Requirements 5.6, 5.8, 3.1, 3.2, 3.3
 */

import type { CustomerCategory } from "@/lib/onboarding/category";

const PINCODE_FORMAT_REGEX = /^\d{6}$/;

/** The reason a captured address cannot be saved. */
export type AddressSaveError = "PINCODE_NOT_SERVICEABLE" | "FLAT_NUMBER_REQUIRED";

/** Inputs to the {@link canSaveAddress} gate. */
export interface AddressSaveInput {
  /** The pincode resolved for the selected map location. */
  pincode: string;
  /** The manually entered flat number. */
  flatNumber: string;
  /** The serviceable pincodes for the admin's franchise. */
  serviceAreaPincodes: Set<string> | readonly string[];
  /** The customer category (KIT bypasses serviceability check). */
  customerCategory?: CustomerCategory;
}

/** Outcome of the save gate, carrying every blocking reason. */
export interface AddressSaveDecision {
  canSave: boolean;
  errors: AddressSaveError[];
}

/** Trim surrounding whitespace so comparisons are stable. */
function normalizePincode(pincode: string): string {
  return pincode.trim();
}

function toServiceAreaSet(
  serviceAreaPincodes: Set<string> | readonly string[],
): Set<string> {
  if (serviceAreaPincodes instanceof Set) {
    // Normalize members so lookups are whitespace-insensitive.
    const normalized = new Set<string>();
    for (const value of serviceAreaPincodes) {
      normalized.add(normalizePincode(value));
    }
    return normalized;
  }
  return new Set(serviceAreaPincodes.map(normalizePincode));
}

/**
 * Whether the given pincode is within the franchise's serviceable pincodes.
 *
 * A pincode is serviceable if and only if it is a valid 6-digit code that is a
 * member of the provided service-area set. (Requirement 5.6)
 */
export function isServiceable(
  pincode: string,
  serviceAreaPincodes: Set<string> | readonly string[],
): boolean {
  const normalized = normalizePincode(pincode);
  if (!PINCODE_FORMAT_REGEX.test(normalized)) {
    return false;
  }
  return toServiceAreaSet(serviceAreaPincodes).has(normalized);
}

/** Whether the flat number is present (non-empty after trimming). (Requirement 5.8) */
export function hasFlatNumber(flatNumber: string): boolean {
  return flatNumber.trim().length > 0;
}

/**
 * Decide whether a captured address can be saved.
 *
 * The address is saveable if and only if its flat number is non-empty (Req 5.8)
 * AND (for MEAL/ACCOMMODATION) its pincode is serviceable (Req 5.6, 3.3).
 * 
 * For KIT category (Req 3.1, 3.2), serviceability check is bypassed - any valid
 * 6-digit PIN is accepted.
 *
 * When the address is not saveable, every blocking reason is reported so the UI
 * can keep the relevant warnings visible.
 */
export function canSaveAddress(input: AddressSaveInput): AddressSaveDecision {
  const errors: AddressSaveError[] = [];

  // Requirement 3.1, 3.2: KIT category bypasses serviceability check
  // Requirement 3.3: MEAL category enforces serviceability check
  if (input.customerCategory !== "KIT") {
    if (!isServiceable(input.pincode, input.serviceAreaPincodes)) {
      errors.push("PINCODE_NOT_SERVICEABLE");
    }
  }

  if (!hasFlatNumber(input.flatNumber)) {
    errors.push("FLAT_NUMBER_REQUIRED");
  }

  return { canSave: errors.length === 0, errors };
}

/**
 * The not-serviceable warning message naming the offending pincode. (Requirement 5.6)
 * The warning must remain visible until a serviceable pincode is selected.
 */
export function notServiceableMessage(pincode: string): string {
  return `Pincode ${normalizePincode(pincode)} is outside our serviceable areas. Please select a serviceable location.`;
}

/** The flat-number-required error message. (Requirement 5.8) */
export const FLAT_NUMBER_REQUIRED_MESSAGE = "Flat number is required.";
