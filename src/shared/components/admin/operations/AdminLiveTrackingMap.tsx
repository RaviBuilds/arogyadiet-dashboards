"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
} from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { MapPin, WifiOff } from "lucide-react";
import type { LiveTrackingStop } from "@/actions/admin-actions/liveTrackingActions";

const containerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "400px",
};

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };
const GPS_STALE_MS = 90_000;

type RiderCoords = { lat: number; lng: number };

function extractCoordsFromPayload(payload: unknown): RiderCoords | null {
  const newData = (payload as { new?: unknown } | null | undefined)?.new as
    | Record<string, unknown>
    | null
    | undefined;

  const rawLat = newData?.lat;
  const rawLng = newData?.lng;

  if (rawLat == null || rawLng == null) return null;

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

export function AdminLiveTrackingMap({
  riderId,
  isRiderOnline,
  stops,
}: {
  riderId: string;
  isRiderOnline: boolean;
  stops: LiveTrackingStop[];
}) {
  const supabase = createClient();
  const mapRef = useRef<google.maps.Map | null>(null);
  const [riderLocation, setRiderLocation] = useState<RiderCoords | null>(null);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<string | null>(
    null,
  );

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  const mappableStops = stops.filter(
    (s) => s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );

  const isGpsFresh =
    locationUpdatedAt != null &&
    Date.now() - new Date(locationUpdatedAt).getTime() < GPS_STALE_MS;

  const showRiderOnMap = isRiderOnline && isGpsFresh && riderLocation != null;

  const fitMapBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoint = false;

    if (showRiderOnMap && riderLocation) {
      bounds.extend(riderLocation);
      hasPoint = true;
    }

    mappableStops.forEach((stop) => {
      bounds.extend({ lat: stop.lat!, lng: stop.lng! });
      hasPoint = true;
    });

    if (hasPoint) {
      map.fitBounds(bounds, 48);
    }
  }, [showRiderOnMap, riderLocation, mappableStops]);

  useEffect(() => {
    if (!riderId || !supabase) return;

    const fetchInitialLocation = async () => {
      try {
        const { data, error } = await supabase
          .from("rider_live_locations")
          .select("lat, lng, updated_at")
          .eq("rider_id", riderId)
          .single();

        if (error) throw error;

        if (data?.lat != null && data?.lng != null) {
          setRiderLocation({
            lat: Number(data.lat),
            lng: Number(data.lng),
          });
          setLocationUpdatedAt(data.updated_at ?? null);
        }
      } catch (err) {
        console.error("[AdminLiveTrackingMap] initial fetch", err);
      }
    };

    fetchInitialLocation();

    const channel = supabase
      .channel(`admin:rider_live_locations:${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rider_live_locations",
          filter: `rider_id=eq.${riderId}`,
        },
        (payload) => {
          const coords = extractCoordsFromPayload(payload);
          if (coords) {
            setRiderLocation(coords);
            const newData = payload.new as { updated_at?: string } | undefined;
            if (newData?.updated_at) {
              setLocationUpdatedAt(newData.updated_at);
            } else {
              setLocationUpdatedAt(new Date().toISOString());
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderId, supabase]);

  useEffect(() => {
    if (isLoaded) fitMapBounds();
  }, [isLoaded, fitMapBounds, showRiderOnMap, mappableStops.length]);

  const defaultCenter =
    mappableStops.length > 0
      ? { lat: mappableStops[0].lat!, lng: mappableStops[0].lng! }
      : riderLocation || HYDERABAD_CENTER;

  if (!isLoaded) {
    return (
      <div className="h-[min(500px,60vh)] w-full bg-zinc-100 animate-pulse rounded-2xl flex items-center justify-center text-zinc-400 font-bold">
        Loading Maps Engine...
      </div>
    );
  }

  let overlayMessage: string | null = null;
  if (!isRiderOnline) {
    overlayMessage =
      "Rider is offline — toggle On Duty on the rider app to enable tracking.";
  } else if (!showRiderOnMap) {
    overlayMessage =
      "Rider is online but GPS is not active. Waiting for location updates...";
  }

  return (
    <div className="relative h-[min(500px,60vh)] w-full rounded-2xl overflow-hidden border bg-zinc-100">
      {showRiderOnMap && (
        <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-full shadow-md font-bold text-sm text-zinc-900 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          Live GPS
        </div>
      )}

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={riderLocation || defaultCenter}
        zoom={13}
        onLoad={(map) => {
          mapRef.current = map;
          fitMapBounds();
        }}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
        }}
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
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/40 backdrop-blur-[2px] p-6">
          <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl border">
            <WifiOff className="h-10 w-10 mx-auto mb-3 text-zinc-400" />
            <p className="font-bold text-zinc-900">Tracking unavailable</p>
            <p className="text-sm text-zinc-600 mt-2">{overlayMessage}</p>
          </div>
        </div>
      )}

      {mappableStops.length === 0 && !overlayMessage && (
        <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
          <span>No mappable stop coordinates. Check address pin codes.</span>
        </div>
      )}
    </div>
  );
}
