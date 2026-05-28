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

export default function AdminLiveTracking() {
  const [riders, setRiders] = useState<LiveTrackingRiderOption[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>("");
  const [payload, setPayload] = useState<LiveTrackingPayload | null>(null);
  const [isLoadingRiders, setIsLoadingRiders] = useState(true);
  const [isPending, startTransition] = useTransition();

  const loadRiders = useCallback(async () => {
    setIsLoadingRiders(true);
    try {
      const list = await getLiveTrackingRiders();
      setRiders(list);
      setSelectedRiderId((current) => {
        if (current && list.some((r) => r.id === current)) return current;
        return list[0]?.id ?? "";
      });
    } finally {
      setIsLoadingRiders(false);
    }
  }, []);

  const loadTrackingData = useCallback((riderId: string) => {
    if (!riderId) return;
    startTransition(async () => {
      const data = await getAdminLiveTrackingData(riderId);
      setPayload(data);
    });
  }, []);

  const pollTrackingData = useCallback(async (riderId: string) => {
    if (!riderId) return;
    const data = await getAdminLiveTrackingData(riderId);
    setPayload(data);
  }, []);

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

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Live Tracking" icon={Truck} />
        <p className="text-sm text-muted-foreground -mt-3 mb-2">
          Track riders in real time after batch pickup. View route stops and
          delivery progress for today.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <Select
            value={selectedRiderId}
            onValueChange={setSelectedRiderId}
            disabled={isLoadingRiders || riders.length === 0}
          >
            <SelectTrigger className="w-full sm:max-w-md">
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
            className="w-fit"
          >
            {payload.rider.isOnline ? "Online" : "Offline"}
          </Badge>
        )}

        <Button
          variant="outline"
          size="sm"
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

      {isLoadingRiders && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading riders...
        </div>
      )}

      {!isLoadingRiders && riders.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
          <Truck className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No deliveries assigned today</p>
          <p className="text-sm mt-1">
            Riders with orders for today will appear here.
          </p>
        </div>
      )}

      {selectedRiderId && (isPending && !payload) && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading tracking data...
        </div>
      )}

      {payload && phase === "not_out" && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-8 text-center">
          <MapPin className="h-10 w-10 mx-auto mb-3 text-orange-400" />
          <p className="font-bold text-orange-900">
            {selectedRiderLabel?.fullName ?? payload.rider.fullName} is not yet
            out for delivery
          </p>
          <p className="text-sm text-orange-800 mt-2 max-w-md mx-auto">
            Live map and customer list will appear once the rider picks up the
            batch from the central kitchen.
          </p>
        </div>
      )}

      {payload && phase === "completed" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-green-50 border-green-200 px-4 py-3 text-green-900 text-sm font-medium">
            All deliveries completed for{" "}
            {payload.rider.fullName} today.
          </div>
          <StopList stops={stops} showMap={false} />
        </div>
      )}

      {payload && phase === "active" && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="rounded-2xl border bg-card p-4 max-h-[min(500px,60vh)] overflow-y-auto">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
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
  return (
    <ul className={cn("space-y-2", !showMap && "max-w-lg")}>
      {stops.map((stop) => (
        <li
          key={stop.orderId}
          className={cn(
            "flex items-start gap-2 rounded-lg px-2 py-2 text-sm",
            stop.isDelivered && "bg-green-50/80",
          )}
        >
          {stop.isDelivered ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold mt-0.5">
              {stop.sequence}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <span className="font-medium text-foreground">
              {stop.sequence}. {stop.customerName}
            </span>
            <span className="text-muted-foreground">
              {" "}
              (
              {stop.locationSource === "pincode" ? `PIN ${stop.pincode}` : stop.pincode}
              )
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
