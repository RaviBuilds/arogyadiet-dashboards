"use client";

import { useState } from "react";
import {
  LiveLocationTracker,
  type GpsHardwareState,
} from "@/shared/components/rider/LiveLocationTracker";

export function RouteGpsIndicator({
  riderId,
  isActive,
}: {
  riderId: string;
  isActive: boolean;
}) {
  // Hooks must run unconditionally and in the same order on every render.
  const [gpsState, setGpsState] = useState<GpsHardwareState>("acquiring");

  if (!isActive) return null;

  return (
    <div className="flex items-center gap-2">
      {/*
        Read-only status reader. The native foreground service (started by the
        On Duty toggle) owns the GPS watcher + upload. This just reflects
        `rider_live_locations` freshness. DO NOT re-introduce a watcher here.
      */}
      <LiveLocationTracker
        riderId={riderId}
        isDelivering={isActive}
        showIndicator={false}
        onGpsStateChange={setGpsState}
      />

      {gpsState === "active" ? (
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-green-700 uppercase tracking-wide">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          GPS Active
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-yellow-700 uppercase tracking-wide">
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400" />
          Acquiring GPS...
        </div>
      )}
    </div>
  );
}
