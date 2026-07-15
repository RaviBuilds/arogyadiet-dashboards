"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/logger";
import { notifyRoutingAssignmentComplete } from "@/lib/delivery/deliveryStatusNotifications";
import { buildISTDepartureISO, isFutureISO8601 } from "@/lib/dates/ist";
import { computeOpenLoopHaversineRoute } from "@/lib/distance";
import { computeOpenLoopRoute } from "@/lib/routing/googleRoutes";
import { applyOperationsScope, isFranchiseScope, type OperationsScope } from "@/lib/franchise/scope";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { resolveRatesForClinic } from "@/services/RateConfigService";

/**
 * Per-rider routing context. Origin is the rider's linked CLINIC coordinate
 * (never the kitchen) and the payout rate is resolved from `rate_configs`
 * (franchise → core → default) — matching the daily auto-router so manual
 * re-routes and automated routing always agree.
 */
type RiderRouteContext = {
  originLat: number;
  originLng: number;
  ratePerKm: number;
  clinicId: string | null;
};

/**
 * Resolves each rider's clinic origin + payout rate. Falls back to the given
 * origin/rate only when a rider has no linked clinic or the clinic is missing
 * coordinates (routing must never hard-fail on a missing clinic geo).
 */
async function resolveRiderRouteContexts(
  supabaseAdmin: SupabaseClient,
  riderIds: string[],
  fallback: { lat: number; lng: number; ratePerKm: number },
): Promise<Map<string, RiderRouteContext>> {
  const ctxByRider = new Map<string, RiderRouteContext>();
  if (riderIds.length === 0) return ctxByRider;

  const { data: riderRows } = await supabaseAdmin
    .from("rider_profiles")
    .select("id, clinic_id")
    .in("id", riderIds);

  const clinicIds = [
    ...new Set(
      (riderRows || []).map((r) => r.clinic_id).filter(Boolean) as string[],
    ),
  ];

  const clinicById = new Map<
    string,
    { id: string; franchise_id: string | null; latitude: number | null; longitude: number | null }
  >();
  if (clinicIds.length > 0) {
    const { data: clinics } = await supabaseAdmin
      .from("clinics")
      .select("id, franchise_id, latitude, longitude")
      .in("id", clinicIds);
    for (const c of clinics || []) clinicById.set(c.id, c as any);
  }

  // Resolve the payout rate once per clinic (rate_configs: franchise → core).
  const rateByClinic = new Map<string, number>();
  for (const clinicId of clinicIds) {
    const clinic = clinicById.get(clinicId);
    if (!clinic) continue;
    try {
      const rates = await resolveRatesForClinic(supabaseAdmin, {
        id: clinic.id,
        franchise_id: clinic.franchise_id,
      });
      rateByClinic.set(clinicId, rates.riderPayoutRatePerKm);
    } catch (e) {
      console.warn(`[routing] rate resolve failed for clinic ${clinicId}`, e);
    }
  }

  for (const r of riderRows || []) {
    const clinic = r.clinic_id ? clinicById.get(r.clinic_id) : null;
    const lat = clinic?.latitude != null ? Number(clinic.latitude) : NaN;
    const lng = clinic?.longitude != null ? Number(clinic.longitude) : NaN;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const rate =
      (r.clinic_id ? rateByClinic.get(r.clinic_id) : undefined) ??
      fallback.ratePerKm;

    if (!hasCoords) {
      console.warn(
        `[routing] rider ${r.id}: clinic ${r.clinic_id ?? "none"} missing coordinates; falling back to kitchen origin`,
      );
    }

    ctxByRider.set(r.id, {
      originLat: hasCoords ? lat : fallback.lat,
      originLng: hasCoords ? lng : fallback.lng,
      ratePerKm: rate,
      clinicId: r.clinic_id ?? null,
    });
  }

  for (const id of riderIds) {
    if (!ctxByRider.has(id)) {
      ctxByRider.set(id, {
        originLat: fallback.lat,
        originLng: fallback.lng,
        ratePerKm: fallback.ratePerKm,
        clinicId: null,
      });
    }
  }

  return ctxByRider;
}

