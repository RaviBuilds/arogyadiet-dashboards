// src/lib/clinic/workload.ts
// Workload snapshot finalization, derivation, and aggregation
// (core-clinic-architecture, Requirements 11.4, 12, 19.6).
//
// This module mixes two kinds of code, kept cleanly separated:
//
//   1. IO functions (use `createAdminClient`, service role): persist a finalized
//      snapshot, derive a clinic's meal/shop counts for a date from the
//      IMMUTABLE order clinic stamp, and read persisted snapshots for stats.
//
//   2. PURE functions (no IO): `aggregateSnapshots` and the bucket-key helpers.
//      These are exported and side-effect-free so they can be property-tested
//      (tasks 9.5, 9.7, 9.8, 9.9) without a live Supabase connection.
//
// AUTHORITATIVE BASIS (Req 19.6, 19.7): per-clinic meal counts are derived by
// counting `delivery_orders` whose STAMPED `clinic_id` equals the clinic and
// whose `delivery_date` equals the target date — never via the customer's
// CURRENT `clinic_id`. This keeps historical attribution stable when a customer
// later moves between clinics.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertSnapshot,
  listSnapshotsInRange,
} from "@/repositories/clinic/snapshotRepository";
import type {
  ActionResult,
  WorkloadAggregate,
  WorkloadGrouping,
  WorkloadMealCounts,
  WorkloadSnapshot,
  WorkloadSnapshotInput,
} from "@/types/clinic";

// Count bounds enforced by the DB CHECK constraints (Req 12.1).
const COUNT_MIN = 0;
const COUNT_MAX = 100000;

// Meal-category codes (exact seed values) → snapshot count fields.
const VEG_CODE = "VEG";
const NON_VEG_CODE = "CHICKEN";
const EGG_CODE = "EGG";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Clamp a value to a non-negative integer within 0..100000 (Req 12.1). Non-finite
 * values and negatives collapse to 0; fractional values are truncated.
 */
export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return COUNT_MIN;
  const truncated = Math.trunc(value);
  if (truncated < COUNT_MIN) return COUNT_MIN;
  if (truncated > COUNT_MAX) return COUNT_MAX;
  return truncated;
}

/**
 * Clamp every value of a shop-product-count map to 0..100000, dropping any
 * entry that clamps to 0 so the persisted/aggregated map stays minimal.
 */
function clampShopProductCounts(
  counts: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [productId, raw] of Object.entries(counts ?? {})) {
    const clamped = clampCount(raw);
    if (clamped > 0) out[productId] = clamped;
  }
  return out;
}

/**
 * Compute the deterministic ISO-8601 week bucket key (e.g. `2024-W05`) for a
 * `YYYY-MM-DD` date string. Uses UTC arithmetic so the result is independent of
 * the host timezone. The week-numbering year is the ISO week year, which can
 * differ from the calendar year at year boundaries.
 */
function isoWeekKey(year: number, month: number, day: number): string {
  // Date of the given day, in UTC (month is 1-based here).
  const date = new Date(Date.UTC(year, month - 1, day));
  // ISO weekday: Monday = 0 … Sunday = 6.
  const isoDow = (date.getUTCDay() + 6) % 7;
  // Shift to the Thursday of this week (ISO weeks are defined by their Thursday).
  date.setUTCDate(date.getUTCDate() - isoDow + 3);
  const weekYear = date.getUTCFullYear();
  // First Thursday of the week-year.
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstIsoDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIsoDow + 3);
  const week =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Derive the deterministic bucket key for a snapshot's `target_date` under the
 * requested grouping (Req 12.4). Pure.
 *
 *   - `day`   → the ISO date itself, `YYYY-MM-DD`.
 *   - `week`  → ISO week, `YYYY-Www`.
 *   - `month` → `YYYY-MM`.
 */
export function bucketKeyForDate(
  targetDate: string,
  grouping: WorkloadGrouping
): string {
  const [yearStr, monthStr, dayStr] = targetDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  switch (grouping) {
    case "day":
      return targetDate;
    case "month":
      return `${yearStr}-${monthStr}`;
    case "week":
      return isoWeekKey(year, month, day);
  }
}

/**
 * Merge `source` shop-product counts into `target` in place, summing shared
 * products and clamping the total to 0..100000.
 */
function mergeShopProductCounts(
  target: Record<string, number>,
  source: Record<string, number>
): void {
  for (const [productId, count] of Object.entries(source ?? {})) {
    target[productId] = clampCount((target[productId] ?? 0) + count);
  }
}

