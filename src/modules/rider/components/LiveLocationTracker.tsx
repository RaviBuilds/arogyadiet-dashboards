"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { Capacitor } from "@capacitor/core";

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

  // Manage screen wake lock based on delivery activity
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function manageScreenWakeLock() {
      try {
        if (isDelivering && !isHijacked) {
          await KeepAwake.keepAwake();
          console.log("Screen wake lock activated: Screen will stay awake.");
        } else {
          await KeepAwake.allowSleep();
          console.log("Screen wake lock released: Screen can now sleep.");
        }
      } catch (err) {
        console.error("Failed to adjust screen wake lock state:", err);
      }
    }

    manageScreenWakeLock();

    return () => {
      if (Capacitor.isNativePlatform()) {
        KeepAwake.allowSleep().catch((err) =>
          console.error("Failed to release wake lock on unmount:", err),
        );
      }
    };
  }, [isDelivering, isHijacked]);

  useEffect(() => {
    if (!isDelivering || isHijacked) return;

    // We are delivering and attempting to start GPS tracking.
    updateGpsState("acquiring");
    setError(null);

    let activeWatchId: string | null = null;

    async function startNativeTracking() {
      try {
        // 1. Request hardware permission dynamically if on a native platform
        if (Capacitor.isNativePlatform()) {
          const permissions = await Geolocation.requestPermissions();
          if (permissions.location !== "granted") {
            setError(
              "Location access was denied. Please enable GPS in device settings.",
            );
            updateGpsState("error");
            return;
          }
        }

        // 2. Start the native hardware geolocation engine loop
        activeWatchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000,
          },
          async (position, geoError) => {
            if (geoError) {
              console.error("GPS Native Error:", geoError.message);
              updateGpsState("error");
              setError("Failed to get GPS signal. Please check permissions.");
              return;
            }

            if (!position || isHijacked) return;

            const now = Date.now();
            // Throttling: If 3000ms haven't passed, ignore this tick
            if (now - lastUpdateTime.current < 3000) {
              return;
            }
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
              if (activeWatchId) {
                await Geolocation.clearWatch({ id: activeWatchId });
              }
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
        );
      } catch (err: unknown) {
        console.error("Failed to launch tracker engine:", err);
        updateGpsState("error");
        setError(
          err instanceof Error
            ? err.message
            : "Unknown tracking setup exception",
        );
      }
    }

    startNativeTracking();

    // Cleanup when leaving the page or changing dependencies
    return () => {
      if (activeWatchId) {
        Geolocation.clearWatch({ id: activeWatchId });
      }
      updateGpsState("idle");
    };
  }, [riderId, isDelivering, isHijacked, sessionId]);

  useEffect(() => {
    if (!isDelivering) {
      updateGpsState("idle");
      setError(null);
    }
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
