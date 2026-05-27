export type Coordinates = { lat: number; lng: number };

type AddressLike = {
  id?: string;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  state?: string | null;
};

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
    return {
      coords: { lat: Number(address.lat), lng: Number(address.lng) },
      usedPincodeFallback: false,
    };
  }

  if (!address.pincode) return null;

  const cached = pincodeCache.get(address.pincode);
  if (cached) {
    return { coords: cached, usedPincodeFallback: true };
  }

  const coords = await geocodePincode(
    address.pincode,
    address.city,
    address.state,
    apiKey,
  );
  if (!coords) return null;

  pincodeCache.set(address.pincode, coords);
  return { coords, usedPincodeFallback: true };
}
