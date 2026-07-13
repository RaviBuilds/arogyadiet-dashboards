"use client";

import { useState, useTransition, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bike, PowerOff } from "lucide-react";
import { setRiderOnlineAction } from "@/actions/rider-actions/shiftActions";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import { Capacitor } from "@capacitor/core";
import { enableKeepAwake, disableKeepAwake } from "@/lib/capacitor/keep-awake";
import { useOffDutyReconcile } from "@/shared/hooks/useOffDutyReconcile";
import { useAutoOffDutyTimer } from "@/shared/hooks/useAutoOffDutyTimer";
import { toast } from "sonner";

type RiderStatusToggleProps = {
  initialStatus: boolean;
  riderId: string;
  /** Whether the rider has active (non-terminal) orders today. Defaults to false. */
  hasActiveOrders?: boolean;
};

export function RiderStatusToggle({
  initialStatus,
  riderId,
  hasActiveOrders = false,
}: RiderStatusToggleProps) {
  const [isOnDuty, setIsOnDuty] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Background geolocation watcher reference
  const watcherIdRef = useRef<string | null>(null);
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
      watcherIdRef.current = null;
      setIsOnDuty(false);
      disableKeepAwake();
    }, []),
  });

  // Auto off-duty timer: marks rider off-duty after 10 minutes of inactivity
  // when no active orders are assigned. Stops GPS tracking and saves resources.
  const handleAutoOffDuty = useCallback(async () => {
    // Stop native tracking
    if (watcherIdRef.current) {
      try {
        await BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
      } catch (err) {
        console.error("Failed to remove watcher on auto-off-duty:", err);
      }
      watcherIdRef.current = null;
    }
    await disableKeepAwake();
    setIsOnDuty(false);
    router.refresh();
  }, [router]);

  useAutoOffDutyTimer({
    isOnDuty,
    hasActiveOrders,
    onAutoOffDuty: handleAutoOffDuty,
  });

  const startBackgroundTracking = useCallback(async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;

    // Reset the fatal-error guard for this fresh shift.
    locationErrorHandledRef.current = false;

    try {
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage:
            "ArogyaDiet is tracking your route for delivery updates.",
          backgroundTitle: "Active Delivery Route",
          requestPermissions: true,
          stale: false,
          // 10m movement threshold — fires on normal walking movement while
          // filtering GPS drift. The native heartbeat covers the stationary case.
          distanceFilter: 10,
          // Real rider id so the native service can upload directly to Supabase.
          riderId,
        },
        // The native LocationForegroundService now owns the upload pipeline
        // (it POSTs to Supabase from a background thread, independent of the
        // WebView). This JS callback is only used to detect fatal errors —
        // device location off or permission denied — which the bridge surfaces
        // here rather than as a promise rejection.
        async (_location, error) => {
          if (!error) return;

          console.error("Background Location Error:", error);

          const msg = (error.message || "").toLowerCase();
          const isFatal =
            error.code === "NOT_AUTHORIZED" ||
            msg.includes("location services disabled") ||
            msg.includes("permission");

          if (isFatal && !locationErrorHandledRef.current) {
            locationErrorHandledRef.current = true;

            // Tear down the non-functional watcher.
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
