import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shop product delivery linking fix — Defect #3 (Property 3 / Req 2.4).
 *
 * A shop `addon_order` is bought against the customer's next active delivery day
 * (`target_delivery_date`) but is not linked to a concrete delivery until the
 * nightly `link-products` cron runs. If the customer later PAUSES the exact day
 * that was chosen as the `target_delivery_date` while the order is still
 * UNLINKED (`delivery_order_id IS NULL`), the order stays bound to a day that no
 * longer has a delivery. The nightly roll-forward eventually recovers it, but
 * this helper makes the state correct IMMEDIATELY on pause rather than relying
 * on the next link run.
 *
 * The logic is split so the target-selection semantics can be unit/property
 * tested without a live database:
 *   - `selectNextActiveDeliveryDate` is PURE over its arguments.
 *   - `retargetUnlinkedAddonOrdersForPausedDates` performs the scoped IO.
 */

/** A subscription daily preference row, narrowed to the fields we need. */
export type DailyPreferenceRow = {
  preference_date: string;
  is_paused: boolean;
};

/**
 * PURE: given a customer's daily preferences and the IST "today", return the
 * customer's next ACTIVE (non-paused) delivery day strictly after `today`, or
 * `null` when the customer has no upcoming active day.
 *
 * This mirrors the checkout "next active day" selection exactly (`is_paused =
 * false` AND `preference_date > today`, earliest first), so a re-targeted order
 * lands on the same day a fresh checkout would pick.
 */
export function selectNextActiveDeliveryDate(
  preferences: DailyPreferenceRow[],
  today: string,
): string | null {
  const candidates = preferences
    .filter((p) => !p.is_paused && p.preference_date > today)
    .map((p) => p.preference_date)
    .sort();
  return candidates[0] ?? null;
}

/**
 * Re-target the customer's UNLINKED PAID `addon_orders` whose
 * `target_delivery_date` falls on one of the just-paused/rescheduled
 * `affectedDates`, moving each to the customer's next active delivery day.
 *
 * Strictly scoped to the passed `customerProfileId` on every read and write.
 * Orders that are already linked (`delivery_order_id` set) are never touched —
 * this preserves the `updateAddonOrderDeliveryDate` guard and Property 7
 * (non-target-day pauses and linked orders behave exactly as before).
 *
 * Returns the number of orders re-targeted. Best-effort by design: a failure to
 * re-target does not need to fail the surrounding pause operation, because the
 * nightly roll-forward is a backstop — callers may choose to log and continue.
 */
export async function retargetUnlinkedAddonOrdersForPausedDates(
  supabase: SupabaseClient,
  customerProfileId: string,
  affectedDates: string[],
  today: string,
): Promise<{ retargeted: number }> {
  const pausedDates = Array.from(new Set(affectedDates)).filter(Boolean);
  if (pausedDates.length === 0) return { retargeted: 0 };

  // Only this customer's PAID, still-unlinked orders whose target lands on a
  // day that was just paused/rescheduled. Linked orders are excluded so the
  // existing "already scheduled" guard is preserved.
  const { data: orders, error: ordersError } = await supabase
    .from("addon_orders")
    .select("id, target_delivery_date")
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "PAID")
    .is("delivery_order_id", null)
    .in("target_delivery_date", pausedDates);

  if (ordersError) throw ordersError;
  if (!orders || orders.length === 0) return { retargeted: 0 };

  // The customer's upcoming preferences (both paused and active) so the pure
  // selector can pick the next active day consistently with checkout.
  const { data: prefs, error: prefsError } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused")
    .eq("customer_profile_id", customerProfileId)
    .gt("preference_date", today)
    .order("preference_date", { ascending: true });

  if (prefsError) throw prefsError;

  const nextActiveDay = selectNextActiveDeliveryDate(
    (prefs ?? []) as DailyPreferenceRow[],
    today,
  );

  // No upcoming active day to move the order to — leave it as-is; the nightly
  // roll-forward remains the backstop once a delivery day exists again.
  if (!nextActiveDay) return { retargeted: 0 };

  let retargeted = 0;
  for (const order of orders) {
    // Nothing to do if the target already equals the next active day.
    if (order.target_delivery_date === nextActiveDay) continue;

    const { data: updated, error: updateError } = await supabase
      .from("addon_orders")
      .update({ target_delivery_date: nextActiveDay })
      .eq("id", order.id)
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "PAID")
      .is("delivery_order_id", null)
      .select("id");

    if (updateError) throw updateError;
    retargeted += updated?.length ?? 0;
  }

  return { retargeted };
}
