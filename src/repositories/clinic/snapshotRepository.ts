// src/repositories/clinic/snapshotRepository.ts
// Data-access layer for the `workload_snapshots` table (core-clinic-architecture).
//
// LAYERING: Data-access ONLY. The finalize/aggregate business logic lives in
// src/lib/clinic/workload.ts; this layer just persists and reads rows. Uses the
// service-role admin client.
//
// Snapshots are persisted, immutable, and de-duplicated by the DB unique
// constraint `uq_snapshot_clinic_kitchen_date` (Req 12.2). The action/service
// layer translates a duplicate-insert error into an already-exists result.

import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkloadSnapshot, WorkloadSnapshotInput } from "@/types/clinic";

const SNAPSHOT_COLUMNS =
  "id, clinic_id, kitchen_id, target_date, veg_count, non_veg_count, egg_count, shop_product_counts";

/**
 * Postgres unique-violation SQLSTATE. Used so the service layer can detect a
 * duplicate (clinic, kitchen, target_date) finalize and return an
 * already-exists result rather than throwing (Req 12.2).
 */
export const UNIQUE_VIOLATION = "23505";

/**
 * Result of attempting to persist a snapshot. `duplicate` is `true` when the
 * (clinic, kitchen, target_date) combination already has a persisted snapshot;
 * the existing record is left unchanged (Req 12.2).
 */
export type InsertSnapshotResult =
  | { ok: true; snapshot: WorkloadSnapshot }
  | { ok: false; duplicate: true };

/**
 * Insert (finalize) a single workload snapshot. Returns `{ ok: false,
 * duplicate: true }` when a snapshot already exists for the
 * (clinic_id, kitchen_id, target_date) combination — the unique constraint is
 * the source of truth (Req 12.1, 12.2). Any other error is thrown.
 */
export async function insertSnapshot(
  input: WorkloadSnapshotInput
): Promise<InsertSnapshotResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workload_snapshots")
    .insert({
      clinic_id: input.clinic_id,
      kitchen_id: input.kitchen_id,
      target_date: input.target_date,
      veg_count: input.veg_count,
      non_veg_count: input.non_veg_count,
      egg_count: input.egg_count,
      shop_product_counts: input.shop_product_counts,
    })
    .select(SNAPSHOT_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, duplicate: true };
    }
    throw new Error(`Failed to insert workload snapshot: ${error.message}`);
  }
  if (!data) {
    throw new Error("Failed to insert workload snapshot: no row returned");
  }
  return { ok: true, snapshot: data as WorkloadSnapshot };
}

/**
 * Fetch the snapshot for a specific (clinic, kitchen, target_date), if any.
 * Returns `null` when none exists. Supports round-trip verification (Req 12.2).
 */
export async function getSnapshot(
  clinicId: string,
  kitchenId: string,
  targetDate: string
): Promise<WorkloadSnapshot | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workload_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("kitchen_id", kitchenId)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch snapshot for clinic ${clinicId}, kitchen ${kitchenId}, date ${targetDate}: ${error.message}`
    );
  }
  return (data as WorkloadSnapshot) ?? null;
}

/**
 * List persisted snapshots within an inclusive `[startDate, endDate]` range,
 * optionally filtered to a single clinic. Ordered by target_date. Feeds the
 * pure aggregation in src/lib/clinic/workload.ts (Req 12.4, 13.3) and the most
 * recent 30-day history view (Req 13.2). The action layer validates
 * `startDate <= endDate` (Req 12.5).
 */
export async function listSnapshotsInRange(
  startDate: string,
  endDate: string,
  clinicId?: string
): Promise<WorkloadSnapshot[]> {
  const admin = createAdminClient();
  let query = admin
    .from("workload_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .gte("target_date", startDate)
    .lte("target_date", endDate);

  if (clinicId) {
    query = query.eq("clinic_id", clinicId);
  }

  const { data, error } = await query.order("target_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list snapshots in range ${startDate}..${endDate}: ${error.message}`
    );
  }
  return (data ?? []) as WorkloadSnapshot[];
}

/**
 * Upsert a workload snapshot — insert if new or UPDATE the counts if a snapshot
 * already exists for the (clinic, kitchen, target_date) combination. This allows
 * re-running automations (e.g. dispatch) to refresh the persisted workload data.
 */
export async function upsertSnapshot(
  input: WorkloadSnapshotInput
): Promise<WorkloadSnapshot> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workload_snapshots")
    .upsert(
      {
        clinic_id: input.clinic_id,
        kitchen_id: input.kitchen_id,
        target_date: input.target_date,
        veg_count: input.veg_count,
        non_veg_count: input.non_veg_count,
        egg_count: input.egg_count,
        shop_product_counts: input.shop_product_counts,
      },
      { onConflict: "clinic_id,kitchen_id,target_date" }
    )
    .select(SNAPSHOT_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to upsert workload snapshot: ${error.message}`);
  }
  if (!data) {
    throw new Error("Failed to upsert workload snapshot: no row returned");
  }
  return data as WorkloadSnapshot;
}

/**
 * Count the number of snapshots referencing the given clinic. Supports
 * dependency-guarded clinic deletion (Req 14.5, 14.6).
 */
export async function countSnapshotsForClinic(clinicId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("workload_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (error) {
    throw new Error(
      `Failed to count snapshots for clinic ${clinicId}: ${error.message}`
    );
  }
  return count ?? 0;
}
