import {
  calculateHaversineDistanceKm,
  type RoutableOrder,
} from "@/lib/distance";

export type LatLng = { lat: number; lng: number };

export type OptimizedRouteLeg = {
  orderId: string;
  routeSequence: number;
  payoutAmount: number;
};

export type OptimizedRouteResult = {
  totalKm: number;
  expectedPayout: number;
  legs: OptimizedRouteLeg[];
  optimizedWaypointIndex: number[];
};

export type RouteLegDetail = {
  distanceMeters: number;
  durationSeconds: number;
  endLocation: LatLng | null;
};

export type OptimizedRouteDetails = OptimizedRouteResult & {
  encodedPolyline: string;
  originLocation: LatLng | null;
  legDetails: RouteLegDetail[];
};

type RouteStop = { id: string; lat: number; lng: number };

type GoogleLatLng = {
  latitude?: number;
  longitude?: number;
};

type GoogleRouteLeg = {
  distanceMeters?: number;
  duration?: string;
  endLocation?: { latLng?: GoogleLatLng };
  startLocation?: { latLng?: GoogleLatLng };
};

type GoogleRoute = {
  distanceMeters?: number;
  optimizedIntermediateWaypointIndex?: number[];
  polyline?: { encodedPolyline?: string };
  legs?: GoogleRouteLeg[];
};

type GoogleRoutesResponse = {
  routes?: GoogleRoute[];
  error?: { message?: string; status?: string };
};

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

const BASE_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.optimizedIntermediateWaypointIndex",
].join(",");

const DETAILS_FIELD_MASK = [
  BASE_FIELD_MASK,
  "routes.polyline.encodedPolyline",
  "routes.legs.endLocation.latLng",
  "routes.legs.startLocation.latLng",
].join(",");

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return calculateHaversineDistanceKm(lat1, lng1, lat2, lng2);
}

export function findFarthestStopIndex(
  kitchenLat: number,
  kitchenLng: number,
  stops: RouteStop[],
): number {
  let farthestIndex = 0;
  let maxDistance = -1;

  for (let i = 0; i < stops.length; i++) {
    const distance = haversineDistanceKm(
      kitchenLat,
      kitchenLng,
      stops[i].lat,
      stops[i].lng,
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      farthestIndex = i;
    }
  }

  return farthestIndex;
}

function toWaypoint(lat: number, lng: number) {
  return {
    location: {
      latLng: {
        latitude: lat,
        longitude: lng,
      },
    },
  };
}

function parseDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1])) : 0;
}

function toLatLng(location: GoogleLatLng | undefined): LatLng | null {
  if (
    location?.latitude == null ||
    location?.longitude == null ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    return null;
  }

  return { lat: location.latitude, lng: location.longitude };
}

function buildOptimizedIndex(
  stopCount: number,
  optimizedIndex: number[] | undefined,
): number[] {
  if (stopCount === 0) return [];
  if (
    optimizedIndex &&
    optimizedIndex.length === stopCount &&
    optimizedIndex.every((index) => index >= 0 && index < stopCount)
  ) {
    return optimizedIndex;
  }

  console.warn(
    "Routes API missing optimizedIntermediateWaypointIndex; using input order.",
    optimizedIndex,
  );
  return Array.from({ length: stopCount }, (_, index) => index);
}

function identityIndex(stopCount: number): number[] {
  return Array.from({ length: stopCount }, (_, index) => index);
}

export type FixedOrderRoutePreview = {
  encodedPolyline: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
};

type RouteShape = "closed_loop" | "open_loop" | "fixed_order_open";

type FetchGoogleRoutesOptions = {
  departureTime?: string;
  optimizeWaypointOrder?: boolean;
  routeShape?: RouteShape;
  /** Used when routeShape is open_loop with >= 2 stops */
  farthestStop?: RouteStop;
  intermediateStops?: RouteStop[];
};

