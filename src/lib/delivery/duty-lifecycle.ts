/**
 * Duty-lifecycle shared utilities.
 *
 * Provides the grace-period configuration reader, shared delivery-status sets,
 * and an IST "today" helper for the auto off-duty cron and admin off-duty action.
 *
 * Requirements: 10.1, 10.2
 */

import { getISTDateString } from "@/lib/dates/ist";

// ─── Grace Period Configuration ─────────────────────────────────────────────────

const DEFAULT_GRACE_MINUTES = 10;
const MIN_GRACE_MINUTES = 0;
const MAX_GRACE_MINUTES = 1440;

/**
 * Reads `RIDER_AUTO_OFF_DUTY_GRACE_MINUTES` from the environment.
 *
 * Validates as a whole number between 0 and 1440 (inclusive).
 * Falls back to 5 minutes when the variable is unset or invalid.
 */
export function getAutoOffDutyGracePeriodMinutes(): number {
  const raw = process.env.RIDER_AUTO_OFF_DUTY_GRACE_MINUTES;

  if (raw == null || raw.trim() === "") {
    return DEFAULT_GRACE_MINUTES;
  }

  const parsed = Number(raw);

  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < MIN_GRACE_MINUTES ||
    parsed > MAX_GRACE_MINUTES
  ) {
    return DEFAULT_GRACE_MINUTES;
  }

  return parsed;
}

// ─── Delivery Status Sets ───────────────────────────────────────────────────────

/**
 * Statuses that mean a delivery is still in progress (non-terminal, post-relevant).
 * A rider with any order in one of these statuses today is NOT eligible for auto off-duty.
 */
export const ACTIVE_DELIVERY_STATUSES = [
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
  "PICKED",
] as const;

export type ActiveDeliveryStatus = (typeof ACTIVE_DELIVERY_STATUSES)[number];

/**
 * Terminal delivery statuses — the order is complete (successfully or not).
 */
export const TERMINAL_DELIVERY_STATUSES = [
  "DELIVERED",
  "FAILED",
] as const;

export type TerminalDeliveryStatus = (typeof TERMINAL_DELIVERY_STATUSES)[number];

// ─── IST "Today" Helper ─────────────────────────────────────────────────────────

/**
 * Returns today's date string in IST (Asia/Kolkata) as YYYY-MM-DD.
 * Re-exports the existing `getISTDateString(0)` for duty-lifecycle consumers.
 */
export function getISTToday(): string {
  return getISTDateString(0);
}

// ─── Off-Duty Propagation ────────────────────────────────────────────────────

/**
 * Propagates an off-duty decision to the rider's native Location_Service so
 * tracking stops even when the app is backgrounded or dead.
 *
 * Layered propagation strategy:
 *
 * **Layer 1 (Realtime — fastest, inherently satisfied):**
 * The caller (cron or admin action) has already written `is_online=false` to
 * `rider_profiles` before invoking this function. Supabase Realtime emits a
 * Postgres NOTIFY for the row change, which any rider app subscribed to realtime
 * changes on `rider_profiles` will receive immediately. No additional action is
 * needed here for Layer 1 — it is inherently satisfied by the write + Supabase
 * Realtime subscription on the client.
 *
 * **Layer 2 (Push — OneSignal data-only notification):**
 * Sends a silent/data-only push via OneSignal to the rider's device. The rider
 * app's push handler receives `{ type: "off_duty", riderId }` and calls
 * `removeWatcher` to stop native GPS tracking. This works even if the app has
 * no active Realtime connection (e.g., WebView is dead/backgrounded).
 *
 * **Layer 3 (Background-safe — SyncWorker authoritative check):**
 * Handled by task 11.2. The SyncWorker's drain cycle reads the authoritative
 * `is_online` and stops via `ACTION_STOP_TRACKING` when false. This is the
 * last-resort fallback for when both Realtime and push are unreachable.
 *
 * **Authoritative state retention (Req 12.2):**
 * Regardless of whether the push succeeds or fails, the server-side
 * `is_online=false` state is already persisted before this function is called.
 * If the app is unreachable (no realtime connection AND no push ack within 30s),
 * the authoritative state is retained and will be applied by the SyncWorker
 * (Layer 3) or on next foreground (task 11.3).
 *
 * This function is best-effort and does NOT throw. Errors are logged and
 * the function returns silently.
 *
 * Requirements: 12.1, 12.2
 */
export async function propagateOffDuty(riderId: string): Promise<void> {
  // Layer 1: Realtime is inherently satisfied by the is_online=false write
  // that the caller has already performed on rider_profiles. Supabase Realtime
  // will broadcast the change to any subscribed client automatically.

  // Layer 2: Send a data-only push notification via OneSignal
  try {
    // Resolve the rider's auth user_id from rider_profiles.id
    // (OneSignal targets by external_id which maps to the auth user UUID)
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();

    const { data: rider, error: lookupError } = await supabase
      .from("rider_profiles")
      .select("user_id")
      .eq("id", riderId)
      .maybeSingle();

    if (lookupError) {
      console.error(
        `[propagateOffDuty] Failed to look up rider user_id for profile ${riderId}:`,
        lookupError.message,
      );
      return;
    }

    if (!rider?.user_id) {
      console.warn(
        `[propagateOffDuty] No user_id found for rider_profiles.id=${riderId}. Push skipped.`,
      );
      return;
    }

    // Send data-only push with off-duty payload
    const { sendDataPushToExternalUserIds } = await import(
      "@/lib/onesignal/server"
    );

    await sendDataPushToExternalUserIds([rider.user_id], {
      type: "off_duty",
      riderId,
    });

    console.log(
      `[propagateOffDuty] Off-duty push sent for rider ${riderId} (user: ${rider.user_id})`,
    );
  } catch (err) {
    // Best-effort: log and return silently. The authoritative is_online=false
    // state is retained server-side (Req 12.2) and Layers 1 & 3 handle the rest.
    console.error(
      `[propagateOffDuty] Error during off-duty propagation for rider ${riderId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

// Re-export getISTDateString for cases where an offset is needed
export { getISTDateString } from "@/lib/dates/ist";
