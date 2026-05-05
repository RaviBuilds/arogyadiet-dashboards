"use client";

import { useEffect, useState } from "react";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { MapPin, Navigation } from "lucide-react";

const containerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "400px",
  borderRadius: "1rem",
};

export function LiveTrackingMap({
  riderId,
  orderStatus,
  customerLat,
  customerLng,
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
}) {
  const supabase = createClient();
  const [riderLocation, setRiderLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  useEffect(() => {
    if (orderStatus !== "ON_THE_WAY" || !riderId) return;

    // 1. Fetch initial location
    const fetchInitialLocation = async () => {
      const { data } = await supabase
        .from("rider_live_locations")
        .select("lat, lng")
        .eq("rider_id", riderId)
        .single();

      if (data) {
        setRiderLocation({ lat: Number(data.lat), lng: Number(data.lng) });
      }
    };

    fetchInitialLocation();

    // 2. Subscribe to Realtime WebSocket updates
    const channel = supabase
      .channel(`tracking-${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen for both UPSERT actions
          schema: "public",
          table: "rider_live_locations",
          filter: `rider_id=eq.${riderId}`,
        },
        (payload) => {
          console.log("GPS Ping Received via WebSocket!", payload.new);
          const newLoc = payload.new as { lat: number; lng: number };
          setRiderLocation({
            lat: Number(newLoc.lat),
            lng: Number(newLoc.lng),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderId, orderStatus, supabase]);

  if (!isLoaded) {
    return (
      <div className="h-[400px] w-full bg-zinc-100 animate-pulse rounded-2xl flex items-center justify-center text-zinc-400 font-bold">
        Loading Maps Engine...
      </div>
    );
  }

  if (orderStatus !== "ON_THE_WAY") {
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

  // Fallback center if rider hasn't pinged yet, or use customer's address
  const defaultCenter =
    customerLat && customerLng
      ? { lat: customerLat, lng: customerLng }
      : { lat: 17.385, lng: 78.4867 }; // Hyderabad Center

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
        center={riderLocation || defaultCenter}
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
        {/* The Rider's Moving Pin */}
        {riderLocation && (
          <Marker
            position={riderLocation}
            // You can replace this with a custom bike icon later!
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#16a34a",
              fillOpacity: 1,
              strokeWeight: 3,
              strokeColor: "#ffffff",
            }}
          />
        )}

        {/* The Customer's Home Pin (Optional, if you have their lat/lng) */}
        {customerLat && customerLng && (
          <Marker position={{ lat: customerLat, lng: customerLng }} />
        )}
      </GoogleMap>
    </div>
  );
}
