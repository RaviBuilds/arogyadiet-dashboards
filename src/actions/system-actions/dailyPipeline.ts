"use server";

// src/actions/system-actions/dailyPipeline.ts
// Central daily automation pipeline (core-clinic-architecture, Requirement 11).
//
// Runs the four steps in strict sequence (Req 11.6):
//   1. order creation   → generateDailyOrders(targetDate)
//   2. product linking  → linkDailyShopPurchases(targetDate)
//   3. snapshotting     → one finalized workload snapshot per Core Clinic
//   4. routing          → executeAutomatedDispatch(targetDate)
//
// Halt-on-failure (Req 11.7): if a step fails the pipeline STOPS, the outputs
// of all previously completed steps are preserved in the returned
// `PipelineResult.steps`, and the failing step is recorded in `failedStep`.
//
// Retry policy (Req 11.8): the order-creation and product-linking steps retry
// up to 3 times before halting. Snapshotting and routing do not retry.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeClinicMealCounts,
  computeClinicShopProductCounts,
  finalizeWorkloadSnapshot,
} from "@/lib/clinic/workload";
import { purchaseAttributionDate } from "@/lib/dates/ist";
import { generateDailyOrders } from "./orderGeneration";
import { executeAutomatedDispatch } from "./routeEngine";

/** The four sequential pipeline steps (Req 11.6). */
export type PipelineStepName =
  | "orderCreation"
  | "productLinking"
  | "snapshotting"
  | "routing";

/** Order-creation step outcome (wraps generateDailyOrders). */
export interface OrderCreationOutcome {
  success: boolean;
  attempts: number;
  inserted?: number;
  skipped?: number;
  error?: string;
}

/** Product-linking step outcome (wraps linkDailyShopPurchases). */
export interface ProductLinkingOutcome {
  success: boolean;
  attempts: number;
  linked?: number;
  error?: string;
}

/** Per-clinic snapshot result within the snapshotting step. */
export interface ClinicSnapshotOutcome {
  clinicId: string;
  status: "finalized" | "already_finalized" | "failed";
  snapshotId?: string;
  error?: string;
}

/** Snapshotting step outcome (one snapshot per Core Clinic). */
export interface SnapshottingOutcome {
  success: boolean;
  clinicsProcessed: number;
  snapshotsFinalized: number;
  alreadyFinalized: number;
  perClinic: ClinicSnapshotOutcome[];
  error?: string;
}

/** Routing step outcome (wraps executeAutomatedDispatch). */
export interface RoutingOutcome {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Structured result of a pipeline run. `steps` carries every step that ran (in
 * order); on a halt the last successful step's output is preserved and
 * `failedStep` names the step that failed (Req 11.7).
 */
export interface PipelineResult {
  success: boolean;
  targetDate: string;
  failedStep?: PipelineStepName;
  steps: {
    orderCreation?: OrderCreationOutcome;
    productLinking?: ProductLinkingOutcome;
    snapshotting?: SnapshottingOutcome;
    routing?: RoutingOutcome;
  };
}

/** Up to 3 retries before halting for retryable steps (Req 11.8). */
const MAX_STEP_RETRIES = 3;

/**
 * Run a step function, retrying up to `maxRetries` times while it reports
 * failure. Returns the final result and the total number of attempts made.
 */
async function runWithRetries<T extends { success: boolean }>(
  fn: () => Promise<T>,
  maxRetries: number,
): Promise<{ result: T; attempts: number }> {
  let result = await fn();
  let attempts = 1;
  while (!result.success && attempts <= maxRetries) {
    result = await fn();
    attempts += 1;
  }
  return { result, attempts };
}

/**
 * Product-linking step (Req 11.3). Minimal pass: it confirms the day's shop
 * purchases (`addon_orders`) for the target delivery date and tallies them by
 * their IST purchase-day attribution window via {@link purchaseAttributionDate}
 * (a purchase at 12:01 AM IST attributes to that day; 11:59 PM IST to the same
 * day). The AUTHORITATIVE per-clinic shop product counts are derived later, at
 * snapshot time, by `computeClinicShopProductCounts` in workload.ts off the
 * immutable order clinic stamp — so this step only verifies the data is present
 * and reports a count; it performs no destructive work.
 */
async function linkDailyShopPurchases(
  targetDate: string,
): Promise<{ success: boolean; linked?: number; error?: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("addon_orders")
    .select("id, created_at, target_delivery_date")
    .eq("target_delivery_date", targetDate)
    .in("status", ["PAID", "DELIVERED", "COMPLETED"]);

  if (error) {
    return { success: false, error: error.message };
  }

  // Tally purchases by their IST attribution day (Req 11.3 semantics). The
  // breakdown is informational; `linked` is the total confirmed for the date.
  let linked = 0;
  const attributionByDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const createdAt = (row as { created_at?: string | null }).created_at;
    const attributionDay = createdAt
      ? purchaseAttributionDate(createdAt)
      : targetDate;
    attributionByDay[attributionDay] = (attributionByDay[attributionDay] ?? 0) + 1;
    linked += 1;
  }

  return { success: true, linked };
}

/**
 * Snapshotting step (Req 11.4): produce exactly one finalized workload snapshot
 * per Core Clinic (clinics where `franchise_id IS NULL`). For each clinic it
 * computes meal counts (`computeClinicMealCounts`) and shop product counts
 * (`computeClinicShopProductCounts`) off the immutable order stamp and calls
 * `finalizeWorkloadSnapshot`. A duplicate (already finalized for the
 * clinic/kitchen/date) is treated as already-done and the step continues; any
 * other error halts the step.
 */
