// src/lib/address/extractLocalityFields.ts
//
// Shared helper for turning a Google Places / Geocoder `address_components`
// array into the locality fields our address forms auto-fill (street/area,
// city, state, pincode). Extracted from the admin Address_Capture component
// (`src/shared/components/address/AddressCaptureMap.tsx`) so the customer
// portal's address picker can reuse the exact same resolution logic.

export interface ResolvedLocalityFields {
  /** Combined premise/route/sublocality — reads like "Street / Locality". */
  streetAddress: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
}

/**
 * Extract streetAddress/area/city/state/pincode from Google address
 * components. Fields that cannot be determined are returned as empty
 * strings so the caller can leave them blank and surface an
 * unresolved-address message instead of guessing.
 */
export function extractLocalityFields(
  components: google.maps.GeocoderAddressComponent[],
): ResolvedLocalityFields {
  const byType = (type: string) =>
    components.find((component) => component.types.includes(type));

  const pincode = byType("postal_code")?.long_name ?? "";
  const state = byType("administrative_area_level_1")?.long_name ?? "";
  const city =
    byType("locality")?.long_name ??
    byType("postal_town")?.long_name ??
    byType("administrative_area_level_2")?.long_name ??
    "";
  const area =
    byType("sublocality_level_1")?.long_name ??
    byType("sublocality")?.long_name ??
    byType("neighborhood")?.long_name ??
    byType("route")?.long_name ??
    "";

  const streetParts = [
    byType("premise")?.long_name,
    byType("route")?.long_name,
    byType("sublocality_level_2")?.long_name,
    byType("sublocality_level_1")?.long_name,
    byType("neighborhood")?.long_name,
  ].filter(Boolean);
  const streetAddress = streetParts.join(", ");

  return { streetAddress, area, city, state, pincode };
}

export function isFullyResolvedLocality(fields: ResolvedLocalityFields): boolean {
  return Boolean(fields.area && fields.city && fields.state && fields.pincode);
}

/**
 * Reverse-geocode a coordinate pair into locality fields using the Google
 * Geocoder. Returns `null` if the Maps JS API is unavailable or the location
 * cannot be resolved. Callers must ensure the Maps JS API (with the geocoding
 * service) is already loaded — typically because an <AddressPickerMap /> /
 * useJsApiLoader has mounted on the page.
 */
export async function reverseGeocodeToFields(
  lat: number,
  lng: number,
): Promise<ResolvedLocalityFields | null> {
  if (typeof google === "undefined" || !google.maps?.Geocoder) return null;
  const geocoder = new google.maps.Geocoder();
  try {
    const response = await geocoder.geocode({ location: { lat, lng } });
    const first = response.results?.[0] ?? null;
    if (!first?.address_components) return null;
    return extractLocalityFields(first.address_components);
  } catch {
    return null;
  }
}
