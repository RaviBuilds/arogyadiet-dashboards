"use client";

// src/shared/components/master/core-business/ClinicLocationPicker.tsx
// Map-based location picker for the Core Clinic create/edit dialog
// (core-clinic-architecture). The Clinic is the sole rider pickup / routing
// origin, so getting its geo coordinates right matters (Req 21.5, 3.11).
//
// This component is fully controlled by React Hook Form: it reads the
// `latitude` / `longitude` fields from the shared clinic form and writes back
// to them whenever the master user interacts with the map. The plain numeric
// lat/lng inputs in the dialog remain the source of truth for validation — the
// map is a convenient, two-way-synced way to set those same values.
//
// UX:
//   • Click anywhere on the map to drop / move the pin.
//   • Drag the pin to fine-tune the exact spot.
//   • "Use my location" centers the pin on the master's current GPS position.
//   • Typing into the lat/lng inputs re-centers the map (handled by the parent
//     via the `latitude` / `longitude` watched values flowing back in).

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";
import { Loader2, Locate, MapPin } from "lucide-react";
import { toast } from "sonner";

import type { ClinicMasterSchemaInput } from "@/validations/clinic";
import { Button } from "@/shared/components/ui/button";

// Hyderabad city center — sensible default when no coordinates are set yet,
// matching the other master/admin maps in the codebase.
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 17.385, lng: 78.4867 };

const mapContainerStyle = {
  width: "100%",
  height: "260px",
};

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  gestureHandling: "greedy",
  styles: [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

function toCoords(
  lat: number | undefined,
  lng: number | undefined
): google.maps.LatLngLiteral | null {
  if (lat === undefined || lng === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Round to 6 decimals (~0.11 m precision) to keep stored values tidy. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
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

export function ClinicLocationPicker({
  form,
}: {
  form: UseFormReturn<ClinicMasterSchemaInput>;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey as string,
  });

  // Watch the form fields so the marker + map stay in sync with whatever the
  // numeric inputs hold (manual typing, edit-dialog reset, or map clicks).
  const latitude = form.watch("latitude");
  const longitude = form.watch("longitude");
  const markerPosition = toCoords(latitude, longitude);

  // Write coordinates back into the RHF form, triggering validation so the
  // FormMessage under each numeric input clears/updates immediately.
  const applyCoordinates = useCallback(
    (lat: number, lng: number) => {
      form.setValue("latitude", round6(lat), {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("longitude", round6(lng), {
        shouldValidate: true,
        shouldDirty: true,
      });
    },
    [form]
  );

  // Keep the map centered on the current coordinates when they change from
  // outside the map (e.g. the master types into the lat/lng inputs).
  useEffect(() => {
    if (markerPosition) {
      mapRef.current?.panTo(markerPosition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (e.latLng) applyCoordinates(e.latLng.lat(), e.latLng.lng());
    },
    [applyCoordinates]
  );

  const handleMarkerDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (e.latLng) applyCoordinates(e.latLng.lat(), e.latLng.lng());
    },
    [applyCoordinates]
  );

  const handleMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      const coords = toCoords(latitude, longitude);
      if (coords) map.panTo(coords);
    },
    [latitude, longitude]
  );

  const handleLocateMe = useCallback(async () => {
    if (isLocating) return;
    setIsLocating(true);
    try {
      const position = await getBrowserPosition();
      const { latitude: lat, longitude: lng } = position.coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("invalid_coords");
      }
      applyCoordinates(lat, lng);
      mapRef.current?.setZoom(16);
    } catch {
      toast.error(
        "Couldn't get your current location. Enable location access and try again."
      );
    } finally {
      setIsLocating(false);
    }
  }, [applyCoordinates, isLocating]);

  const shell =
    "h-[260px] w-full rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-center px-4 text-xs";

  if (!apiKey) {
    return (
      <div className={`${shell} text-slate-500`}>
        Map unavailable. Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to pick a
        location on the map.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`${shell} text-red-500`}>
        Failed to load Google Maps. You can still enter the latitude and
        longitude manually below.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-sm font-medium text-slate-700">
          <MapPin className="h-3.5 w-3.5 text-emerald-600" />
          Pin location on map
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={handleLocateMe}
          disabled={isLocating}
        >
          {isLocating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Locate className="h-3.5 w-3.5" />
          )}
          Use my location
        </Button>
      </div>

      {isLoaded ? (
        <div className="relative overflow-hidden rounded-xl border border-slate-200">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={markerPosition ?? DEFAULT_CENTER}
            zoom={markerPosition ? 15 : 11}
            options={mapOptions}
            onClick={handleMapClick}
            onLoad={handleMapLoad}
          >
            {markerPosition && (
              <Marker
                position={markerPosition}
                draggable
                onDragEnd={handleMarkerDragEnd}
              />
            )}
          </GoogleMap>
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-white/85 py-1 text-center text-[10px] text-slate-600">
            {markerPosition
              ? "Click the map or drag the pin to adjust the exact clinic location"
              : "Click anywhere on the map to drop the clinic pin"}
          </p>
        </div>
      ) : (
        <div className={`${shell} text-slate-400`}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading map...
        </div>
      )}
    </div>
  );
}
