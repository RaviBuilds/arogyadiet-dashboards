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
  // Previously useState was declared AFTER an early `return null`, which is a
  // Rules-of-Hooks violation that throws/desyncs hook state whenever isActive flips.
  const [gpsState, setGpsState] = useState<GpsHardwareState>("acquiring");

  if (!isActive) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Starts/stops actual GPS watch + DB syncing */}
      <LiveLocationTracker
        riderId={riderId}
        isDelivering={isActive}
        showIndicator={false}
        onGpsStateChange={setGpsState}
      />

      {/* Small always-visible indicator (top-right) */}
      {gpsState === "active" && (
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-green-700 uppercase tracking-wide">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          GPS Active
        </div>
      )}

      {gpsState === "acquiring" && (
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-yellow-700 uppercase tracking-wide">
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400" />
          Acquiring GPS...
        </div>
      )}

      {gpsState === "error" && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[10px] sm:text-xs font-bold text-orange-800">
          ⚠️ Location Access Blocked: Please enable GPS in your browser
          settings.
        </div>
      )}
    </div>
  );
}
