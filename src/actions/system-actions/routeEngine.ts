import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

// Initialize the Admin Client to bypass RLS for system tasks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function executeAutomatedDispatch(targetDate: string) {
  // 1. Fetch Global Configuration using Admin Client
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

  const payoutPerKm = settings?.rider_payout_per_km || 16;
  const GOOGLE_API_KEY =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_API_KEY)
    return {
      error: "Google Maps API Key is missing from environment variables.",
    };

  // 2. Fetch all Pending Orders for the Target Date that have GPS coordinates
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("delivery_orders")
    .select(`id, delivery_address_id, addresses ( pincode, lat, lng )`)
    .eq("delivery_date", targetDate)
    .eq("status", "ORDER_CREATED")
    .is("batch_id", null);

  if (ordersError || !orders || orders.length === 0) {
    return { error: `No pending orders found to route for ${targetDate}.` };
  }

  // 3. Map Pincodes to Riders
  const { data: serviceAreas } = await supabaseAdmin
    .from("rider_service_areas")
    .select("pincode, rider_id");
  const pincodeToRiderMap = new Map(
    serviceAreas?.map((sa) => [sa.pincode, sa.rider_id]),
  );

  // Group valid orders by Rider
  const riderGroups = new Map<string, any[]>();
  for (const order of orders) {
    const address = Array.isArray(order.addresses)
      ? order.addresses[0]
      : order.addresses;
    if (!address?.lat || !address?.lng) continue; // Skip orders without GPS

    const riderId = pincodeToRiderMap.get(address.pincode);
    if (riderId) {
      if (!riderGroups.has(riderId)) riderGroups.set(riderId, []);
      riderGroups
        .get(riderId)!
        .push({ id: order.id, lat: address.lat, lng: address.lng });
    }
  }

  let batchesCreated = 0;

  // 4. Process Each Rider's Load via Google Maps API
  for (const [riderId, riderOrders] of Array.from(riderGroups.entries())) {
    const waypointsStr =
      `optimize:true|` + riderOrders.map((o) => `${o.lat},${o.lng}`).join("|");
    const kitchenCoords = `${kitchen.lat},${kitchen.lng}`;

    try {
      const mapRes = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${kitchenCoords}&destination=${kitchenCoords}&waypoints=${waypointsStr}&key=${GOOGLE_API_KEY}`,
      );
      const mapData = await mapRes.json();

      if (mapData.status !== "OK") {
        console.error("Google Maps API Error:", mapData);
        continue;
      }

      const route = mapData.routes[0];
      const totalMeters = route.legs.reduce(
        (sum: number, leg: any) => sum + leg.distance.value,
        0,
      );
      const totalKm = Number((totalMeters / 1000).toFixed(2));
      const expectedPayout = Math.round(totalKm * payoutPerKm);

      // 5. Save the Batch
      const { data: newBatch, error: batchError } = await supabaseAdmin
        .from("delivery_batches")
        .insert({
          assigned_rider_id: riderId,
          delivery_date: targetDate,
          total_distance_km: totalKm,
          expected_payout: expectedPayout,
          status: "PENDING",
        })
        .select("id")
        .single();

      if (newBatch && !batchError) {
        batchesCreated++;

        // 6. Update Orders with per-leg payout_amount
        const optimalOrderIndices = route.waypoint_order as number[];
        const legs = route.legs as any[];

        for (let i = 0; i < optimalOrderIndices.length; i++) {
          const originalIndex = optimalOrderIndices[i];
          const actualOrder = riderOrders[originalIndex];
          const legDistanceKm = (legs[i]?.distance?.value || 0) / 1000;
          const orderPayout = Number((legDistanceKm * payoutPerKm).toFixed(2));

          await supabaseAdmin
            .from("delivery_orders")
            .update({
              batch_id: newBatch.id,
              assigned_rider_id: riderId,
              status: "ASSIGNED",
              route_sequence: i + 1,
              payout_amount: orderPayout,
            })
            .eq("id", actualOrder.id);
        }
      }
    } catch (err) {
      console.error("Routing Engine Error:", err);
    }
  }

  revalidatePath("/rider/route");
  return {
    success: true,
    message: `Routed ${batchesCreated} batches via Google Maps for ${targetDate}!`,
  };
}
