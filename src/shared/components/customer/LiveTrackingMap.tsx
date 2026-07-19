"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  DirectionsRenderer,
} from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { MapPin } from "lucide-react";

const containerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "400px",
};

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ],
};

type RiderCoords = { lat: number; lng: number };

// Polling fallback interval. The realtime websocket is the primary channel,
// but it can silently drop in production (proxies/CDN, idle timeouts, auth
// token refresh). Polling guarantees the marker + route keep moving even when
// the socket is dead, without waiting for a manual page refresh.
const LOCATION_POLL_MS = 8_000;

// Re-fetch the route polyline once the rider has moved at least this far from
// the origin used for the last Directions request. Keeps the green line
// following the rider instead of freezing on the first position.
const ROUTE_REFETCH_MIN_MOVE_M = 60;

// Never re-request Directions more often than this (cost / rate-limit guard).
const ROUTE_REFETCH_MIN_INTERVAL_MS = 12_000;

// How long the bike takes to glide from its old position to a freshly received
// one. Kept comfortably shorter than the poll interval so the marker settles
// before the next update arrives, giving a smooth "riding" feel.
const MARKER_ANIM_DURATION_MS = 1_400;

// Movements below this (GPS jitter while stationary) snap instantly — no point
// animating a 1-2m wobble. Movements above the max are treated as a teleport
// (first fix, big GPS correction) and snap rather than slide across the map.
const MARKER_SNAP_MIN_M = 2;
const MARKER_SNAP_MAX_M = 3_000;

