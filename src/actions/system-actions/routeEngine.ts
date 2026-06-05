import { revalidatePath } from "next/cache";
import {
  calculateHaversineDistanceKm,
  computeHaversineRoute,
  type RoutableOrder,
} from "@/lib/distance";
import { resolveAddressCoordinates } from "@/lib/geocoding";
import { notifyRoutingAssignmentComplete } from "@/lib/delivery/deliveryStatusNotifications";
import { createAdminClient } from "@/lib/supabase/admin";

// Service-role client only: this engine runs from cron/background jobs and must bypass RLS.
const supabaseAdmin = createAdminClient();

const RE_ROUTABLE_STATUSES = ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED"];

type GoogleDirectionsRoute = {
  totalKm: number;
  expectedPayout: number;
  legs: { orderId: string; routeSequence: number; payoutAmount: number }[];
};

async function logRoutingRun(
  targetDate: string,
  latestStats: Record<string, unknown>,
) {
  try {
    const { data: existingLog, error: existingLogError } = await supabaseAdmin
      .from("automation_logs")
      .select("run_count")
      .eq("automation_type", "ROUTING")
      .eq("target_date", targetDate)
      .maybeSingle();

    if (existingLogError) {
      console.error("Error fetching routing automation log:", existingLogError);
      return;
    }

    const newCount = (existingLog?.run_count || 0) + 1;
    const { error: upsertError } = await supabaseAdmin
      .from("automation_logs")
      .upsert(
        {
          automation_type: "ROUTING",
          target_date: targetDate,
          run_count: newCount,
          last_run_at: new Date().toISOString(),
          latest_stats: latestStats,
        },
        { onConflict: "automation_type,target_date" },
      );

    if (upsertError) {
      console.error("Error upserting routing automation log:", upsertError);
    }
  } catch (error) {
    console.error("Unexpected error logging routing automation run:", error);
  }
}

async function resetPendingRoutingForDate(targetDate: string) {
  const { data: resetOrders, error: resetError } = await supabaseAdmin
    .from("delivery_orders")
    .update({
      batch_id: null,
      assigned_rider_id: null,
      route_sequence: null,
      payout_amount: 0,
      status: "ORDER_CREATED",
    })
    .eq("delivery_date", targetDate)
    .in("status", RE_ROUTABLE_STATUSES)
    .select("id");

  if (resetError) {
    return { error: resetError.message, ordersReset: 0, batchesRemoved: 0 };
  }

  const { data: activeBatchRefs } = await supabaseAdmin
    .from("delivery_orders")
    .select("batch_id")
    .eq("delivery_date", targetDate)
    .not("batch_id", "is", null);

  const activeBatchIds = new Set(
    activeBatchRefs?.map((order) => order.batch_id).filter(Boolean) ?? [],
  );

  const { data: pendingBatches } = await supabaseAdmin
    .from("delivery_batches")
    .select("id")
    .eq("delivery_date", targetDate)
    .eq("status", "PENDING");

  const batchIdsToDelete = (pendingBatches ?? [])
    .map((batch) => batch.id)
    .filter((id) => !activeBatchIds.has(id));

  if (batchIdsToDelete.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from("delivery_batches")
      .delete()
      .in("id", batchIdsToDelete);

    if (deleteError) {
      return { error: deleteError.message, ordersReset: 0, batchesRemoved: 0 };
    }
  }

  return {
    ordersReset: resetOrders?.length ?? 0,
    batchesRemoved: batchIdsToDelete.length,
  };
}