/**
 * Aggregate persisted workload snapshots into day/week/month buckets, grouped
 * per Clinic AND per Kitchen, summing veg/non-veg/egg counts and merging shop
 * product counts (Req 12.4). PURE — no IO.
 *
 * Empty input yields an empty result (a caller requesting a range with no rows
 * therefore sees a zeroed/empty set, Req 12.6, 13.3). Output is sorted
 * deterministically by clinic, then kitchen, then bucket.
 *
 * Validates: Requirements 12.4, 12.6, 13.3.
 */
export function aggregateSnapshots(
  rows: WorkloadSnapshot[],
  grouping: WorkloadGrouping
): WorkloadAggregate[] {
  const buckets = new Map<string, WorkloadAggregate>();

  for (const row of rows) {
    const bucket = bucketKeyForDate(row.target_date, grouping);
    const key = `${row.clinic_id}\u0000${row.kitchen_id}\u0000${bucket}`;

    let aggregate = buckets.get(key);
    if (!aggregate) {
      aggregate = {
        clinic_id: row.clinic_id,
        kitchen_id: row.kitchen_id,
        bucket,
        veg_count: 0,
        non_veg_count: 0,
        egg_count: 0,
        shop_product_counts: {},
      };
      buckets.set(key, aggregate);
    }

    aggregate.veg_count = clampCount(aggregate.veg_count + row.veg_count);
    aggregate.non_veg_count = clampCount(
      aggregate.non_veg_count + row.non_veg_count
    );
    aggregate.egg_count = clampCount(aggregate.egg_count + row.egg_count);
    mergeShopProductCounts(aggregate.shop_product_counts, row.shop_product_counts);
  }

  return [...buckets.values()].sort((a, b) => {
    if (a.clinic_id !== b.clinic_id) return a.clinic_id < b.clinic_id ? -1 : 1;
    if (a.kitchen_id !== b.kitchen_id)
      return a.kitchen_id < b.kitchen_id ? -1 : 1;
    return a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0;
  });
}

// ─── IO: snapshot derivation from the order stamp (Req 19.6) ───────────────────

/**
 * Derive a clinic's veg/non-veg/egg meal counts for a target date by counting
 * `delivery_orders` whose STAMPED `clinic_id` equals the clinic and whose
 * `delivery_date` equals the target date, grouped by meal-category code
 * (VEG → veg_count, CHICKEN → non_veg_count, EGG → egg_count). Counts are
 * clamped to 0..100000.
 *
 * Uses the order stamp — NOT the customer's current clinic — so attribution
 * stays stable when customers later move (Req 19.6).
 *
 * Validates: Requirements 11.4, 12.1, 19.6.
 */
export async function computeClinicMealCounts(
  clinicId: string,
  targetDate: string
): Promise<WorkloadMealCounts> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("delivery_orders")
    .select("meal_category_id, meal_categories(code)")
    .eq("clinic_id", clinicId)
    .eq("delivery_date", targetDate);

  if (error) {
    throw new Error(
      `Failed to derive meal counts for clinic ${clinicId} on ${targetDate}: ${error.message}`
    );
  }

  let veg = 0;
  let nonVeg = 0;
  let egg = 0;

  for (const row of data ?? []) {
    // Supabase may surface the embedded relation as an object or a 1-element array.
    const rel = (row as { meal_categories?: unknown }).meal_categories;
    const category = Array.isArray(rel) ? rel[0] : rel;
    const code = (category as { code?: string } | null | undefined)?.code;

    if (code === VEG_CODE) veg += 1;
    else if (code === NON_VEG_CODE) nonVeg += 1;
    else if (code === EGG_CODE) egg += 1;
  }

  return {
    veg_count: clampCount(veg),
    non_veg_count: clampCount(nonVeg),
    egg_count: clampCount(egg),
  };
}

/**
 * Derive a clinic's shop product counts for a target date as a `{productId:
 * count}` map. Shop purchases are `addon_orders` linked to that clinic's
 * delivery orders for the date (`addon_orders.delivery_order_id` →
 * `delivery_orders`); each `addon_order_items` line contributes its `quantity`
 * to the running total for its `product_id`. Totals are clamped to 0..100000.
 *
 * Like the meal counts, this derives off the immutable order stamp
 * (`delivery_orders.clinic_id`), so it is stable across later customer moves.
 *
 * Validates: Requirements 12.1, 19.6.
 */