function getISTDateString(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function getRoutingData(scope?: OperationsScope) {
  const supabase = await createClient();

  const today = getISTDateString();
  const tomorrow = getISTDateString(1);

  let ordersQuery = supabase
    .from("delivery_orders")
    .select(`
      id, status, assigned_rider_id, delivery_date, customer_profile_id, franchise_id,
      customer_profiles ( users ( full_name ) ),
      addresses!delivery_address_id ( pincode, lat, lng ),
      meal_categories ( name )
    `)
    .in("delivery_date", [today, tomorrow])
    .in("status", ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED", "PICKED"]);

  ordersQuery = applyOperationsScope(ordersQuery, scope);

  const { data: ordersData, error: ordersError } = await ordersQuery;

  if (ordersError) console.error("Error fetching routing orders:", ordersError);

  // Map of customer_profile_id -> pinned rider_id (permanent overrides).
  const { data: fixedAssignments } = await supabase
    .from("fixed_rider_assignments")
    .select("customer_profile_id, rider_id");
  const overrideMap = new Map(
    (fixedAssignments || []).map((fa: any) => [fa.customer_profile_id, fa.rider_id]),
  );

  const orders = (ordersData || []).map((o: any) => {
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;
    const pinnedRiderId = o.customer_profile_id
      ? overrideMap.get(o.customer_profile_id) ?? null
      : null;
    return {
      id: o.id,
      customerName: o.customer_profiles?.users?.full_name || "Unknown",
      pincode: addr?.pincode || "N/A",
      mealType: o.meal_categories?.name || "N/A",
      status: o.status,
      deliveryDate: o.delivery_date,
      assigned_rider_id: o.assigned_rider_id || "",
      isPinned: Boolean(pinnedRiderId),
      pinnedRiderId,
    };
  });

  let ridersQuery = supabase
    .from("rider_profiles")
    .select(`
      id, employee_code, clinic_id,
      users!inner ( full_name ),
      rider_service_areas ( pincode )
    `)
    .eq("is_active", true);

  ridersQuery = applyOperationsScope(ridersQuery, scope);

  const { data: ridersData, error: ridersError } = await ridersQuery;

  if (ridersError) console.error("Error fetching routing riders:", ridersError);

  // Per-rider, per-date pickup status. A rider/date is frozen (already out for
  // delivery) and must not receive re-routes. Detected from two independent
  // signals since batch status can lag order status:
  //   1. The batch for that date has left PENDING.
  //   2. ANY order for that rider/date is already dispatched.
  const pickedUpDatesByRider = new Map<string, Set<string>>();
  const markPickedUp = (riderId: string | null, date: string | null) => {
    if (!riderId || !date) return;
    if (!pickedUpDatesByRider.has(riderId)) {
      pickedUpDatesByRider.set(riderId, new Set());
    }
    pickedUpDatesByRider.get(riderId)!.add(date);
  };

  let batchesQuery = supabase
    .from("delivery_batches")
    .select("assigned_rider_id, delivery_date, status")
    .in("delivery_date", [today, tomorrow]);
  batchesQuery = applyOperationsScope(batchesQuery, scope);
  const { data: batchesData } = await batchesQuery;
  (batchesData || []).forEach((b: any) => {
    if (String(b.status).toUpperCase() !== "PENDING") {
      markPickedUp(b.assigned_rider_id, b.delivery_date);
    }
  });

  let dispatchedQuery = supabase
    .from("delivery_orders")
    .select("assigned_rider_id, delivery_date")
    .in("delivery_date", [today, tomorrow])
    .in("status", [
      "OUT_FOR_DELIVERY",
      "REACHING_TO_LOCATION",
      "DELIVERED",
      "FAILED",
      "PENDING_FAILURE_APPROVAL",
    ])
    .not("assigned_rider_id", "is", null);
  dispatchedQuery = applyOperationsScope(dispatchedQuery, scope);
  const { data: dispatchedData } = await dispatchedQuery;
  (dispatchedData || []).forEach((o: any) => {
    markPickedUp(o.assigned_rider_id, o.delivery_date);
  });

  const riders = (ridersData || []).map((r: any) => ({
    id: r.id,
    fullName: r.users?.full_name || "Unknown",
    employeeCode: r.employee_code || "N/A",
    // Rider's linked Clinic — drives clinic-selector-first gating (Req 17).
    clinic_id: r.clinic_id ?? null,
    assignedPincodes: r.rider_service_areas?.map((a: any) => a.pincode) || [],
    // Dates for which this rider has already picked up (frozen for re-routing).
    pickedUpDates: Array.from(pickedUpDatesByRider.get(r.id) || []),
  }));

  return { orders, riders };
}

async function commitRiderRouteForDate(
  supabaseAdmin: SupabaseClient,
  targetDate: string,
  riderId: string,
  orderIds: string[],
  allCurrentOrders: {
    id: string;
    assigned_rider_id: string | null;
    batch_id: string | null;
    addresses: { lat: number | null; lng: number | null } | { lat: number | null; lng: number | null }[] | null;
  }[],
  existingBatches: { id: string; assigned_rider_id: string }[] | null,
  originLat: number,
  originLng: number,
  ratePerKm: number,
  apiKey: string | undefined,
  departureTime: string | undefined,
  batchFranchiseId: string | null,
  clinicId: string | null,
) {
  let batchId = existingBatches?.find((b) => b.assigned_rider_id === riderId)?.id;

  const routableStops: { id: string; lat: number; lng: number }[] = [];

  for (const orderId of orderIds) {
    const orderData = allCurrentOrders.find((o) => o.id === orderId);
    const addr = Array.isArray(orderData?.addresses)
      ? orderData.addresses[0]
      : orderData?.addresses;

    const lat = addr?.lat != null ? Number(addr.lat) : NaN;
    const lng = addr?.lng != null ? Number(addr.lng) : NaN;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      routableStops.push({ id: orderId, lat, lng });
    } else {
      console.warn(
        `[routing] order ${orderId}: missing coordinates; excluded from open-loop optimization`,
      );
    }
  }

  let totalBatchDistance = 0;
  let totalBatchPayout = 0;
  const orderUpdates: {
    id: string;
    route_sequence: number;
    payout_amount: number;
  }[] = [];

  if (routableStops.length > 0) {
    let route =
      apiKey != null
        ? await computeOpenLoopRoute(
            originLat,
            originLng,
            routableStops,
            apiKey,
            ratePerKm,
            departureTime,
          )
        : null;

    if (!route) {
      route = computeOpenLoopHaversineRoute(
        routableStops,
        originLat,
        originLng,
        ratePerKm,
      );
    }

    totalBatchDistance = route.totalKm;
    totalBatchPayout = route.expectedPayout;

    for (const leg of route.legs) {
      orderUpdates.push({
        id: leg.orderId,
        route_sequence: leg.routeSequence,
        payout_amount: leg.payoutAmount,
      });
    }
  }

  const optimizedIds = new Set(orderUpdates.map((u) => u.id));
  let nextSequence = orderUpdates.length + 1;
  for (const orderId of orderIds) {
    if (!optimizedIds.has(orderId)) {
      orderUpdates.push({
        id: orderId,
        route_sequence: nextSequence++,
        payout_amount: 0,
      });
    }
  }

  totalBatchDistance = Number(totalBatchDistance.toFixed(2));
  totalBatchPayout = Number(totalBatchPayout.toFixed(2));

  if (!batchId) {
    const { data: newBatch, error: batchCreateErr } = await supabaseAdmin
      .from("delivery_batches")
      .insert({
        assigned_rider_id: riderId,
        delivery_date: targetDate,
        status: "PENDING",
        total_distance_km: totalBatchDistance,
        expected_payout: totalBatchPayout,
        franchise_id: batchFranchiseId,
        clinic_id: clinicId,
      })
      .select("id")
      .single();

    if (batchCreateErr) throw batchCreateErr;
    batchId = newBatch.id;
  } else {
    await supabaseAdmin
      .from("delivery_batches")
      .update({
        total_distance_km: totalBatchDistance,
        expected_payout: totalBatchPayout,
      })
      .eq("id", batchId);
  }

  for (const update of orderUpdates) {
    const { error: updateOrderErr } = await supabaseAdmin
      .from("delivery_orders")
      .update({
        assigned_rider_id: riderId,
        batch_id: batchId,
        route_sequence: update.route_sequence,
        payout_amount: update.payout_amount,
      })
      .eq("id", update.id);

    if (updateOrderErr) throw updateOrderErr;
  }
}

// Order statuses that mean the parcel has already left the kitchen. Once an
// order reaches any of these, its route is locked and cannot be re-routed.
const DISPATCHED_ORDER_STATUSES = new Set([
  "OUT_FOR_DELIVERY",
  "REACHING_TO_LOCATION",
  "PENDING_FAILURE_APPROVAL",
  "DELIVERED",
  "FAILED",
]);

async function commitRouteChangesForDate(
  supabaseAdmin: SupabaseClient,
  targetDate: string,
  movesMap: Map<string, string | null | undefined>,
  fallback: { lat: number; lng: number; ratePerKm: number },
  apiKey: string | undefined,
  departureTime: string | undefined,
  scope: OperationsScope,
) {
  let ordersQuery = supabaseAdmin
    .from("delivery_orders")
    .select("id, assigned_rider_id, batch_id, status, addresses!delivery_address_id (lat, lng)")
    .eq("delivery_date", targetDate);

  ordersQuery = applyOperationsScope(ordersQuery, scope);

  const { data: allCurrentOrders, error: fetchOrdersErr } = await ordersQuery;

  if (fetchOrdersErr) throw fetchOrdersErr;
  if (!allCurrentOrders?.length) return;

  // New batches inherit the franchise scope (NULL for core/all) so franchise
  // batches stay attributed and core batches remain unchanged.
  const batchFranchiseId = isFranchiseScope(scope) ? scope : null;

  let batchesQuery = supabaseAdmin
    .from("delivery_batches")
    .select("id, assigned_rider_id, status")
    .eq("delivery_date", targetDate);

  batchesQuery = applyOperationsScope(batchesQuery, scope);

  const { data: existingBatches, error: fetchBatchesErr } = await batchesQuery;

  if (fetchBatchesErr) throw fetchBatchesErr;

  // A rider is FROZEN for this date once they are out for delivery. Frozen
  // riders can neither receive new orders, lose orders, nor have their existing
  // route sequence recomputed.
  //
  // We detect this from TWO independent signals, because batch status is not
  // always reliable (batches can remain PENDING even after their orders are
  // dispatched — e.g. when orders are moved to OUT_FOR_DELIVERY individually):
  //   1. The rider's batch has left PENDING (they tapped "Mark Batch Picked Up").
  //   2. ANY of the rider's orders for this date is already dispatched.
  const frozenRiderIds = new Set<string>();
  for (const b of existingBatches || []) {
    if (b.assigned_rider_id && String(b.status).toUpperCase() !== "PENDING") {
      frozenRiderIds.add(b.assigned_rider_id);
    }
  }
  for (const o of allCurrentOrders) {
    if (
      o.assigned_rider_id &&
      DISPATCHED_ORDER_STATUSES.has(String(o.status).toUpperCase())
    ) {
      frozenRiderIds.add(o.assigned_rider_id);
    }
  }

  const orderById = new Map(allCurrentOrders.map((o) => [o.id, o]));

  // Only the orders explicitly moved in this commit define which riders we
  // touch. Every other rider on this date keeps their route sequence + payout
  // exactly as-is (Req: re-route only the rider who received the change).
  const affectedRiderIds = new Set<string>();
  const unassignedOrderIds: string[] = [];

  for (const [orderId, rawNewRiderId] of movesMap.entries()) {
    const order = orderById.get(orderId);
    // Moves targeting an order on a different date/scope are ignored here.
    if (!order) continue;

    const newRiderId = rawNewRiderId || null;
    const srcRiderId = order.assigned_rider_id || null;

    // No-op guard (assigned to the same rider) — nothing to validate or move.
    if (newRiderId === srcRiderId) continue;

    // The order itself must not have already left the kitchen.
    if (DISPATCHED_ORDER_STATUSES.has(String(order.status).toUpperCase())) {
      throw new Error(
        "This delivery is already out for delivery and can no longer be re-routed.",
      );
    }

    // Cannot pull an order away from a rider who already picked up their batch.
    if (srcRiderId && frozenRiderIds.has(srcRiderId)) {
      throw new Error(
        "Cannot change this route: the current rider has already picked up their batch and is out for delivery.",
      );
    }

    // Cannot assign an order to a rider who already picked up their batch.
    if (newRiderId && frozenRiderIds.has(newRiderId)) {
      throw new Error(
        "Cannot assign to this rider: their batch is already picked up and out for delivery.",
      );
    }

    if (srcRiderId) affectedRiderIds.add(srcRiderId);
    if (newRiderId) {
      affectedRiderIds.add(newRiderId);
    } else {
      unassignedOrderIds.push(orderId);
    }
  }

  // Recompute the route ONLY for affected, non-frozen riders. Each rider's set
  // is built from their final (post-move) NON-dispatched orders so anything
  // already out for delivery keeps its committed sequence.
  const riderOrdersMap = new Map<string, string[]>();
  for (const riderId of affectedRiderIds) {
    if (frozenRiderIds.has(riderId)) continue;
    const orderIds = allCurrentOrders
      .filter((o) => {
        const finalRider = movesMap.has(o.id)
          ? movesMap.get(o.id) || null
          : o.assigned_rider_id;
        return (
          finalRider === riderId &&
          !DISPATCHED_ORDER_STATUSES.has(String(o.status).toUpperCase())
        );
      })
      .map((o) => o.id);
    riderOrdersMap.set(riderId, orderIds);
  }

  // Resolve each affected rider's clinic origin + rate_configs payout rate.
  const ridersToRoute = Array.from(riderOrdersMap.entries()).filter(
    ([, orderIds]) => orderIds.length > 0,
  );
  const riderContexts = await resolveRiderRouteContexts(
    supabaseAdmin,
    ridersToRoute.map(([riderId]) => riderId),
    fallback,
  );

  await Promise.all(
    ridersToRoute.map(([riderId, orderIds]) => {
      const ctx = riderContexts.get(riderId)!;
      return commitRiderRouteForDate(
        supabaseAdmin,
        targetDate,
        riderId,
        orderIds,
        allCurrentOrders,
        existingBatches,
        ctx.originLat,
        ctx.originLng,
        ctx.ratePerKm,
        apiKey,
        departureTime,
        batchFranchiseId,
        ctx.clinicId,
      );
    }),
  );

  if (unassignedOrderIds.length > 0) {
    const { error: unassignErr } = await supabaseAdmin
      .from("delivery_orders")
      .update({
        assigned_rider_id: null,
        batch_id: null,
        route_sequence: null,
        payout_amount: 0,
      })
      .in("id", unassignedOrderIds);

    if (unassignErr) throw unassignErr;
  }

  // Clean up only the affected riders' batches if they were emptied by moves.
  // Untouched riders' batches are never inspected or deleted.
  const affectedBatchIds = (existingBatches || [])
    .filter((b) => affectedRiderIds.has(b.assigned_rider_id))
    .map((b) => b.id);

  if (affectedBatchIds.length > 0) {
    const { data: remainingOrders } = await supabaseAdmin
      .from("delivery_orders")
      .select("batch_id")
      .eq("delivery_date", targetDate)
      .in("batch_id", affectedBatchIds);

    const activeBatchIds = new Set(remainingOrders?.map((o) => o.batch_id) || []);

    for (const batchId of affectedBatchIds) {
      if (!activeBatchIds.has(batchId)) {
        await supabaseAdmin.from("delivery_batches").delete().eq("id", batchId);
      }
    }
  }
}

export async function commitRouteChanges(
  moves: { orderId: string; newRiderId: string | null }[],
  scope?: OperationsScope,
) {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Payout rate comes exclusively from rate_configs (master Rate
    // Configuration), resolved per-rider by clinic. The core rate is the
    // fallback for riders with no linked clinic.
    const coreRates = await resolveRatesForClinic(supabaseAdmin, {
      id: "",
      franchise_id: null,
    });
    const fallbackRatePerKm = coreRates.riderPayoutRatePerKm;

    // Kitchen coordinate is ONLY a fallback origin for riders whose clinic has
    // no coordinates; the real origin is each rider's clinic.
    const { data: kitchen } = await supabaseAdmin.from("kitchens").select("lat, lng").eq("is_active", true).limit(1).single();
    const fallbackLat = kitchen?.lat ? Number(kitchen.lat) : 17.3850;
    const fallbackLng = kitchen?.lng ? Number(kitchen.lng) : 78.4867;

    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    const movesMap = new Map(moves.map((m) => [m.orderId, m.newRiderId]));

    const { data: movedOrders, error: movedOrdersErr } = await supabaseAdmin
      .from("delivery_orders")
      .select("delivery_date")
      .in("id", moves.map((m) => m.orderId));

    if (movedOrdersErr) throw movedOrdersErr;

    const affectedDates = [
      ...new Set(movedOrders?.map((order) => order.delivery_date).filter(Boolean) ?? []),
    ];

    for (const targetDate of affectedDates) {
      const departureTimeIso = buildISTDepartureISO(targetDate);
      const departureTime = isFutureISO8601(departureTimeIso)
        ? departureTimeIso
        : undefined;

      await commitRouteChangesForDate(
        supabaseAdmin,
        targetDate,
        movesMap,
        { lat: fallbackLat, lng: fallbackLng, ratePerKm: fallbackRatePerKm },
        apiKey,
        departureTime,
        scope,
      );
    }

    await logAdminAction("UPDATE", "delivery_route", "multiple", {
      total_moves: moves.length,
    });

    for (const targetDate of affectedDates) {
      await notifyRoutingAssignmentComplete(targetDate);
    }

    revalidatePath("/admin/operations");
    revalidatePath("/admin/riders");
    return { success: true };
  } catch (error: any) {
    console.error("Error committing route changes:", error);
    return { success: false, error: error.message || "Failed to update dynamic routes." };
  }
}