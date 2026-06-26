"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { TERMINAL_ORDER_STATUSES } from "@/lib/delivery/orderStatuses";
import { resolveAddressCoordinates } from "@/lib/geocoding";
import { applyOperationsScope, type OperationsScope } from "@/lib/franchise/scope";

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

const ACTIVE_DELIVERY_STATUSES = [
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
  "PICKED",
] as const;

const POST_PICKUP_STATUSES = [
  ...ACTIVE_DELIVERY_STATUSES,
  "DELIVERED",
  "FAILED",
] as const;

export type LiveTrackingPhase = "not_out" | "active" | "completed";

export type LiveTrackingStop = {
  sequence: number;
  orderId: string;
  customerName: string;
  pincode: string;
  status: string;
  lat?: number;
  lng?: number;
  locationSource?: "gps" | "pincode";
  isDelivered: boolean;
};

export type LiveTrackingPayload = {
  phase: LiveTrackingPhase;
  rider: { id: string; fullName: string; isOnline: boolean };
  stops: LiveTrackingStop[];
};

export type LiveTrackingRiderOption = {
  id: string;
  fullName: string;
  hint: string;
};

export type RiderLiveLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
};

function derivePhase(statuses: string[]): LiveTrackingPhase {
  if (statuses.length === 0) return "not_out";

  if (
    statuses.every((s) =>
      TERMINAL_ORDER_STATUSES.includes(
        s as (typeof TERMINAL_ORDER_STATUSES)[number],
      ),
    )
  ) {
    return "completed";
  }

  const hasPostPickup = statuses.some((s) =>
    POST_PICKUP_STATUSES.includes(s as (typeof POST_PICKUP_STATUSES)[number]),
  );
  if (!hasPostPickup) return "not_out";

  return "active";
}

export async function getRiderLiveLocation(
  riderId: string,
): Promise<RiderLiveLocation | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("rider_live_locations")
    .select("lat, lng, updated_at")
    .eq("rider_id", riderId)
    .maybeSingle();

  if (error) {
    console.error("[getRiderLiveLocation]", error);
    return null;
  }

  if (data?.lat == null || data?.lng == null) return null;

  const lat = Number(data.lat);
  const lng = Number(data.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}

export async function getLiveTrackingRiders(
  scope?: OperationsScope,
): Promise<LiveTrackingRiderOption[]> {
  const supabase = createAdminClient();
  const today = getISTDateString();

  let ordersQuery = supabase
    .from("delivery_orders")
    .select(
      `
      assigned_rider_id,
      status,
      rider_profiles (
        id,
        users ( full_name )
      )
    `,
    )
    .eq("delivery_date", today)
    .not("assigned_rider_id", "is", null);

  ordersQuery = applyOperationsScope(ordersQuery, scope);

  const { data: orders, error } = await ordersQuery;

  if (error) {
    console.error("[getLiveTrackingRiders]", error);
    return [];
  }

  const riderMap = new Map<string, LiveTrackingRiderOption>();

  for (const order of orders || []) {
    const riderId = order.assigned_rider_id as string;
    if (!riderId) continue;

    const riderProfile = Array.isArray(order.rider_profiles)
      ? order.rider_profiles[0]
      : order.rider_profiles;
    const users = riderProfile?.users;
    const user = Array.isArray(users) ? users[0] : users;
    const fullName = user?.full_name || "Unknown Rider";

    const existing = riderMap.get(riderId);
    const status = order.status as string;
    const isOut =
      POST_PICKUP_STATUSES.includes(
        status as (typeof POST_PICKUP_STATUSES)[number],
      ) && status !== "DELIVERED" && status !== "FAILED";

    if (!existing) {
      riderMap.set(riderId, {
        id: riderId,
        fullName,
        hint: isOut ? "Out for delivery" : "",
      });
    } else if (isOut && !existing.hint) {
      existing.hint = "Out for delivery";
    }
  }

  return Array.from(riderMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export async function getAdminLiveTrackingData(
  riderId: string,
  scope?: OperationsScope,
): Promise<LiveTrackingPayload | null> {
  const supabase = createAdminClient();
  const today = getISTDateString();

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  let ordersQuery = supabase
    .from("delivery_orders")
    .select(
      `
        id,
        status,
        route_sequence,
        customer_profiles ( users ( full_name ) ),
        addresses!delivery_address_id ( lat, lng, pincode, city, state )
      `,
    )
    .eq("assigned_rider_id", riderId)
    .eq("delivery_date", today)
    .order("route_sequence", { ascending: true, nullsFirst: false });

  ordersQuery = applyOperationsScope(ordersQuery, scope);

  const [riderRes, ordersRes] = await Promise.all([
    supabase
      .from("rider_profiles")
      .select("id, is_online, users ( full_name )")
      .eq("id", riderId)
      .single(),
    ordersQuery,
  ]);

  if (riderRes.error || !riderRes.data) {
    console.error("[getAdminLiveTrackingData] rider", riderRes.error);
    return null;
  }

  if (ordersRes.error) {
    console.error("[getAdminLiveTrackingData] orders", ordersRes.error);
    return null;
  }

  const orders = ordersRes.data || [];
  if (orders.length === 0) {
    const users = riderRes.data.users;
    const user = Array.isArray(users) ? users[0] : users;
    return {
      phase: "not_out",
      rider: {
        id: riderId,
        fullName: user?.full_name || "Unknown Rider",
        isOnline: Boolean(riderRes.data.is_online),
      },
      stops: [],
    };
  }

  const pincodeCache = new Map<string, { lat: number; lng: number }>();
  const stops: LiveTrackingStop[] = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i] as Record<string, unknown>;
    const addr = Array.isArray(order.addresses)
      ? order.addresses[0]
      : order.addresses;
    const address = addr as {
      lat?: number | null;
      lng?: number | null;
      pincode?: string | null;
      city?: string | null;
      state?: string | null;
    } | null;

    const cp = Array.isArray(order.customer_profiles)
      ? order.customer_profiles[0]
      : order.customer_profiles;
    const cpUsers = (cp as { users?: unknown })?.users;
    const cpUser = Array.isArray(cpUsers) ? cpUsers[0] : cpUsers;
    const customerName =
      (cpUser as { full_name?: string })?.full_name || "Unknown Customer";

    const status = String(order.status);
    const sequence =
      typeof order.route_sequence === "number"
        ? order.route_sequence
        : i + 1;

    let lat: number | undefined;
    let lng: number | undefined;
    let locationSource: "gps" | "pincode" | undefined;

    if (apiKey && address) {
      const resolved = await resolveAddressCoordinates(
        address,
        apiKey,
        pincodeCache,
      );
      if (resolved) {
        lat = resolved.coords.lat;
        lng = resolved.coords.lng;
        locationSource = resolved.usedPincodeFallback ? "pincode" : "gps";
      }
    } else if (address?.lat != null && address?.lng != null) {
      lat = Number(address.lat);
      lng = Number(address.lng);
      locationSource = "gps";
    }

    stops.push({
      sequence,
      orderId: String(order.id),
      customerName,
      pincode: address?.pincode || "N/A",
      status,
      lat,
      lng,
      locationSource,
      isDelivered: status === "DELIVERED",
    });
  }

  const statuses = stops.map((s) => s.status);
  const phase = derivePhase(statuses);

  const users = riderRes.data.users;
  const user = Array.isArray(users) ? users[0] : users;

  return {
    phase,
    rider: {
      id: riderId,
      fullName: user?.full_name || "Unknown Rider",
      isOnline: Boolean(riderRes.data.is_online),
    },
    stops,
  };
}
