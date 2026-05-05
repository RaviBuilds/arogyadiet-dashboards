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

  // Generates a unique ID for this specific tab/phone session
  const [sessionId] = useState(() => crypto.randomUUID());

  // Keeps track of whether this phone has officially claimed the database yet
  const hasClaimedSession = useRef(false);

  useEffect(() => {
    if (!isDelivering || isHijacked) return;

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (isHijacked) return;

        const { latitude, longitude } = position.coords;

        // 1. THE FIRST PING: The device MUST formally claim the database session
        if (!hasClaimedSession.current) {
          const { error: claimError } = await supabase
            .from("rider_live_locations")
            .upsert(
              {
                rider_id: riderId,
                lat: latitude,
                lng: longitude,
                tracker_session_id: sessionId, // Claim ownership!
                updated_at: new Date().toISOString(),
              },
              { onConflict: "rider_id" },
            );

          if (!claimError) {
            hasClaimedSession.current = true; // Mark as successfully claimed
          }
          return; // Done for this ping!
        }

        // 2. ALL FUTURE PINGS: Verify we still own it before pushing updates
        const { data: dbCheck } = await supabase
          .from("rider_live_locations")
          .select("tracker_session_id")
          .eq("rider_id", riderId)
          .maybeSingle();

        // If the DB has an ID, and it's NOT ours, someone else logged in and stole it!
        if (
          dbCheck?.tracker_session_id &&
          dbCheck.tracker_session_id !== sessionId
        ) {
          console.warn("Tracking hijacked by another device!");
          setIsHijacked(true); // Trigger the red UI
          navigator.geolocation.clearWatch(watchId); // Permanently kill the GPS loop for this phone
          return;
        }

        // 3. SAFE TO PROCEED: We still own the session, save the new coordinates
        const { error: dbError } = await supabase
          .from("rider_live_locations")
          .upsert(
            {
              rider_id: riderId,
              lat: latitude,
              lng: longitude,
              tracker_session_id: sessionId,
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
    return () => navigator.geolocation.clearWatch(watchId);
  }, [riderId, isDelivering, isHijacked, sessionId]);

  if (!isDelivering) return null;

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