async function fetchGoogleDirectionsRoute(
  riderOrders: RoutableOrder[],
  kitchenLat: number,
  kitchenLng: number,
  payoutPerKm: number,
  apiKey: string,
): Promise<GoogleDirectionsRoute | null> {
  // A. Open routing: pick the farthest delivery (Haversine from kitchen) as the final stop.
  let farthestOriginalIndex = 0;
  let maxDistanceKm = -1;

  for (let index = 0; index < riderOrders.length; index++) {
    const order = riderOrders[index];
    const distanceKm = calculateHaversineDistanceKm(
      kitchenLat,
      kitchenLng,
      order.lat,
      order.lng,
    );

    if (distanceKm > maxDistanceKm) {
      maxDistanceKm = distanceKm;
      farthestOriginalIndex = index;
    }
  }

  const destinationOrder = riderOrders[farthestOriginalIndex];

  // B. Split remaining orders into Google waypoints; track their original riderOrders indices.
  const intermediateOrders: RoutableOrder[] = [];
  const originalIndicesOfIntermediates: number[] = [];

  riderOrders.forEach((order, originalIndex) => {
    if (originalIndex === farthestOriginalIndex) return;

    intermediateOrders.push(order);
    originalIndicesOfIntermediates.push(originalIndex);
  });

  const kitchenCoords = `${kitchenLat},${kitchenLng}`;
  const params = new URLSearchParams({
    origin: kitchenCoords,
    destination: `${destinationOrder.lat},${destinationOrder.lng}`,
    mode: "driving",
    key: apiKey,
  });

  if (intermediateOrders.length > 0) {
    params.set(
      "waypoints",
      `optimize:true|${intermediateOrders
        .map((order) => `${order.lat},${order.lng}`)
        .join("|")}`,
    );
  }

  const mapRes = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
  );
  const mapData = await mapRes.json();

  if (mapData.status !== "OK") {
    console.error("Google Maps API Error:", mapData);
    return null;
  }

  const route = mapData.routes[0];
  const totalMeters = route.legs.reduce(
    (sum: number, leg: { distance: { value: number } }) =>
      sum + leg.distance.value,
    0,
  );
  const totalKm = Number((totalMeters / 1000).toFixed(2));
  const expectedPayout = Math.round(totalKm * payoutPerKm);

  const legs = route.legs as { distance?: { value?: number } }[];

  const googleWaypointOrder: number[] =
    intermediateOrders.length === 0
      ? []
      : Array.isArray(route.waypoint_order) && route.waypoint_order.length > 0
        ? (route.waypoint_order as number[])
        : intermediateOrders.map((_, index) => index);

  // D. Google's waypoint_order indexes into intermediateOrders only — remap to riderOrders,
  // then append the farthest stop as the fixed final destination (no return to kitchen).
  const optimizedIntermediateOriginalIndices = googleWaypointOrder.map(
    (intermediateIndex) => originalIndicesOfIntermediates[intermediateIndex],
  );
  const finalOptimalIndices = [
    ...optimizedIntermediateOriginalIndices,
    farthestOriginalIndex,
  ];

  // E. Build payout legs in visit order using each Directions leg distance.
  const orderedLegs = finalOptimalIndices.map((originalIndex, legIndex) => {
    const order = riderOrders[originalIndex];
    const legDistanceKm = (legs[legIndex]?.distance?.value || 0) / 1000;

    return {
      orderId: order.id,
      routeSequence: legIndex + 1,
      payoutAmount: Number((legDistanceKm * payoutPerKm).toFixed(2)),
    };
  });

  return { totalKm, expectedPayout, legs: orderedLegs };
}

async function commitRiderBatch(
  riderId: string,
  targetDate: string,
  route: GoogleDirectionsRoute,
) {
  const { data: newBatch, error: batchError } = await supabaseAdmin
    .from("delivery_batches")
    .insert({
      assigned_rider_id: riderId,
      delivery_date: targetDate,
      total_distance_km: route.totalKm,
      expected_payout: route.expectedPayout,
      status: "PENDING",
    })
    .select("id")
    .single();

  if (!newBatch || batchError) return 0;

  for (const leg of route.legs) {
    await supabaseAdmin
      .from("delivery_orders")
      .update({
        batch_id: newBatch.id,
        assigned_rider_id: riderId,
        status: "ASSIGNED",
        route_sequence: leg.routeSequence,
        payout_amount: leg.payoutAmount,
      })
      .eq("id", leg.orderId);
  }

  return route.legs.length;
}

