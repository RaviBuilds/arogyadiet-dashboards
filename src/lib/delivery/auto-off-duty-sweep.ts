/**
 * Auto Off-Duty Sweep — connectivity-based detection and execution logic.
 *
 * Evaluates each `is_online = true` rider against their live-location heartbeat
 * and flips them off-duty (`is_online = false`, `last_offline_at = now()`) when
 * their app is no longer reporting — i.e. the rider closed/killed the app.
 *
 * "Online" reflects ACTUAL app connectivity, not order assignment. A rider who
 * holds assigned orders but whose app is not reporting is flipped offline. The
 * only guard is an in-progress delivery: a rider actively out for delivery is
 * never flipped mid-delivery, tolerating brief signal gaps.
 *
 * Heartbeat source: `rider_live_locations.updated_at` — the native foreground
 * service uploads location (including a stationary heartbeat) directly to
 * Supabase while the app runs; the pings stop when the app is closed/killed.
 *
 * Design principles:
 *  - Per-rider failures are isolated and recorded.
 *  - Idempotent: riders already `is_online = false` are skipped.
 *  - Pure function over the Supabase admin client — testable in isolation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVE_DELIVERY_STATUSES,
  getRiderHeartbeatStaleMinutes,
  getISTToday,
} from "./duty-lifecycle";

// ─── Result Types ───────────────────────────────────────────────────────────────

export interface SweepError {
  riderId: string;
  error: string;
}

export interface SweepResult {
  /** Rider IDs that were flipped from is_online=true to is_online=false */
  flipped: string[];
  /** Rider IDs that were evaluated but not eligible (fresh heartbeat, active delivery, etc.) */
  skipped: string[];
  /** Per-rider evaluation or write errors — isolated, did not stop the sweep */
  errors: SweepError[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────────

interface RiderRow {
  id: string;
  is_online: boolean;
  /** When the rider last toggled online. Acts as a grace floor so a freshly
   *  online rider isn't flipped before the native service's first ping. */
  last_online_at: string | null;
}

interface OrderStatusRow {
  status: string;
}

// ─── Sweep Function ─────────────────────────────────────────────────────────────

/**
 * Runs the auto off-duty sweep.
 *
 * 1. Queries all riders with `is_online = true`.
 * 2. For each rider, protects those with an in-progress delivery today.
 * 3. Reads the rider's live-location heartbeat and flips them off-duty when it
 *    (floored by their go-online time) is older than the staleness threshold.
 *
 * @param adminClient - A Supabase admin (service-role) client.
 * @param now - Optional override for "now" (ISO string). Defaults to current time.
 * @returns Structured sweep result.
 */
export async function runAutoOffDutySweep(
  adminClient: SupabaseClient,
  now?: string,
): Promise<SweepResult> {
  const result: SweepResult = {
    flipped: [],
    skipped: [],
    errors: [],
  };

  const executionTime = now ?? new Date().toISOString();
  const executionDate = new Date(executionTime);
  const staleThresholdMinutes = getRiderHeartbeatStaleMinutes();
  const todayIST = getISTToday();

  // Step 1: Fetch all online riders (with their go-online time for the grace floor)
  const { data: onlineRiders, error: ridersError } = await adminClient
    .from("rider_profiles")
    .select("id, is_online, last_online_at")
    .eq("is_online", true);

  if (ridersError) {
    result.errors.push({
      riderId: "__sweep__",
      error: `Failed to fetch online riders: ${ridersError.message}`,
    });
    return result;
  }

  if (!onlineRiders || onlineRiders.length === 0) {
    return result;
  }

  // Step 2: Evaluate each rider independently
  for (const rider of onlineRiders as RiderRow[]) {
    try {
      await evaluateRider(
        adminClient,
        rider,
        todayIST,
        executionDate,
        staleThresholdMinutes,
        executionTime,
        result,
      );
    } catch (err: unknown) {
      // Per-rider failures are isolated
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ riderId: rider.id, error: message });
    }
  }

  return result;
}

// ─── Per-Rider Evaluation ───────────────────────────────────────────────────────

async function evaluateRider(
  adminClient: SupabaseClient,
  rider: RiderRow,
  todayIST: string,
  executionDate: Date,
  staleThresholdMinutes: number,
  executionTime: string,
  result: SweepResult,
): Promise<void> {
  // Idempotent guard: if already offline, skip
  if (!rider.is_online) {
    result.skipped.push(rider.id);
    return;
  }

  // Guard: never flip a rider who is actively out for delivery. An in-progress
  // delivery presumes the rider is working; tolerate brief signal gaps.
  const { data: orders, error: ordersError } = await adminClient
    .from("delivery_orders")
    .select("status")
    .eq("assigned_rider_id", rider.id)
    .eq("delivery_date", todayIST);

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  const hasActiveOrder = ((orders ?? []) as OrderStatusRow[]).some((o) =>
    (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(o.status),
  );

  if (hasActiveOrder) {
    result.skipped.push(rider.id);
    return;
  }

  // Heartbeat: the live-location ping is the app-connectivity signal.
  const { data: location, error: locationError } = await adminClient
    .from("rider_live_locations")
    .select("updated_at")
    .eq("rider_id", rider.id)
    .maybeSingle();

  if (locationError) {
    throw new Error(`Failed to fetch live location: ${locationError.message}`);
  }

  // Effective last-seen = most recent of the heartbeat ping and the go-online
  // time. last_online_at is a grace floor so a rider who just toggled online is
  // not flipped before the native service emits its first location ping.
  const lastSeenMs = mostRecentSignalMs(
    (location as { updated_at?: string | null } | null)?.updated_at ?? null,
    rider.last_online_at,
  );

  // A fresh heartbeat means the app is connected — keep the rider online.
  if (lastSeenMs !== null) {
    const staleDeadline = lastSeenMs + staleThresholdMinutes * 60 * 1000;
    if (executionDate.getTime() < staleDeadline) {
      result.skipped.push(rider.id);
      return;
    }
  }

  // Stale (or no signal at all) → the app is not reporting → flip off-duty.
  const { error: updateError } = await adminClient
    .from("rider_profiles")
    .update({
      is_online: false,
      last_offline_at: executionTime,
    })
    .eq("id", rider.id)
    .eq("is_online", true); // Additional idempotent guard at DB level

  if (updateError) {
    throw new Error(`Failed to update rider: ${updateError.message}`);
  }

  result.flipped.push(rider.id);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns the most recent of the two signal timestamps in epoch milliseconds,
 * ignoring null/unparseable values. Returns null when neither is usable.
 */
function mostRecentSignalMs(
  heartbeatAt: string | null,
  lastOnlineAt: string | null,
): number | null {
  let latest: number | null = null;

  for (const value of [heartbeatAt, lastOnlineAt]) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (latest === null || ms > latest) {
      latest = ms;
    }
  }

  return latest;
}
