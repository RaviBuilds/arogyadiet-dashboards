"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle } from "lucide-react";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
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

  // Keeps track of whether this phone has officially claimed the database session
  const hasClaimedSession = useRef(false);
  const lastUpdateTime = useRef<number>(0);

  // Store the background watcher ID for cleanup
  const watcherIdRef = useRef<string | null>(null);

  const updateGpsState = useCallback(
    (next: GpsHardwareState) => {
      setGpsState(next);
      onGpsStateChange?.(next);
    },
    [onGpsStateChange],
  );

  useEffect(() => {
    if (!isDelivering || isHijacked) return;

    // Only use background geolocation on native platforms
    if (!Capacitor.isNativePlatform()) return;

    updateGpsState("acquiring");
    setError(null);

    let cancelled = false;

    async function startBackgroundTracking() {
      try {
        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage:
              "ArogyaDiet is tracking your route for delivery updates.",
            backgroundTitle: "Active Delivery Route",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10, // Update every 10 meters of movement
          },
          async (location, bgError) => {
            if (cancelled) return;

            if (bgError) {
              console.error("Background Location Error:", bgError);
              updateGpsState("error");
              setError(
                "Location tracking failed. Please check GPS permissions.",
              );
              return;
            }

            if (!location) return;

            const now = Date.now();
            // Throttle DB writes: skip if less than 3s since last update
            if (now - lastUpdateTime.current < 3000) {
              return;
            }
            lastUpdateTime.current = now;

            // Hardware is actively providing coordinates
            updateGpsState("active");

            const { latitude, longitude } = location;

            // 1. FIRST PING: Claim the database session for this device
            if (!hasClaimedSession.current) {
              const { error: claimError } = await supabase
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

              if (!claimError) {
                hasClaimedSession.current = true;
              }
              return;
            }

            // 2. SUBSEQUENT PINGS: Verify ownership before updating
            const { data: dbCheck } = await supabase
              .from("rider_live_locations")
              .select("tracker_session_id")
              .eq("rider_id", riderId)
              .maybeSingle();

            // If another device has claimed this rider's session, stop tracking
            if (
              dbCheck?.tracker_session_id &&
              dbCheck.tracker_session_id !== sessionId
            ) {
              console.warn("Tracking hijacked by another device!");
              setIsHijacked(true);
              // Remove watcher immediately to stop draining battery
              if (watcherIdRef.current) {
                await BackgroundGeolocation.removeWatcher({
                  id: watcherIdRef.current,
                });
                watcherIdRef.current = null;
              }
              return;
            }

            // 3. SAFE: We still own the session, push coordinates
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

        // Persist the watcher ID so cleanup can kill the foreground service
        if (!cancelled) {
          watcherIdRef.current = watcherId;
        } else {
          // If cancelled before we could store it, remove immediately
          await BackgroundGeolocation.removeWatcher({ id: watcherId });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        console.error("Failed to start background location tracker:", err);
        updateGpsState("error");
        setError(
          err instanceof Error
            ? err.message
            : "Unknown tracking setup exception",
        );
      }
    }

    startBackgroundTracking();

    // Cleanup: remove watcher to kill the foreground service and stop battery drain
    return () => {
      cancelled = true;
      if (watcherIdRef.current) {
        BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current }).catch(
          (err) =>
            console.error("Failed to remove background watcher on cleanup:", err),
        );
        watcherIdRef.current = null;
      }
      hasClaimedSession.current = false;
      updateGpsState("idle");
    };
  }, [riderId, isDelivering, isHijacked, sessionId, supabase, updateGpsState]);

  useEffect(() => {
    if (!isDelivering) {
      updateGpsState("idle");
      setError(null);
    }
  }, [isDelivering, updateGpsState]);

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
