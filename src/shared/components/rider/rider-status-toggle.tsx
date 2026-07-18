"use client";

import { useState, useTransition, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bike, PowerOff, MapPinOff, RefreshCw } from "lucide-react";
import { setRiderOnlineAction } from "@/actions/rider-actions/shiftActions";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { enableKeepAwake, disableKeepAwake } from "@/lib/capacitor/keep-awake";
import { useOffDutyReconcile } from "@/shared/hooks/useOffDutyReconcile";
import { useAutoOffDutyTimer } from "@/shared/hooks/useAutoOffDutyTimer";
import {
  ensureTrackingPermissions,
  isFullyPermitted,
} from "@/lib/capacitor/tracking-permissions";
import { toast } from "sonner";

type RiderStatusToggleProps = {
  initialStatus: boolean;
  riderId: string;
  /** Whether the rider has active (non-terminal) orders today. Defaults to false. */
  hasActiveOrders?: boolean;
};

/** Why a tracking-start attempt failed, so callers can show the right message. */
type StartTrackingResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "location_off" | "unknown" };

export function RiderStatusToggle({
  initialStatus,
  riderId,
  hasActiveOrders = false,
}: RiderStatusToggleProps) {
  const [isOnDuty, setIsOnDuty] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  // True when the rider is On Duty but tracking can't run because device
  // Location/GPS is off (or permission is missing). Drives a persistent,
  // actionable warning instead of silently showing "Acquiring GPS" forever.
  const [gpsBlocked, setGpsBlocked] = useState(false);
  const [retrying, setRetrying] = useState(false);
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
      setGpsBlocked(false);
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
    setGpsBlocked(false);
    router.refresh();
  }, [router]);

  useAutoOffDutyTimer({
    isOnDuty,
    hasActiveOrders,
    onAutoOffDuty: handleAutoOffDuty,
  });

  const startBackgroundTracking =
    useCallback(async (): Promise<StartTrackingResult> => {
      if (!Capacitor.isNativePlatform()) return { ok: true };

      // Reset the fatal-error guard for this fresh shift.
      locationErrorHandledRef.current = false;

      // Ensure the permissions continuous tracking actually needs are granted:
      // "Allow all the time" background location + notifications. Without the
      // background grant a one-time / "while in use" permission is revoked the
      // moment the rider leaves the app, and tracking silently dies.
      const perms = await ensureTrackingPermissions();
      if (perms.location !== "granted") {
        return { ok: false, reason: "permission" };
      }
      if (!isFullyPermitted(perms)) {
        toast.warning(
          perms.backgroundLocation !== "granted"
            ? 'Set location to "Allow all the time" so tracking keeps working when your screen is locked. Open the banner above to fix it.'
            : "Enable notifications so the tracking indicator stays active in the background.",
          { duration: 8000 },
        );
      }

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

              // Keep the rider On Duty but surface a persistent, actionable
              // warning: they just need to turn Location back on. Tracking
              // auto-resumes when they do (foreground listener below).
              await disableKeepAwake();
              setGpsBlocked(true);

              toast.error(
                "Location is turned off. Turn on device Location/GPS to keep sharing your location.",
              );
            }
          },
        );

        watcherIdRef.current = watcherId;
        return { ok: true };
      } catch (err) {
        console.error("Failed to start background geolocation:", err);
        const msg = ((err as Error)?.message || "").toLowerCase();
        if (
          msg.includes("location services disabled") ||
          msg.includes("location is") ||
          msg.includes("gps")
        ) {
          return { ok: false, reason: "location_off" };
        }
        if (msg.includes("permission") || msg.includes("authoriz")) {
          return { ok: false, reason: "permission" };
        }
        return { ok: false, reason: "unknown" };
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

  // Resume tracking when the app is (re)opened while the rider is still On Duty
  // server-side — e.g. after the app was closed/killed, or the phone rebooted.
  // Without this the toggle shows On Duty but no watcher is running, so the
  // route page shows "Acquiring GPS" forever with no explanation (the reported
  // Bug 1). If device Location is off, we surface a persistent warning instead.
  const resumeTracking = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    if (!isOnDuty) return;
    if (watcherIdRef.current) return; // already tracking

    const res = await startBackgroundTracking();
    if (res.ok) {
      setGpsBlocked(false);
      await enableKeepAwake();
    } else {
      // permission / location_off / unknown → show the actionable warning.
      setGpsBlocked(true);
      if (res.reason === "location_off") {
        toast.error(
          "Location is turned off. Turn on device Location/GPS to resume sharing your location.",
        );
      }
    }
  }, [isOnDuty, startBackgroundTracking]);

  // Run the resume attempt once on mount (app open) when the server says the
  // rider is On Duty.
  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    if (initialStatus) {
      void resumeTracking();
    }
  }, [initialStatus, resumeTracking]);

  // Re-check on every foreground: if the rider is On Duty but tracking isn't
  // running (killed while backgrounded, or Location was just turned back on),
  // re-arm it. This is what makes tracking auto-recover after the rider fixes
  // a "Location off" situation without needing to toggle Off/On.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | null = null;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && isOnDuty && !watcherIdRef.current) {
        void resumeTracking();
      }
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle?.remove();
    };
  }, [isOnDuty, resumeTracking]);

  // NOTE: We intentionally do NOT remove the watcher on unmount. The native
  // foreground service is owned by the shift (is_online), not by this UI
  // component, and must keep tracking while the rider navigates between the
  // dashboard, route, and other pages. The watcher is removed only on an
  // explicit Off Duty (toggle / auto-off-duty / admin off-duty reconcile) or a
  // fatal location error.

  const handleRetryTracking = useCallback(async () => {
    setRetrying(true);
    try {
      await resumeTracking();
    } finally {
      setRetrying(false);
    }
  }, [resumeTracking]);

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
        const res = await startBackgroundTracking();
        if (!res.ok) {
          // Req 9.5: couldn't start tracking after is_online=true — revert.
          await setRiderOnlineAction(false);
          setIsOnDuty(false);
          setGpsBlocked(false);
          if (res.reason === "location_off") {
            toast.error(
              "Turn on your device Location/GPS, then toggle On Duty again.",
            );
          } else if (res.reason === "permission") {
            toast.error(
              "Location permission is required to go On Duty. Allow location access and try again.",
            );
          } else {
            toast.error("Could not start location tracking. Please try again.");
          }
          return;
        }
        setGpsBlocked(false);
        await enableKeepAwake();
      } else {
        // Req 9.3: Off toggle — call removeWatcher
        await stopBackgroundTracking();
        await disableKeepAwake();
        setGpsBlocked(false);
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
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

      {isOnDuty && gpsBlocked && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <MapPinOff className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-red-900">
              Location is off — you&apos;re not being tracked
            </p>
            <p className="text-xs font-medium text-red-700 mt-0.5">
              Turn on Location/GPS from your phone&apos;s quick settings, then
              tap Retry. You&apos;ll stay On Duty.
            </p>
            <button
              type="button"
              onClick={handleRetryTracking}
              disabled={retrying}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", retrying && "animate-spin")}
              />
              {retrying ? "Checking…" : "Retry"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
