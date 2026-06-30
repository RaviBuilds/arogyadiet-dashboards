"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentType,
} from "react";
import {
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import {
  Circle,
  Clock,
  IndianRupee,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Route,
} from "lucide-react";

import {
  getRoutingSandboxMeta,
  getRoutingSandboxRiderRoute,
  getRoutingSandboxRiders,
  type RoutingSandboxMeta,
  type RoutingSandboxRiderOption,
  type RoutingSandboxRiderRoute,
  type RoutingSandboxStop,
} from "@/actions/admin-actions/routingSandboxActions";
import { SectionHeader } from "../core/SectionHeader";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/lib/utils";
import { ridersForSelectedClinic } from "@/lib/clinic/visibility";
import {
  ClinicSelectControl,
  SelectClinicPrompt,
  useClinicSelector,
  type GetClinics,
} from "./clinicSelector";

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

function MetaStatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex min-w-[140px] flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-slate-200">
        <Icon className="h-4 w-4 text-emerald-600" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
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

  const mapShellClass =
    "flex min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500";

  if (!apiKey) {
    return (
      <div className={cn(mapShellClass, "p-6 text-center")}>
        Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to load the sandbox map.
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={cn(
          mapShellClass,
          "border-red-200 bg-red-50 p-6 text-center text-red-600",
        )}
      >
        Google Maps failed to load.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={cn(mapShellClass, "gap-2")}>
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading map...
      </div>
    );
  }

  return (
    <div className="relative min-h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-zinc-100 shadow-sm">
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
        <div className="absolute bottom-4 left-4 right-4 z-10 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No mappable stop coordinates. Check address pin codes.</span>
        </div>
      )}

      {!encodedPolyline && mappableStops.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-600 shadow-sm">
          Route line unavailable. Stops are still shown in assigned sequence.
        </div>
      )}
    </div>
  );
}

