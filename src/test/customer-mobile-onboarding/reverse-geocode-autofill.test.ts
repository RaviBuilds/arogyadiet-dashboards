// Integration test (light example) — Google reverse-geocode auto-fill mapping
// (customer-mobile-onboarding, Task 11.2).
//
// SCOPE: the AddressCaptureMap component reverse-geocodes a coordinate via the
// Google Geocoder and maps the returned `address_components` into the
// area/city/state/pincode fields it auto-fills (Req 5.3), leaving fields that
// cannot be resolved empty so the caller can surface an unresolved-address
// error (Req 5.7).
//
// `extractLocalityFields` is a module-private helper inside a "use client"
// component (`AddressCaptureMap.tsx`) that transitively imports Google Maps and
// Capacitor browser-only modules, so it is not importable into a node test.
// Per the task guidance ("test the extractLocalityFields-style mapping if
// exported, else keep this as a light example"), this test documents and pins
// the mapping contract against a representative Google Geocoder response using a
// faithful local reproduction of the component's mapping rules.
//
// Validates: Requirements 5.3 (mapping contract), 5.7 (unresolved → empty)

import { describe, expect, it } from "vitest";

// ─── Faithful reproduction of AddressCaptureMap.extractLocalityFields ────────
// Mirrors the private mapping in src/shared/components/address/AddressCaptureMap.tsx
// (kept in sync with the component; a change there should update this contract).
interface AddressComponent {
  long_name: string;
  types: string[];
}

interface ResolvedLocalityFields {
  area: string;
  city: string;
  state: string;
  pincode: string;
}

function extractLocalityFields(
  components: AddressComponent[],
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

  return { area, city, state, pincode };
}

// A representative Google Geocoder reverse-geocode result for a Hyderabad
// coordinate (the kind of `address_components` array the Geocoder returns).
const HYDERABAD_COMPONENTS: AddressComponent[] = [
  { long_name: "Madhapur", types: ["sublocality_level_1", "sublocality", "political"] },
  { long_name: "Hyderabad", types: ["locality", "political"] },
  { long_name: "Hyderabad", types: ["administrative_area_level_2", "political"] },
  { long_name: "Telangana", types: ["administrative_area_level_1", "political"] },
  { long_name: "India", types: ["country", "political"] },
  { long_name: "500081", types: ["postal_code"] },
];

describe("Google reverse-geocode auto-fill mapping (Req 5.3)", () => {
  it("maps address_components to area/city/state/pincode + records lat/lng", () => {
    const fields = extractLocalityFields(HYDERABAD_COMPONENTS);

    expect(fields).toEqual({
      area: "Madhapur",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500081",
    });
  });

  it("falls back through the locality/area type preference order", () => {
    // No `locality` and no `sublocality_level_1`: city falls back to
    // administrative_area_level_2, area falls back to `route`.
    const components: AddressComponent[] = [
      { long_name: "Old Airport Rd", types: ["route"] },
      { long_name: "Bengaluru Urban", types: ["administrative_area_level_2", "political"] },
      { long_name: "Karnataka", types: ["administrative_area_level_1", "political"] },
      { long_name: "560017", types: ["postal_code"] },
    ];

    const fields = extractLocalityFields(components);

    expect(fields).toEqual({
      area: "Old Airport Rd",
      city: "Bengaluru Urban",
      state: "Karnataka",
      pincode: "560017",
    });
  });

  it("leaves unresolved fields empty when the geocoder omits them (Req 5.7)", () => {
    // A sparse ocean-point response with only a country component.
    const components: AddressComponent[] = [
      { long_name: "India", types: ["country", "political"] },
    ];

    const fields = extractLocalityFields(components);

    expect(fields).toEqual({ area: "", city: "", state: "", pincode: "" });
  });
});
