"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
} from "@react-google-maps/api";
import { AlertCircle, MapPin, NavigationOff } from "lucide-react";
import {
  getRiderLiveLocation,
  type LiveTrackingStop,
} from "@/actions/admin-actions/liveTrackingActions";

const CONTAINER_STYLE = {
  width: "100%",
  height: "100%",
  minHeight: "600px",
} as const;

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };
const GPS_STALE_MS = 90_000;
const LOCATION_POLL_MS = 5_000;
const DEFAULT_ZOOM = 13;

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ],
};

type RiderCoords = { lat: number; lng: number };

type AdminLiveTrackingMapProps = {
  riderId: string;
  isRiderOnline: boolean;
  stops: LiveTrackingStop[];
};

function AdminLiveTrackingMapInner({
  riderId,
  isRiderOnline,
  stops,
}: AdminLiveTrackingMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const hasFittedBoundsRef = useRef(false);
  const [riderLocation, setRiderLocation] = useState<RiderCoords | null>(null);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<string | null>(
    null,
  );

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  const mappableStops = useMemo(
    () =>
      stops.filter(
        (s) =>
          s.lat != null &&
          s.lng != null &&
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lng),
      ),
    [stops],
  );

  const stopsBoundsKey = useMemo(
    () =>
      mappableStops
        .map((s) => `${s.orderId}:${s.lat}:${s.lng}`)
        .join("|"),
    [mappableStops],
  );

  const mapCenter = useMemo(() => {
    if (mappableStops.length > 0) {
      return { lat: mappableStops[0].lat!, lng: mappableStops[0].lng! };
    }
    return HYDERABAD_CENTER;
  }, [stopsBoundsKey]);

  const mapZoom = useMemo(() => DEFAULT_ZOOM, []);

  const isGpsFresh =
    locationUpdatedAt != null &&
    Date.now() - new Date(locationUpdatedAt).getTime() < GPS_STALE_MS;

  const showRiderOnMap = isRiderOnline && isGpsFresh && riderLocation != null;

  const fitStopsBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps || mappableStops.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();
    mappableStops.forEach((stop) => {
      bounds.extend({ lat: stop.lat!, lng: stop.lng! });
    });

    map.fitBounds(bounds, 48);
    hasFittedBoundsRef.current = true;
  }, [mappableStops]);

  useEffect(() => {
    if (!riderId) return;

    let cancelled = false;

    const fetchLocation = async () => {
      try {
        const data = await getRiderLiveLocation(riderId);
        if (cancelled || !data) return;

        setRiderLocation({ lat: data.lat, lng: data.lng });
        setLocationUpdatedAt(data.updatedAt);
      } catch (err) {
        console.error("[AdminLiveTrackingMap] fetch location", err);
      }
    };

    fetchLocation();
    const interval = setInterval(fetchLocation, LOCATION_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [riderId]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    hasFittedBoundsRef.current = false;
    fitStopsBounds();
  }, [isLoaded, stopsBoundsKey, fitStopsBounds]);

  useEffect(() => {
    if (!showRiderOnMap || !riderLocation || !mapRef.current) return;
    mapRef.current.panTo(riderLocation);
  }, [riderLocation, showRiderOnMap]);

  const handleMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      fitStopsBounds();
    },
    [fitStopsBounds],
  );

  if (!isLoaded) {
    return (
      <div className="relative h-full min-h-[600px] w-full rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="flex h-full min-h-[600px] w-full animate-pulse items-center justify-center bg-slate-50 text-sm font-medium text-slate-400">
          Loading Maps Engine...
        </div>
      </div>
    );
  }

  let overlayMessage: string | null = null;
  let overlayIcon: "offline" | "gps" | null = null;

  if (!isRiderOnline) {
    overlayMessage =
      "Rider is offline — toggle On Duty on the rider app to enable tracking.";
    overlayIcon = "offline";
  } else if (!showRiderOnMap) {
    overlayMessage = "Rider is online but GPS is inactive.";
    overlayIcon = "gps";
  }

  return (
    <div className="relative h-full min-h-[600px] w-full rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {showRiderOnMap && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-900 shadow-sm backdrop-blur-md">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          Live GPS
        </div>
      )}

      <GoogleMap
        mapContainerStyle={CONTAINER_STYLE}
        center={mapCenter}
        zoom={mapZoom}
        onLoad={handleMapLoad}
        options={MAP_OPTIONS}
      >
        {showRiderOnMap && riderLocation && (
          <Marker
            position={riderLocation}
            title="Rider"
            label={{ text: "🛵", fontSize: "22px" }}
            icon={{
              url: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E",
              scaledSize: new window.google.maps.Size(1, 1),
            }}
          />
        )}

        {mappableStops.map((stop) => (
          <Marker
            key={stop.orderId}
            position={{ lat: stop.lat!, lng: stop.lng! }}
            title={stop.customerName}
            label={{
              text: String(stop.sequence),
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: "12px",
            }}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: stop.isDelivered ? "#16a34a" : "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>

      {overlayMessage && (
        <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-6 py-3 shadow-lg backdrop-blur-md">
          {overlayIcon === "offline" ? (
            <NavigationOff className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <p className="text-sm font-medium text-slate-700">{overlayMessage}</p>
        </div>
      )}

      {mappableStops.length === 0 && !overlayMessage && (
        <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-200 bg-amber-50/90 px-6 py-3 shadow-sm backdrop-blur-md">
          <MapPin className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-sm font-medium text-amber-900">
            No mappable stop coordinates. Check address pin codes.
          </span>
        </div>
      )}
    </div>
  );
}

export const AdminLiveTrackingMap = memo(AdminLiveTrackingMapInner);
