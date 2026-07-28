"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { TERMINAL_ORDER_STATUSES } from "@/lib/delivery/orderStatuses";
import { resolveAddressCoordinates } from "@/lib/geocoding";
import { applyOperationsScope, type OperationsScope } from "@/lib/franchise/scope";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import {
  ACTIVE_DELIVERY_STATUSES as DUTY_ACTIVE_STATUSES,
  getISTToday as getDutyISTToday,
  propagateOffDuty,
} from "@/lib/delivery/duty-lifecycle";

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
  /** Rider's linked Clinic — drives clinic-selector-first gating (Req 17). */
  clinic_id: string | null;
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
        clinic_id,
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
    const clinicId =
      (riderProfile as { clinic_id?: string | null } | null)?.clinic_id ?? null;

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
        clinic_id: clinicId,
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
        customer_profiles ( users!customer_profiles_user_id_fkey ( full_name ) ),
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


// ─── Admin Off-Duty Action ──────────────────────────────────────────────────────

export type AdminSetRiderOffDutyResult =
  | { success: true }
  | { success: false; error: "unauthorized" | "not_found" | "active_assignment" };

/**
 * Admin-initiated off-duty action with active-assignment guard.
 *
 * 1. Verify admin authorization (riders group, manage level).
 * 2. Verify the rider exists in rider_profiles.
 * 3. Server-authoritative re-check: any active orders today → reject.
 * 4. Set is_online=false, last_offline_at=now().
 * 5. Invoke propagateOffDuty to signal the native service.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 14.7
 */
export async function adminSetRiderOffDutyAction(
  riderId: string,
): Promise<AdminSetRiderOffDutyResult> {
  // 1. Admin authorization gate
  const gate = await checkGroupManage("riders");
  if (!gate.ok) {
    return { success: false, error: "unauthorized" };
  }

  const supabase = createAdminClient();

  // 2. Verify rider exists
  const { data: rider, error: riderError } = await supabase
    .from("rider_profiles")
    .select("id")
    .eq("id", riderId)
    .maybeSingle();

  if (riderError) {
    console.error("[adminSetRiderOffDutyAction] rider lookup error:", riderError);
    return { success: false, error: "not_found" };
  }

  if (!rider) {
    return { success: false, error: "not_found" };
  }

  // 3. Server-authoritative re-check of active orders today
  const today = getDutyISTToday();

  const { data: activeOrders, error: ordersError } = await supabase
    .from("delivery_orders")
    .select("id")
    .eq("assigned_rider_id", riderId)
    .eq("delivery_date", today)
    .in("status", [...DUTY_ACTIVE_STATUSES])
    .limit(1);

  if (ordersError) {
    console.error("[adminSetRiderOffDutyAction] orders check error:", ordersError);
    // On query failure, treat conservatively as active to avoid premature off-duty
    return { success: false, error: "active_assignment" };
  }

  if (activeOrders && activeOrders.length > 0) {
    return { success: false, error: "active_assignment" };
  }

  // 4. Set is_online=false, last_offline_at=now()
  const { error: updateError } = await supabase
    .from("rider_profiles")
    .update({
      is_online: false,
      last_offline_at: new Date().toISOString(),
    })
    .eq("id", riderId);

  if (updateError) {
    console.error("[adminSetRiderOffDutyAction] update error:", updateError);
    return { success: false, error: "active_assignment" };
  }

  // 5. Invoke propagateOffDuty (placeholder until task 11.1)
  try {
    await propagateOffDuty(riderId);
  } catch (err) {
    // Propagation failure does not revert the is_online=false state (Req 10.8 analog)
    console.error("[adminSetRiderOffDutyAction] propagateOffDuty error:", err);
  }

  return { success: true };
}
