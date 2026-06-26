import { revalidatePath } from "next/cache";
import {
  computeOpenLoopHaversineRoute,
  type RoutableOrder,
} from "@/lib/distance";
import {
  buildISTDepartureISO,
  DEFAULT_RIDER_DEPARTURE_TIME_IST,
  isFutureISO8601,
} from "@/lib/dates/ist";
import { resolveAddressCoordinates } from "@/lib/geocoding";
import { notifyRoutingAssignmentComplete } from "@/lib/delivery/deliveryStatusNotifications";
import { computeOpenLoopRoute } from "@/lib/routing/googleRoutes";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";

// Service-role client only: this engine runs from cron/background jobs and must bypass RLS.
const supabaseAdmin = createAdminClient();

const RE_ROUTABLE_STATUSES = ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED"];
const MAX_STOPS_PER_RIDER = 20;

type CommittedRoute = {
  totalKm: number;
  expectedPayout: number;
  legs: { orderId: string; routeSequence: number; payoutAmount: number }[];
};

type CoordinateAuditEntry = {
  orderId: string;
  addressId: string | null;
  pincode: string | null;
  lat: number;
  lng: number;
  usedPincodeFallback: boolean;
  riderId: string;
};

type RoutingFallbackEntry = {
  riderId: string;
  orderCount: number;
};

type SpilloverEntry = {
  orderId: string;
  riderId: string;
  reason: "rider_capacity_exceeded";
};

type RiderDispatchContext = {
  targetDate: string;
  franchiseId: string | null;
  kitchenLat: number;
  kitchenLng: number;
  payoutPerKm: number;
  apiKey: string;
  departureTime?: string;
};