function StopList({ stops }: { stops: RoutingSandboxStop[] }) {
  return (
    <ol className="relative">
      {stops.map((stop, index) => {
        const isLast = index === stops.length - 1;

        return (
          <li key={stop.orderId} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-12px)] border-l-2 border-slate-100"
                aria-hidden
              />
            )}

            <div className="relative z-1 shrink-0">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600 ring-2 ring-blue-100">
                {stop.sequence}
              </span>
            </div>

            <div className="min-w-0 flex-1 rounded-lg bg-blue-50/40 px-3 py-2 -ml-1">
              <p className="font-medium text-slate-900">{stop.customerName}</p>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                <Circle className="h-1.5 w-1.5 fill-current" />
                PIN {stop.pincode}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RouteMetrics({
  routeData,
}: {
  routeData: RoutingSandboxRiderRoute;
}) {
  if (!routeData.routePreview) return null;

  return (
    <div className="mt-5 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4">
      <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Route className="h-3.5 w-3.5" />
          Preview distance
        </p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">
          {formatDistance(routeData.routePreview.totalDistanceMeters)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock className="h-3.5 w-3.5" />
          Preview duration
        </p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">
          {formatDuration(routeData.routePreview.totalDurationSeconds)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <IndianRupee className="h-3.5 w-3.5" />
          Batch recorded
        </p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">
          {routeData.batch.totalDistanceKm.toFixed(2)} km · ₹
          {routeData.batch.expectedPayout}
        </p>
      </div>
    </div>
  );
}

export default function RoutingSandbox({
  scope,
  getMeta = getRoutingSandboxMeta,
  getRiders = getRoutingSandboxRiders,
  getRiderRoute = getRoutingSandboxRiderRoute,
  getClinics,
}: {
  /** Operations scope ("core" | "all" | franchise uuid) passed to admin fetches. */
  scope?: string;
  getMeta?: (scope?: string) => Promise<RoutingSandboxMeta>;
  getRiders?: (
    targetDate: string,
    scope?: string,
  ) => Promise<RoutingSandboxRiderOption[]>;
  getRiderRoute?: (
    riderId: string,
    targetDate: string,
    batchId?: string,
    scope?: string,
  ) => Promise<RoutingSandboxRiderRoute | null>;
  /**
   * When provided, enables clinic-selector-first mode (Req 17): the view loads
   * no meta/rider/route data until a clinic is selected, then shows only that
   * clinic's riders. Omitted by the franchise portal (which scopes itself).
   */
  getClinics?: GetClinics;
} = {}) {
  const {
    selectorFirst,
    clinicOptions,
    clinicsLoading,
    selectedClinicId,
    setSelectedClinicId,
  } = useClinicSelector(getClinics);

  const [meta, setMeta] = useState<RoutingSandboxMeta | null>(null);
  const [riders, setRiders] = useState<RoutingSandboxRiderOption[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [routeData, setRouteData] = useState<RoutingSandboxRiderRoute | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(!selectorFirst);
  const [isPending, startTransition] = useTransition();

  const loadSandbox = useCallback(async () => {
    // Selector-first gating: fetch nothing until a clinic is chosen
    // (Req 17.1, 17.3, 17.5).
    if (selectorFirst && !selectedClinicId) return;
    setIsLoading(true);
    try {
      const sandboxMeta = await getMeta(scope);
      setMeta(sandboxMeta);

      const riderList = await getRiders(sandboxMeta.targetDate, scope);
      setRiders(riderList);
    } finally {
      setIsLoading(false);
    }
  }, [getMeta, getRiders, scope, selectorFirst, selectedClinicId]);

  // Riders actually shown: in selector-first mode, only the selected clinic's
  // riders (Req 17.2, 17.4, 17.6); empty until a clinic is chosen (Req 17.1).
  const displayedRiders = useMemo(
    () =>
      selectorFirst
        ? ridersForSelectedClinic(selectedClinicId || null, riders)
        : riders,
    [selectorFirst, selectedClinicId, riders],
  );

  const loadRiderRoute = useCallback(
    (riderId: string, targetDate: string, batchId?: string) => {
      if (!riderId) return;
      startTransition(async () => {
        const data = await getRiderRoute(
          riderId,
          targetDate,
          batchId,
          scope,
        );
        setRouteData(data);
        if (data && data.batches.length > 0) {
          setSelectedBatchId(data.batch.id);
        }
      });
    },
    [getRiderRoute, scope],
  );

  // Changing the clinic discards any prior rider/batch/route selection so no
  // stale data remains (Req 17.7); the recompute is immediate (well within 3s).
  const handleClinicChange = useCallback(
    (clinicId: string) => {
      setSelectedClinicId(clinicId);
      setSelectedRiderId("");
      setSelectedBatchId("");
      setRouteData(null);
    },
    [setSelectedClinicId],
  );

  useEffect(() => {
    loadSandbox();
  }, [loadSandbox]);

  // Keep the selected rider valid within the currently displayed riders.
  useEffect(() => {
    setSelectedRiderId((current) => {
      if (current && displayedRiders.some((rider) => rider.id === current)) {
        return current;
      }
      return displayedRiders[0]?.id ?? "";
    });
  }, [displayedRiders]);

  useEffect(() => {
    if (!meta?.targetDate || !selectedRiderId) return;
    loadRiderRoute(selectedRiderId, meta.targetDate, selectedBatchId || undefined);
  }, [meta?.targetDate, selectedRiderId, selectedBatchId, loadRiderRoute]);

  const showBatchSelect = (routeData?.batches.length ?? 0) > 1;
  const stops = useMemo(
    () => [...(routeData?.stops ?? [])].sort((a, b) => a.sequence - b.sequence),
    [routeData?.stops],
  );

  const showActionBar = !isLoading && displayedRiders.length > 0;
  // Selector-first gate: render only the selector + prompt until a clinic is
  // selected, so no rider/route data is shown (Req 17.1, 17.3, 17.5).
  const gatePending = selectorFirst && !selectedClinicId;

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="Routing Sandbox" icon={Route} className="mb-0" />
        <p className="mt-1 ml-8 text-sm text-muted-foreground">
          Inspect the latest automated routing assignment. Select a rider to
          review delivery sequence and map path quality from production dispatch
          data.
        </p>
      </div>

      {selectorFirst && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4">
          <ClinicSelectControl
            clinicOptions={clinicOptions}
            clinicsLoading={clinicsLoading}
            selectedClinicId={selectedClinicId}
            onSelect={handleClinicChange}
          />
        </div>
      )}

      {gatePending && (
        <SelectClinicPrompt message="Select a clinic to inspect its riders and routing." />
      )}

      {!gatePending && meta && (
        <div className="flex flex-wrap gap-3">
          <MetaStatCard
            label="Routing date"
            value={meta.targetDate}
            icon={Route}
          />
          <MetaStatCard
            label="Last run"
            value={`${formatLastRun(meta.lastRunAt)} IST`}
            icon={Clock}
          />
          <MetaStatCard
            label="Batches"
            value={String(meta.batchesCreated)}
            icon={Package}
          />
          <MetaStatCard
            label="Assigned"
            value={String(meta.ordersAssigned)}
            icon={MapPin}
          />
          {meta.spilloverCount > 0 && (
            <div className="flex min-w-[140px] flex-1 items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-amber-200">
                <Package className="h-4 w-4 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-700">Spillover</p>
                <p className="truncate text-sm font-semibold text-amber-900">
                  {meta.spilloverCount} manual assignment
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {showActionBar && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-[200px] flex-1">
            <Select
              value={selectedRiderId}
              onValueChange={(value) => {
                setSelectedBatchId("");
                setSelectedRiderId(value);
              }}
              disabled={isLoading || displayedRiders.length === 0}
            >
              <SelectTrigger className="w-full border-slate-200 sm:max-w-md">
                <SelectValue
                  placeholder={
                    isLoading ? "Loading riders..." : "Select a rider"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {displayedRiders.map((rider) => (
                  <SelectItem key={rider.id} value={rider.id}>
                    {rider.fullName} — {rider.stopCount} stops
                    {rider.batchCount > 1
                      ? ` (${rider.batchCount} batches)`
                      : ""}
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
                <SelectTrigger className="w-full border-slate-200 sm:max-w-xs">
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
            className="shrink-0 border-slate-200"
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
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading routing sandbox...
        </div>
      )}

      {!gatePending && !isLoading && displayedRiders.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-muted-foreground">
          <Route className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">
            {selectorFirst
              ? "No riders for this clinic"
              : "No routed deliveries for this date"}
          </p>
          <p className="mt-1 text-sm">
            {selectorFirst
              ? "This clinic has no riders with routed deliveries for this date."
              : "Run dispatch automation or pick a date with assigned batches."}
          </p>
        </div>
      )}

      {selectedRiderId && isPending && !routeData && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading route...
        </div>
      )}

      {routeData && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <div className="max-h-[min(600px,70vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Assigned route ({stops.length} deliveries)
            </p>
            <StopList stops={stops} />
            <RouteMetrics routeData={routeData} />
          </div>

          <div className={cn(isPending && "pointer-events-none opacity-70")}>
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
