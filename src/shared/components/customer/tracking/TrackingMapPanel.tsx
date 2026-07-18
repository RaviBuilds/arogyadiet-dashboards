"use client";

import { Clock, MapPinned, Navigation2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveTrackingMap } from "@/shared/components/customer/LiveTrackingMap";

/**
 * TrackingMapPanel — the map becomes the hero.
 *
 * Full-bleed <LiveTrackingMap/> with floating glass-morphism overlays for
 * live status, ETA, and distance. All data is exactly what LiveTrackingMap
 * already computes/emits (onEtaChange / onDistanceChange / onLocationUpdate)
 * — no new tracking logic, no new API calls, purely presentational chrome
 * layered on top of the untouched map.
 */
export function TrackingMapPanel({
  riderId,
  orderStatus,
  customerLat,
  customerLng,
  etaText,
  distanceText,
  isLocationFresh,
  onEtaChange,
  onDistanceChange,
  onLocationUpdate,
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
  etaText: string | null;
  distanceText: string | null;
  isLocationFresh: boolean;
  onEtaChange: (eta: string | null) => void;
  onDistanceChange: (distance: string | null) => void;
  onLocationUpdate: () => void;
}) {
  const canTrack =
    orderStatus === "OUT_FOR_DELIVERY" || orderStatus === "REACHING_TO_LOCATION";

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-3xl border border-white/60 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.25)] sm:h-[520px] lg:h-full lg:min-h-[560px]">
      <LiveTrackingMap
        riderId={riderId}
        orderStatus={orderStatus}
        customerLat={customerLat}
        customerLng={customerLng}
        onEtaChange={onEtaChange}
        onDistanceChange={onDistanceChange}
        onLocationUpdate={onLocationUpdate}
      />

      {canTrack ? (
        <>
          {/* Top-left: rider approaching */}
          <GlassOverlay className="left-4 top-4 sm:left-5 sm:top-5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  isLocationFresh && "animate-ping bg-emerald-400",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  isLocationFresh ? "bg-emerald-500" : "bg-slate-300",
                )}
              />
            </span>
            <span className="text-sm font-semibold text-slate-900">
              {isLocationFresh ? "Rider approaching" : "Connecting…"}
            </span>
          </GlassOverlay>

          {/* Bottom-left: ETA */}
          {etaText ? (
            <GlassOverlay className="bottom-4 left-4 sm:bottom-5 sm:left-5">
              <Clock className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="leading-tight">
                <p className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-400">
                  ETA
                </p>
                <p className="text-sm font-bold text-slate-900">{etaText}</p>
              </div>
            </GlassOverlay>
          ) : null}

          {/* Bottom-right: distance */}
          {distanceText ? (
            <GlassOverlay className="bottom-4 right-4 sm:bottom-5 sm:right-5">
              <Navigation2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="leading-tight">
                <p className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-400">
                  Distance
                </p>
                <p className="text-sm font-bold text-slate-900">{distanceText}</p>
              </div>
            </GlassOverlay>
          ) : null}

          {/* Top-right: live indicator */}
          <GlassOverlay className="right-4 top-4 sm:right-5 sm:top-5" pill>
            <MapPinned className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
              Live
            </span>
          </GlassOverlay>
        </>
      ) : null}
    </div>
  );
}

function GlassOverlay({
  children,
  className,
  pill = false,
}: {
  children: React.ReactNode;
  className?: string;
  pill?: boolean;
}) {
  return (
    <div
      className={cn(
        "reveal-rise absolute z-10 flex items-center gap-2 border border-white/60 bg-white/80 shadow-lg shadow-slate-900/10 backdrop-blur-md",
        pill ? "rounded-full px-3 py-1.5" : "rounded-2xl px-3.5 py-2.5",
        className,
      )}
      style={{ ["--reveal-delay" as string]: "250ms" }}
    >
      {children}
    </div>
  );
}