export async function computeClinicShopProductCounts(
  clinicId: string,
  targetDate: string
): Promise<Record<string, number>> {
  const admin = createAdminClient();

  // 1. The clinic's stamped delivery orders for the date.
  const { data: orders, error: ordersError } = await admin
    .from("delivery_orders")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("delivery_date", targetDate);

  if (ordersError) {
    throw new Error(
      `Failed to load delivery orders for clinic ${clinicId} on ${targetDate}: ${ordersError.message}`
    );
  }

  const orderIds = (orders ?? [])
    .map((o) => (o as { id?: string }).id)
    .filter((id): id is string => Boolean(id));

  if (orderIds.length === 0) {
    return {};
  }

  // 2. Addon orders attached to those delivery orders, with their line items.
  const { data: addonOrders, error: addonError } = await admin
    .from("addon_orders")
    .select("delivery_order_id, addon_order_items(product_id, quantity)")
    .in("delivery_order_id", orderIds);

  if (addonError) {
    throw new Error(
      `Failed to load addon orders for clinic ${clinicId} on ${targetDate}: ${addonError.message}`
    );
  }

  const counts: Record<string, number> = {};
  for (const addonOrder of addonOrders ?? []) {
    const itemsRel = (addonOrder as { addon_order_items?: unknown })
      .addon_order_items;
    const items = Array.isArray(itemsRel)
      ? itemsRel
      : itemsRel
        ? [itemsRel]
        : [];

    for (const item of items) {
      const productId = (item as { product_id?: string }).product_id;
      if (!productId) continue;
      const quantity = (item as { quantity?: number }).quantity ?? 1;
      counts[productId] = (counts[productId] ?? 0) + quantity;
    }
  }

  return clampShopProductCounts(counts);
}

// ─── IO: persistence + statistics ──────────────────────────────────────────────

/**
 * Persist ONE finalized workload snapshot for a (clinic, kitchen, target_date)
 * combination, returning the new record's id on success (round-trip
 * persistence). Meal counts and shop product counts are clamped to 0..100000
 * at this layer (Req 12.1) BEFORE persistence so a real DB CHECK constraint can
 * never reject an over-range count.
 *
 * Persistence is delegated to `snapshotRepository.insertSnapshot`, whose result
 * is the source of truth for duplicate detection: the DB unique constraint
 * `uq_snapshot_clinic_kitchen_date` makes finalize idempotent-by-rejection. A
 * duplicate (clinic, kitchen, target_date) surfaces as `{ ok: false,
 * duplicate: true }`, which is translated here into an "already exists" failure,
 * leaving the existing record unchanged (Req 12.2). Any unexpected persistence
 * error is surfaced as a failure result rather than thrown.
 *
 * Validates: Requirements 11.4, 12.1, 12.2.
 */
export async function finalizeWorkloadSnapshot(
  input: WorkloadSnapshotInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const result = await insertSnapshot({
      clinic_id: input.clinic_id,
      kitchen_id: input.kitchen_id,
      target_date: input.target_date,
      veg_count: clampCount(input.veg_count),
      non_veg_count: clampCount(input.non_veg_count),
      egg_count: clampCount(input.egg_count),
      shop_product_counts: clampShopProductCounts(input.shop_product_counts),
    });

    if (!result.ok) {
      // Duplicate (clinic, kitchen, target_date): the existing record is the
      // source of truth and is left unchanged (Req 12.2).
      return {
        success: false,
        error: `A workload snapshot already exists for clinic ${input.clinic_id}, kitchen ${input.kitchen_id}, and date ${input.target_date}.`,
      };
    }

    return { success: true, data: { id: result.snapshot.id } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to persist workload snapshot.",
    };
  }
}

/**
 * Read persisted workload snapshots whose `target_date` falls within
 * `[startDate, endDate]` and return them aggregated by the requested grouping,
 * per Clinic and per Kitchen (Req 12.4).
 *
 *   - Rejects an invalid range (start after end) with an error (Req 12.5).
 *   - An in-range request with no matching snapshots returns an empty/zeroed
 *     result set (Req 12.6, 13.3).
 *
 * Dates are `YYYY-MM-DD` strings; lexicographic comparison is a valid ordering
 * for that format.
 *
 * Validates: Requirements 12.4, 12.5, 12.6, 13.3.
 */
export async function getWorkloadStatistics(params: {
  startDate: string;
  endDate: string;
  grouping: WorkloadGrouping;
}): Promise<ActionResult<WorkloadAggregate[]>> {
  const { startDate, endDate, grouping } = params;

  // Req 12.5: reject an invalid range whose start is after its end.
  if (startDate > endDate) {
    return {
      success: false,
      error: "Invalid date range: the start date must be on or before the end date.",
    };
  }

  try {
    const rows = await listSnapshotsInRange(startDate, endDate);
    return { success: true, data: aggregateSnapshots(rows, grouping) };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read workload snapshots.",
    };
  }
}
