"use server";

import {
  buildISTDepartureISO,
  getISTDateString,
  isFutureISO8601,
} from "@/lib/dates/ist";
import { resolveAddressCoordinates } from "@/lib/geocoding";
import { computeFixedOrderRoutePreview } from "@/lib/routing/googleRoutes";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyOperationsScope, isFranchiseScope, type OperationsScope } from "@/lib/franchise/scope";

const ASSIGNED_ORDER_STATUSES = [
  "ASSIGNED",
  "PICKED",
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
  "DELIVERED",
  "FAILED",
] as const;

export type RoutingSandboxMeta = {
  targetDate: string;
  lastRunAt: string | null;
  batchesCreated: number;
  ordersAssigned: number;
  spilloverCount: number;
};

export type RoutingSandboxRiderOption = {
  id: string;
  fullName: string;
  stopCount: number;
  batchCount: number;
};

export type RoutingSandboxStop = {
  sequence: number;
  orderId: string;
  customerName: string;
  pincode: string;
  lat?: number;
  lng?: number;
};

export type RoutingSandboxBatchOption = {
  id: string;
  label: string;
  stopCount: number;
  totalDistanceKm: number;
  expectedPayout: number;
};

export type RoutingSandboxRiderRoute = {
  kitchen: { lat: number; lng: number };
  batch: {
    id: string;
    totalDistanceKm: number;
    expectedPayout: number;
  };
  rider: { id: string; fullName: string };
  batches: RoutingSandboxBatchOption[];
  stops: RoutingSandboxStop[];
  routePreview: {
    encodedPolyline: string;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
  } | null;
};

function readStatsNumber(stats: Record<string, unknown> | null, key: string) {
  const value = stats?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Resolves the route-origin kitchen for a rider.
 *
 * A franchise rider draws from its franchise kitchen; a core rider draws from
 * the core kitchen (the active kitchen not owned by any franchise). This avoids
 * the previous `.maybeSingle()` on `is_active=true`, which errored — and
 * returned a null route, hiding the map — whenever more than one kitchen was
 * active (e.g. core + a franchise kitchen).
 */
async function resolveSandboxKitchen(
  supabase: ReturnType<typeof createAdminClient>,
  riderFranchiseId: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (riderFranchiseId) {
    const { data: franchise } = await supabase
      .from("franchises")
      .select("kitchen_id, kitchens:kitchen_id ( lat, lng )")
      .eq("id", riderFranchiseId)
      .maybeSingle();

    const kitchen = Array.isArray((franchise as any)?.kitchens)
      ? (franchise as any).kitchens[0]
      : (franchise as any)?.kitchens;

    if (kitchen?.lat != null && kitchen?.lng != null) {
      return { lat: Number(kitchen.lat), lng: Number(kitchen.lng) };
    }
  }

  // Core kitchen = an active kitchen that is not owned by any franchise.
  const { data: franchiseRows } = await supabase
    .from("franchises")
    .select("kitchen_id");
  const franchiseKitchenIds = (franchiseRows ?? [])
    .map((f: any) => f.kitchen_id)
    .filter(Boolean);

  const { data: activeKitchens } = await supabase
    .from("kitchens")
    .select("id, lat, lng")
    .eq("is_active", true);

  const core =
    (activeKitchens ?? []).find(
      (k: any) => !franchiseKitchenIds.includes(k.id),
    ) ?? (activeKitchens ?? [])[0];

  if (core?.lat != null && core?.lng != null) {
    return { lat: Number(core.lat), lng: Number(core.lng) };
  }

  return null;
}

export async function getRoutingSandboxMeta(
  scope?: OperationsScope,
): Promise<RoutingSandboxMeta> {
  const supabase = createAdminClient();
  const fallbackDate = getISTDateString(0);

  const { data: logs, error } = await supabase
    .from("automation_logs")
    .select("target_date, last_run_at, latest_stats")
    .eq("automation_type", "ROUTING")
    .order("last_run_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[getRoutingSandboxMeta]", error);
    return {
      targetDate: fallbackDate,
      lastRunAt: null,
      batchesCreated: 0,
      ordersAssigned: 0,
      spilloverCount: 0,
    };
  }

  const successfulLog = (logs ?? []).find((log) => {
    const stats = log.latest_stats as Record<string, unknown> | null;
    const batchesCreated = readStatsNumber(stats, "batchesCreated");
    const ordersAssigned = readStatsNumber(stats, "ordersAssigned");
    return batchesCreated > 0 || ordersAssigned > 0;
  });

  // The automation log holds GLOBAL run info (one row per date). We keep its
  // date + timestamp for display, but derive the Batches/Assigned counts
  // directly from the DB scoped to the selected view so "Core Business" shows
  // only core numbers and a franchise shows only its own.
  const targetDate = successfulLog?.target_date || fallbackDate;
  const lastRunAt = successfulLog?.last_run_at ?? null;

  const batchesPromise = applyOperationsScope(
    supabase
      .from("delivery_batches")
      .select("id", { count: "exact", head: true })
      .eq("delivery_date", targetDate),
    scope,
  );

  const ordersPromise = applyOperationsScope(
    supabase
      .from("delivery_orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_date", targetDate)
      .not("assigned_rider_id", "is", null)
      .in("status", [...ASSIGNED_ORDER_STATUSES]),
    scope,
  );

  const [batchesRes, ordersRes] = await Promise.all([
    batchesPromise,
    ordersPromise,
  ]);

  // Spillover isn't a stored column, so it comes from the run log. When viewing
  // a single franchise we don't have a scoped figure, so report 0 there.
  const stats = successfulLog?.latest_stats as Record<string, unknown> | null;
  const spilloverCount = isFranchiseScope(scope)
    ? 0
    : readStatsNumber(stats, "spilloverCount");

  return {
    targetDate,
    lastRunAt,
    batchesCreated: batchesRes.count ?? 0,
    ordersAssigned: ordersRes.count ?? 0,
    spilloverCount,
  };
}

