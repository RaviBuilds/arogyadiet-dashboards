"use client";

import { useState, useTransition, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bike, PowerOff } from "lucide-react";
import { setRiderOnlineAction } from "@/actions/rider-actions/shiftActions";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";
import { enableKeepAwake, disableKeepAwake } from "@/lib/capacitor/keep-awake";
import { useOffDutyReconcile } from "@/shared/hooks/useOffDutyReconcile";
import { toast } from "sonner";

type RiderStatusToggleProps = {
  initialStatus: boolean;
  riderId: string;
};

/** Heartbeat interval: re-upsert last known location periodically to keep
 *  updated_at fresh, preventing the admin dashboard from flagging
 *  "GPS inactive" when the rider is stationary (below distanceFilter).
 *
 *  Set to 30s — comfortably under the dashboard's 90s GPS_STALE_MS threshold,
 *  giving margin even if the WebView throttles the timer while foregrounded.
 *  NOTE: this is a foreground mitigation only. True background reliability
 *  requires the upload to move into the native SyncWorker (see LocationForegroundService TODO). */
const HEARTBEAT_INTERVAL_MS = 30_000;

export function RiderStatusToggle({
  initialStatus,
  riderId,
}: RiderStatusToggleProps) {
  const [isOnDuty, setIsOnDuty] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Background geolocation watcher reference
  const watcherIdRef = useRef<string | null>(null);
  // Throttle DB writes so a fast GPS stream can't hammer Supabase / the WebView.
  const lastWriteRef = useRef<number>(0);
  // Last known good coordinates for heartbeat re-upsert
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Heartbeat interval handle
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard so we only handle a fatal location error (services off / permission
  // denied) once per shift instead of on every repeated error callback.
  const locationErrorHandledRef = useRef(false);

  // Foreground reconcile: when the app returns to the foreground, check if the
  // server has flipped is_online=false (auto-off-duty / admin action) while the
  // app was backgrounded. If so, stop native tracking. No-op when watcher is
  // already cleared or rider is already off. (Req 12.4, 12.5, 15.7)
  useOffDutyReconcile({
    riderId,
    getWatcherId: useCallback(() => watcherIdRef.current, []),
    onWatcherCleared: useCallback(() => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      lastCoordsRef.current = null;
      watcherIdRef.current = null;
      setIsOnDuty(false);
      disableKeepAwake();
    }, []),
  });

  const startBackgroundTracking = useCallback(async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;

    // Reset the fatal-error guard for this fresh shift.
    locationErrorHandledRef.current = false;

    const supabase = createClient();

    try {
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage:
            "ArogyaDiet is tracking your route for delivery updates.",
          backgroundTitle: "Active Delivery Route",
          requestPermissions: true,
          stale: false,
          // 10m movement threshold. Lower than the previous 25m to ensure
          // fixes fire with normal walking movement (~12–15m steps). The
          // 3s DB-write throttle protects against excessive upserts.
          distanceFilter: 10,
        },
        async (location, error) => {
          if (error) {
            console.error("Background Location Error:", error);

            // Detect a fatal error where tracking can never succeed: device
            // location services are OFF, or permission was denied. The native
            // bridge surfaces these via the callback (not a promise reject).
            const msg = (error.message || "").toLowerCase();
            const isFatal =
              error.code === "NOT_AUTHORIZED" ||
              msg.includes("location services disabled") ||
              msg.includes("permission");

            if (isFatal && !locationErrorHandledRef.current) {
              locationErrorHandledRef.current = true;

              // Tear down the (non-functional) watcher + heartbeat.
              if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
              }
              lastCoordsRef.current = null;
              if (watcherIdRef.current) {
                BackgroundGeolocation.removeWatcher({
                  id: watcherIdRef.current,
                }).catch(() => {});
                watcherIdRef.current = null;
              }

              // Flip the rider back off-duty on the server and in the UI —
              // an untracked rider should not appear On Duty.
              await setRiderOnlineAction(false);
              setIsOnDuty(false);
              disableKeepAwake();

              toast.error(
                "Location is turned off. Enable device Location/GPS, then toggle On Duty again.",
              );
            }
            return;
          }

          // Guard against the plugin's initial resolve, which delivers the
          // watcher-id object ({ id }) with no coordinates. Only upsert when
          // we actually have valid numeric lat/lng — otherwise we'd write
          // null and hit the rider_live_locations NOT NULL constraint (23502).
          if (
            location &&
            typeof location.latitude === "number" &&
            Number.isFinite(location.latitude) &&
            typeof location.longitude === "number" &&
            Number.isFinite(location.longitude)
          ) {
            // Throttle DB writes: at most one every 3s regardless of how
            // frequently the plugin reports new coordinates.
            const now = Date.now();
            if (now - lastWriteRef.current < 3000) return;
            lastWriteRef.current = now;

            const { latitude, longitude } = location;

            // Store last known good coords for heartbeat re-upsert
            lastCoordsRef.current = { lat: latitude, lng: longitude };

            const { error: upsertError } = await supabase
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
            if (upsertError) {
              console.error(
                "rider_live_locations upsert failed:",
                upsertError,
              );
            }
          }
        },
      );

      watcherIdRef.current = watcherId;

      // Start a heartbeat that re-upserts the last known location every 60s.
      // This keeps updated_at fresh even when the rider is stationary (below
      // the distanceFilter threshold), preventing the admin dashboard from
      // incorrectly marking them as "GPS inactive".
      heartbeatRef.current = setInterval(async () => {
        const coords = lastCoordsRef.current;
        if (!coords) return; // No fix received yet — skip
        const { error: hbError } = await supabase
          .from("rider_live_locations")
          .upsert(
            {
              rider_id: riderId,
              lat: coords.lat,
              lng: coords.lng,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "rider_id" },
          );
        if (hbError) {
          console.error("Heartbeat upsert failed:", hbError);
        }
      }, HEARTBEAT_INTERVAL_MS);

      return true;
    } catch (err) {
      console.error("Failed to start background geolocation:", err);
      return false;
    }
  }, [riderId]);

  const stopBackgroundTracking = useCallback(async () => {
    // Clear the heartbeat interval first
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    lastCoordsRef.current = null;

    if (watcherIdRef.current) {
      try {
        await BackgroundGeolocation.removeWatcher({
          id: watcherIdRef.current,
        });
      } catch (err) {
        console.error("Failed to remove background watcher:", err);
      }
      watcherIdRef.current = null;
    }
  }, []);

  // Safety net: if this component unmounts while still on duty (e.g. the rider
  // navigates away), remove the native watcher so the foreground service and
  // its location stream don't leak and keep draining battery / firing events.
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (watcherIdRef.current) {
        BackgroundGeolocation.removeWatcher({
          id: watcherIdRef.current,
        }).catch((err) =>
          console.error("Failed to remove watcher on unmount:", err),
        );
        watcherIdRef.current = null;
      }
    };
  }, []);

  const handleToggle = (checked: boolean) => {
    setIsOnDuty(checked);
    startTransition(async () => {
      // Step 1: Set is_online on the server and confirm success
      const result = await setRiderOnlineAction(checked);
      if (result.error) {
        // Req 9.4: is_online set failed — revert toggle, no watcher, surface error
        setIsOnDuty(!checked);
        toast.error(result.error);
        return;
      }

      // Step 2: Manage background geolocation based on the confirmed state
      if (checked) {
        // Req 9.1: is_online=true confirmed, now start tracking
        const trackingStarted = await startBackgroundTracking();
        if (!trackingStarted) {
          // Req 9.5: addWatcher failed after is_online=true — revert is_online, revert toggle, surface error
          await setRiderOnlineAction(false);
          setIsOnDuty(false);
          toast.error("Could not start location tracking. Please try again.");
          return;
        }
        await enableKeepAwake();
      } else {
        // Req 9.3: Off toggle — call removeWatcher
        await stopBackgroundTracking();
        await disableKeepAwake();
      }
      router.refresh();
    });
  };

  return (
    <div
      className={cn(
        "p-5 rounded-2xl border-2 transition-colors duration-300 flex items-center justify-between shadow-sm",
        isOnDuty ? "bg-green-50 border-green-200" : "bg-white border-zinc-200",
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center transition-colors shrink-0",
            isOnDuty
              ? "bg-green-100 text-green-700"
              : "bg-zinc-100 text-zinc-400",
          )}
        >
          {isOnDuty ? (
            <Bike className="h-6 w-6" />
          ) : (
            <PowerOff className="h-6 w-6" />
          )}
        </div>
        <div>
          <h2 className="font-black text-lg text-zinc-900 leading-tight">
            {isOnDuty ? "You are On Duty" : "You are Offline"}
          </h2>
          <p className="text-sm font-medium text-zinc-500 mt-0.5">
            {isOnDuty
              ? "Background tracking active..."
              : "Toggle to start shift"}
          </p>
        </div>
      </div>
      <Switch
        checked={isOnDuty}
        onCheckedChange={handleToggle}
        disabled={isPending}
        className="scale-125 ml-2"
      />
    </div>
  );
}
