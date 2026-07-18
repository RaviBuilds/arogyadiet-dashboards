"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

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

export function LiveTrackingMap({
  riderId,
  orderStatus,
  customerLat,
  customerLng,
  onEtaChange,
  onDistanceChange,
  onLocationUpdate,
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
  onEtaChange?: (etaText: string | null) => void;
  /** Distance-to-arrival text (e.g. "1.4 km"), derived from the SAME
   *  Directions response already fetched for the ETA — no extra API call. */
  onDistanceChange?: (distanceText: string | null) => void;
  /** Fired every time a fresh rider coordinate lands (initial fetch or
   *  realtime update) — purely a UI freshness signal ("Updated Xs ago"),
   *  does not alter the underlying subscription/polling behavior at all. */
  onLocationUpdate?: () => void;
}) {
  // Stable Supabase client — created once and reused across renders.
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const mapRef = useRef<google.maps.Map | null>(null);
  const [riderLocation, setRiderLocation] = useState<RiderCoords | null>(null);
  const [directionsResponse, setDirectionsResponse] =
    useState<google.maps.DirectionsResult | null>(null);

  // Track whether we've already fetched directions so we never re-fetch.
  const directionsFetchedRef = useRef(false);

  const initialCenter = useMemo(
    () =>
      customerLat && customerLng
        ? { lat: customerLat, lng: customerLng }
        : { lat: 17.385, lng: 78.4867 },
    [customerLat, customerLng],
  );

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  const canTrack =
    orderStatus === "OUT_FOR_DELIVERY" ||
    orderStatus === "REACHING_TO_LOCATION";

  // ─────────────────────────────────────────────────────────────────────────
  // DIRECTIONS: Fetch the route polyline ONCE (rider → customer).
  // This effect only fires when we first have both:
  //   1. A valid riderLocation (initial fetch from DB)
  //   2. The Maps JS SDK loaded
  // It will NOT re-fire on subsequent riderLocation updates because of the
  // directionsFetchedRef guard.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Already fetched — never re-fetch.
    if (directionsFetchedRef.current) return;
    if (!isLoaded || !canTrack) return;
    if (customerLat == null || customerLng == null) return;
    if (!riderLocation) return;

    let cancelled = false;
    directionsFetchedRef.current = true;

    const fetchDirections = async () => {
      try {
        const originCoords = {
          lat: Number(riderLocation.lat),
          lng: Number(riderLocation.lng),
        };
        const destCoords = {
          lat: Number(customerLat),
          lng: Number(customerLng),
        };

        if (
          Number.isNaN(originCoords.lat) ||
          Number.isNaN(originCoords.lng) ||
          Number.isNaN(destCoords.lat) ||
          Number.isNaN(destCoords.lng)
        ) {
          console.warn(
            "[LiveTrackingMap] Directions aborted: NaN coordinates",
            { originCoords, destCoords },
          );
          onEtaChange?.(null);
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

        const leg = response.routes?.[0]?.legs?.[0];
        onEtaChange?.(leg?.duration?.text ?? null);
        onDistanceChange?.(leg?.distance?.text ?? null);
      } catch (err) {
        console.error("[LiveTrackingMap] Directions request failed", err);
        if (cancelled) return;
        setDirectionsResponse(null);
        onEtaChange?.(null);
        onDistanceChange?.(null);
      }
    };

    fetchDirections();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // gated by directionsFetchedRef; we only want the first valid riderLocation.
  }, [isLoaded, canTrack, customerLat, customerLng, riderLocation]);

  // ─────────────────────────────────────────────────────────────────────────
  // REALTIME: Subscribe to rider GPS updates.
  // Updates ONLY the marker position — never triggers Directions.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!riderId) return;

    // 1. Initial fetch
    const fetchInitialLocation = async () => {
      try {
        const { data, error } = await supabase
          .from("rider_live_locations")
          .select("lat, lng")
          .eq("rider_id", riderId)
          .single();

        if (error) throw error;

        if (data && data.lat && data.lng) {
          setRiderLocation({ lat: Number(data.lat), lng: Number(data.lng) });
          onLocationUpdate?.();
        }
      } catch (err) {
        console.error("[LiveTrackingMap] Initial Fetch Error:", err);
      }
    };

    fetchInitialLocation();

    // 2. Realtime subscription
    const channel = supabase
      .channel(`public:rider_live_locations:rider_id=eq.${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rider_live_locations",
          filter: `rider_id=eq.${riderId}`,
        },
        (payload) => {
          const newData = payload.new as Record<string, unknown> | undefined;
          if (newData && newData.lat && newData.lng) {
            setRiderLocation({
              lat: Number(newData.lat),
              lng: Number(newData.lng),
            });
            onLocationUpdate?.();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLocationUpdate
    // is a UI-only freshness callback; including it would resubscribe the
    // realtime channel on every parent re-render.
  }, [riderId, supabase]);

  // ─────────────────────────────────────────────────────────────────────────
  // PAN: Smoothly follow rider on the map without re-rendering <GoogleMap>.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!riderLocation || !mapRef.current) return;
    mapRef.current.panTo(riderLocation);
  }, [riderLocation]);

  // ─────────────────────────────────────────────────────────────────────────
  // MAP LOAD CALLBACK
  // ─────────────────────────────────────────────────────────────────────────
  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full min-h-[400px] animate-pulse items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">
        Loading map…
      </div>
    );
  }

  if (!canTrack) {
    return (
      <div className="flex h-full w-full min-h-[400px] flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 p-8 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
          <MapPin className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="font-semibold text-slate-700">Map unavailable yet</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
          We&apos;ll start live tracking once your rider begins today&apos;s
          delivery.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={initialCenter}
        zoom={15}
        options={MAP_OPTIONS}
        onLoad={handleMapLoad}
      >
        {/* Route polyline — rendered once, never re-fetched */}
        {directionsResponse && (
          <DirectionsRenderer
            directions={directionsResponse}
            options={{
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: "#059669",
                strokeOpacity: 0.9,
                strokeWeight: 5,
              },
            }}
          />
        )}

        {/* Rider marker — updates position in real-time without re-fetching anything */}
        {riderLocation && (
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

        {/* Destination marker */}
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
