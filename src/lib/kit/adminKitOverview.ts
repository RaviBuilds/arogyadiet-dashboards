// src/lib/kit/adminKitOverview.ts
//
// Pure mapping + classification helpers for the admin Customer 360 KIT tab.
//
// LAYERING: no Supabase, no React, no server-only APIs — everything here is a
// deterministic transform over rows already fetched by
// `kitLifecycleRepository.getAdminKitRecordRows()`. Keeping it pure makes the
// lifecycle grouping rules (which kit is "current", which is "incoming", what
// counts as history) independently verifiable.

import type {
  AdminKitDailyLog,
  AdminKitOverview,
  AdminKitRecord,
} from "@/types/kitLifecycle";

/** Raw row shape returned by the repository for one KIT subscription. */
export interface AdminKitRecordRow {
  id: string;
  subscription_code: string | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
  kit_duration_days: number | null;
  kit_received_date: string | null;
  kit_tracker_end_date: string | null;
  kit_total_skipped_days: number | null;
  created_at: string | null;
  kit_products: { name: string | null; base_price: number | null; tax_rate: number | null } | null;
  kit_shipping_info: Array<{
    courier_partner: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    created_at: string | null;
  }>;
  kit_daily_logs: Array<{
    log_date: string;
    status: string;
    physical_activity_minutes: number | null;
    physical_activity_name: string | null;
    weight_kg: number | null;
    step_count: number | null;
    water_intake_liters: number | null;
    buttermilk_intake: string | null;
    fat_consumption: string | null;
    main_dish: string | null;
    protein_curry: string | null;
    veg_curry: string | null;
    soup_name_qty: string | null;
    eggs_count: number | null;
    salads_qty: string | null;
  }>;
}

/** Coerce a Postgres numeric (delivered as a string) to a number. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map a repository row to the display record used by the admin KIT tab.
 *
 * Defensive about shapes Supabase can hand back: to-many embeds may be absent,
 * numeric columns may be null, and a subscription may legitimately have no
 * shipping row yet (kit created but courier not entered).
 */
export function mapAdminKitRecord(row: AdminKitRecordRow): AdminKitRecord {
  const logs: AdminKitDailyLog[] = (row.kit_daily_logs ?? [])
    .map((log) => ({
      log_date: log.log_date,
      // Anything that isn't an explicit skip is treated as taken, matching the
      // DB check constraint (only these two values are storable).
      status:
        log.status === "FOOD_SKIPPED"
          ? ("FOOD_SKIPPED" as const)
          : ("FOOD_TAKEN" as const),
      physical_activity_minutes: log.physical_activity_minutes ?? null,
      physical_activity_name: log.physical_activity_name ?? null,
      // numeric columns arrive as strings over PostgREST — coerce so the UI can
      // format them and the export writes numbers, not text.
      weight_kg: toNumber(log.weight_kg),
      step_count: log.step_count ?? null,
      water_intake_liters: toNumber(log.water_intake_liters),
      buttermilk_intake: log.buttermilk_intake ?? null,
      fat_consumption: log.fat_consumption ?? null,
      main_dish: log.main_dish ?? null,
      protein_curry: log.protein_curry ?? null,
      veg_curry: log.veg_curry ?? null,
      soup_name_qty: log.soup_name_qty ?? null,
      eggs_count: log.eggs_count ?? null,
      salads_qty: log.salads_qty ?? null,
    }))
    .sort((a, b) => a.log_date.localeCompare(b.log_date));

  // Newest shipping row wins — the Shipping tab upserts per subscription, so
  // there is normally exactly one, but ordering keeps this stable regardless.
  const shippingRows = [...(row.kit_shipping_info ?? [])].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const shippingRow = shippingRows[0] ?? null;

  return {
    subscriptionId: row.id,
    subscriptionCode: row.subscription_code ?? null,
    kitProductName: row.kit_products?.name ?? "Unknown Product",
    kitDurationDays: row.kit_duration_days ?? 0,
    status: row.status,
    startsOn: row.starts_on ?? null,
    endsOn: row.effective_end_on ?? row.ends_on ?? null,
    basePrice: toNumber(row.kit_products?.base_price),
    taxRate: toNumber(row.kit_products?.tax_rate),
    kitReceivedDate: row.kit_received_date ?? null,
    kitTrackerEndDate: row.kit_tracker_end_date ?? null,
    kitTotalSkippedDays: row.kit_total_skipped_days ?? 0,
    createdAt: row.created_at ?? null,
    shipping:
      shippingRow && shippingRow.courier_partner
        ? {
            courierPartner: shippingRow.courier_partner,
            trackingNumber: shippingRow.tracking_number ?? "",
            trackingUrl: shippingRow.tracking_url ?? null,
            shippedAt: shippingRow.shipped_at ?? null,
            deliveredAt: shippingRow.delivered_at ?? null,
          }
        : null,
    dailyLogs: logs,
    daysTaken: logs.filter((log) => log.status === "FOOD_TAKEN").length,
    daysSkipped: logs.filter((log) => log.status === "FOOD_SKIPPED").length,
  };
}

/**
 * Newest-first ordering. `created_at` is the authoritative order (a PENDING kit
 * has no `starts_on` yet, so sorting on start date would bury the newest kit).
 */
export function sortKitRecordsNewestFirst(
  records: AdminKitRecord[],
): AdminKitRecord[] {
  return [...records].sort((a, b) => {
    const aKey = a.createdAt ?? a.startsOn ?? "";
    const bKey = b.createdAt ?? b.startsOn ?? "";
    return bKey.localeCompare(aKey);
  });
}

/**
 * Group KIT records by lifecycle role for the admin KIT tab.
 *
 * Rules:
 *   - `current`  = newest ACTIVE kit (the one being tracked).
 *   - `incoming` = newest PENDING kit (dispatched, not started by customer).
 *   - `history`  = everything else, newest first. Closed kits land here, and so
 *     do any surplus ACTIVE/PENDING duplicates — data that should not exist,
 *     but which must stay visible rather than silently disappear.
 */
export function buildAdminKitOverview(
  records: AdminKitRecord[],
): AdminKitOverview {
  const ordered = sortKitRecordsNewestFirst(records);

  const current = ordered.find((record) => record.status === "ACTIVE") ?? null;
  const incoming = ordered.find((record) => record.status === "PENDING") ?? null;

  const history = ordered.filter(
    (record) =>
      record.subscriptionId !== current?.subscriptionId &&
      record.subscriptionId !== incoming?.subscriptionId,
  );

  return { current, incoming, history };
}

/**
 * The KIT whose courier details the Shipping tab should manage: the newest
 * dispatch first, then the running kit, then the most recent closed kit.
 */
export function resolveShippingTarget(
  overview: AdminKitOverview,
): AdminKitRecord | null {
  return overview.incoming ?? overview.current ?? overview.history[0] ?? null;
}