// easeInOutQuad — gentle acceleration then deceleration.
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Initial-bearing (forward azimuth) from `a` to `b`, in degrees clockwise from
// north [0,360). Used to rotate the direction pointer so the bike "faces" the
// way it's travelling along the route.
function bearingDegrees(a: RiderCoords, b: RiderCoords): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Circular SVG badge (upright, non-rotating) so the marker always reads as the
// delivery scooter. Direction is conveyed by the separate rotating beam behind
// it. Uses the Material "two-wheeler" glyph for a crisp, recognizable scooter.
const BIKE_BADGE_PX = 46;
const BIKE_BADGE_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
    <defs>
      <filter id="bikeShadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#0f172a" flood-opacity="0.35"/>
      </filter>
    </defs>
    <circle cx="23" cy="23" r="16" fill="#ffffff" stroke="#059669" stroke-width="3" filter="url(#bikeShadow)"/>
    <g transform="translate(11,11)" fill="#059669">
      <path d="M19.44 9.03 15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.76-2.24-4.97-4.56-4.97zM7.82 15C7.4 16.15 6.28 17 5 17c-1.63 0-3-1.37-3-3s1.37-3 3-3c1.28 0 2.4.85 2.82 2H5v2h2.82zM19 17c-1.63 0-3-1.37-3-3s1.37-3 3-3 3 1.37 3 3-1.37 3-3 3z"/>
    </g>
  </svg>`,
);

// Haversine distance in meters between two coordinates.
function distanceMeters(a: RiderCoords, b: RiderCoords): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function LiveTrackingMap({
  riderId,
  orderStatus,
  customerLat,
  customerLng,
  onEtaChange,
  onDistanceChange,
  onLocationUpdate,
}: {
  riderId: string | null;
  orderStatus: string;
  customerLat?: number;
  customerLng?: number;
  onEtaChange?: (etaText: string | null) => void;
  /** Distance-to-arrival text (e.g. "1.4 km"), derived from the SAME
   *  Directions response already fetched for the ETA — no extra API call. */
  onDistanceChange?: (distanceText: string | null) => void;
  /** Fired every time a fresh rider coordinate lands (initial fetch or
   *  realtime update) — purely a UI freshness signal ("Updated Xs ago"),
   *  does not alter the underlying subscription/polling behavior at all. */
  onLocationUpdate?: () => void;
}) {
  // Stable Supabase client — created once and reused across renders.
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const mapRef = useRef<google.maps.Map | null>(null);
  // `riderLocation` is the raw TARGET coordinate from realtime/polling.
  // `displayPosition` is the ANIMATED coordinate actually rendered for the
  // marker — it eases from the previous position to the target so the bike
  // glides instead of teleporting on each update.
  const [riderLocation, setRiderLocation] = useState<RiderCoords | null>(null);
  const [displayPosition, setDisplayPosition] = useState<RiderCoords | null>(
    null,
  );
  // Mirror of displayPosition kept in a ref so the animation effect can read
  // the current on-screen position as its start point WITHOUT depending on it
  // (which would restart the tween every frame).
  const displayPosRef = useRef<RiderCoords | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Direction the bike is travelling (degrees clockwise from north). Held in a
  // ref too so jitter-sized moves can keep the last heading instead of spinning.
  const [heading, setHeading] = useState<number>(0);
  const headingRef = useRef<number>(0);
  const [directionsResponse, setDirectionsResponse] =
    useState<google.maps.DirectionsResult | null>(null);

  // Origin (rider coords) used for the last Directions request, plus the
  // timestamp of that request. Used to decide when the route is stale enough
  // to warrant a re-fetch as the rider moves.
  const lastDirectionsOriginRef = useRef<RiderCoords | null>(null);
  const lastDirectionsAtRef = useRef<number>(0);
  const directionsInFlightRef = useRef(false);

  const initialCenter = useMemo(
    () =>
      customerLat && customerLng
        ? { lat: customerLat, lng: customerLng }
        : { lat: 17.385, lng: 78.4867 },
    [customerLat, customerLng],
  );

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  const canTrack =
    orderStatus === "OUT_FOR_DELIVERY" ||
    orderStatus === "REACHING_TO_LOCATION";

  // ─────────────────────────────────────────────────────────────────────────
  // DIRECTIONS: Fetch the route polyline (rider → customer) and KEEP IT FRESH.
  // Fires on the first valid riderLocation, then re-fetches whenever the rider
  // has moved far enough (ROUTE_REFETCH_MIN_MOVE_M) since the last request,
  // rate-limited by ROUTE_REFETCH_MIN_INTERVAL_MS. This makes the green route
  // line follow the rider live instead of freezing on the first position.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !canTrack) return;
    if (customerLat == null || customerLng == null) return;
    if (!riderLocation) return;
    if (directionsInFlightRef.current) return;

    const originCoords = {
      lat: Number(riderLocation.lat),
      lng: Number(riderLocation.lng),
    };
    const destCoords = {
      lat: Number(customerLat),
      lng: Number(customerLng),
    };

    if (
      Number.isNaN(originCoords.lat) ||
      Number.isNaN(originCoords.lng) ||
      Number.isNaN(destCoords.lat) ||
      Number.isNaN(destCoords.lng)
    ) {
      console.warn("[LiveTrackingMap] Directions aborted: NaN coordinates", {
        originCoords,
        destCoords,
      });
      onEtaChange?.(null);
      return;
    }

    // Decide whether this rider position warrants a fresh route request.
    const prevOrigin = lastDirectionsOriginRef.current;
    const now = Date.now();
    if (prevOrigin) {
      const moved = distanceMeters(prevOrigin, originCoords);
      const elapsed = now - lastDirectionsAtRef.current;
      if (moved < ROUTE_REFETCH_MIN_MOVE_M) return;
      if (elapsed < ROUTE_REFETCH_MIN_INTERVAL_MS) return;
    }

    let cancelled = false;
    directionsInFlightRef.current = true;
    lastDirectionsOriginRef.current = originCoords;
    lastDirectionsAtRef.current = now;

    const fetchDirections = async () => {
      try {
        const service = new window.google.maps.DirectionsService();
        const response = await service.route({
          origin: originCoords,
          destination: destCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
        });

        if (cancelled) return;
        setDirectionsResponse(response);

        const leg = response.routes?.[0]?.legs?.[0];
        onEtaChange?.(leg?.duration?.text ?? null);
        onDistanceChange?.(leg?.distance?.text ?? null);
      } catch (err) {
        console.error("[LiveTrackingMap] Directions request failed", err);
        if (cancelled) return;
        // Keep the previous route on transient failures rather than blanking
        // the map; only clear ETA/distance so stale numbers aren't shown.
        onEtaChange?.(null);
        onDistanceChange?.(null);
      } finally {
        directionsInFlightRef.current = false;
      }
    };

    fetchDirections();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are
    // stable UI setters; re-adding them would not change behavior.
  }, [isLoaded, canTrack, customerLat, customerLng, riderLocation]);

  // ─────────────────────────────────────────────────────────────────────────
  // REALTIME: Subscribe to rider GPS updates.
  // Updates ONLY the marker position — never triggers Directions.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!riderId) return;

    let cancelled = false;

    // Apply a coordinate only when it actually changed, so we don't churn
    // state (and re-run the directions effect) on identical repeated reads.
    const applyLocation = (lat: unknown, lng: unknown) => {
      if (cancelled) return;
      const nextLat = Number(lat);
      const nextLng = Number(lng);
      if (Number.isNaN(nextLat) || Number.isNaN(nextLng)) return;

      setRiderLocation((prev) => {
        if (prev && prev.lat === nextLat && prev.lng === nextLng) {
          return prev;
        }
        return { lat: nextLat, lng: nextLng };
      });
      onLocationUpdate?.();
    };

    // Shared fetch used for both the initial load and the polling fallback.
    const fetchLocation = async () => {
      try {
        const { data, error } = await supabase
          .from("rider_live_locations")
          .select("lat, lng")
          .eq("rider_id", riderId)
          .maybeSingle();

        if (error) throw error;
        if (data && data.lat && data.lng) {
          applyLocation(data.lat, data.lng);
        }
      } catch (err) {
        console.error("[LiveTrackingMap] Location fetch error:", err);
      }
    };

    // 1. Initial fetch
    fetchLocation();

    // 2. Realtime subscription (primary channel)
    const channel = supabase
      .channel(`public:rider_live_locations:rider_id=eq.${riderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rider_live_locations",
          filter: `rider_id=eq.${riderId}`,
        },
        (payload) => {
          const newData = payload.new as Record<string, unknown> | undefined;
          if (newData && newData.lat && newData.lng) {
            applyLocation(newData.lat, newData.lng);
          }
        },
      )
      .subscribe();

    // 3. Polling fallback. Realtime websockets can silently drop in production
    // (proxies/CDN, idle timeouts, auth token refresh). Polling guarantees the
    // marker + route keep updating without a manual refresh. applyLocation
    // dedupes identical reads, so this is cheap when realtime is healthy.
    const pollId = setInterval(fetchLocation, LOCATION_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLocationUpdate
    // is a UI-only freshness callback; including it would resubscribe the
    // realtime channel + polling on every parent re-render.
  }, [riderId, supabase]);

  // ─────────────────────────────────────────────────────────────────────────
  // ANIMATE: Ease the bike marker from its current on-screen position to the
  // newly received target, and glide the map center along with it — instead of
  // snapping. This runs a requestAnimationFrame tween on every new target.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!riderLocation) return;

    const target = riderLocation;
    const from = displayPosRef.current;

    // Cancel any in-flight tween so a fresh update always wins.
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const commit = (pos: RiderCoords) => {
      displayPosRef.current = pos;
      setDisplayPosition(pos);
      mapRef.current?.setCenter(pos);
    };

    // First fix, negligible jitter, or teleport-sized jump → snap instantly.
    if (!from) {
      commit(target);
      return;
    }
    const dist = distanceMeters(from, target);

    // Update the facing direction only on a real move — a stationary rider's
    // GPS jitter would otherwise spin the pointer randomly.
    if (dist >= MARKER_SNAP_MIN_M) {
      const nextHeading = bearingDegrees(from, target);
      headingRef.current = nextHeading;
      setHeading(nextHeading);
    }

    if (dist < MARKER_SNAP_MIN_M || dist > MARKER_SNAP_MAX_M) {
      commit(target);
      return;
    }

    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / MARKER_ANIM_DURATION_MS);
      const eased = easeInOutQuad(t);
      const pos = {
        lat: from.lat + (target.lat - from.lat) * eased,
        lng: from.lng + (target.lng - from.lng) * eased,
      };
      commit(pos);
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // keyed on the target only; displayPosRef supplies the start point so the
    // tween is not restarted on its own per-frame state updates.
  }, [riderLocation]);

  // ─────────────────────────────────────────────────────────────────────────
  // MAP LOAD CALLBACK
  // ─────────────────────────────────────────────────────────────────────────
  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Upright scooter badge — memoized so the per-frame animation re-renders
  // don't rebuild the icon object (which would flicker the marker).
  const bikeBadgeIcon = useMemo<google.maps.Icon | undefined>(() => {
    if (!isLoaded) return undefined;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${BIKE_BADGE_SVG}`,
      scaledSize: new window.google.maps.Size(BIKE_BADGE_PX, BIKE_BADGE_PX),
      anchor: new window.google.maps.Point(BIKE_BADGE_PX / 2, BIKE_BADGE_PX / 2),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- static asset,
    // only depends on the Maps SDK being ready.
  }, [isLoaded]);

  // Rotating direction "beam" — a soft translucent cone (Google-Maps driving
  // style) emanating from behind the badge, pointing along the travel heading.
  // Drawn pointing "up" (north) with its tip at the badge center, then rotated
  // clockwise by the heading. Rebuilt only when the heading changes.
  const headingBeamIcon = useMemo<google.maps.Symbol | undefined>(() => {
    if (!isLoaded) return undefined;
    return {
      // Tip at center (0,0), fanning out and up with a gently rounded far edge.
      path: "M 0 0 L -13 -30 Q 0 -37 13 -30 Z",
      fillColor: "#059669",
      fillOpacity: 0.35,
      strokeColor: "#059669",
      strokeOpacity: 0.15,
      strokeWeight: 1,
      rotation: heading,
      scale: 1,
      anchor: new window.google.maps.Point(0, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rotation is the
    // only dynamic field; anchor/colors are constant.
  }, [isLoaded, heading]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full min-h-[400px] animate-pulse items-center justify-center bg-slate-100 text-sm font-semibold text-slate-400">
        Loading map…
      </div>
    );
  }

  if (!canTrack) {
    return (
      <div className="flex h-full w-full min-h-[400px] flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 p-8 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
          <MapPin className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="font-semibold text-slate-700">Map unavailable yet</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
          We&apos;ll start live tracking once your rider begins today&apos;s
          delivery.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={initialCenter}
        zoom={15}
        options={MAP_OPTIONS}
        onLoad={handleMapLoad}
      >
        {/* Route polyline — rendered once, never re-fetched */}
        {directionsResponse && (
          <DirectionsRenderer
            directions={directionsResponse}
            options={{
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: "#059669",
                strokeOpacity: 0.9,
                strokeWeight: 5,
              },
            }}
          />
        )}

        {/* Rider marker — renders the animated (eased) position so the bike
            glides smoothly toward each new coordinate instead of jumping.
            Two stacked markers: a rotating direction beam (heading) beneath
            an upright scooter badge, mimicking live delivery apps. */}
        {displayPosition && headingBeamIcon && (
          <Marker
            position={displayPosition}
            icon={headingBeamIcon}
            zIndex={10}
            clickable={false}
          />
        )}
        {displayPosition && bikeBadgeIcon && (
          <Marker
            position={displayPosition}
            title="Rider"
            icon={bikeBadgeIcon}
            zIndex={11}
          />
        )}

        {/* Destination marker */}
        {customerLat && customerLng && (
          <Marker
            position={{ lat: customerLat, lng: customerLng }}
            title="Delivery location"
            label={{ text: "🏠", fontSize: "22px" }}
            icon={{
              url: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E",
              scaledSize: new window.google.maps.Size(1, 1),
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}
