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

  const riders = (ridersData || []).map((r: any) => ({
    id: r.id,
    fullName: r.users?.full_name || "Unknown",
    employeeCode: r.employee_code || "N/A",
    // Rider's linked Clinic — drives clinic-selector-first gating (Req 17).
    clinic_id: r.clinic_id ?? null,
    assignedPincodes: r.rider_service_areas?.map((a: any) => a.pincode) || []
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
  kitchenLat: number,
  kitchenLng: number,
  ratePerKm: number,
  apiKey: string | undefined,
  departureTime: string | undefined,
  batchFranchiseId: string | null,
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
            kitchenLat,
            kitchenLng,
            routableStops,
            apiKey,
            ratePerKm,
            departureTime,
          )
        : null;

    if (!route) {
      route = computeOpenLoopHaversineRoute(
        routableStops,
        kitchenLat,
        kitchenLng,
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

async function commitRouteChangesForDate(
  supabaseAdmin: SupabaseClient,
  targetDate: string,
  movesMap: Map<string, string | null | undefined>,
  ratePerKm: number,
  kitchenLat: number,
  kitchenLng: number,
  apiKey: string | undefined,
  departureTime: string | undefined,
  scope: OperationsScope,
) {
  let ordersQuery = supabaseAdmin
    .from("delivery_orders")
    .select("id, assigned_rider_id, batch_id, addresses!delivery_address_id (lat, lng)")
    .eq("delivery_date", targetDate);

  ordersQuery = applyOperationsScope(ordersQuery, scope);

  const { data: allCurrentOrders, error: fetchOrdersErr } = await ordersQuery;

  if (fetchOrdersErr) throw fetchOrdersErr;
  if (!allCurrentOrders?.length) return;

  // New batches inherit the franchise scope (NULL for core/all) so franchise
  // batches stay attributed and core batches remain unchanged.
  const batchFranchiseId = isFranchiseScope(scope) ? scope : null;

  const riderOrdersMap = new Map<string, string[]>();
  const unassignedOrderIds: string[] = [];

  allCurrentOrders.forEach((order) => {
    const finalRiderId = movesMap.has(order.id)
      ? movesMap.get(order.id)
      : order.assigned_rider_id;
    if (finalRiderId) {
      if (!riderOrdersMap.has(finalRiderId)) riderOrdersMap.set(finalRiderId, []);
      riderOrdersMap.get(finalRiderId)!.push(order.id);
    } else {
      unassignedOrderIds.push(order.id);
    }
  });

  let batchesQuery = supabaseAdmin
    .from("delivery_batches")
    .select("id, assigned_rider_id")
    .eq("delivery_date", targetDate);

  batchesQuery = applyOperationsScope(batchesQuery, scope);

  const { data: existingBatches, error: fetchBatchesErr } = await batchesQuery;

  if (fetchBatchesErr) throw fetchBatchesErr;

  await Promise.all(
    Array.from(riderOrdersMap.entries()).map(([riderId, orderIds]) =>
      commitRiderRouteForDate(
        supabaseAdmin,
        targetDate,
        riderId,
        orderIds,
        allCurrentOrders,
        existingBatches,
        kitchenLat,
        kitchenLng,
        ratePerKm,
        apiKey,
        departureTime,
        batchFranchiseId,
      ),
    ),
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

  const { data: postRemainingOrders } = await supabaseAdmin
    .from("delivery_orders")
    .select("batch_id")
    .eq("delivery_date", targetDate)
    .not("batch_id", "is", null);

  const activeBatchIds = new Set(postRemainingOrders?.map((o) => o.batch_id) || []);

  if (existingBatches) {
    for (const batch of existingBatches) {
      if (!activeBatchIds.has(batch.id)) {
        await supabaseAdmin.from("delivery_batches").delete().eq("id", batch.id);
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
    const { data: settings } = await supabaseAdmin.from("system_settings").select("rider_payout_per_km").eq("id", "global").single();
    const ratePerKm = Number(settings?.rider_payout_per_km || 16.00);

    const { data: kitchen } = await supabaseAdmin.from("kitchens").select("lat, lng").eq("is_active", true).limit(1).single();
    const kitchenLat = kitchen?.lat ? Number(kitchen.lat) : 17.3850;
    const kitchenLng = kitchen?.lng ? Number(kitchen.lng) : 78.4867;

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
        ratePerKm,
        kitchenLat,
        kitchenLng,
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