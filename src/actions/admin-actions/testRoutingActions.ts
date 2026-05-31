"use server";

export type LatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleDirectionsLeg = {
  start_address?: string;
  end_address?: string;
  start_location?: LatLngLiteral;
  end_location?: LatLngLiteral;
  distance?: {
    text?: string;
    value?: number;
  };
  duration?: {
    text?: string;
    value?: number;
  };
};

type GoogleDirectionsRoute = {
  summary?: string;
  bounds?: {
    northeast: LatLngLiteral;
    southwest: LatLngLiteral;
  };
  copyrights?: string;
  warnings?: string[];
  waypoint_order?: number[];
  overview_polyline?: {
    points?: string;
  };
  legs?: GoogleDirectionsLeg[];
};

type GoogleDirectionsResponse = {
  status: string;
  error_message?: string;
  geocoded_waypoints?: unknown[];
  routes?: GoogleDirectionsRoute[];
};

type IntermediateStop = {
  originalIndex: number;
  coordinates: LatLngLiteral;
};

export type TestRouteStop = {
  sequence: number;
  originalIndex: number;
  coordinates: LatLngLiteral;
  location: LatLngLiteral | null;
};

export type TestRouteSuccess = {
  ok: true;
  status: string;
  origin: LatLngLiteral;
  destinations: LatLngLiteral[];
  waypointOrder: number[];
  optimizedStops: TestRouteStop[];
  overviewPolyline: string;
  originLocation: LatLngLiteral | null;
  bounds: GoogleDirectionsRoute["bounds"] | null;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  legs: GoogleDirectionsLeg[];
  debug: {
    status: string;
    routing_mode: "open";
    waypoint_order: number[];
    google_waypoint_order: number[];
    full_waypoint_order: number[];
    farthest_destination_index: number;
    farthest_coordinates: LatLngLiteral;
    optimized_coordinates: LatLngLiteral[];
    legs: Array<{
      sequence: number;
      startAddress: string | null;
      endAddress: string | null;
      distanceText: string | null;
      distanceMeters: number | null;
      durationText: string | null;
      durationSeconds: number | null;
    }>;
    geocoded_waypoints?: unknown[];
  };
};

export type TestRouteFailure = {
  ok: false;
  status?: string;
  error: string;
};

export type TestRouteResult = TestRouteSuccess | TestRouteFailure;

const MAX_TEST_DESTINATIONS = 10;
const EARTH_RADIUS_KM = 6371;