async function runSnapshotting(targetDate: string): Promise<SnapshottingOutcome> {
  const admin = createAdminClient();

  const { data: coreClinics, error } = await admin
    .from("clinics")
    .select("id, kitchen_id")
    .is("franchise_id", null);

  if (error) {
    return {
      success: false,
      clinicsProcessed: 0,
      snapshotsFinalized: 0,
      alreadyFinalized: 0,
      perClinic: [],
      error: `Failed to load core clinics: ${error.message}`,
    };
  }

  const clinics = (coreClinics ?? []) as { id: string; kitchen_id: string }[];
  const perClinic: ClinicSnapshotOutcome[] = [];
  let snapshotsFinalized = 0;
  let alreadyFinalized = 0;

  for (const clinic of clinics) {
    try {
      const meals = await computeClinicMealCounts(clinic.id, targetDate);
      const shopProductCounts = await computeClinicShopProductCounts(
        clinic.id,
        targetDate,
      );

      const finalizeResult = await finalizeWorkloadSnapshot({
        clinic_id: clinic.id,
        kitchen_id: clinic.kitchen_id,
        target_date: targetDate,
        veg_count: meals.veg_count,
        non_veg_count: meals.non_veg_count,
        egg_count: meals.egg_count,
        shop_product_counts: shopProductCounts,
      });

      if (finalizeResult.success) {
        snapshotsFinalized += 1;
        perClinic.push({
          clinicId: clinic.id,
          status: "finalized",
          snapshotId: finalizeResult.data.id,
        });
        continue;
      }

      // A duplicate snapshot is not a hard failure (Req 12.2) — already done.
      if (/already exists/i.test(finalizeResult.error)) {
        alreadyFinalized += 1;
        perClinic.push({ clinicId: clinic.id, status: "already_finalized" });
        continue;
      }

      // Any other persistence error halts the snapshotting step.
      perClinic.push({
        clinicId: clinic.id,
        status: "failed",
        error: finalizeResult.error,
      });
      return {
        success: false,
        clinicsProcessed: perClinic.length,
        snapshotsFinalized,
        alreadyFinalized,
        perClinic,
        error: finalizeResult.error,
      };
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Unknown snapshotting error";
      perClinic.push({ clinicId: clinic.id, status: "failed", error: message });
      return {
        success: false,
        clinicsProcessed: perClinic.length,
        snapshotsFinalized,
        alreadyFinalized,
        perClinic,
        error: message,
      };
    }
  }

  return {
    success: true,
    clinicsProcessed: clinics.length,
    snapshotsFinalized,
    alreadyFinalized,
    perClinic,
  };
}

/**
 * Routing step (Req 11.5): run the automated per-clinic dispatch. Normalizes
 * the existing dispatch return ({ error } | { success, message, stats }) into a
 * uniform {@link RoutingOutcome}.
 */
async function runRouting(targetDate: string): Promise<RoutingOutcome> {
  const dispatch = await executeAutomatedDispatch(targetDate);

  if (dispatch && "error" in dispatch && dispatch.error) {
    return { success: false, error: dispatch.error };
  }

  const message =
    dispatch && "message" in dispatch ? dispatch.message : undefined;
  return { success: true, message };
}

/**
 * Orchestrate the daily pipeline for `targetDate`, running order creation →
 * product linking → snapshotting → routing in sequence (Req 11.6). Halts at the
 * first failing step, preserving completed steps' output and recording the
 * failing step (Req 11.7). Order-creation and product-linking retry up to 3
 * times before halting (Req 11.8); snapshotting and routing do not retry.
 */
export async function runDailyPipeline(
  targetDate: string,
): Promise<PipelineResult> {
  const result: PipelineResult = { success: false, targetDate, steps: {} };

  // 1. Order creation (retryable).
  const orderRun = await runWithRetries(
    () => generateDailyOrders(targetDate),
    MAX_STEP_RETRIES,
  );
  result.steps.orderCreation = {
    success: orderRun.result.success,
    attempts: orderRun.attempts,
    inserted: orderRun.result.inserted,
    skipped: orderRun.result.skipped,
    error: orderRun.result.error,
  };
  if (!orderRun.result.success) {
    result.failedStep = "orderCreation";
    return result;
  }

  // 2. Product linking (retryable).
  const linkRun = await runWithRetries(
    () => linkDailyShopPurchases(targetDate),
    MAX_STEP_RETRIES,
  );
  result.steps.productLinking = {
    success: linkRun.result.success,
    attempts: linkRun.attempts,
    linked: linkRun.result.linked,
    error: linkRun.result.error,
  };
  if (!linkRun.result.success) {
    result.failedStep = "productLinking";
    return result;
  }

  // 3. Snapshotting (no retry).
  const snapshotting = await runSnapshotting(targetDate);
  result.steps.snapshotting = snapshotting;
  if (!snapshotting.success) {
    result.failedStep = "snapshotting";
    return result;
  }

  // 4. Routing (no retry).
  const routing = await runRouting(targetDate);
  result.steps.routing = routing;
  if (!routing.success) {
    result.failedStep = "routing";
    return result;
  }

  result.success = true;
  return result;
}
