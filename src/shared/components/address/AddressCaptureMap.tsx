"use client";

// src/shared/components/address/AddressCaptureMap.tsx
//
// Map-based Address_Capture component (Design: "UI — Admin Portal",
// "Address_Capture"). Portal-agnostic and reusable: it owns no persistence and
// takes a controlled `value`/`onChange` pair plus the franchise's serviceable
// pincodes, and reports its validation state back to the parent wizard via
// `onValidityChange`.
//
// It mirrors the interaction pattern of the customer address picker
// (`src/shared/components/customer/address-picker-map.tsx`): `useJsApiLoader`,
// a draggable centre pin, and a "locate me" button, plus the same loading /
// fallback states. On top of that it adds a Google Places Autocomplete search
// box and reverse-geocode auto-fill.
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 15.13

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  useJsApiLoader,
} from "@react-google-maps/api";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { AlertTriangle, Loader2, Locate, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import {
  canSaveAddress,
  FLAT_NUMBER_REQUIRED_MESSAGE,
  hasFlatNumber,
  isServiceable,
  notServiceableMessage,
  type AddressSaveError,
} from "@/lib/address/serviceablePincode";
import type { CustomerCategory } from "@/lib/onboarding/category";

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };

const LOCATION_ERROR_MESSAGE =
  "Please activate location services on your device and grant permission to locate the address.";

const UNRESOLVED_ADDRESS_MESSAGE =
  "We couldn't resolve the full address from this location. Please adjust the pin or refine the search.";

// Stable references so the JS API loader is not re-initialised on every render.
const GOOGLE_MAPS_LIBRARIES: "places"[] = ["places"];

const mapContainerStyle = {
  width: "100%",
  height: "100%",
  borderRadius: "0.75rem",
};

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  gestureHandling: "greedy",
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ],
};

/** The address tag values supported by `addresses.tag` (Req 5.1). */
export type AddressTag = "Home" | "Office";

/**
 * Controlled value of the Address_Capture component. Locality fields
 * (`area`/`city`/`state`/`pincode`) and `lat`/`lng` are auto-filled from the
 * selected map location (Req 5.3); `flatNumber`/`floorNumber` are the only
 * manually entered fields (Req 5.4); `tag` defaults to "Home" (Req 5.1).
 */
export interface AddressCaptureValue {
  tag: AddressTag;
  searchText?: string;
  flatNumber: string;
  floorNumber?: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
}

/** Validation snapshot surfaced to the parent wizard. */
export interface AddressCaptureValidity {
  /** Whether the captured address may be saved (Req 5.6 + 5.8 + resolution). */
  canSave: boolean;
  /** Every blocking reason (serviceability / flat number). */
  errors: AddressSaveError[];
  /** Whether the selected pincode is within the franchise service area (Req 5.6). */
  isServiceable: boolean;
  /** Whether area/city/state/pincode and coordinates all resolved (Req 5.3/5.7). */
  isResolved: boolean;
}

export interface AddressCaptureMapProps {
  /** Controlled address value. */
  value: AddressCaptureValue;
  /** Called with the next value whenever any field changes. */
  onChange: (value: AddressCaptureValue) => void;
  /** The serviceable pincodes for the admin's franchise (Req 5.6). */
  serviceAreaPincodes: string[];
  /** Reports the current validation state to the parent wizard. */
  onValidityChange?: (validity: AddressCaptureValidity) => void;
  /** Disable all interaction (e.g. while submitting). */
  disabled?: boolean;
  /** Show the "locate me" button (defaults to true). */
  showLocateButton?: boolean;
  /** Customer category for category-aware validation (Req 3.1, 3.2, 3.3). */
  customerCategory?: CustomerCategory;
}

/** A blank value convenient for initialising the parent form. */
export const emptyAddressCaptureValue: AddressCaptureValue = {
  tag: "Home",
  searchText: "",
  flatNumber: "",
  floorNumber: "",
  area: "",
  city: "",
  state: "",
  pincode: "",
  lat: null,
  lng: null,
};

