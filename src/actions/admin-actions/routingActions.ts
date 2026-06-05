"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/logger";
import { notifyRoutingAssignmentComplete } from "@/lib/delivery/deliveryStatusNotifications";

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

// Helper function to calculate straight-line distance in km (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getRoutingData() {
  const supabase = await createClient();

  const today = getISTDateString();
  const tomorrow = getISTDateString(1);

  const { data: ordersData, error: ordersError } = await supabase
    .from("delivery_orders")
    .select(`
      id, status, assigned_rider_id, delivery_date,
      customer_profiles ( users ( full_name ) ),
      addresses!delivery_address_id ( pincode, lat, lng ),
      meal_categories ( name )
    `)
    .in("delivery_date", [today, tomorrow])
    .in("status", ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED", "PICKED"]);

  if (ordersError) console.error("Error fetching routing orders:", ordersError);

  const orders = (ordersData || []).map((o: any) => {
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;
    return {
      id: o.id,
      customerName: o.customer_profiles?.users?.full_name || "Unknown",
      pincode: addr?.pincode || "N/A",
      mealType: o.meal_categories?.name || "N/A",
      status: o.status,
      deliveryDate: o.delivery_date,
      assigned_rider_id: o.assigned_rider_id || "",
    };
  });

  const { data: ridersData, error: ridersError } = await supabase
    .from("rider_profiles")
    .select(`
      id, employee_code,
      users!inner ( full_name ),
      rider_service_areas ( pincode )
    `)
    .eq("is_active", true);

  if (ridersError) console.error("Error fetching routing riders:", ridersError);

  const riders = (ridersData || []).map((r: any) => ({
    id: r.id,
    fullName: r.users?.full_name || "Unknown",
    employeeCode: r.employee_code || "N/A",
    assignedPincodes: r.rider_service_areas?.map((a: any) => a.pincode) || []
  }));

  return { orders, riders };
}

async function commitRouteChangesForDate(
  supabaseAdmin: SupabaseClient,
  targetDate: string,
  movesMap: Map<string, string | null | undefined>,
  ratePerKm: number,
  baseLat: number,
  baseLng: number,
) {
  const { data: allCurrentOrders, error: fetchOrdersErr } = await supabaseAdmin
    .from("delivery_orders")
    .select("id, assigned_rider_id, batch_id, addresses!delivery_address_id (lat, lng)")
    .eq("delivery_date", targetDate);

  if (fetchOrdersErr) throw fetchOrdersErr;
  if (!allCurrentOrders?.length) return;

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

  const { data: existingBatches, error: fetchBatchesErr } = await supabaseAdmin
    .from("delivery_batches")
    .select("id, assigned_rider_id")
    .eq("delivery_date", targetDate);

  if (fetchBatchesErr) throw fetchBatchesErr;

  for (const [riderId, orderIds] of riderOrdersMap.entries()) {
    let batchId = existingBatches?.find((b) => b.assigned_rider_id === riderId)?.id;

    let totalBatchDistance = 0;
    let totalBatchPayout = 0;
    let currentLat = baseLat;
    let currentLng = baseLng;

    const orderUpdates: {
      id: string;
      route_sequence: number;
      payout_amount: number;
    }[] = [];

    for (let index = 0; index < orderIds.length; index++) {
      const orderId = orderIds[index];
      const orderData = allCurrentOrders.find((o) => o.id === orderId);

      const addr = Array.isArray(orderData?.addresses)
        ? orderData.addresses[0]
        : orderData?.addresses;

      const destLat = addr?.lat ? Number(addr.lat) : currentLat;
      const destLng = addr?.lng ? Number(addr.lng) : currentLng;

      const straightLineDist = calculateDistance(
        currentLat,
        currentLng,
        destLat,
        destLng,
      );
      const roadDistance = straightLineDist * 1.3;

      totalBatchDistance += roadDistance;
      const orderPayout = Number((roadDistance * ratePerKm).toFixed(2));
      totalBatchPayout += orderPayout;

      currentLat = destLat;
      currentLng = destLng;

      orderUpdates.push({
        id: orderId,
        route_sequence: index + 1,
        payout_amount: orderPayout,
      });
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

export async function commitRouteChanges(moves: { orderId: string; newRiderId: string | null }[]) {
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data: settings } = await supabaseAdmin.from("system_settings").select("rider_payout_per_km").eq("id", "global").single();
    const ratePerKm = Number(settings?.rider_payout_per_km || 16.00);

    const { data: kitchen } = await supabaseAdmin.from("kitchens").select("lat, lng").eq("is_active", true).limit(1).single();
    const baseLat = kitchen?.lat ? Number(kitchen.lat) : 17.3850;
    const baseLng = kitchen?.lng ? Number(kitchen.lng) : 78.4867;

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
      await commitRouteChangesForDate(
        supabaseAdmin,
        targetDate,
        movesMap,
        ratePerKm,
        baseLat,
        baseLng,
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