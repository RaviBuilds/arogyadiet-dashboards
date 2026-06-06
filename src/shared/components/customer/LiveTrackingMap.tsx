"use client";

import { useEffect, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
} from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { MapPin } from "lucide-react";

const containerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "400px",
  borderRadius: "1rem",
};

type RiderCoords = { lat: number; lng: number };

function extractCoordsFromRealtimePayload(
  payload: unknown,
): RiderCoords | null {
  // Supabase `postgres_changes` payload puts the updated row in `payload.new`.
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

export function LiveTrackingMap({
  riderId,
  orderStatus,
  customerLat,
  customerLng,
  onEtaChange,
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
  onEtaChange?: (etaText: string | null) => void;
}) {
  const supabase = createClient();
  const [riderLocation, setRiderLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [initialCenter] = useState(
    customerLat && customerLng
      ? { lat: customerLat, lng: customerLng }
      : { lat: 17.385, lng: 78.4867 },
  );

  const [directionsResponse, setDirectionsResponse] =
    useState<google.maps.DirectionsResult | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  // Fetch and refresh driving route whenever rider location updates.
  useEffect(() => {
    const notifyEta = (eta: string | null) => onEtaChange?.(eta);

    const canTrack =
      orderStatus === "OUT_FOR_DELIVERY" ||
      orderStatus === "REACHING_TO_LOCATION";

    if (!canTrack) {
      notifyEta(null);
      return;
    }

    if (!isLoaded) return;

    if (customerLat == null || customerLng == null) {
      notifyEta(null);
      return;
    }

    // DirectionsService must not run until rider origin is present.
    if (!riderLocation) return;

    let cancelled = false;

    const fetchDirections = async () => {
      try {
        // CRITICAL: Coerce all coordinates to strict numbers (stringified decimals can silently fail).
        const originCoords = {
          lat: Number(riderLocation.lat),
          lng: Number(riderLocation.lng),
        };
        const destCoords = {
          lat: Number(customerLat),
          lng: Number(customerLng),
        };

        // If coercion produced NaN, abort this attempt.
        if (
          Number.isNaN(originCoords.lat) ||
          Number.isNaN(originCoords.lng) ||
          Number.isNaN(destCoords.lat) ||
          Number.isNaN(destCoords.lng)
        ) {
          console.warn(
            "[LiveTrackingMap] Directions aborted: NaN coordinates",
            {
              originCoords,
              destCoords,
              riderLocation,
              customerLat,
              customerLng,
            },
          );
          if (!cancelled) notifyEta(null);
          return;
        }

        const service = new window.google.maps.DirectionsService();
        const response = await service.route({
          origin: originCoords,
          destination: destCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
        });

        if (cancelled) return;
        setDirectionsResponse(response);

        const etaText = response.routes?.[0]?.legs?.[0]?.duration?.text ?? null;
        notifyEta(etaText);
      } catch (err) {
        console.error("Directions request failed", err);
        if (cancelled) return;
        setDirectionsResponse(null);
        notifyEta(null);
      }
    };

    fetchDirections();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, customerLat, customerLng, orderStatus, riderLocation, onEtaChange]);

  useEffect(() => {
    if (!riderId || !supabase) return;

    // 1. Robust Initial Fetch
    const fetchInitialLocation = async () => {
      try {
        const { data, error } = await supabase
          .from('rider_live_locations')
          .select('lat, lng')
          .eq('rider_id', riderId)
          .single();

        if (error) throw error;

        if (data && data.lat && data.lng) {
          setRiderLocation({ lat: Number(data.lat), lng: Number(data.lng) });
        }
      } catch (err) {
        console.error("[LiveTrackingMap] Initial Fetch Error:", err);
      }
    };

    fetchInitialLocation();

    // 2. Global Realtime Subscription
    const channel = supabase
      .channel(`public:rider_live_locations:rider_id=eq.${riderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rider_live_locations',
          filter: `rider_id=eq.${riderId}`
        },
        (payload) => {
          const newData = payload.new as any;
          if (newData && newData.lat && newData.lng) {
            setRiderLocation({ lat: Number(newData.lat), lng: Number(newData.lng) });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderId, supabase]);

  if (!isLoaded) {
    return (
      <div className="h-[400px] w-full bg-zinc-100 animate-pulse rounded-2xl flex items-center justify-center text-zinc-400 font-bold">
        Loading Maps Engine...
      </div>
    );
  }

  const canShowMap =
    orderStatus === "OUT_FOR_DELIVERY" ||
    orderStatus === "REACHING_TO_LOCATION";

  if (!canShowMap) {
    return (
      <div className="p-6 bg-orange-50 border border-orange-100 text-orange-800 rounded-2xl text-center shadow-sm">
        <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="font-bold">Map unavailable</p>
        <p className="text-sm mt-1">
          Live tracking will appear here once the rider leaves the kitchen.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border-4 border-white shadow-lg relative h-[400px] w-full bg-zinc-100">
      {/* Live Status Badge Overlay */}
      <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-full shadow-md font-bold text-sm text-zinc-900 flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
        </span>
        Rider Approaching
      </div>

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={initialCenter}
        zoom={15}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            // Optional: Cleans up map clutter for a premium look
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
        }}
      >
        {/* Route polyline snapped to the road */}
        {directionsResponse && (
          <DirectionsRenderer
            directions={directionsResponse}
            options={{
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: "#111827",
                strokeOpacity: 0.9,
                strokeWeight: 5,
              },
            }}
          />
        )}

        {/* Origin marker (Rider) */}
        {riderLocation && (
          <Marker
            position={riderLocation}
            title="Rider"
            label={{ text: "🛵", fontSize: "22px" }}
            // Transparent icon so only the label (emoji) is visible.
            icon={{
              url: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E",
              scaledSize: new window.google.maps.Size(1, 1),
            }}
          />
        )}

        {/* Destination marker (Customer) */}
        {customerLat && customerLng && (
          <Marker
            position={{ lat: customerLat, lng: customerLng }}
            title="Delivery location"
            label={{ text: "🏠", fontSize: "22px" }}
            icon={{
              url: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E",
              scaledSize: new window.google.maps.Size(1, 1),
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}
