"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import { Loader2, MapPin, RefreshCw, Route } from "lucide-react";

import {
  getRoutingSandboxMeta,
  getRoutingSandboxRiderRoute,
  getRoutingSandboxRiders,
  type RoutingSandboxMeta,
  type RoutingSandboxRiderOption,
  type RoutingSandboxRiderRoute,
  type RoutingSandboxStop,
} from "@/actions/admin-actions/routingSandboxActions";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/lib/utils";

const mapContainerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "520px",
};

function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  const points: google.maps.LatLngLiteral[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} hr ${remainingMinutes} min`;
}

function formatLastRun(iso: string | null) {
  if (!iso) return "No routing run logged";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function RoutingSandboxMap({
  kitchen,
  stops,
  encodedPolyline,
}: {
  kitchen: { lat: number; lng: number };
  stops: RoutingSandboxStop[];
  encodedPolyline: string | null;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey || "",
  });

  const mappableStops = stops.filter(
    (stop) =>
      stop.lat != null &&
      stop.lng != null &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lng),
  );

  const routePath = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : []),
    [encodedPolyline],
  );

  const fitMapBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoint = false;

    bounds.extend(kitchen);
    hasPoint = true;

    mappableStops.forEach((stop) => {
      bounds.extend({ lat: stop.lat!, lng: stop.lng! });
    });

    routePath.forEach((point) => bounds.extend(point));

    if (hasPoint) {
      map.fitBounds(bounds, 48);
    }
  }, [kitchen, mappableStops, routePath]);

  useEffect(() => {
    if (isLoaded) fitMapBounds();
  }, [isLoaded, fitMapBounds]);

  if (!apiKey) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to load the sandbox map.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border bg-destructive/10 p-6 text-center text-sm text-destructive">
        Google Maps failed to load.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border bg-muted/30 text-sm text-muted-foreground">
        Loading Maps Engine...
      </div>
    );
  }

  return (
    <div className="relative min-h-[520px] overflow-hidden rounded-2xl border bg-zinc-100">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={kitchen}
        zoom={12}
        onLoad={(map) => {
          mapRef.current = map;
          fitMapBounds();
        }}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
        }}
      >
        {routePath.length > 0 && (
          <Polyline
            path={routePath}
            options={{
              strokeColor: "#2563eb",
              strokeOpacity: 0.9,
              strokeWeight: 5,
            }}
          />
        )}

        <Marker
          position={kitchen}
          title="Kitchen"
          label={{
            text: "K",
            color: "#ffffff",
            fontWeight: "bold",
          }}
          icon={{
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 15,
            fillColor: "#111827",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          }}
        />

        {mappableStops.map((stop) => (
          <Marker
            key={stop.orderId}
            position={{ lat: stop.lat!, lng: stop.lng! }}
            title={`${stop.sequence}. ${stop.customerName}`}
            label={{
              text: String(stop.sequence),
              color: "#ffffff",
              fontWeight: "bold",
            }}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>

      {mappableStops.length === 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
          <span>No mappable stop coordinates. Check address pin codes.</span>
        </div>
      )}

      {!encodedPolyline && mappableStops.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border bg-white/95 px-4 py-3 text-sm text-muted-foreground">
          Route line unavailable. Stops are still shown in assigned sequence.
        </div>
      )}
    </div>
  );
}

function StopList({ stops }: { stops: RoutingSandboxStop[] }) {
  return (
    <ul className="space-y-2">
      {stops.map((stop) => (
        <li
          key={stop.orderId}
          className="flex items-start gap-2 rounded-lg px-2 py-2 text-sm"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold mt-0.5">
            {stop.sequence}
          </span>
          <div className="min-w-0 flex-1">
            <span className="font-medium text-foreground">
              {stop.sequence}. {stop.customerName}
            </span>
            <span className="text-muted-foreground"> ({stop.pincode})</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function TestRoutingClient() {
  const [meta, setMeta] = useState<RoutingSandboxMeta | null>(null);
  const [riders, setRiders] = useState<RoutingSandboxRiderOption[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [routeData, setRouteData] = useState<RoutingSandboxRiderRoute | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const loadSandbox = useCallback(async () => {
    setIsLoading(true);
    try {
      const sandboxMeta = await getRoutingSandboxMeta();
      setMeta(sandboxMeta);

      const riderList = await getRoutingSandboxRiders(sandboxMeta.targetDate);
      setRiders(riderList);

      setSelectedRiderId((current) => {
        if (current && riderList.some((rider) => rider.id === current)) {
          return current;
        }
        return riderList[0]?.id ?? "";
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadRiderRoute = useCallback(
    (riderId: string, targetDate: string, batchId?: string) => {
      if (!riderId) return;
      startTransition(async () => {
        const data = await getRoutingSandboxRiderRoute(
          riderId,
          targetDate,
          batchId,
        );
        setRouteData(data);
        if (data && data.batches.length > 0) {
          setSelectedBatchId(data.batch.id);
        }
      });
    },
    [],
  );

  useEffect(() => {
    loadSandbox();
  }, [loadSandbox]);

  useEffect(() => {
    if (!meta?.targetDate || !selectedRiderId) return;
    loadRiderRoute(selectedRiderId, meta.targetDate, selectedBatchId || undefined);
  }, [meta?.targetDate, selectedRiderId, selectedBatchId, loadRiderRoute]);

  const showBatchSelect = (routeData?.batches.length ?? 0) > 1;
  const stops = useMemo(
    () => [...(routeData?.stops ?? [])].sort((a, b) => a.sequence - b.sequence),
    [routeData?.stops],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline" className="gap-1">
          <Route className="h-3.5 w-3.5" />
          Routing for {meta?.targetDate ?? "—"}
        </Badge>
        {meta && (
          <>
            <span>Last run: {formatLastRun(meta.lastRunAt)} IST</span>
            <span>·</span>
            <span>{meta.batchesCreated} batches</span>
            <span>·</span>
            <span>{meta.ordersAssigned} assigned</span>
            {meta.spilloverCount > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-700 font-medium">
                  {meta.spilloverCount} spillover (manual assignment)
                </span>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-[200px]">
          <Select
            value={selectedRiderId}
            onValueChange={(value) => {
              setSelectedBatchId("");
              setSelectedRiderId(value);
            }}
            disabled={isLoading || riders.length === 0}
          >
            <SelectTrigger className="w-full sm:max-w-md">
              <SelectValue
                placeholder={
                  isLoading ? "Loading riders..." : "Select a rider"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {riders.map((rider) => (
                <SelectItem key={rider.id} value={rider.id}>
                  {rider.fullName} — {rider.stopCount} stops
                  {rider.batchCount > 1 ? ` (${rider.batchCount} batches)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showBatchSelect && routeData && (
          <div className="min-w-[200px]">
            <Select
              value={selectedBatchId || routeData.batch.id}
              onValueChange={setSelectedBatchId}
            >
              <SelectTrigger className="w-full sm:max-w-xs">
                <SelectValue placeholder="Select batch" />
              </SelectTrigger>
              <SelectContent>
                {routeData.batches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.label} — {batch.stopCount} stops,{" "}
                    {batch.totalDistanceKm.toFixed(1)} km
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            loadSandbox();
            if (meta?.targetDate && selectedRiderId) {
              loadRiderRoute(
                selectedRiderId,
                meta.targetDate,
                selectedBatchId || undefined,
              );
            }
          }}
          disabled={isPending || isLoading}
        >
          {isPending || isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading routing sandbox...
        </div>
      )}

      {!isLoading && riders.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
          <Route className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No routed deliveries for this date</p>
          <p className="text-sm mt-1">
            Run dispatch automation or pick a date with assigned batches.
          </p>
        </div>
      )}

      {selectedRiderId && isPending && !routeData && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading route...
        </div>
      )}

      {routeData && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
          <div className="rounded-2xl border bg-card p-4 max-h-[min(560px,70vh)] overflow-y-auto">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Assigned route ({stops.length} deliveries)
            </p>
            <StopList stops={stops} />
            {routeData.routePreview && (
              <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p>
                  Preview distance:{" "}
                  {formatDistance(routeData.routePreview.totalDistanceMeters)}
                </p>
                <p>
                  Preview duration:{" "}
                  {formatDuration(routeData.routePreview.totalDurationSeconds)}
                </p>
                <p>
                  Batch recorded: {routeData.batch.totalDistanceKm.toFixed(2)}{" "}
                  km · ₹{routeData.batch.expectedPayout}
                </p>
              </div>
            )}
          </div>

          <div className={cn(isPending && "opacity-70 pointer-events-none")}>
            <RoutingSandboxMap
              kitchen={routeData.kitchen}
              stops={stops}
              encodedPolyline={routeData.routePreview?.encodedPolyline ?? null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
