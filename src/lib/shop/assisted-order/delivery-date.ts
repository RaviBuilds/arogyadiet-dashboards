import type { SupabaseClient } from "@supabase/supabase-js";

import { getISTDateString } from "@/lib/dates/ist";
import {
  selectNextActiveDeliveryDate,
  type DailyPreferenceRow,
} from "@/lib/shop/retargetUnlinkedAddonOrders";

/**
 * Assisted order — target delivery date resolver (Req 6.2, 6.4).
 *
 * An assisted shop order (placed by an Admin/Franchise_Admin on behalf of a
 * customer) must land on the SAME "next available delivery" day that a fresh
 * customer-side checkout would pick, so it links identically through the
 * existing linking flow (`runProductLinkingAction`).
 *
 * The customer checkout (`processStandaloneCheckout`) selects that day as:
 *   - `subscription_daily_preferences` where `is_paused = false`
 *   - AND `preference_date > getISTDateString(0)` (strictly after IST "today")
 *   - earliest such day.
 *
 * This module mirrors that selection exactly, reusing the already-tested pure
 * selector (`selectNextActiveDeliveryDate`) so the assisted flow can never drift
 * from checkout / linking. The pure selection is split from the scoped IO so the
 * semantics stay unit/property testable without a live database.
 */

export type { DailyPreferenceRow } from "@/lib/shop/retargetUnlinkedAddonOrders";

/**
 * PURE: given a customer's daily preferences and the IST "today", return the
 * earliest NON-paused (active) delivery day strictly after `currentISTDate`, or
 * `null` when no such day exists.
 *
 * ISO `YYYY-MM-DD` strings compare correctly lexicographically, so a plain
 * string comparison implements the "strictly after today" rule. Delegates to
 * the shared checkout selector to guarantee identical semantics (Req 6.2).
 */
export function selectTargetDeliveryDate(
  preferences: DailyPreferenceRow[],
  currentISTDate: string,
): string | null {
  return selectNextActiveDeliveryDate(preferences, currentISTDate);
}

/**
 * Resolve the assisted order's `target_delivery_date` for a customer by reading
 * their upcoming daily preferences and selecting the earliest non-paused active
 * day strictly after the Current_IST_Date basis.
 *
 * Strictly scoped to the passed `customerProfileId`. Returns `null` when the
 * customer has no upcoming non-paused active delivery day (Req 6.4) — the caller
 * (placement) must reject the order in that case.
 *
 * @param currentISTDate Optional override for testing; defaults to the
 *   authoritative `getISTDateString(0)` used across checkout and linking.
 */
export async function resolveTargetDeliveryDate(
  supabase: SupabaseClient,
  customerProfileId: string,
  currentISTDate: string = getISTDateString(0),
): Promise<string | null> {
  const { data, error } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused")
    .eq("customer_profile_id", customerProfileId)
    .eq("is_paused", false)
    .gt("preference_date", currentISTDate)
    .order("preference_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return (data as DailyPreferenceRow).preference_date;
}
