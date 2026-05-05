"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { MapPin, AlertTriangle } from "lucide-react";

export function LiveLocationTracker({
  riderId,
  isDelivering,
}: {
  riderId: string;
  isDelivering: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isHijacked, setIsHijacked] = useState(false);
  const supabase = createClient();

  // Generate a unique ID for this specific browser tab/phone
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    // If not delivering OR if another phone took over, do not track!
    if (!isDelivering || isHijacked) return;

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    let watchId: number;

    // 1. ANTI-PING-PONG LISTENER: Watch to see if another device takes over
    const channel = supabase
      .channel(`tracker-hijack-${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rider_live_locations",
          filter: `rider_id=eq.${riderId}`,
        },
        (payload) => {
          // If the DB has a different session ID, another phone is broadcasting!
          if (
            payload.new.tracker_session_id &&
            payload.new.tracker_session_id !== sessionIdRef.current
          ) {
            console.warn("Tracking hijacked by another device!");
            setIsHijacked(true); // This instantly unmounts the tracker below
            if (watchId) navigator.geolocation.clearWatch(watchId);
          }
        },
      )
      .subscribe();

    // 2. Start broadcasting our location & our secret Session ID
    watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (isHijacked) return; // Double-check before pushing to DB

        const { latitude, longitude } = position.coords;

        const { error: dbError } = await supabase
          .from("rider_live_locations")
          .upsert(
            {
              rider_id: riderId,
              lat: latitude,
              lng: longitude,
              tracker_session_id: sessionIdRef.current, // Claim ownership!
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
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 5000,
      },
    );

    // Cleanup when leaving page
    return () => {
      navigator.geolocation.clearWatch(watchId);
      supabase.removeChannel(channel);
    };
  }, [riderId, isDelivering, isHijacked]);

  if (!isDelivering) return null;
 console.log("ISHIJACKED =>", isHijacked)
  // NEW: Show a warning if they are logged in elsewhere
  if (isHijacked) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-red-600 uppercase tracking-wide bg-red-50 px-2.5 py-1 rounded-md border border-red-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Paused: Active on another device
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold text-green-700 uppercase tracking-wide">
      {error ? (
        <span className="text-red-500 normal-case">{error}</span>
      ) : (
        <>
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