function isValidCoordinate(point: LatLngLiteral) {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

function formatCoordinates(point: LatLngLiteral) {
  return `${point.lat},${point.lng}`;
}

function haversineDistanceKm(a: LatLngLiteral, b: LatLngLiteral) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLng = Math.sin(dLng / 2);
  const haversine =
    sinHalfDLat * sinHalfDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfDLng * sinHalfDLng;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function findFarthestDestinationIndex(
  origin: LatLngLiteral,
  destinations: LatLngLiteral[],
) {
  let farthestOriginalIndex = 0;
  let maxDistance = -1;

  destinations.forEach((destination, index) => {
    const distance = haversineDistanceKm(origin, destination);
    if (distance > maxDistance) {
      maxDistance = distance;
      farthestOriginalIndex = index;
    }
  });

  return farthestOriginalIndex;
}

function buildIntermediateStops(
  destinations: LatLngLiteral[],
  farthestOriginalIndex: number,
): IntermediateStop[] {
  return destinations
    .map((coordinates, originalIndex) => ({ originalIndex, coordinates }))
    .filter((stop) => stop.originalIndex !== farthestOriginalIndex);
}

function buildFullWaypointOrder(
  googleWaypointOrder: number[],
  intermediates: IntermediateStop[],
  farthestOriginalIndex: number,
) {
  const optimizedIntermediateOriginalIndices = googleWaypointOrder.map(
    (intermediateIndex) => intermediates[intermediateIndex].originalIndex,
  );

  return [...optimizedIntermediateOriginalIndices, farthestOriginalIndex];
}

export async function calculateTestRoute(
  origin: LatLngLiteral,
  destinations: LatLngLiteral[],
): Promise<TestRouteResult> {
  if (!isValidCoordinate(origin)) {
    return { ok: false, error: "Enter valid origin latitude and longitude." };
  }

  const cleanDestinations = destinations.filter(isValidCoordinate);

  if (cleanDestinations.length !== destinations.length) {
    return {
      ok: false,
      error: "Enter valid latitude and longitude for every delivery stop.",
    };
  }

  if (cleanDestinations.length === 0) {
    return { ok: false, error: "Enter at least one delivery coordinate pair." };
  }

  if (cleanDestinations.length > MAX_TEST_DESTINATIONS) {
    return {
      ok: false,
      error: `Use ${MAX_TEST_DESTINATIONS} or fewer delivery coordinate pairs in the sandbox.`,
    };
  }

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: "Google Maps API key is not configured.",
    };
  }

  const farthestOriginalIndex = findFarthestDestinationIndex(
    origin,
    cleanDestinations,
  );
  const farthestCoordinates = cleanDestinations[farthestOriginalIndex];
  const intermediates = buildIntermediateStops(
    cleanDestinations,
    farthestOriginalIndex,
  );

  const params = new URLSearchParams({
    origin: formatCoordinates(origin),
    destination: formatCoordinates(farthestCoordinates),
    mode: "driving",
    key: apiKey,
  });

  if (intermediates.length > 0) {
    params.set(
      "waypoints",
      `optimize:true|${intermediates
        .map((stop) => formatCoordinates(stop.coordinates))
        .join("|")}`,
    );
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    return {
      ok: false,
      error: `Directions API request failed with HTTP ${response.status}.`,
    };
  }

  const directions = (await response.json()) as GoogleDirectionsResponse;

  if (directions.status !== "OK") {
    return {
      ok: false,
      status: directions.status,
      error:
        directions.error_message ||
        `Directions API returned status ${directions.status}.`,
    };
  }

  const route = directions.routes?.[0];
  const overviewPolyline = route?.overview_polyline?.points;

  if (!route || !overviewPolyline) {
    return {
      ok: false,
      status: directions.status,
      error: "Directions API returned no drawable route geometry.",
    };
  }

  const googleWaypointOrder =
    intermediates.length === 0
      ? []
      : route.waypoint_order && route.waypoint_order.length > 0
        ? route.waypoint_order
        : intermediates.map((_, index) => index);

  const fullWaypointOrder =
    intermediates.length === 0
      ? [farthestOriginalIndex]
      : buildFullWaypointOrder(
          googleWaypointOrder,
          intermediates,
          farthestOriginalIndex,
        );

  const legs = route.legs || [];
  const optimizedStops = fullWaypointOrder.map((originalIndex, sequenceIndex) => ({
    sequence: sequenceIndex + 1,
    originalIndex,
    coordinates: cleanDestinations[originalIndex],
    location: legs[sequenceIndex]?.end_location || null,
  }));

  const totalDistanceMeters = legs.reduce(
    (sum, leg) => sum + (leg.distance?.value || 0),
    0,
  );
  const totalDurationSeconds = legs.reduce(
    (sum, leg) => sum + (leg.duration?.value || 0),
    0,
  );

  return {
    ok: true,
    status: directions.status,
    origin,
    destinations: cleanDestinations,
    waypointOrder: fullWaypointOrder,
    optimizedStops,
    overviewPolyline,
    originLocation: legs[0]?.start_location || null,
    bounds: route.bounds || null,
    totalDistanceMeters,
    totalDurationSeconds,
    legs,
    debug: {
      status: directions.status,
      routing_mode: "open",
      waypoint_order: fullWaypointOrder,
      google_waypoint_order: googleWaypointOrder,
      full_waypoint_order: fullWaypointOrder,
      farthest_destination_index: farthestOriginalIndex,
      farthest_coordinates: farthestCoordinates,
      optimized_coordinates: fullWaypointOrder.map(
        (originalIndex) => cleanDestinations[originalIndex],
      ),
      legs: legs.map((leg, index) => ({
        sequence: index + 1,
        startAddress: leg.start_address || null,
        endAddress: leg.end_address || null,
        distanceText: leg.distance?.text || null,
        distanceMeters: leg.distance?.value || null,
        durationText: leg.duration?.text || null,
        durationSeconds: leg.duration?.value || null,
      })),
      geocoded_waypoints: directions.geocoded_waypoints,
    },
  };
}
