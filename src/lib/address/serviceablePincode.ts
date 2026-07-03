/**
 * Serviceable-pincode gate logic for the map-based Address_Capture component.
 *
 * Pure decision logic (no I/O) backing the admin quick-onboarding address save:
 *  - Requirement 5.6: a captured address whose pincode is outside the franchise's
 *    serviceable pincodes must surface a not-serviceable warning naming that pincode,
 *    and the address must not be saveable until a serviceable pincode is selected.
 *  - Requirement 5.8: an address with an empty flat number must not be saveable, and
 *    the save must be rejected with a flat-number-required error.
 *
 * Validates: Requirements 5.6, 5.8
 */

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
 * The address is saveable if and only if its pincode is serviceable (Req 5.6)
 * AND its flat number is non-empty (Req 5.8). When it is not saveable, every
 * blocking reason is reported so the UI can keep the relevant warnings visible.
 */
export function canSaveAddress(input: AddressSaveInput): AddressSaveDecision {
  const errors: AddressSaveError[] = [];

  if (!isServiceable(input.pincode, input.serviceAreaPincodes)) {
    errors.push("PINCODE_NOT_SERVICEABLE");
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
