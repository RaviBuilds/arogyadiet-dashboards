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

  // Foreground reconcile: when the app returns to the foreground, check if the
  // server has flipped is_online=false (auto-off-duty / admin action) while the
  // app was backgrounded. If so, stop native tracking. No-op when watcher is
  // already cleared or rider is already off. (Req 12.4, 12.5, 15.7)
  useOffDutyReconcile({
    riderId,
    getWatcherId: useCallback(() => watcherIdRef.current, []),
    onWatcherCleared: useCallback(() => {
      watcherIdRef.current = null;
      setIsOnDuty(false);
      disableKeepAwake();
    }, []),
  });

  const startBackgroundTracking = useCallback(async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;

    const supabase = createClient();

    try {
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage:
            "ArogyaDiet is tracking your route for delivery updates.",
          backgroundTitle: "Active Delivery Route",
          requestPermissions: true,
          stale: false,
          // ~25m movement threshold (was 10m). A tighter filter spams the
          // bridge with micro-movements and degrades WebView frame rates.
          distanceFilter: 25,
        },
        async (location, error) => {
          if (error) {
            console.error("Background Location Error:", error);
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
      return true;
    } catch (err) {
      console.error("Failed to start background geolocation:", err);
      return false;
    }
  }, [riderId]);

  const stopBackgroundTracking = useCallback(async () => {
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
