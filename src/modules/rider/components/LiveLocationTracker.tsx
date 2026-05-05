"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client"; // Adjust to your client Supabase setup
import { MapPin } from "lucide-react";

export function LiveLocationTracker({
  riderId,
  isDelivering,
}: {
  riderId: string;
  isDelivering: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    // If the rider isn't actively on a delivery, don't track them!
    if (!isDelivering) return;

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    // watchPosition is highly optimized for mobile devices
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        // UPSERT the location to Supabase
        const { error: dbError } = await supabase
          .from("rider_live_locations")
          .upsert(
            {
              rider_id: riderId,
              lat: latitude,
              lng: longitude,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "rider_id" },
          );

        if (dbError) {
          console.error("Failed to sync location:", dbError.message);
        }
      },
      (geoError) => {
        console.error("GPS Error:", geoError);
        setError("Failed to get GPS signal. Please check permissions.");
      },
      {
        enableHighAccuracy: true, // Forces the phone's GPS chip to wake up
        maximumAge: 10000,
        timeout: 5000,
      },
    );

    // Cleanup: Stop tracking if they leave the page or finish the delivery
    return () => navigator.geolocation.clearWatch(watchId);
  }, [riderId, isDelivering]);

  if (!isDelivering) return null;

  return (
    <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold text-green-700 uppercase tracking-wide">
      {error ? (
        <span className="text-red-500 normal-case">{error}</span>
      ) : (
        <>
          {/* The Glowing Green Dot */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          Live GPS Active
        </>
      )}
    </div>
  );
}
