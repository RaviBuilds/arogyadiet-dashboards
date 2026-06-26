"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MapPin,
  RefreshCw,
  Truck,
} from "lucide-react";
import { SectionHeader } from "../core/SectionHeader";
import { AdminLiveTrackingMap } from "./AdminLiveTrackingMap";
import {
  getAdminLiveTrackingData,
  getLiveTrackingRiders,
  type LiveTrackingPayload,
  type LiveTrackingRiderOption,
  type LiveTrackingStop,
} from "@/actions/admin-actions/liveTrackingActions";
import { cn } from "@/lib/utils";

const TRACKING_POLL_MS = 10_000;

export default function AdminLiveTracking({
  scope,
  getRiders = getLiveTrackingRiders,
  getTrackingData = getAdminLiveTrackingData,
}: {
  /** Operations scope ("core" | "all" | franchise uuid) passed to admin fetches. */
  scope?: string;
  getRiders?: (scope?: string) => Promise<LiveTrackingRiderOption[]>;
  getTrackingData?: (
    riderId: string,
    scope?: string,
  ) => Promise<LiveTrackingPayload | null>;
} = {}) {
  const [riders, setRiders] = useState<LiveTrackingRiderOption[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>("");
  const [payload, setPayload] = useState<LiveTrackingPayload | null>(null);
  const [isLoadingRiders, setIsLoadingRiders] = useState(true);
  const [isPending, startTransition] = useTransition();

  const loadRiders = useCallback(async () => {
    setIsLoadingRiders(true);
    try {
      const list = await getRiders(scope);
      setRiders(list);
      setSelectedRiderId((current) => {
        if (current && list.some((r) => r.id === current)) return current;
        return list[0]?.id ?? "";
      });
    } finally {
      setIsLoadingRiders(false);
    }
  }, [getRiders, scope]);

  const loadTrackingData = useCallback((riderId: string) => {
    if (!riderId) return;
    startTransition(async () => {
      const data = await getTrackingData(riderId, scope);
      setPayload(data);
    });
  }, [getTrackingData, scope]);

  const pollTrackingData = useCallback(async (riderId: string) => {
    if (!riderId) return;
    const data = await getTrackingData(riderId, scope);
    setPayload(data);
  }, [getTrackingData, scope]);

  useEffect(() => {
    loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    if (selectedRiderId) loadTrackingData(selectedRiderId);
  }, [selectedRiderId, loadTrackingData]);

  useEffect(() => {
    if (!selectedRiderId) return;

    const interval = setInterval(() => {
      pollTrackingData(selectedRiderId);
    }, TRACKING_POLL_MS);

    return () => clearInterval(interval);
  }, [selectedRiderId, pollTrackingData]);

  const phase = payload?.phase ?? "not_out";
  const stops = useMemo(
    () =>
      [...(payload?.stops ?? [])].sort((a, b) => a.sequence - b.sequence),
    [payload?.stops],
  );

  const selectedRiderLabel = riders.find((r) => r.id === selectedRiderId);

  const showActionBar =
    !isLoadingRiders && riders.length > 0 && selectedRiderId;

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Live Tracking" icon={Truck} className="mb-0" />
        <p className="mt-1 ml-8 text-sm text-muted-foreground">
          Track riders in real time after batch pickup. View route stops and
          delivery progress for today.
        </p>
      </div>

      {showActionBar && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-[200px] flex-1">
            <Select
              value={selectedRiderId}
              onValueChange={setSelectedRiderId}
              disabled={isLoadingRiders || riders.length === 0}
            >
              <SelectTrigger className="w-full border-slate-200 sm:max-w-md">
                <SelectValue
                  placeholder={
                    isLoadingRiders ? "Loading riders..." : "Select a rider"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {riders.map((rider) => (
                  <SelectItem key={rider.id} value={rider.id}>
                    {rider.fullName}
                    {rider.hint ? ` — ${rider.hint}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {payload?.rider && (
            <Badge
              variant={payload.rider.isOnline ? "default" : "secondary"}
              className={cn(
                "w-fit shrink-0",
                payload.rider.isOnline &&
                  "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
              )}
            >
              {payload.rider.isOnline ? "Online" : "Offline"}
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-slate-200"
            onClick={() => {
              loadRiders();
              if (selectedRiderId) loadTrackingData(selectedRiderId);
            }}
            disabled={isPending || isLoadingRiders}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      )}

      {isLoadingRiders && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading riders...
        </div>
      )}

      {!isLoadingRiders && riders.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-muted-foreground">
          <Truck className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">No deliveries assigned today</p>
          <p className="mt-1 text-sm">
            Riders with orders for today will appear here.
          </p>
        </div>
      )}

      {selectedRiderId && isPending && !payload && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading tracking data...
        </div>
      )}

      {payload && phase === "not_out" && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-8 text-center">
          <MapPin className="mx-auto mb-3 h-10 w-10 text-orange-400" />
          <p className="font-bold text-orange-900">
            {selectedRiderLabel?.fullName ?? payload.rider.fullName} is not yet
            out for delivery
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-orange-800">
            Live map and customer list will appear once the rider picks up the
            batch from the central kitchen.
          </p>
        </div>
      )}

      {payload && phase === "completed" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            All deliveries completed for {payload.rider.fullName} today.
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <StopList stops={stops} showMap={false} />
          </div>
        </div>
      )}

      {payload && phase === "active" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <div className="max-h-[min(600px,70vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Today&apos;s route ({stops.length} deliveries)
            </p>
            <StopList stops={stops} showMap />
          </div>
          <AdminLiveTrackingMap
            riderId={payload.rider.id}
            isRiderOnline={payload.rider.isOnline}
            stops={stops}
          />
        </div>
      )}
    </div>
  );
}

function StopList({
  stops,
  showMap,
}: {
  stops: LiveTrackingStop[];
  showMap: boolean;
}) {
  const activeStopIndex = stops.findIndex((s) => !s.isDelivered);

  return (
    <ol className={cn("relative", !showMap && "max-w-lg")}>
      {stops.map((stop, index) => {
        const isActive = index === activeStopIndex;
        const isLast = index === stops.length - 1;
        const locationLabel =
          stop.locationSource === "pincode"
            ? `PIN ${stop.pincode}`
            : stop.pincode;

        return (
          <li key={stop.orderId} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-12px)] border-l-2 border-slate-100"
                aria-hidden
              />
            )}

            <div className="relative z-1 shrink-0">
              {stop.isDelivered ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </span>
              ) : isActive ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600 ring-2 ring-blue-100">
                  {stop.sequence}
                </span>
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-400">
                  {stop.sequence}
                </span>
              )}
            </div>

            <div
              className={cn(
                "min-w-0 flex-1 rounded-lg px-3 py-2 -ml-1",
                stop.isDelivered && "bg-emerald-50",
                isActive && !stop.isDelivered && "bg-blue-50/60",
              )}
            >
              <p
                className={cn(
                  "font-medium text-slate-900",
                  stop.isDelivered && "text-emerald-700",
                  isActive && !stop.isDelivered && "text-blue-900",
                )}
              >
                {stop.customerName}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                <Circle className="h-1.5 w-1.5 fill-current" />
                {locationLabel}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