type RiderDispatchResult = {
  riderId: string;
  batchesCreated: number;
  ordersAssigned: number;
  fallbacks: RoutingFallbackEntry[];
  spillover: SpilloverEntry[];
  error?: string;
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

async function commitRiderBatch(
  riderId: string,
  targetDate: string,
  route: CommittedRoute,
  franchiseId: string | null,
) {
  const { data: newBatch, error: batchError } = await supabaseAdmin
    .from("delivery_batches")
    .insert({
      assigned_rider_id: riderId,
      delivery_date: targetDate,
      total_distance_km: route.totalKm,
      expected_payout: route.expectedPayout,
      status: "PENDING",
      // Stamp the batch with the scope's franchise_id so franchise portals
      // and reporting can filter batches. Core scope stays NULL (unchanged).
      franchise_id: franchiseId,
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

async function processRiderDispatch(
  riderId: string,
  riderOrders: RoutableOrder[],
  coordinateAudit: CoordinateAuditEntry[],
  ctx: RiderDispatchContext,
): Promise<RiderDispatchResult> {
  if (riderOrders.length === 0) {
    return {
      riderId,
      batchesCreated: 0,
      ordersAssigned: 0,
      fallbacks: [],
      spillover: [],
    };
  }

  const pincodeFallbackCount = coordinateAudit.filter(
    (entry) => entry.riderId === riderId && entry.usedPincodeFallback,
  ).length;

  if (pincodeFallbackCount > 0) {
    console.warn(
      `[routing] rider ${riderId}: ${pincodeFallbackCount}/${riderOrders.length} stops use pincode centroid coordinates`,
    );
  }

  const assignedOrders = riderOrders.slice(0, MAX_STOPS_PER_RIDER);
  const spilloverOrders = riderOrders.slice(MAX_STOPS_PER_RIDER);
  const spillover: SpilloverEntry[] = spilloverOrders.map((order) => ({
    orderId: order.id,
    riderId,
    reason: "rider_capacity_exceeded",
  }));

  if (spillover.length > 0) {
    console.warn(
      `[routing] rider ${riderId}: ${spillover.length} orders exceed capacity; manual assignment required`,
    );

    for (const entry of spillover) {
      await supabaseAdmin.from("delivery_status_logs").insert({
        delivery_order_id: entry.orderId,
        status: "ORDER_CREATED",
        note: `Skipped during dispatch: rider capacity exceeded (max ${MAX_STOPS_PER_RIDER})`,
      });
    }
  }

  const googleRoute = await computeOpenLoopRoute(
    ctx.kitchenLat,
    ctx.kitchenLng,
    assignedOrders,
    ctx.apiKey,
    ctx.payoutPerKm,
    ctx.departureTime,
  );

  let route: CommittedRoute;
  const fallbacks: RoutingFallbackEntry[] = [];

  if (googleRoute) {
    route = googleRoute;
  } else {
    route = computeOpenLoopHaversineRoute(
      assignedOrders,
      ctx.kitchenLat,
      ctx.kitchenLng,
      ctx.payoutPerKm,
    );
    fallbacks.push({
      riderId,
      orderCount: assignedOrders.length,
    });
  }

  const assignedCount = await commitRiderBatch(
    riderId,
    ctx.targetDate,
    route,
    ctx.franchiseId,
  );

  return {
    riderId,
    batchesCreated: assignedCount > 0 ? 1 : 0,
    ordersAssigned: assignedCount,
    fallbacks,
    spillover,
  };
}

async function processRiderDispatchSafe(
  riderId: string,
  riderOrders: RoutableOrder[],
  coordinateAudit: CoordinateAuditEntry[],
  ctx: RiderDispatchContext,
): Promise<RiderDispatchResult> {
  try {
    return await processRiderDispatch(
      riderId,
      riderOrders,
      coordinateAudit,
      ctx,
    );
  } catch (err) {
    console.error(`Routing Engine Error for rider ${riderId}:`, err);
    return {
      riderId,
      batchesCreated: 0,
      ordersAssigned: 0,
      fallbacks: [],
      spillover: [],
      error: err instanceof Error ? err.message : "Unknown routing error",
    };
  }
}

type DispatchScope = {
  franchiseId: string | null;
  label: string;
  kitchenLat: number;
  kitchenLng: number;
  // When false, NO franchise_id filter is applied to orders/service areas.
  // This preserves the exact legacy core behavior when the feature flag is off.
  scopedByFranchise: boolean;
};

type SharedDispatchConfig = {
  targetDate: string;
  payoutPerKm: number;
  apiKey: string;
  departureTime?: string;
  customerOverrideMap: Map<string, string>;
};

type ScopeStats = {
  scope: string;
  franchiseId: string | null;
  totalOrders: number;
  batchesCreated: number;
  ordersAssigned: number;
  spillover: SpilloverEntry[];
  riderErrors: { riderId: string; error: string }[];
  routingFallbacks: RoutingFallbackEntry[];
  coordinateAudit: CoordinateAuditEntry[];
  skippedOrderIds: string[];
  geocodedFromPincode: number;
  overrideAssigned: number;
  skippedBadCoords: number;
  skippedNoRider: number;
};

/**
 * Routes and batches the orders belonging to a single scope (core or one
 * franchise). Each scope is fully self-contained: it only reads orders and
 * rider service areas matching its franchise_id, uses its own kitchen as the
 * route origin, and stamps every batch it creates with its franchise_id.
 *
 * The internal routing/grouping/commit logic is identical to the original core
 * engine — only the data inputs (orders, service areas, kitchen, stamp) differ.
 */
async function dispatchScope(
  scope: DispatchScope,
  shared: SharedDispatchConfig,
): Promise<ScopeStats> {
  const empty: ScopeStats = {
    scope: scope.label,
    franchiseId: scope.franchiseId,
    totalOrders: 0,
    batchesCreated: 0,
    ordersAssigned: 0,
    spillover: [],
    riderErrors: [],
    routingFallbacks: [],
    coordinateAudit: [],
    skippedOrderIds: [],
    geocodedFromPincode: 0,
    overrideAssigned: 0,
    skippedBadCoords: 0,
    skippedNoRider: 0,
  };

  // --- Orders for this scope -------------------------------------------------
  let ordersQuery = supabaseAdmin
    .from("delivery_orders")
    .select(
      `id, customer_profile_id, delivery_address_id, addresses!delivery_address_id ( id, pincode, lat, lng, city, state )`,
    )
    .eq("delivery_date", shared.targetDate)
    .eq("status", "ORDER_CREATED")
    .is("batch_id", null);

  if (scope.scopedByFranchise) {
    ordersQuery = scope.franchiseId
      ? ordersQuery.eq("franchise_id", scope.franchiseId)
      : ordersQuery.is("franchise_id", null);
  }

  const { data: orders, error: ordersError } = await ordersQuery;

  if (ordersError || !orders || orders.length === 0) {
    return empty;
  }

  // --- Rider service areas for this scope ------------------------------------
  let serviceAreaQuery = supabaseAdmin
    .from("rider_service_areas")
    .select("pincode, rider_id");

  if (scope.scopedByFranchise) {
    serviceAreaQuery = scope.franchiseId
      ? serviceAreaQuery.eq("franchise_id", scope.franchiseId)
      : serviceAreaQuery.is("franchise_id", null);
  }

  const { data: serviceAreas } = await serviceAreaQuery;
  const pincodeToRiderMap = new Map(
    serviceAreas?.map((sa) => [sa.pincode, sa.rider_id]),
  );

  let overrideAssigned = 0;
  const riderGroups = new Map<string, RoutableOrder[]>();
  const pincodeCache = new Map<string, { lat: number; lng: number }>();
  let geocodedFromPincode = 0;
  let skippedBadCoords = 0;
  let skippedNoRider = 0;
  const skippedOrderIds: string[] = [];
  const coordinateAudit: CoordinateAuditEntry[] = [];

  for (const order of orders) {
    const address = Array.isArray(order.addresses)
      ? order.addresses[0]
      : order.addresses;

    const resolved = await resolveAddressCoordinates(
      address,
      shared.apiKey,
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

    const overrideRiderId = order.customer_profile_id
      ? shared.customerOverrideMap.get(order.customer_profile_id)
      : undefined;
    const riderId =
      overrideRiderId || pincodeToRiderMap.get(address?.pincode || "");
    if (!riderId) {
      skippedNoRider++;
      continue;
    }
    if (overrideRiderId) overrideAssigned++;

    const auditEntry: CoordinateAuditEntry = {
      orderId: order.id,
      addressId: address?.id ?? null,
      pincode: address?.pincode ?? null,
      lat: resolved.coords.lat,
      lng: resolved.coords.lng,
      usedPincodeFallback: resolved.usedPincodeFallback,
      riderId,
    };
    coordinateAudit.push(auditEntry);
    console.info(`[routing:${scope.label}] resolved order coordinates`, auditEntry);

    if (!riderGroups.has(riderId)) riderGroups.set(riderId, []);
    riderGroups.get(riderId)!.push({
      id: order.id,
      lat: resolved.coords.lat,
      lng: resolved.coords.lng,
    });
  }

  if (riderGroups.size === 0) {
    return {
      ...empty,
      totalOrders: orders.length,
      skippedOrderIds,
      coordinateAudit,
      geocodedFromPincode,
      skippedBadCoords,
      skippedNoRider,
    };
  }

  const dispatchCtx: RiderDispatchContext = {
    targetDate: shared.targetDate,
    franchiseId: scope.franchiseId,
    kitchenLat: scope.kitchenLat,
    kitchenLng: scope.kitchenLng,
    payoutPerKm: shared.payoutPerKm,
    apiKey: shared.apiKey,
    departureTime: shared.departureTime,
  };

  const riderResults = await Promise.all(
    Array.from(riderGroups.entries()).map(([riderId, riderOrders]) =>
      processRiderDispatchSafe(riderId, riderOrders, coordinateAudit, dispatchCtx),
    ),
  );

  let batchesCreated = 0;
  let ordersAssigned = 0;
  const routingFallbacks: RoutingFallbackEntry[] = [];
  const riderErrors: { riderId: string; error: string }[] = [];
  const spillover: SpilloverEntry[] = [];

  for (const result of riderResults) {
    batchesCreated += result.batchesCreated;
    ordersAssigned += result.ordersAssigned;
    routingFallbacks.push(...result.fallbacks);
    spillover.push(...result.spillover);
    if (result.error) {
      riderErrors.push({ riderId: result.riderId, error: result.error });
    }
  }

  return {
    scope: scope.label,
    franchiseId: scope.franchiseId,
    totalOrders: orders.length,
    batchesCreated,
    ordersAssigned,
    spillover,
    riderErrors,
    routingFallbacks,
    coordinateAudit,
    skippedOrderIds,
    geocodedFromPincode,
    overrideAssigned,
    skippedBadCoords,
    skippedNoRider,
  };
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
  const payoutPerKm = settings?.rider_payout_per_km || 16;

  const GOOGLE_API_KEY =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_API_KEY) {
    return {
      error: "Google Maps API Key is missing from environment variables.",
    };
  }

  const departureTimeIso = buildISTDepartureISO(targetDate);
  const departureTime = isFutureISO8601(departureTimeIso)
    ? departureTimeIso
    : undefined;

  if (!departureTime) {
    console.warn(
      `[routing] departure ${departureTimeIso} is in the past; using traffic-aware "now"`,
    );
  }

  // Permanent customer -> rider overrides. Built once and shared across all
  // scopes; each scope only processes its own orders, so an override only ever
  // applies to a customer whose order is in that scope.
  const { data: fixedAssignments } = await supabaseAdmin
    .from("fixed_rider_assignments")
    .select("customer_profile_id, rider_id, rider_profiles!inner ( is_active )");
  const customerOverrideMap = new Map<string, string>();
  for (const fa of fixedAssignments ?? []) {
    const rider = Array.isArray((fa as any).rider_profiles)
      ? (fa as any).rider_profiles[0]
      : (fa as any).rider_profiles;
    if (rider?.is_active && fa.customer_profile_id && fa.rider_id) {
      customerOverrideMap.set(fa.customer_profile_id, fa.rider_id);
    }
  }

  const shared: SharedDispatchConfig = {
    targetDate,
    payoutPerKm,
    apiKey: GOOGLE_API_KEY,
    departureTime,
    customerOverrideMap,
  };

  // ---------------------------------------------------------------------------
  // Build the list of scopes to route.
  //
  // FLAG OFF (production today): a SINGLE core scope with NO franchise filter —
  //   byte-for-byte the legacy behavior. Core is completely undisturbed.
  // FLAG ON: core scope isolated to franchise_id IS NULL + one scope per active
  //   franchise (its own kitchen, riders and orders). Batches are stamped with
  //   the franchise_id.
  // ---------------------------------------------------------------------------
  const scopes: DispatchScope[] = [];
  const skippedFranchises: { franchiseId: string; name: string; reason: string }[] = [];

  if (!FRANCHISE_FEATURES_ENABLED) {
    // Legacy core path — unchanged. Single active kitchen, no franchise filter.
    const { data: kitchen } = await supabaseAdmin
      .from("kitchens")
      .select("lat, lng")
      .eq("is_active", true)
      .single();

    if (!kitchen) return { error: "No active kitchen found in database." };

    scopes.push({
      franchiseId: null,
      label: "core",
      kitchenLat: Number(kitchen.lat),
      kitchenLng: Number(kitchen.lng),
      scopedByFranchise: false,
    });
  } else {
    // Franchise features ON: resolve franchises first so we can identify which
    // kitchens belong to franchises and exclude them from the core kitchen pick.
    const { data: franchises } = await supabaseAdmin
      .from("franchises")
      .select("id, name, kitchen_id, kitchens:kitchen_id ( id, lat, lng )")
      .eq("status", "active");

    const franchiseKitchenIds = (franchises ?? [])
      .map((f: any) => f.kitchen_id)
      .filter((id: string | null): id is string => Boolean(id));

    // Core kitchen = an active kitchen that is NOT a franchise kitchen.
    const { data: activeKitchens } = await supabaseAdmin
      .from("kitchens")
      .select("id, lat, lng")
      .eq("is_active", true);

    const coreKitchen =
      (activeKitchens ?? []).find(
        (k: any) => !franchiseKitchenIds.includes(k.id),
      ) ?? (activeKitchens ?? [])[0];

    if (!coreKitchen) return { error: "No active core kitchen found in database." };

    scopes.push({
      franchiseId: null,
      label: "core",
      kitchenLat: Number(coreKitchen.lat),
      kitchenLng: Number(coreKitchen.lng),
      scopedByFranchise: true,
    });

    for (const f of franchises ?? []) {
      const kitchen = Array.isArray((f as any).kitchens)
        ? (f as any).kitchens[0]
        : (f as any).kitchens;

      if (!kitchen?.lat || !kitchen?.lng) {
        skippedFranchises.push({
          franchiseId: f.id,
          name: f.name,
          reason: "No kitchen configured",
        });
        continue;
      }

      scopes.push({
        franchiseId: f.id,
        label: `franchise:${f.name}`,
        kitchenLat: Number(kitchen.lat),
        kitchenLng: Number(kitchen.lng),
        scopedByFranchise: true,
      });
    }
  }

  // Run each scope independently and sequentially. A failure or empty result in
  // one scope (e.g. a franchise with no riders) never affects the others.
  const scopeStats: ScopeStats[] = [];
  for (const scope of scopes) {
    scopeStats.push(await dispatchScope(scope, shared));
  }

  // Aggregate across all scopes.
  const totalOrders = scopeStats.reduce((s, x) => s + x.totalOrders, 0);
  const batchesCreated = scopeStats.reduce((s, x) => s + x.batchesCreated, 0);
  const ordersAssigned = scopeStats.reduce((s, x) => s + x.ordersAssigned, 0);
  const unassignedSpillover = scopeStats.flatMap((x) => x.spillover);
  const riderErrors = scopeStats.flatMap((x) => x.riderErrors);
  const routingFallbacks = scopeStats.flatMap((x) => x.routingFallbacks);
  const coordinateAudit = scopeStats.flatMap((x) => x.coordinateAudit);
  const skippedOrderIds = scopeStats.flatMap((x) => x.skippedOrderIds);
  const geocodedFromPincode = scopeStats.reduce(
    (s, x) => s + x.geocodedFromPincode,
    0,
  );
  const overrideAssigned = scopeStats.reduce((s, x) => s + x.overrideAssigned, 0);
  const skippedBadCoords = scopeStats.reduce((s, x) => s + x.skippedBadCoords, 0);
  const skippedNoRider = scopeStats.reduce((s, x) => s + x.skippedNoRider, 0);

  // No orders anywhere → friendly success (matches legacy behavior).
  if (totalOrders === 0) {
    const emptyRunStats = { totalOrders: 0, batchesCreated: 0 };
    await logRoutingRun(targetDate, emptyRunStats);
    return {
      success: true,
      message: `No pending orders found to route for ${targetDate}.`,
      stats: emptyRunStats,
    };
  }

  const usedFallback = routingFallbacks.length > 0;
  const trafficLabel = departureTime
    ? `${DEFAULT_RIDER_DEPARTURE_TIME_IST.slice(0, 5)} IST traffic`
    : "current traffic";
  const routingMethod = usedFallback
    ? `Google Routes (TWO_WHEELER, ${trafficLabel}) with Haversine fallback`
    : `Google Routes (TWO_WHEELER, ${trafficLabel})`;

  const resultStatsObject = {
    totalOrders,
    batchesCreated,
    ordersAssigned,
    unassignedSpillover,
    spilloverCount: unassignedSpillover.length,
    riderErrors,
    departureTime: departureTime ?? null,
    batchesRemoved: resetResult.batchesRemoved,
    ordersReset: resetResult.ordersReset,
    geocodedFromPincode,
    overrideAssigned,
    skippedBadCoords,
    skippedNoRider,
    skippedOrderIds,
    routingFallbacks,
    coordinateAudit,
    skippedFranchises,
    scopes: scopeStats.map((x) => ({
      scope: x.scope,
      franchiseId: x.franchiseId,
      totalOrders: x.totalOrders,
      batchesCreated: x.batchesCreated,
      ordersAssigned: x.ordersAssigned,
      skippedNoRider: x.skippedNoRider,
      skippedBadCoords: x.skippedBadCoords,
    })),
  };

  await logRoutingRun(targetDate, resultStatsObject);

  revalidatePath("/rider/route");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/riders");

  // Legacy core-only behavior: when the flag is OFF there is exactly one scope.
  // Preserve the original "no routable orders" hard error so existing callers
  // (cron 400 status, admin UI) behave identically.
  if (!FRANCHISE_FEATURES_ENABLED && ordersAssigned === 0) {
    return {
      error: `No routable orders for ${targetDate}. ${skippedBadCoords} missing coordinates/pincode, ${skippedNoRider} without assigned rider for their pincode.`,
    };
  }

  if (ordersAssigned > 0) {
    await notifyRoutingAssignmentComplete(targetDate);
  }

  const spilloverNote =
    unassignedSpillover.length > 0
      ? ` ${unassignedSpillover.length} order(s) need manual assignment (rider capacity).`
      : "";

  return {
    success: true,
    message: `Routed ${batchesCreated} batches via ${routingMethod} for ${targetDate}!${spilloverNote}`,
    stats: resultStatsObject,
  };
}