export async function getRoutingSandboxRiders(
  targetDate: string,
  scope?: OperationsScope,
): Promise<RoutingSandboxRiderOption[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("delivery_orders")
    .select(
      `
      assigned_rider_id,
      batch_id,
      rider_profiles (
        id,
        users ( full_name )
      )
    `,
    )
    .eq("delivery_date", targetDate)
    .not("assigned_rider_id", "is", null)
    .in("status", [...ASSIGNED_ORDER_STATUSES]);

  query = applyOperationsScope(query, scope);

  const { data: orders, error } = await query;

  if (error) {
    console.error("[getRoutingSandboxRiders]", error);
    return [];
  }

  const riderMap = new Map<string, RoutingSandboxRiderOption>();
  const batchIdsByRider = new Map<string, Set<string>>();

  for (const order of orders ?? []) {
    const riderId = order.assigned_rider_id as string;
    if (!riderId) continue;

    const riderProfile = Array.isArray(order.rider_profiles)
      ? order.rider_profiles[0]
      : order.rider_profiles;
    const users = riderProfile?.users;
    const user = Array.isArray(users) ? users[0] : users;
    const fullName = user?.full_name || "Unknown Rider";

    const existing = riderMap.get(riderId);
    if (!existing) {
      riderMap.set(riderId, {
        id: riderId,
        fullName,
        stopCount: 1,
        batchCount: 0,
      });
      batchIdsByRider.set(riderId, new Set());
    } else {
      existing.stopCount += 1;
    }

    if (order.batch_id) {
      batchIdsByRider.get(riderId)!.add(order.batch_id as string);
    }
  }

  for (const [riderId, rider] of riderMap.entries()) {
    rider.batchCount = batchIdsByRider.get(riderId)?.size ?? 0;
  }

  return Array.from(riderMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export async function getRoutingSandboxRiderRoute(
  riderId: string,
  targetDate: string,
  batchId?: string,
  scope?: OperationsScope,
): Promise<RoutingSandboxRiderRoute | null> {
  const supabase = createAdminClient();

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const [riderRes, batchesRes] = await Promise.all([
    supabase
      .from("rider_profiles")
      .select("id, franchise_id, users ( full_name )")
      .eq("id", riderId)
      .single(),
    supabase
      .from("delivery_batches")
      .select("id, total_distance_km, expected_payout, created_at")
      .eq("assigned_rider_id", riderId)
      .eq("delivery_date", targetDate)
      .order("created_at", { ascending: false }),
  ]);

  if (riderRes.error || !riderRes.data) {
    console.error("[getRoutingSandboxRiderRoute] rider", riderRes.error);
    return null;
  }

  // Origin kitchen follows the rider's franchise (core rider → core kitchen).
  const riderFranchiseId = (riderRes.data as { franchise_id?: string | null })
    .franchise_id ?? null;
  const kitchenCoords = await resolveSandboxKitchen(supabase, riderFranchiseId);

  if (!kitchenCoords) {
    console.error("[getRoutingSandboxRiderRoute] no kitchen resolved");
    return null;
  }

  const batches = batchesRes.data ?? [];
  if (batches.length === 0) return null;

  const batchOptions: RoutingSandboxBatchOption[] = await Promise.all(
    batches.map(async (batch) => {
      const { count } = await supabase
        .from("delivery_orders")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batch.id);

      return {
        id: batch.id,
        label: `Batch ${batch.id.slice(0, 6).toUpperCase()}`,
        stopCount: count ?? 0,
        totalDistanceKm: Number(batch.total_distance_km ?? 0),
        expectedPayout: Number(batch.expected_payout ?? 0),
      };
    }),
  );

  const selectedBatchId = batchId ?? batches[0].id;
  const selectedBatch =
    batches.find((batch) => batch.id === selectedBatchId) ?? batches[0];

  const { data: orders, error: ordersError } = await applyOperationsScope(
    supabase
      .from("delivery_orders")
      .select(
        `
      id,
      route_sequence,
      customer_profiles ( users ( full_name ) ),
      addresses!delivery_address_id ( lat, lng, pincode, city, state )
    `,
      )
      .eq("batch_id", selectedBatch.id),
    scope,
  ).order("route_sequence", { ascending: true, nullsFirst: false });

  if (ordersError) {
    console.error("[getRoutingSandboxRiderRoute] orders", ordersError);
    return null;
  }

  const pincodeCache = new Map<string, { lat: number; lng: number }>();
  const stops: RoutingSandboxStop[] = [];

  for (const order of orders ?? []) {
    const address = Array.isArray(order.addresses)
      ? order.addresses[0]
      : order.addresses;
    const cp = Array.isArray(order.customer_profiles)
      ? order.customer_profiles[0]
      : order.customer_profiles;
    const cpUsers = (cp as { users?: unknown })?.users;
    const cpUser = Array.isArray(cpUsers) ? cpUsers[0] : cpUsers;

    const sequence =
      typeof order.route_sequence === "number" ? order.route_sequence : stops.length + 1;

    let lat: number | undefined;
    let lng: number | undefined;

    if (apiKey && address) {
      const resolved = await resolveAddressCoordinates(
        address,
        apiKey,
        pincodeCache,
      );
      if (resolved) {
        lat = resolved.coords.lat;
        lng = resolved.coords.lng;
      }
    } else if (address?.lat != null && address?.lng != null) {
      lat = Number(address.lat);
      lng = Number(address.lng);
    }

    stops.push({
      sequence,
      orderId: order.id,
      customerName:
        (cpUser as { full_name?: string })?.full_name || "Unknown Customer",
      pincode: address?.pincode || "N/A",
      lat,
      lng,
    });
  }

  stops.sort((a, b) => a.sequence - b.sequence);

  const kitchenLat = kitchenCoords.lat;
  const kitchenLng = kitchenCoords.lng;

  const mappableStops = stops.filter(
    (stop) =>
      stop.lat != null &&
      stop.lng != null &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lng),
  );

  let routePreview: RoutingSandboxRiderRoute["routePreview"] = null;

  if (apiKey && mappableStops.length > 0) {
    const departureTimeIso = buildISTDepartureISO(targetDate);
    const departureTime = isFutureISO8601(departureTimeIso)
      ? departureTimeIso
      : undefined;

    routePreview = await computeFixedOrderRoutePreview(
      kitchenLat,
      kitchenLng,
      mappableStops.map((stop) => ({
        id: stop.orderId,
        lat: stop.lat!,
        lng: stop.lng!,
      })),
      apiKey,
      departureTime,
    );
  }

  const users = riderRes.data.users;
  const user = Array.isArray(users) ? users[0] : users;

  return {
    kitchen: { lat: kitchenLat, lng: kitchenLng },
    batch: {
      id: selectedBatch.id,
      totalDistanceKm: Number(selectedBatch.total_distance_km ?? 0),
      expectedPayout: Number(selectedBatch.expected_payout ?? 0),
    },
    rider: {
      id: riderId,
      fullName: user?.full_name || "Unknown Rider",
    },
    batches: batchOptions,
    stops,
    routePreview,
  };
}
