"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Loader2, Locate, MapPin, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/shared/components/ui/input";
import {
  extractLocalityFields,
  type ResolvedLocalityFields,
} from "@/lib/address/extractLocalityFields";

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };

const LOCATION_ERROR_MESSAGE =
  "Please activate location services on your device and grant permission to locate your current address.";

const LOCATION_PERMISSION_DENIED_MESSAGE =
  "Location permission is blocked. Please enable it for this app in your device Settings, then try again.";

// Stable reference so the JS API loader is not re-initialised on every render
// (must match the libraries used elsewhere for the same script id).
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

export type AddressPickerMapProps = {
  lat: number | null;
  lng: number | null;
  disabled?: boolean;
  showLocateButton?: boolean;
  onCoordinatesChange: (lat: number, lng: number) => void;
  /**
   * When provided, renders a Google Places search box above the map and
   * auto-fills street/area/city/state/pincode whenever a place is selected,
   * the pin is dragged, or "Detect" locates the customer — mirroring the
   * admin Quick Onboarding address capture flow.
   */
  onAddressResolved?: (
    fields: ResolvedLocalityFields,
    lat: number,
    lng: number,
  ) => void;
  /** Show the "Search location" autocomplete box above the map. */
  showSearchBox?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
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

async function getCurrentPosition(): Promise<{ latitude: number; longitude: number }> {
  if (Capacitor.isNativePlatform()) {
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== "granted") {
      permissions = await Geolocation.requestPermissions();
    }
    if (permissions.location !== "granted") {
      // "denied" here means the user has permanently blocked the prompt
      // (Android 13+ won't re-prompt after two denials) — request a Settings visit.
      const permanentlyDenied = permissions.location === "denied";
      throw new Error(permanentlyDenied ? "permission_blocked" : "permission_denied");
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

export function AddressPickerMap({
  lat,
  lng,
  disabled = false,
  showLocateButton = true,
  onCoordinatesChange,
  onAddressResolved,
  showSearchBox = false,
  searchPlaceholder = "Search apartment name or locality",
}: AddressPickerMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteServiceRef =
    useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const [isLocating, setIsLocating] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [predictions, setPredictions] = useState<
    google.maps.places.AutocompletePrediction[]
  >([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [mapCenter, setMapCenter] = useState<google.maps.LatLngLiteral>(
    () => toCoords(lat, lng) ?? HYDERABAD_CENTER,
  );

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey as string,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Sync center when coords change externally (Detect Location, edit reset).
  useEffect(() => {
    const coords = toCoords(lat, lng);
    if (!coords || isDraggingRef.current) return;
    setMapCenter(coords);
    mapRef.current?.panTo(coords);
  }, [lat, lng]);

  /** Reverse-geocode a coordinate pair and, if resolved, report locality fields. */
  const reverseGeocodeAndResolve = useCallback(
    async (latitude: number, longitude: number) => {
      if (!onAddressResolved || typeof google === "undefined") return;
      const geocoder =
        geocoderRef.current ?? (geocoderRef.current = new google.maps.Geocoder());
      try {
        const response = await geocoder.geocode({
          location: { lat: latitude, lng: longitude },
        });
        const first = response.results?.[0] ?? null;
        if (first?.address_components) {
          onAddressResolved(
            extractLocalityFields(first.address_components),
            latitude,
            longitude,
          );
        }
      } catch {
        // Silently ignore — coordinates are already applied via onCoordinatesChange.
      }
    },
    [onAddressResolved],
  );

  const applyCoordinates = useCallback(
    (latitude: number, longitude: number) => {
      const coords = { lat: latitude, lng: longitude };
      setMapCenter(coords);
      mapRef.current?.panTo(coords);
      onCoordinatesChange(latitude, longitude);
      void reverseGeocodeAndResolve(latitude, longitude);
    },
    [onCoordinatesChange, reverseGeocodeAndResolve],
  );

  const emitCenterCoords = useCallback(() => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const nextLat = center.lat();
    const nextLng = center.lng();
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    onCoordinatesChange(nextLat, nextLng);
    void reverseGeocodeAndResolve(nextLat, nextLng);
  }, [onCoordinatesChange, reverseGeocodeAndResolve]);

  /**
   * Resolve a Places `place_id` to coordinates + locality fields via the
   * Geocoder (which accepts a placeId and returns geometry AND
   * address_components in one call), then pan the map and auto-fill.
   */
  const resolvePlaceId = useCallback(
    async (placeId: string) => {
      if (typeof google === "undefined") return;
      const geocoder =
        geocoderRef.current ??
        (geocoderRef.current = new google.maps.Geocoder());
      try {
        const response = await geocoder.geocode({ placeId });
        const first = response.results?.[0];
        const location = first?.geometry?.location;
        if (!first || !location) return;

        const latitude = location.lat();
        const longitude = location.lng();
        const coords = { lat: latitude, lng: longitude };
        setMapCenter(coords);
        mapRef.current?.panTo(coords);
        onCoordinatesChange(latitude, longitude);

        if (first.address_components) {
          onAddressResolved?.(
            extractLocalityFields(first.address_components),
            latitude,
            longitude,
          );
        }
      } catch {
        // Silently ignore — the user can still drag the pin.
      }
    },
    [onAddressResolved, onCoordinatesChange],
  );

  /**
   * Debounced Places Autocomplete lookup. We render the prediction list
   * ourselves (see JSX below) instead of using the `<Autocomplete>` widget,
   * whose dropdown is portalled to <body> and becomes unclickable inside a
   * Radix Dialog (pointer-events lock + nested dismissable layers). This
   * custom dropdown lives inside the dialog DOM, so it just works.
   */
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (
      trimmed.length < 3 ||
      typeof google === "undefined" ||
      !google.maps?.places
    ) {
      setPredictions([]);
      setShowPredictions(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const service =
        autocompleteServiceRef.current ??
        (autocompleteServiceRef.current =
          new google.maps.places.AutocompleteService());
      if (!sessionTokenRef.current) {
        sessionTokenRef.current =
          new google.maps.places.AutocompleteSessionToken();
      }
      service.getPlacePredictions(
        {
          input: trimmed,
          componentRestrictions: { country: "in" },
          sessionToken: sessionTokenRef.current,
        },
        (results, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            results &&
            results.length > 0
          ) {
            setPredictions(results);
            setShowPredictions(true);
          } else {
            setPredictions([]);
            setShowPredictions(false);
          }
        },
      );
    }, 250);
  }, []);

  const handleSelectPrediction = useCallback(
    (prediction: google.maps.places.AutocompletePrediction) => {
      setSearchInput(prediction.description);
      setPredictions([]);
      setShowPredictions(false);
      // A session ends once a place is selected — drop the token so the next
      // search starts a fresh (correctly billed) session.
      sessionTokenRef.current = null;
      void resolvePlaceId(prediction.place_id);
    },
    [resolvePlaceId],
  );

  // Clean up any pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
      const coords = toCoords(lat, lng) ?? HYDERABAD_CENTER;
      map.panTo(coords);
    },
    [lat, lng],
  );

  const handleLocateMe = useCallback(async () => {
    if (disabled || isLocating) return;

    setIsLocating(true);
    try {
      const { latitude, longitude } = await getCurrentPosition();

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("invalid_coords");
      }

      applyCoordinates(latitude, longitude);
    } catch (error) {
      const message =
        error instanceof Error && error.message === "permission_blocked"
          ? LOCATION_PERMISSION_DENIED_MESSAGE
          : LOCATION_ERROR_MESSAGE;
      toast.error(message);
    } finally {
      setIsLocating(false);
    }
  }, [applyCoordinates, disabled, isLocating]);

  if (!apiKey) {
    return (
      <div className="h-[220px] w-full bg-zinc-100 rounded-lg flex items-center justify-center text-xs text-zinc-500 text-center px-4">
        Map unavailable. Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-[220px] w-full bg-zinc-100 rounded-lg flex items-center justify-center text-xs text-red-500 text-center px-4">
        Failed to load Google Maps. Please try again.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-[220px] w-full bg-zinc-100 animate-pulse rounded-lg flex items-center justify-center text-xs text-zinc-400 font-medium">
        Loading map...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {showSearchBox && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            className="pl-8"
            maxLength={255}
            placeholder={searchPlaceholder}
            value={searchInput}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => handleSearchChange(event.target.value)}
            onFocus={() => {
              if (predictions.length > 0) setShowPredictions(true);
            }}
            // Delay hiding so a click on a prediction registers first.
            onBlur={() => window.setTimeout(() => setShowPredictions(false), 150)}
          />

          {showPredictions && predictions.length > 0 && (
            <ul className="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              {predictions.map((prediction) => (
                <li key={prediction.place_id}>
                  <button
                    type="button"
                    // Prevent the input's blur from firing before the click,
                    // which would close the list before selection registers.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectPrediction(prediction)}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-zinc-50"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-800">
                        {prediction.structured_formatting?.main_text ??
                          prediction.description}
                      </span>
                      {prediction.structured_formatting?.secondary_text && (
                        <span className="block truncate text-xs text-zinc-500">
                          {prediction.structured_formatting.secondary_text}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className={`relative h-[220px] w-full rounded-lg overflow-hidden border border-zinc-200 ${
          disabled ? "opacity-50 pointer-events-none" : ""
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

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-10 flex flex-col items-center">
          <MapPin className="h-8 w-8 text-primary drop-shadow-md fill-primary/20" />
          <div className="h-1.5 w-1.5 rounded-full bg-primary/80 -mt-1" />
        </div>

        <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-zinc-600 bg-white/80 mx-4 py-1 rounded-md pointer-events-none">
          Drag the map to pin your exact delivery location
        </p>
      </div>
    </div>
  );
}
