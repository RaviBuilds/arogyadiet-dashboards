/**
 * Auto Off-Duty Sweep — detection and execution logic.
 *
 * Evaluates each `is_online = true` rider against today's `delivery_orders`,
 * determines eligibility for auto off-duty, and performs the write
 * (`is_online = false`, `last_offline_at = now()`) for eligible riders.
 *
 * Design principles:
 *  - Per-rider failures are isolated and recorded (Req 10.9).
 *  - Idempotent: riders already `is_online = false` are skipped (Req 10.10).
 *  - Pure function over the Supabase admin client — testable in isolation.
 *
 * Requirements: 10.4, 10.5, 10.6, 10.7, 10.9, 10.10
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVE_DELIVERY_STATUSES,
  TERMINAL_DELIVERY_STATUSES,
  getAutoOffDutyGracePeriodMinutes,
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
  /** Rider IDs that were evaluated but not eligible (active order, within grace, no terminal, etc.) */
  skipped: string[];
  /** Per-rider evaluation or write errors — isolated, did not stop the sweep */
  errors: SweepError[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────────

interface RiderRow {
  id: string;
  is_online: boolean;
}

interface OrderRow {
  id: string;
  status: string;
  updated_at: string;
}

// ─── Sweep Function ─────────────────────────────────────────────────────────────

/**
 * Runs the auto off-duty sweep.
 *
 * 1. Queries all riders with `is_online = true`.
 * 2. For each rider, queries today's `delivery_orders`.
 * 3. Evaluates eligibility per the requirements.
 * 4. Writes `is_online = false` + `last_offline_at` for eligible riders.
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
  const gracePeriodMinutes = getAutoOffDutyGracePeriodMinutes();
  const todayIST = getISTToday();

  // Step 1: Fetch all online riders
  const { data: onlineRiders, error: ridersError } = await adminClient
    .from("rider_profiles")
    .select("id, is_online")
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
        gracePeriodMinutes,
        executionTime,
        result,
      );
    } catch (err: unknown) {
      // Per-rider failures are isolated (Req 10.9)
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
  gracePeriodMinutes: number,
  executionTime: string,
  result: SweepResult,
): Promise<void> {
  // Idempotent guard: if already offline, skip (Req 10.10)
  if (!rider.is_online) {
    result.skipped.push(rider.id);
    return;
  }

  // Fetch today's delivery orders for this rider
  const { data: orders, error: ordersError } = await adminClient
    .from("delivery_orders")
    .select("id, status, updated_at")
    .eq("assigned_rider_id", rider.id)
    .eq("delivery_date", todayIST);

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  const todayOrders = (orders ?? []) as OrderRow[];

  // Req 10.4: If any order is in an active status, skip
  const hasActiveOrder = todayOrders.some((o) =>
    (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(o.status),
  );

  if (hasActiveOrder) {
    result.skipped.push(rider.id);
    return;
  }

  const terminalOrders = todayOrders.filter((o) =>
    (TERMINAL_DELIVERY_STATUSES as readonly string[]).includes(o.status),
  );

  // Case A: Rider has NO orders at all today — they should not be online.
  // Apply the grace period from last_online_at to give them time to check app.
  if (todayOrders.length === 0) {
    // Fetch last_online_at to determine grace period start
    const { data: riderProfile, error: profileError } = await adminClient
      .from("rider_profiles")
      .select("last_online_at")
      .eq("id", rider.id)
      .maybeSingle();

    if (profileError || !riderProfile?.last_online_at) {
      // No last_online_at available — flip immediately (conservative)
      // Fall through to the flip logic below
    } else {
      const onlineSince = new Date(riderProfile.last_online_at);
      const graceDeadline = new Date(
        onlineSince.getTime() + gracePeriodMinutes * 60 * 1000,
      );

      if (executionDate < graceDeadline) {
        result.skipped.push(rider.id);
        return;
      }
    }
    // Fall through to flip
  } else if (terminalOrders.length === 0) {
    // Case B: Rider has orders but none are terminal yet (e.g. all ORDER_CREATED/ASSIGNED)
    // These riders still have pending work — skip them
    result.skipped.push(rider.id);
    return;
  } else {
    // Case C: Rider has terminal orders — check grace period from last terminal
    // Req 10.6: If the most recent terminal transition is within the grace period, skip
    const mostRecentTerminalTime = getMostRecentTerminalTransition(terminalOrders);

    if (mostRecentTerminalTime) {
      const graceDeadline = new Date(
        mostRecentTerminalTime.getTime() + gracePeriodMinutes * 60 * 1000,
      );

      if (executionDate < graceDeadline) {
        // Still within grace period
        result.skipped.push(rider.id);
        return;
      }
    }
  }

  // Req 10.7: Rider is eligible — flip to off-duty
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
 * Returns the most recent terminal transition time from a set of terminal orders.
 * Uses `updated_at` as the proxy for when the terminal status was set.
 */
function getMostRecentTerminalTransition(
  terminalOrders: OrderRow[],
): Date | null {
  if (terminalOrders.length === 0) return null;

  let latest: Date | null = null;

  for (const order of terminalOrders) {
    if (!order.updated_at) continue;
    const t = new Date(order.updated_at);
    if (!latest || t > latest) {
      latest = t;
    }
  }

  return latest;
}
