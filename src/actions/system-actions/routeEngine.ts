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
import { resolveBatchClinicStamp } from "@/lib/clinic/order-stamp";

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
  // Route origin coordinate. In the core path this is the CLINIC's
  // latitude/longitude (never the kitchen) per Req 2.4 / 10.1.
  originLat: number;
  originLng: number;
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
  clinicId: string | null,
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
      // Stamp the batch with the rider's linked clinic resolved at routing time
      // via resolveBatchClinicStamp (Req 19.3). Set exactly once at batch
      // creation and never updated afterwards; null when the rider has no linked
      // clinic (Req 19.9), which never blocks routing.
      clinic_id: clinicId,
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
  batchClinicId: string | null,
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
    ctx.originLat,
    ctx.originLng,
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
      ctx.originLat,
      ctx.originLng,
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
    batchClinicId,
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
  batchClinicId: string | null,
): Promise<RiderDispatchResult> {
  try {
    return await processRiderDispatch(
      riderId,
      riderOrders,
      coordinateAudit,
      ctx,
      batchClinicId,
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
  // Clinic that owns this routing scope and supplies the route origin. In the
  // per-clinic core path (flag off) this is always a real Core Clinic id and
  // is stamped onto every batch the scope creates (Req 19.3). It is null only
  // for the inert franchise scopes (flag on), which are scoped by franchise_id
  // instead (Req 18.3).
  clinicId: string | null;
  franchiseId: string | null;
  label: string;
  // Route origin coordinate. In the core path this is the CLINIC's stored
  // latitude/longitude (Req 2.4, 10.1) — never the kitchen. The inert franchise
  // path still populates it from the franchise kitchen so it compiles.
  originLat: number;
  originLng: number;
  // Scoping mode:
  //   true  -> filter orders/service areas by franchise_id (inert franchise
  //            path, retained for Req 18.3). NO clinic filter is applied.
  //   false -> per-clinic core path: filter orders/service areas by clinicId.
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
  clinicId: string | null;
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
 * Routes and batches the orders belonging to a single scope. In the core path
 * (FRANCHISE_FEATURES_ENABLED off) each scope is one Core Clinic: it only reads
 * orders and rider service areas matching that clinic_id, uses the clinic's
 * coordinates as the route origin (Req 10.1), and stamps every batch it creates
 * with the scope clinic id (Req 19.3). The inert franchise path scopes by
 * franchise_id instead and is retained unchanged (Req 18.3).
 *
 * The internal routing/grouping/commit logic is identical to the original core
 * engine — only the data inputs (orders, service areas, origin, stamp) differ.
 */
async function dispatchScope(
  scope: DispatchScope,
  shared: SharedDispatchConfig,
): Promise<ScopeStats> {
  const empty: ScopeStats = {
    scope: scope.label,
    clinicId: scope.clinicId,
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
    // Inert franchise path (Req 18.3): scope by franchise_id only.
    ordersQuery = scope.franchiseId
      ? ordersQuery.eq("franchise_id", scope.franchiseId)
      : ordersQuery.is("franchise_id", null);
  } else if (scope.clinicId) {
    // Per-clinic core path (Req 10.2, 19.5): scope by the order's creation-time
    // clinic stamp. Orders whose stamp is null (unresolved address) belong to
    // no clinic scope and are not routed — their pincode would not map to any
    // clinic's rider under legacy single-kitchen routing either, so the routed
    // result is equivalent (Req 18.6).
    ordersQuery = ordersQuery.eq("clinic_id", scope.clinicId);
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
    // Inert franchise path (Req 18.3): scope by franchise_id only.
    serviceAreaQuery = scope.franchiseId
      ? serviceAreaQuery.eq("franchise_id", scope.franchiseId)
      : serviceAreaQuery.is("franchise_id", null);
  } else if (scope.clinicId) {
    // Per-clinic core path: only the pincodes (and thus riders) belonging to
    // this clinic participate, yielding one batch per active clinic rider.
    serviceAreaQuery = serviceAreaQuery.eq("clinic_id", scope.clinicId);
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
    originLat: scope.originLat,
    originLng: scope.originLng,
    payoutPerKm: shared.payoutPerKm,
    apiKey: shared.apiKey,
    departureTime: shared.departureTime,
  };

  // Resolve each grouped rider's linked clinic so the batch stamp is the
  // RIDER's linked clinic at routing time (Req 19.3) rather than the scope
  // clinic. In the per-clinic core path the rider's linked clinic normally
  // equals the scope clinic, but reading rider_profiles.clinic_id makes the
  // stamp authoritative and correctly yields null for a rider with no linked
  // clinic (Req 19.9) without ever blocking routing. The inert franchise path
  // (scopedByFranchise) keeps its scope clinic (always null when the flag is
  // off) so its behavior is unchanged.
  const riderClinicMap = new Map<string, string | null>();
  if (!scope.scopedByFranchise) {
    const riderIds = Array.from(riderGroups.keys());
    if (riderIds.length > 0) {
      const { data: riderProfiles } = await supabaseAdmin
        .from("rider_profiles")
        .select("id, clinic_id")
        .in("id", riderIds);
      for (const rider of riderProfiles ?? []) {
        riderClinicMap.set(rider.id, rider.clinic_id ?? null);
      }
    }
  }

  const riderResults = await Promise.all(
    Array.from(riderGroups.entries()).map(([riderId, riderOrders]) => {
      const riderLinkedClinicId = scope.scopedByFranchise
        ? scope.clinicId
        : riderClinicMap.get(riderId) ?? null;
      // Stamp = the rider's linked clinic at routing time; null-rider -> null,
      // never blocking routing (Req 19.3, 19.9). The grouped orders keep their
      // own creation-time delivery_orders.clinic_id and are never re-stamped.
      const batchClinicId = resolveBatchClinicStamp(riderLinkedClinicId);
      return processRiderDispatchSafe(
        riderId,
        riderOrders,
        coordinateAudit,
        dispatchCtx,
        batchClinicId,
      );
    }),
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
    clinicId: scope.clinicId,
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
  // FLAG OFF (production today): one scope PER CORE CLINIC (clinics where
  //   franchise_id IS NULL), each using the CLINIC's own latitude/longitude as
  //   the route origin — never the kitchen (Req 2.4, 10.1). Clinics with a
  //   missing/out-of-range coordinate are skipped and recorded (Req 10.7).
  //   After the Madhapur seed there is exactly one Core Clinic whose coordinates
  //   were copied from the kitchen, so a single clinic scope reproduces the
  //   legacy single-kitchen result given the same inputs (Req 18.6).
  // FLAG ON: core scope isolated to franchise_id IS NULL + one scope per active
  //   franchise (its own kitchen, riders and orders). Retained but inert when
  //   the flag is off (Req 18.3).
  // ---------------------------------------------------------------------------
  const scopes: DispatchScope[] = [];
  const skippedFranchises: { franchiseId: string; name: string; reason: string }[] = [];
  const skippedClinics: { clinicId: string; name: string; reason: string }[] = [];

  if (!FRANCHISE_FEATURES_ENABLED) {
    // Core path: enumerate every Core Clinic (franchise_id IS NULL) as an
    // independent routing scope using the clinic coordinate as origin.
    //
    // Equivalence guard (Req 10.8, 18.3, 18.6): with the flag off — including
    // when the env var is unset (Req 18.4) — this branch performs NO franchise
    // table read and applies NO franchise filter. It selects only Core Clinics
    // (`franchise_id IS NULL`); the `franchises` table is queried solely in the
    // retained-but-inert flag-on branch below. Given the same inputs this
    // reproduces the pre-franchise routed result.
    const { data: coreClinics, error: clinicsError } = await supabaseAdmin
      .from("clinics")
      .select("id, name, latitude, longitude")
      .is("franchise_id", null);

    if (clinicsError) {
      return { error: `Failed to load core clinics: ${clinicsError.message}` };
    }

    for (const clinic of coreClinics ?? []) {
      const lat = Number(clinic.latitude);
      const lng = Number(clinic.longitude);

      // Skip clinics with missing/out-of-range coordinates without aborting the
      // rest of the run, recording an error indication identifying the clinic
      // (Req 10.7).
      const hasValidCoords =
        clinic.latitude !== null &&
        clinic.longitude !== null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;

      if (!hasValidCoords) {
        skippedClinics.push({
          clinicId: clinic.id,
          name: clinic.name,
          reason: "Missing or out-of-range clinic coordinates",
        });
        continue;
      }

      scopes.push({
        clinicId: clinic.id,
        franchiseId: null,
        label: `clinic:${clinic.name}`,
        originLat: lat,
        originLng: lng,
        scopedByFranchise: false,
      });
    }
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
      clinicId: null,
      franchiseId: null,
      label: "core",
      originLat: Number(coreKitchen.lat),
      originLng: Number(coreKitchen.lng),
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
        clinicId: null,
        franchiseId: f.id,
        label: `franchise:${f.name}`,
        originLat: Number(kitchen.lat),
        originLng: Number(kitchen.lng),
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
    skippedClinics,
    scopes: scopeStats.map((x) => ({
      scope: x.scope,
      clinicId: x.clinicId,
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