async function fetchGoogleRoutes(
  kitchenLat: number,
  kitchenLng: number,
  stops: RouteStop[],
  apiKey: string,
  fieldMask: string,
  options: FetchGoogleRoutesOptions = {},
): Promise<GoogleRoute | null> {
  if (stops.length === 0) return null;

  const optimizeWaypointOrder = options.optimizeWaypointOrder ?? true;
  const kitchenWaypoint = toWaypoint(kitchenLat, kitchenLng);
  const routeShape = options.routeShape ?? "closed_loop";

  let origin = kitchenWaypoint;
  let destination = kitchenWaypoint;
  let intermediates: ReturnType<typeof toWaypoint>[] = [];

  if (routeShape === "fixed_order_open") {
    if (stops.length === 1) {
      destination = toWaypoint(stops[0].lat, stops[0].lng);
    } else {
      const lastStop = stops[stops.length - 1];
      destination = toWaypoint(lastStop.lat, lastStop.lng);
      intermediates = stops
        .slice(0, -1)
        .map((stop) => toWaypoint(stop.lat, stop.lng));
    }
  } else if (routeShape === "open_loop") {
    if (stops.length === 1) {
      destination = toWaypoint(stops[0].lat, stops[0].lng);
    } else {
      const farthest = options.farthestStop ?? stops[stops.length - 1];
      const intermediateStops =
        options.intermediateStops ??
        stops.filter((stop) => stop.id !== farthest.id);
      destination = toWaypoint(farthest.lat, farthest.lng);
      intermediates = intermediateStops.map((stop) =>
        toWaypoint(stop.lat, stop.lng),
      );
    }
  } else {
    intermediates = stops.map((stop) => toWaypoint(stop.lat, stop.lng));
  }

  const body: Record<string, unknown> = {
    origin,
    destination,
    intermediates,
    travelMode: "TWO_WHEELER",
    optimizeWaypointOrder,
    routingPreference: "TRAFFIC_AWARE",
    units: "METRIC",
  };

  if (options.departureTime) {
    body.departureTime = options.departureTime;
  }

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Google Routes API HTTP error:", response.status, errorText);
    return null;
  }

  const data = (await response.json()) as GoogleRoutesResponse;

  if (!data.routes?.[0]) {
    console.error("Google Routes API Error:", data.error ?? data);
    return null;
  }

  return data.routes[0];
}

type BuildRouteOptions = {
  assumeStopsInVisitOrder?: boolean;
};

function buildRouteFromGoogleResponse(
  route: GoogleRoute,
  stops: RouteStop[],
  payoutPerKm: number,
  options: BuildRouteOptions = {},
): OptimizedRouteResult | null {
  const apiLegs = route.legs ?? [];
  const stopCount = stops.length;

  if (apiLegs.length < stopCount) {
    console.error(
      "Google Routes API returned fewer legs than delivery stops.",
      { stopCount, legCount: apiLegs.length },
    );
    return null;
  }

  const optimizedWaypointIndex = options.assumeStopsInVisitOrder
    ? identityIndex(stopCount)
    : buildOptimizedIndex(
        stopCount,
        route.optimizedIntermediateWaypointIndex,
      );

  const outboundLegs = apiLegs.slice(0, stopCount);
  const totalMeters = outboundLegs.reduce(
    (sum, leg) => sum + (leg.distanceMeters ?? 0),
    0,
  );
  const totalKm = Number((totalMeters / 1000).toFixed(2));

  const legs = optimizedWaypointIndex.map((stopIndex, visitIndex) => {
    const stop = stops[stopIndex];
    const legDistanceKm = (outboundLegs[visitIndex]?.distanceMeters ?? 0) / 1000;

    return {
      orderId: stop.id,
      routeSequence: visitIndex + 1,
      payoutAmount: Number((legDistanceKm * payoutPerKm).toFixed(2)),
    };
  });

  const expectedPayout = Number(
    legs.reduce((s, l) => s + l.payoutAmount, 0).toFixed(2),
  );

  return {
    totalKm,
    expectedPayout,
    legs,
    optimizedWaypointIndex,
  };
}

function orderStopsOpenLoop(
  kitchenLat: number,
  kitchenLng: number,
  stops: RouteStop[],
  googleRoute: GoogleRoute,
): RouteStop[] {
  if (stops.length <= 1) return [...stops];

  const farthestIndex = findFarthestStopIndex(kitchenLat, kitchenLng, stops);
  const farthest = stops[farthestIndex];
  const intermediateStops = stops.filter((_, i) => i !== farthestIndex);

  const intermediateCount = intermediateStops.length;
  const googleOrder = buildOptimizedIndex(
    intermediateCount,
    googleRoute.optimizedIntermediateWaypointIndex,
  );

  const orderedStops: RouteStop[] = [
    ...googleOrder.map((j) => intermediateStops[j]),
    farthest,
  ];

  return orderedStops;
}