export async function executeAutomatedDispatch(targetDate: string) {
  const resetResult = await resetPendingRoutingForDate(targetDate);
  if (resetResult.error) {
    return { error: `Failed to reset existing routing: ${resetResult.error}` };
  }

  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("rider_payout_per_km")
    .eq("id", "global")
    .single();
  const { data: kitchen } = await supabaseAdmin
    .from("kitchens")
    .select("lat, lng")
    .eq("is_active", true)
    .single();

  if (!kitchen) return { error: "No active kitchen found in database." };

  const kitchenLat = Number(kitchen.lat);
  const kitchenLng = Number(kitchen.lng);
  const payoutPerKm = settings?.rider_payout_per_km || 16;
  const GOOGLE_API_KEY =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_API_KEY) {
    return {
      error: "Google Maps API Key is missing from environment variables.",
    };
  }

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("delivery_orders")
    .select(
      `id, delivery_address_id, addresses!delivery_address_id ( id, pincode, lat, lng, city, state )`,
    )
    .eq("delivery_date", targetDate)
    .eq("status", "ORDER_CREATED")
    .is("batch_id", null);

  if (ordersError || !orders) {
    return { error: `No pending orders found to route for ${targetDate}.` };
  }

  if (orders.length === 0) {
    const emptyRunStats = {
      totalOrders: 0,
      batchesCreated: 0,
    };

    await logRoutingRun(targetDate, emptyRunStats);

    return {
      success: true,
      message: `No pending orders found to route for ${targetDate}.`,
      stats: emptyRunStats,
    };
  }

  const { data: serviceAreas } = await supabaseAdmin
    .from("rider_service_areas")
    .select("pincode, rider_id");
  const pincodeToRiderMap = new Map(
    serviceAreas?.map((sa) => [sa.pincode, sa.rider_id]),
  );

  const riderGroups = new Map<string, RoutableOrder[]>();
  const pincodeCache = new Map<string, { lat: number; lng: number }>();
  let geocodedFromPincode = 0;
  let skippedBadCoords = 0;
  let skippedNoRider = 0;
  let ordersAssigned = 0;
  const skippedOrderIds: string[] = [];
  const routingFallbacks: { riderId: string; orderCount: number }[] = [];

  for (const order of orders) {
    const address = Array.isArray(order.addresses)
      ? order.addresses[0]
      : order.addresses;

    const resolved = await resolveAddressCoordinates(
      address,
      GOOGLE_API_KEY,
      pincodeCache,
    );
    if (!resolved) {
      skippedBadCoords++;
      skippedOrderIds.push(order.id);
      await supabaseAdmin.from("delivery_status_logs").insert({
        delivery_order_id: order.id,
        status: "ORDER_CREATED",
        note: "Skipped during dispatch: coordinates could not be resolved",
      });
      continue;
    }

    if (resolved.usedPincodeFallback) {
      geocodedFromPincode++;
      if (address?.id) {
        await supabaseAdmin
          .from("addresses")
          .update({
            lat: resolved.coords.lat,
            lng: resolved.coords.lng,
          })
          .eq("id", address.id);
      }
    }

    const riderId = pincodeToRiderMap.get(address?.pincode || "");
    if (!riderId) {
      skippedNoRider++;
      continue;
    }

    if (!riderGroups.has(riderId)) riderGroups.set(riderId, []);
    riderGroups.get(riderId)!.push({
      id: order.id,
      lat: resolved.coords.lat,
      lng: resolved.coords.lng,
    });
  }

  if (riderGroups.size === 0) {
    await logRoutingRun(targetDate, {
      totalOrders: orders.length,
      batchesCreated: 0,
      ordersAssigned,
      batchesRemoved: resetResult.batchesRemoved,
      ordersReset: resetResult.ordersReset,
      geocodedFromPincode,
      skippedBadCoords,
      skippedNoRider,
      skippedOrderIds,
      routingFallbacks,
    });

    return {
      error: `No routable orders for ${targetDate}. ${skippedBadCoords} missing coordinates/pincode, ${skippedNoRider} without assigned rider for their pincode.`,
    };
  }

  let batchesCreated = 0;

  for (const [riderId, riderOrders] of Array.from(riderGroups.entries())) {
    if (riderOrders.length === 0) continue;

    try {
      let route = await fetchGoogleDirectionsRoute(
        riderOrders,
        kitchenLat,
        kitchenLng,
        payoutPerKm,
        GOOGLE_API_KEY,
      );

      if (!route) {
        route = computeHaversineRoute(
          riderOrders,
          kitchenLat,
          kitchenLng,
          payoutPerKm,
        );
        routingFallbacks.push({
          riderId,
          orderCount: riderOrders.length,
        });
      }

      const assignedCount = await commitRiderBatch(riderId, targetDate, route);
      if (assignedCount > 0) {
        batchesCreated++;
        ordersAssigned += assignedCount;
      }
    } catch (err) {
      console.error("Routing Engine Error:", err);
    }
  }

  revalidatePath("/rider/route");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/riders");

  const usedFallback = routingFallbacks.length > 0;
  const routingMethod = usedFallback
    ? "Google Maps with Haversine fallback"
    : "Google Maps";
  const resultStatsObject = {
    totalOrders: orders.length,
    batchesCreated,
    ordersAssigned,
    batchesRemoved: resetResult.batchesRemoved,
    ordersReset: resetResult.ordersReset,
    geocodedFromPincode,
    skippedBadCoords,
    skippedNoRider,
    skippedOrderIds,
    routingFallbacks,
  };

  await logRoutingRun(targetDate, resultStatsObject);

  if (ordersAssigned > 0) {
    await notifyRoutingAssignmentComplete(targetDate);
  }

  return {
    success: true,
    message: `Routed ${batchesCreated} batches via ${routingMethod} for ${targetDate}!`,
    stats: resultStatsObject,
  };
}
