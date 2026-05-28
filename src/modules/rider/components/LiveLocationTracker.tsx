"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle } from "lucide-react";

export type GpsHardwareState = "idle" | "acquiring" | "active" | "error";

export function LiveLocationTracker({
  riderId,
  isDelivering,
  showIndicator = true,
  onGpsStateChange,
}: {
  riderId: string;
  isDelivering: boolean;
  showIndicator?: boolean;
  onGpsStateChange?: (state: GpsHardwareState) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isHijacked, setIsHijacked] = useState(false);
  const [gpsState, setGpsState] = useState<GpsHardwareState>("idle");
  const supabase = createClient();

  // Generates a unique ID for this specific tab/phone session
  const [sessionId] = useState(() => crypto.randomUUID());

  // Keeps track of whether this phone has officially claimed the database yet
  const hasClaimedSession = useRef(false);
  const lastUpdateTime = useRef<number>(0);

  const updateGpsState = (next: GpsHardwareState) => {
    setGpsState(next);
    onGpsStateChange?.(next);
  };

  useEffect(() => {
    if (!isDelivering || isHijacked) return;

    // We are delivering and attempting to start GPS tracking.
    updateGpsState("acquiring");
    setError(null);

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      updateGpsState("error");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (isHijacked) return;

        const now = Date.now();
        // If 3000ms haven't passed, do not update the database
        if (now - lastUpdateTime.current < 3000) {
          return;
        }
        // Update the timestamp
        lastUpdateTime.current = now;

        // Hardware is actively providing coordinates.
        updateGpsState("active");

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
        const message =
          geoError instanceof Error
            ? geoError.message
            : (geoError as GeolocationPositionError | undefined)?.message ||
              "Unknown geolocation error";
        console.error("GPS Error:", message);
        updateGpsState("error");
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
      updateGpsState("idle");
    };
  }, [riderId, isDelivering, isHijacked, sessionId]);

  useEffect(() => {
    if (!isDelivering) {
      updateGpsState("idle");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDelivering]);

  if (!isDelivering) return null;
  if (!showIndicator) return null;

  if (isHijacked) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-red-600 uppercase tracking-wide bg-red-50 px-2.5 py-1 rounded-md border border-red-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Paused: Active on another device
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wide">
      {gpsState === "error" || error ? (
        <span className="text-red-500 normal-case font-bold">
          {error || "Location Access Blocked"}
        </span>
      ) : gpsState === "acquiring" ? (
        <>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <span className="text-yellow-700">Acquiring GPS...</span>
        </>
      ) : (
        <>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          <span className="text-green-700">Live GPS Active</span>
        </>
      )}
    </div>
  );
}
