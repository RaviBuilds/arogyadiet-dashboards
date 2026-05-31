"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import { Loader2, Plus, Route, Trash2 } from "lucide-react";

import {
  calculateTestRoute,
  type LatLngLiteral,
  type TestRouteResult,
  type TestRouteSuccess,
} from "@/actions/admin-actions/testRoutingActions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };
const MADHAPUR_COORDS = { lat: "17.4486", lng: "78.3908" };
const MAX_DESTINATIONS = 10;

const mapContainerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "520px",
};

type CoordinateInput = {
  lat: string;
  lng: string;
};

type DeliveryInput = CoordinateInput & {
  customerName: string;
};

type SubmittedStop = {
  label: string;
  customerName: string;
  coordinates: LatLngLiteral;
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

function parseCoordinateInput(point: CoordinateInput): LatLngLiteral | null {
  if (!point.lat.trim() || !point.lng.trim()) return null;

  const lat = Number(point.lat);
  const lng = Number(point.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

function hasCoordinateInput(point: CoordinateInput) {
  return point.lat.trim().length > 0 || point.lng.trim().length > 0;
}

function formatCoordinateLabel(point: LatLngLiteral) {
  return `${point.lat}, ${point.lng}`;
}

function getAlphabetLabel(index: number) {
  return String.fromCharCode(65 + index);
}

function RouteSandboxMap({
  route,
  submittedStops,
}: {
  route: TestRouteSuccess | null;
  submittedStops: SubmittedStop[];
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey || "",
  });

  const overviewPolyline = route?.overviewPolyline || "";
  const routePath = useMemo(
    () => (overviewPolyline ? decodePolyline(overviewPolyline) : []),
    [overviewPolyline],
  );

  useEffect(() => {
    if (!isLoaded || !mapRef.current || routePath.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();
    routePath.forEach((point) => bounds.extend(point));
    mapRef.current.fitBounds(bounds, 48);
  }, [isLoaded, routePath]);

  if (!apiKey) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to load the sandbox map.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-xl border bg-destructive/10 p-6 text-center text-sm text-destructive">
        Google Maps failed to load.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-xl border bg-muted/30 text-sm text-muted-foreground">
        Loading Maps Engine...
      </div>
    );
  }

  return (
    <div className="relative min-h-[520px] overflow-hidden rounded-xl border bg-zinc-100">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={route?.originLocation || HYDERABAD_CENTER}
        zoom={12}
        onLoad={(map) => {
          mapRef.current = map;
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

        {route?.originLocation && (
          <Marker
            position={route.originLocation}
            title="Origin / Kitchen"
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
        )}

        {route?.optimizedStops.map(
          (stop) => {
            const submittedStop = submittedStops[stop.originalIndex];
            const markerLabel =
              submittedStop?.label || getAlphabetLabel(stop.originalIndex);
            const customerName = submittedStop?.customerName || "Unnamed customer";

            return (
              stop.location && (
              <Marker
                key={`${stop.originalIndex}-${stop.sequence}`}
                position={stop.location}
                title={`${markerLabel}: ${customerName} (${formatCoordinateLabel(stop.coordinates)})`}
                label={{
                  text: markerLabel,
                  color: "#ffffff",
                  fontWeight: "bold",
                }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 14,
                  fillColor: "#16a34a",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 2,
                }}
              />
              )
            );
          },
        )}
      </GoogleMap>

      {!route && (
        <div className="absolute bottom-4 left-4 right-4 rounded-xl border bg-white/95 p-4 text-sm text-muted-foreground shadow-sm">
          Enter delivery coordinates and calculate a route to draw the optimized
          result here.
        </div>
      )}
    </div>
  );
}

export default function TestRoutingClient() {
  const [origin, setOrigin] = useState<CoordinateInput>(MADHAPUR_COORDS);
  const [destinations, setDestinations] = useState<DeliveryInput[]>([
    { lat: "", lng: "", customerName: "" },
  ]);
  const [submittedStops, setSubmittedStops] = useState<SubmittedStop[]>([]);
  const [result, setResult] = useState<TestRouteResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const successfulRoute = result?.ok ? result : null;
  const filledDestinationCount = destinations.filter(hasCoordinateInput).length;
  const hasOriginInput = hasCoordinateInput(origin);

  const jsonOutput = useMemo(() => {
    if (!result) return "";
    if (!result.ok) {
      return JSON.stringify(result, null, 2);
    }

    return JSON.stringify(result.debug, null, 2);
  }, [result]);

  const waypointExplanation = useMemo(() => {
    if (!successfulRoute) return null;

    const inputMapping = submittedStops
      .map((stop, index) => `${index}=${stop.label}`)
      .join(", ");
    const visitOrder = successfulRoute.waypointOrder
      .map((originalIndex) => submittedStops[originalIndex]?.label || originalIndex)
      .join(" -> ");
    const farthestStop =
      submittedStops[successfulRoute.debug.farthest_destination_index];

    return {
      inputMapping,
      visitOrder,
      farthestLabel: farthestStop?.label || getAlphabetLabel(
        successfulRoute.debug.farthest_destination_index,
      ),
      farthestCustomerName: farthestStop?.customerName || "Unnamed customer",
    };
  }, [successfulRoute, submittedStops]);

  const updateOrigin = (field: keyof CoordinateInput, value: string) => {
    setOrigin((current) => ({ ...current, [field]: value }));
  };

  const updateDestination = (
    index: number,
    field: keyof DeliveryInput,
    value: string,
  ) => {
    setDestinations((current) =>
      current.map((destination, currentIndex) =>
        currentIndex === index
          ? { ...destination, [field]: value }
          : destination,
      ),
    );
  };

  const addDestination = () => {
    setDestinations((current) =>
      current.length >= MAX_DESTINATIONS
        ? current
        : [...current, { lat: "", lng: "", customerName: "" }],
    );
  };

  const removeDestination = (index: number) => {
    setDestinations((current) =>
      current.length === 1
        ? [{ lat: "", lng: "", customerName: "" }]
        : current.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const handleCalculate = async () => {
    setIsCalculating(true);
    setResult(null);
    setSubmittedStops([]);

    try {
      const parsedOrigin = parseCoordinateInput(origin);

      if (!parsedOrigin) {
        setResult({
          ok: false,
          error: "Enter valid origin latitude and longitude.",
        });
        return;
      }

      const filledDestinations = destinations.filter(hasCoordinateInput);

      if (filledDestinations.length === 0) {
        setResult({
          ok: false,
          error: "Enter at least one delivery coordinate pair.",
        });
        return;
      }

      const parsedDestinations = filledDestinations.map(parseCoordinateInput);

      if (parsedDestinations.some((destination) => destination == null)) {
        setResult({
          ok: false,
          error: "Enter valid latitude and longitude for every delivery stop.",
        });
        return;
      }

      const submitted = filledDestinations.map((destination, index) => ({
        label: getAlphabetLabel(index),
        customerName: destination.customerName.trim(),
        coordinates: parsedDestinations[index] as LatLngLiteral,
      }));

      const routeResult = await calculateTestRoute(
        parsedOrigin,
        parsedDestinations as LatLngLiteral[],
      );
      setSubmittedStops(submitted);
      setResult(routeResult);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected route calculation error.",
      });
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Route Inputs</CardTitle>
          <CardDescription>
            This is stateless test data. Nothing is saved to dispatch or
            Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label>Origin / Kitchen Coordinates</Label>
            <div className="flex gap-2">
              <Input
                value={origin.lat}
                onChange={(event) => updateOrigin("lat", event.target.value)}
                placeholder="Latitude"
                inputMode="decimal"
                aria-label="Origin latitude"
              />
              <Input
                value={origin.lng}
                onChange={(event) => updateOrigin("lng", event.target.value)}
                placeholder="Longitude"
                inputMode="decimal"
                aria-label="Origin longitude"
              />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Delivery Coordinates</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Label each customer as A, B, C and add up to{" "}
                  {MAX_DESTINATIONS} coordinate pairs.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDestination}
                disabled={destinations.length >= MAX_DESTINATIONS}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            <div className="grid gap-2">
              {destinations.map((destination, index) => (
                <div key={index} className="flex gap-2 rounded-lg border p-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {getAlphabetLabel(index)}
                  </div>
                  <div className="grid flex-1 gap-2">
                    <div className="flex gap-2">
                      <Input
                        value={destination.lat}
                        onChange={(event) =>
                          updateDestination(index, "lat", event.target.value)
                        }
                        placeholder={`${getAlphabetLabel(index)}: Lat`}
                        inputMode="decimal"
                        aria-label={`Delivery ${getAlphabetLabel(index)} latitude`}
                      />
                      <Input
                        value={destination.lng}
                        onChange={(event) =>
                          updateDestination(index, "lng", event.target.value)
                        }
                        placeholder={`${getAlphabetLabel(index)}: Lng`}
                        inputMode="decimal"
                        aria-label={`Delivery ${getAlphabetLabel(index)} longitude`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeDestination(index)}
                        aria-label={`Remove delivery coordinate pair ${getAlphabetLabel(index)}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <Input
                      value={destination.customerName}
                      onChange={(event) =>
                        updateDestination(
                          index,
                          "customerName",
                          event.target.value,
                        )
                      }
                      placeholder={`${getAlphabetLabel(index)}: Customer name`}
                      aria-label={`Delivery ${getAlphabetLabel(index)} customer name`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            onClick={handleCalculate}
            disabled={
              isCalculating || !hasOriginInput || filledDestinationCount === 0
            }
            className="w-full"
          >
            {isCalculating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Route className="size-4" />
            )}
            Calculate Optimized Route
          </Button>

          {result && !result.ok && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {result.error}
            </div>
          )}

          {successfulRoute && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">Open route waypoint order</div>
              <div className="font-mono text-xs">
                [{successfulRoute.waypointOrder.join(", ")}]
              </div>
              {waypointExplanation && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Input index mapping: {waypointExplanation.inputMapping}</p>
                  <p>Optimized marker order: {waypointExplanation.visitOrder}</p>
                  <p>
                    Farthest stop (fixed final destination):{" "}
                    {waypointExplanation.farthestLabel} (
                    {waypointExplanation.farthestCustomerName})
                  </p>
                  <p>
                    Google intermediate order: [
                    {successfulRoute.debug.google_waypoint_order.join(", ")}]
                  </p>
                </div>
              )}
              <div className="text-muted-foreground">
                {formatDistance(successfulRoute.totalDistanceMeters)} total,
                about {formatDuration(successfulRoute.totalDurationSeconds)}.
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="routing-json">Raw waypoint JSON</Label>
            <Textarea
              id="routing-json"
              value={jsonOutput}
              readOnly
              placeholder="The waypoint_order response will appear here."
              className="min-h-56 font-mono text-xs"
            />
          </div>

          <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="font-medium">Customer label mapping</div>
            {submittedStops.length > 0 ? (
              <div className="grid gap-1">
                {submittedStops.map((stop, index) => (
                  <div
                    key={`${stop.label}-${index}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      Index {index} = {stop.label}
                    </span>
                    <span className="text-right">
                      {stop.label}: {stop.customerName || "Unnamed customer"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add customer names beside coordinates, then calculate to lock
                the label mapping for the returned waypoint_order.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optimized Route Map</CardTitle>
          <CardDescription>
            Open routing: kitchen to optimized intermediate stops, ending at the
            farthest delivery. Markers show K for the origin and A, B, C for
            customer stops.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RouteSandboxMap
            route={successfulRoute}
            submittedStops={submittedStops}
          />
        </CardContent>
      </Card>
    </div>
  );
}
