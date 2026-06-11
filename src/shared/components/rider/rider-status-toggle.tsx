"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bike, PowerOff } from "lucide-react";
import { setRiderOnlineAction } from "@/actions/rider-actions/shiftActions";
import { BackgroundGeolocation } from "@capacitor-community/background-geolocation";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

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

  const startBackgroundTracking = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    const supabase = createClient();

    try {
      const watcherId = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage:
            "ArogyaDiet is tracking your route for delivery updates.",
          backgroundTitle: "Active Delivery Route",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10, // Update every 10 meters
        },
        async (location, error) => {
          if (error) {
            console.error("Background Location Error:", error);
            return;
          }

          if (location) {
            const { latitude, longitude } = location;
            await supabase.from("rider_live_locations").upsert(
              {
                rider_id: riderId,
                lat: latitude,
                lng: longitude,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "rider_id" },
            );
          }
        },
      );

      watcherIdRef.current = watcherId;
    } catch (err) {
      console.error("Failed to start background geolocation:", err);
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

  const handleToggle = (checked: boolean) => {
    setIsOnDuty(checked);
    startTransition(async () => {
      const result = await setRiderOnlineAction(checked);
      if (result.error) {
        setIsOnDuty(!checked); // Revert on failure
        console.error(result.error);
        // Revert tracking state on failure
        if (checked) {
          await stopBackgroundTracking();
        }
      } else {
        // Toggle succeeded — manage background geolocation
        if (checked) {
          await startBackgroundTracking();
        } else {
          await stopBackgroundTracking();
        }
        router.refresh();
      }
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