function toCoords(
  lat: number | null,
  lng: number | null,
): google.maps.LatLngLiteral | null {
  if (lat == null || lng == null) return null;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

function getBrowserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation_unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

async function getCurrentPosition(): Promise<{
  latitude: number;
  longitude: number;
}> {
  if (Capacitor.isNativePlatform()) {
    const permissions = await Geolocation.requestPermissions();
    if (permissions.location !== "granted") {
      throw new Error("permission_denied");
    }
  }
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });
    return position.coords;
  } catch {
    const position = await getBrowserPosition();
    return position.coords;
  }
}

interface ResolvedLocalityFields {
  area: string;
  city: string;
  state: string;
  pincode: string;
}

/**
 * Extract area/city/state/pincode from Google address components. Fields that
 * cannot be determined are returned as empty strings so the caller can leave
 * them blank and surface an unresolved-address error (Req 5.7).
 */
function extractLocalityFields(
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

  return { area, city, state, pincode };
}

function isFullyResolved(fields: ResolvedLocalityFields): boolean {
  return Boolean(fields.area && fields.city && fields.state && fields.pincode);
}

export function AddressCaptureMap({
  value,
  onChange,
  serviceAreaPincodes,
  onValidityChange,
  disabled = false,
  showLocateButton = true,
  customerCategory,
}: AddressCaptureMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const isDraggingRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onValidityChangeRef = useRef(onValidityChange);

  const [isLocating, setIsLocating] = useState(false);
  const [flatTouched, setFlatTouched] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [mapCenter, setMapCenter] = useState<google.maps.LatLngLiteral>(
    () => toCoords(value.lat, value.lng) ?? HYDERABAD_CENTER,
  );

  // Keep refs current so async callbacks read the latest props without
  // re-binding map/autocomplete handlers.
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onValidityChangeRef.current = onValidityChange;
  });

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey as string,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Sync map centre when coordinates change externally (e.g. parent reset).
  useEffect(() => {
    const coords = toCoords(value.lat, value.lng);
    if (!coords || isDraggingRef.current) return;
    setMapCenter(coords);
    mapRef.current?.panTo(coords);
  }, [value.lat, value.lng]);

  // Report validation state to the parent whenever gating inputs change.
  const serviceKey = serviceAreaPincodes.join(",");
  useEffect(() => {
    const decision = canSaveAddress({
      pincode: value.pincode,
      flatNumber: value.flatNumber,
      serviceAreaPincodes,
      customerCategory,
    });
    const resolved =
      isFullyResolved({
        area: value.area,
        city: value.city,
        state: value.state,
        pincode: value.pincode,
      }) &&
      value.lat != null &&
      value.lng != null;

    onValidityChangeRef.current?.({
      canSave: decision.canSave && resolved,
      errors: decision.errors,
      isServiceable: isServiceable(value.pincode, serviceAreaPincodes),
      isResolved: resolved,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    value.pincode,
    value.flatNumber,
    value.area,
    value.city,
    value.state,
    value.lat,
    value.lng,
    serviceKey,
    customerCategory,
  ]);

  const patchValue = useCallback((patch: Partial<AddressCaptureValue>) => {
    onChangeRef.current({ ...valueRef.current, ...patch });
  }, []);

  /**
   * Apply a resolved location: record coordinates, then auto-fill the locality
   * fields (Req 5.3). Fields that cannot be resolved are left empty and an
   * unresolved-address error is raised, while manual inputs are retained
   * (Req 5.7).
   */
  const applyLocation = useCallback(
    (
      lat: number,
      lng: number,
      components: google.maps.GeocoderAddressComponent[] | null,
    ) => {
      const coords = { lat, lng };
      setMapCenter(coords);
      mapRef.current?.panTo(coords);

      if (!components || components.length === 0) {
        setUnresolved(true);
        patchValue({ lat, lng, area: "", city: "", state: "", pincode: "" });
        return;
      }

      const fields = extractLocalityFields(components);
      setUnresolved(!isFullyResolved(fields));
      patchValue({ lat, lng, ...fields });
    },
    [patchValue],
  );

  /** Reverse-geocode a coordinate pair and auto-fill locality fields. */
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      if (typeof google === "undefined") return;
      const geocoder =
        geocoderRef.current ?? (geocoderRef.current = new google.maps.Geocoder());
      try {
        const response = await geocoder.geocode({ location: { lat, lng } });
        const first = response.results?.[0] ?? null;
        applyLocation(lat, lng, first?.address_components ?? null);
      } catch {
        applyLocation(lat, lng, null);
      }
    },
    [applyLocation],
  );

  const emitCenterCoords = useCallback(() => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const nextLat = center.lat();
    const nextLng = center.lng();
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    void reverseGeocode(nextLat, nextLng);
  }, [reverseGeocode]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    if (disabled) return;
    emitCenterCoords();
  }, [disabled, emitCenterCoords]);

  const handleMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      const coords = toCoords(value.lat, value.lng) ?? HYDERABAD_CENTER;
      map.panTo(coords);
    },
    [value.lat, value.lng],
  );

  const handleLocateMe = useCallback(async () => {
    if (disabled || isLocating) return;
    setIsLocating(true);
    try {
      const { latitude, longitude } = await getCurrentPosition();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("invalid_coords");
      }
      await reverseGeocode(latitude, longitude);
    } catch {
      toast.error(LOCATION_ERROR_MESSAGE);
    } finally {
      setIsLocating(false);
    }
  }, [disabled, isLocating, reverseGeocode]);

  const handleAutocompleteLoad = useCallback(
    (autocomplete: google.maps.places.Autocomplete) => {
      autocompleteRef.current = autocomplete;
    },
    [],
  );

  const handlePlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    const location = place?.geometry?.location;
    if (!place || !location) return;

    const lat = location.lat();
    const lng = location.lng();
    const searchText = place.formatted_address ?? valueRef.current.searchText;

    if (place.address_components && place.address_components.length > 0) {
      const coords = { lat, lng };
      setMapCenter(coords);
      mapRef.current?.panTo(coords);
      const fields = extractLocalityFields(place.address_components);
      setUnresolved(!isFullyResolved(fields));
      patchValue({ lat, lng, searchText, ...fields });
    } else {
      patchValue({ searchText });
      void reverseGeocode(lat, lng);
    }
  }, [patchValue, reverseGeocode]);

  const showServiceableWarning =
    customerCategory !== "KIT" && // Req 3.1, 3.2: KIT bypasses serviceability
    value.pincode.trim().length > 0 &&
    !isServiceable(value.pincode, serviceAreaPincodes);
  const showFlatError = flatTouched && !hasFlatNumber(value.flatNumber);

  if (!apiKey) {
    return (
      <div className="flex h-[220px] w-full items-center justify-center rounded-lg bg-zinc-100 px-4 text-center text-xs text-zinc-500">
        Map unavailable. Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-[220px] w-full items-center justify-center rounded-lg bg-zinc-100 px-4 text-center text-xs text-red-500">
        Failed to load Google Maps. Please try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Req 5.1: Home/Office tag selector at the top, Home selected by default. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="address-tag">Address type</Label>
        <RadioGroup
          id="address-tag"
          className="flex gap-3"
          value={value.tag}
          onValueChange={(tag) => patchValue({ tag: tag as AddressTag })}
          disabled={disabled}
        >
          {(["Home", "Office"] as const).map((tag) => (
            <label
              key={tag}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-primary/5"
            >
              <RadioGroupItem value={tag} aria-label={tag} />
              {tag}
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Req 5.2: location search box + Google Map. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="address-search">Search location</Label>
        {isLoaded ? (
          <Autocomplete
            onLoad={handleAutocompleteLoad}
            onPlaceChanged={handlePlaceChanged}
            options={{
              fields: ["geometry", "address_components", "formatted_address"],
              componentRestrictions: { country: "in" },
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="address-search"
                type="text"
                className="pl-8"
                maxLength={255}
                placeholder="Search apartment name or locality"
                defaultValue={value.searchText ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  patchValue({ searchText: event.target.value })
                }
              />
            </div>
          </Autocomplete>
        ) : (
          <div className="h-8 w-full animate-pulse rounded-lg bg-zinc-100" />
        )}
      </div>

      {/* Map with draggable centre pin + locate button (mirrors legacy picker). */}
      {isLoaded ? (
        <div
          className={`relative h-[220px] w-full overflow-hidden rounded-lg border border-zinc-200 ${
            disabled ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={mapCenter}
            zoom={16}
            options={{
              ...mapOptions,
              zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_CENTER,
              },
              draggable: !disabled,
              scrollwheel: !disabled,
              disableDoubleClickZoom: disabled,
            }}
            onLoad={handleMapLoad}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />

          {showLocateButton && (
            <button
              type="button"
              aria-label="Locate me"
              disabled={disabled || isLocating}
              onClick={handleLocateMe}
              className="absolute right-[10px] bottom-[calc(50%+48px)] z-20 flex h-10 w-10 items-center justify-center rounded-sm border border-zinc-200 bg-white text-zinc-700 shadow-md transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLocating ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <Locate className="h-[18px] w-[18px]" />
              )}
            </button>
          )}

          <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center">
            <MapPin className="h-8 w-8 fill-primary/20 text-primary drop-shadow-md" />
            <div className="-mt-1 h-1.5 w-1.5 rounded-full bg-primary/80" />
          </div>

          <p className="pointer-events-none absolute right-0 bottom-2 left-0 mx-4 rounded-md bg-white/80 py-1 text-center text-[10px] text-zinc-600">
            Drag the map to pin the exact delivery location
          </p>
        </div>
      ) : (
        <div className="flex h-[220px] w-full animate-pulse items-center justify-center rounded-lg bg-zinc-100 text-xs font-medium text-zinc-400">
          Loading map...
        </div>
      )}

      {/* Req 5.7: unresolved-locality error; manual values are retained. */}
      {unresolved && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Address not resolved</AlertTitle>
          <AlertDescription>{UNRESOLVED_ADDRESS_MESSAGE}</AlertDescription>
        </Alert>
      )}

      {/* Req 5.6, 3.3: not-serviceable warning naming the pincode; stays visible
          until a serviceable pincode is selected. Hidden for KIT category (Req 3.1, 3.2). */}
      {showServiceableWarning && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Location not serviceable</AlertTitle>
          <AlertDescription>
            {notServiceableMessage(value.pincode)}
          </AlertDescription>
        </Alert>
      )}

      {/* Req 5.4: flat/floor are the only manually entered fields. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="flat-number">Flat number</Label>
          <Input
            id="flat-number"
            type="text"
            maxLength={50}
            placeholder="e.g. 302"
            value={value.flatNumber}
            disabled={disabled}
            aria-invalid={showFlatError}
            onChange={(event) => patchValue({ flatNumber: event.target.value })}
            onBlur={() => setFlatTouched(true)}
          />
          {/* Req 5.8: flat number is required to save. */}
          {showFlatError && (
            <p className="text-xs text-destructive">
              {FLAT_NUMBER_REQUIRED_MESSAGE}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="floor-number">Floor number</Label>
          <Input
            id="floor-number"
            type="text"
            maxLength={20}
            placeholder="Optional"
            value={value.floorNumber ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchValue({ floorNumber: event.target.value })
            }
          />
        </div>
      </div>

      {/* Req 5.3: auto-filled locality fields (read-only, resolved from map). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="address-area">Area</Label>
          <Input
            id="address-area"
            type="text"
            readOnly
            placeholder="Auto-filled from map"
            value={value.area}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address-city">City</Label>
          <Input
            id="address-city"
            type="text"
            readOnly
            placeholder="Auto-filled from map"
            value={value.city}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address-state">State</Label>
          <Input
            id="address-state"
            type="text"
            readOnly
            placeholder="Auto-filled from map"
            value={value.state}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address-pincode">Pincode</Label>
          <Input
            id="address-pincode"
            type="text"
            readOnly
            placeholder="Auto-filled from map"
            value={value.pincode}
            aria-invalid={showServiceableWarning}
          />
        </div>
      </div>
    </div>
  );
}

export default AddressCaptureMap;
