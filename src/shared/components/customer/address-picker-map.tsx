"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Loader2, Locate, MapPin } from "lucide-react";
import { toast } from "sonner";

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };

const LOCATION_ERROR_MESSAGE =
  "Please activate location services on your device and grant permission to locate your current address.";

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

export function AddressPickerMap({
  lat,
  lng,
  disabled = false,
  showLocateButton = true,
  onCoordinatesChange,
}: AddressPickerMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const isDraggingRef = useRef(false);
  const [isLocating, setIsLocating] = useState(false);
  const [mapCenter, setMapCenter] = useState<google.maps.LatLngLiteral>(
    () => toCoords(lat, lng) ?? HYDERABAD_CENTER,
  );

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey as string,
  });

  // Sync center when coords change externally (Detect Location, edit reset).
  useEffect(() => {
    const coords = toCoords(lat, lng);
    if (!coords || isDraggingRef.current) return;
    setMapCenter(coords);
    mapRef.current?.panTo(coords);
  }, [lat, lng]);

  const applyCoordinates = useCallback(
    (latitude: number, longitude: number) => {
      const coords = { lat: latitude, lng: longitude };
      setMapCenter(coords);
      mapRef.current?.panTo(coords);
      onCoordinatesChange(latitude, longitude);
    },
    [onCoordinatesChange],
  );

  const emitCenterCoords = useCallback(() => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const nextLat = center.lat();
    const nextLng = center.lng();
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    onCoordinatesChange(nextLat, nextLng);
  }, [onCoordinatesChange]);

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
    } catch {
      toast.error(LOCATION_ERROR_MESSAGE);
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
  );
}
