export type Coordinates = { lat: number; lng: number };

type AddressLike = {
  id?: string;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  state?: string | null;
};

const INDIA_LAT_MIN = 6;
const INDIA_LAT_MAX = 37;
const INDIA_LNG_MIN = 68;
const INDIA_LNG_MAX = 97;

export function isValidDeliveryCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return (
    lat >= INDIA_LAT_MIN &&
    lat <= INDIA_LAT_MAX &&
    lng >= INDIA_LNG_MIN &&
    lng <= INDIA_LNG_MAX
  );
}

async function resolveFromPincode(
  address: AddressLike,
  apiKey: string,
  pincodeCache: Map<string, Coordinates>,
): Promise<Coordinates | null> {
  if (!address.pincode) return null;

  const cached = pincodeCache.get(address.pincode);
  if (cached) return cached;

  const coords = await geocodePincode(
    address.pincode,
    address.city,
    address.state,
    apiKey,
  );
  if (!coords) return null;

  pincodeCache.set(address.pincode, coords);
  return coords;
}

export async function geocodePincode(
  pincode: string,
  city: string | null | undefined,
  state: string | null | undefined,
  apiKey: string,
): Promise<Coordinates | null> {
  const locationParts = [pincode, city, state, "India"].filter(Boolean);
  const address = encodeURIComponent(locationParts.join(", "));

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&region=in&key=${apiKey}`,
  );
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    console.warn(`Geocoding failed for pincode ${pincode}:`, data.status);
    return null;
  }

  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

export async function resolveAddressCoordinates(
  address: AddressLike | null | undefined,
  apiKey: string,
  pincodeCache: Map<string, Coordinates>,
): Promise<{ coords: Coordinates; usedPincodeFallback: boolean } | null> {
  if (!address) return null;

  if (address.lat != null && address.lng != null) {
    const lat = Number(address.lat);
    const lng = Number(address.lng);

    if (isValidDeliveryCoordinate(lat, lng)) {
      return { coords: { lat, lng }, usedPincodeFallback: false };
    }
  }

  const pincodeCoords = await resolveFromPincode(address, apiKey, pincodeCache);
  if (!pincodeCoords) return null;

  return { coords: pincodeCoords, usedPincodeFallback: true };
}
