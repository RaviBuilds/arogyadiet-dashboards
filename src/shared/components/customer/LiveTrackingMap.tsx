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
  borderRadius: "1rem",
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
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
  onEtaChange?: (etaText: string | null) => void;
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

        const etaText =
          response.routes?.[0]?.legs?.[0]?.duration?.text ?? null;
        onEtaChange?.(etaText);
      } catch (err) {
        console.error("[LiveTrackingMap] Directions request failed", err);
        if (cancelled) return;
        setDirectionsResponse(null);
        onEtaChange?.(null);
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
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      <div className="h-[400px] w-full bg-zinc-100 animate-pulse rounded-2xl flex items-center justify-center text-zinc-400 font-bold">
        Loading Maps Engine...
      </div>
    );
  }

  if (!canTrack) {
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
                strokeColor: "#111827",
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
