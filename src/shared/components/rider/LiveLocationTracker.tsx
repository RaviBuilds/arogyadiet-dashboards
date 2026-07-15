"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type GpsHardwareState = "idle" | "acquiring" | "active" | "error";

/**
 * Route-level GPS *status indicator* (read-only).
 *
 * IMPORTANT — DO NOT re-add `BackgroundGeolocation.addWatcher` here.
 *
 * The native foreground service started by the On Duty toggle
 * (`rider-status-toggle.tsx`) is the SINGLE owner of the GPS watcher and the
 * upload pipeline (it POSTs to Supabase from a native background thread with a
 * 30s heartbeat, independent of the WebView). This component used to start a
 * SECOND `addWatcher` and upload from WebView JS, which:
 *   1. confused the single native watcher (it passed no `riderId`), and
 *   2. died silently in the background/Doze (WebView JS timers are throttled),
 *      and
 *   3. called `removeWatcher` on unmount — killing the native service the
 *      toggle had started.
 * This surfaced as "Rider is online but GPS is inactive" right after batch
 * pickup (when order status flips to OUT_FOR_DELIVERY and this component
 * mounts). See `.kiro/steering/rider-gps-tracking.md`.
 *
 * This component now only READS `rider_live_locations.updated_at` and reports
 * freshness using the same 90s staleness threshold as the admin live map.
 */

// Matches AdminLiveTrackingMap.GPS_STALE_MS — a shared "is the native pipeline
// still uploading?" threshold.
const GPS_STALE_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;

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
  const [gpsState, setGpsState] = useState<GpsHardwareState>("idle");

  // Stable singleton client for this component instance. createClient() returns
  // a NEW client object on every call, so creating it in the render body would
  // change the reference each render and re-trigger the polling effect.
  const [supabase] = useState(() => createClient());

  // Mirror of gpsState so we can skip redundant state writes / parent re-renders.
  const gpsStateRef = useRef<GpsHardwareState>("idle");

  const updateGpsState = useCallback(
    (next: GpsHardwareState) => {
      if (gpsStateRef.current === next) return;
      gpsStateRef.current = next;
      setGpsState(next);
      onGpsStateChange?.(next);
    },
    [onGpsStateChange],
  );

  useEffect(() => {
    if (!isDelivering) {
      updateGpsState("idle");
      return;
    }

    updateGpsState("acquiring");

    let cancelled = false;

    const checkFreshness = async () => {
      try {
        const { data, error } = await supabase
          .from("rider_live_locations")
          .select("updated_at")
          .eq("rider_id", riderId)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error("[LiveLocationTracker] freshness check", error.message);
          return;
        }

        const isFresh =
          data?.updated_at != null &&
          Date.now() - new Date(data.updated_at).getTime() < GPS_STALE_MS;

        // Native service is uploading → "active"; otherwise still "acquiring"
        // (native watcher warming up, or stalled — either way not yet live).
        updateGpsState(isFresh ? "active" : "acquiring");
      } catch (err) {
        if (!cancelled) {
          console.error("[LiveLocationTracker] freshness check failed", err);
        }
      }
    };

    checkFreshness();
    const interval = setInterval(checkFreshness, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      updateGpsState("idle");
    };
  }, [riderId, isDelivering, supabase, updateGpsState]);

  if (!isDelivering) return null;
  if (!showIndicator) return null;

  return (
    <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wide">
      {gpsState === "active" ? (
        <>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          <span className="text-green-700">Live GPS Active</span>
        </>
      ) : (
        <>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <span className="text-yellow-700">Acquiring GPS...</span>
        </>
      )}
    </div>
  );
}
