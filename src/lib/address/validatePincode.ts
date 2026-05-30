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