export async function computeOpenLoopRoute(
  kitchenLat: number,
  kitchenLng: number,
  stops: RouteStop[],
  apiKey: string,
  payoutPerKm: number,
  departureTime?: string,
): Promise<OptimizedRouteResult | null> {
  if (stops.length === 0) return null;

  const fetchOptions: FetchGoogleRoutesOptions = {
    departureTime,
    routeShape: "open_loop",
    optimizeWaypointOrder: stops.length > 1,
  };

  if (stops.length >= 2) {
    const farthestIndex = findFarthestStopIndex(kitchenLat, kitchenLng, stops);
    fetchOptions.farthestStop = stops[farthestIndex];
    fetchOptions.intermediateStops = stops.filter((_, i) => i !== farthestIndex);
  }

  const route = await fetchGoogleRoutes(
    kitchenLat,
    kitchenLng,
    stops,
    apiKey,
    BASE_FIELD_MASK,
    fetchOptions,
  );

  if (!route) return null;

  const orderedStops =
    stops.length <= 1
      ? [...stops]
      : orderStopsOpenLoop(kitchenLat, kitchenLng, stops, route);

  return buildRouteFromGoogleResponse(route, orderedStops, payoutPerKm, {
    assumeStopsInVisitOrder: true,
  });
}

export async function computeOptimizedDeliveryRoute(
  riderOrders: RoutableOrder[],
  kitchenLat: number,
  kitchenLng: number,
  payoutPerKm: number,
  apiKey: string,
  departureTime?: string,
): Promise<OptimizedRouteResult | null> {
  return computeOpenLoopRoute(
    kitchenLat,
    kitchenLng,
    riderOrders,
    apiKey,
    payoutPerKm,
    departureTime,
  );
}

export async function computeOptimizedRouteDetails(
  kitchenLat: number,
  kitchenLng: number,
  stops: Array<{ id: string; lat: number; lng: number }>,
  apiKey: string,
  payoutPerKm = 0,
  departureTime?: string,
): Promise<OptimizedRouteDetails | null> {
  if (stops.length === 0) return null;

  const fetchOptions: FetchGoogleRoutesOptions = {
    departureTime,
    routeShape: "open_loop",
    optimizeWaypointOrder: stops.length > 1,
  };

  if (stops.length >= 2) {
    const farthestIndex = findFarthestStopIndex(kitchenLat, kitchenLng, stops);
    fetchOptions.farthestStop = stops[farthestIndex];
    fetchOptions.intermediateStops = stops.filter((_, i) => i !== farthestIndex);
  }

  const route = await fetchGoogleRoutes(
    kitchenLat,
    kitchenLng,
    stops,
    apiKey,
    DETAILS_FIELD_MASK,
    fetchOptions,
  );

  if (!route) return null;

  const orderedStops =
    stops.length <= 1
      ? [...stops]
      : orderStopsOpenLoop(kitchenLat, kitchenLng, stops, route);

  const baseResult = buildRouteFromGoogleResponse(
    route,
    orderedStops,
    payoutPerKm,
    { assumeStopsInVisitOrder: true },
  );
  if (!baseResult) return null;

  const apiLegs = route.legs ?? [];
  const stopCount = orderedStops.length;
  const outboundLegs = apiLegs.slice(0, stopCount);

  const legDetails: RouteLegDetail[] = outboundLegs.map((leg) => ({
    distanceMeters: leg.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(leg.duration),
    endLocation: toLatLng(leg.endLocation?.latLng),
  }));

  const encodedPolyline = route.polyline?.encodedPolyline;
  if (!encodedPolyline) {
    console.error("Google Routes API returned no route polyline.");
    return null;
  }

  return {
    ...baseResult,
    encodedPolyline,
    originLocation: toLatLng(apiLegs[0]?.startLocation?.latLng),
    legDetails,
  };
}

export async function computeFixedOrderRoutePreview(
  kitchenLat: number,
  kitchenLng: number,
  stops: Array<{ id: string; lat: number; lng: number }>,
  apiKey: string,
  departureTime?: string,
): Promise<FixedOrderRoutePreview | null> {
  const route = await fetchGoogleRoutes(
    kitchenLat,
    kitchenLng,
    stops,
    apiKey,
    DETAILS_FIELD_MASK,
    {
      departureTime,
      optimizeWaypointOrder: false,
      routeShape: "fixed_order_open",
    },
  );

  if (!route) return null;

  const encodedPolyline = route.polyline?.encodedPolyline;
  if (!encodedPolyline) {
    console.error("Google Routes API returned no route polyline.");
    return null;
  }

  const apiLegs = route.legs ?? [];
  const totalDistanceMeters = apiLegs.reduce(
    (sum, leg) => sum + (leg.distanceMeters ?? 0),
    0,
  );
  const totalDurationSeconds = apiLegs.reduce(
    (sum, leg) => sum + parseDurationSeconds(leg.duration),
    0,
  );

  return {
    encodedPolyline,
    totalDistanceMeters,
    totalDurationSeconds,
  };
}
