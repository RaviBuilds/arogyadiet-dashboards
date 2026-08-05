// src/repositories/dietitian/healthLogRepository.ts
// Data-access layer for the Health_Log write target (`health_logs`), the
// Health_Log read model (`v_health_log_timeline`), Self_Log adherence rows
// (`kit_daily_logs`) and Custom_Parameter label suggestions.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for Health_Log persistence and timeline reads. It applies NO business
// validation (that lives in `src/services/HealthLogService.ts`) and contains
// NO `'use server'` wrappers (those live in `src/actions/dietitian-actions/*`).
// Uses the service-role admin client, mirroring `src/repositories/clinic/`.
//
// `health_logs` carries a PARTIAL unique index —
//   (customer_profile_id, log_date) WHERE author_type = 'DIETITIAN'
// — so it cannot be targeted through PostgREST's `.upsert({ onConflict })`,
// which infers a conflict target from column names alone and cannot express
// the index's WHERE predicate (Postgres requires the same predicate to be
// repeated on the `ON CONFLICT` clause for a partial index to be inferred).
// `upsertHealthLog` therefore performs the check-then-write itself: read the
// existing Dietitian_Log for the day, UPDATE it when found, otherwise INSERT;
// a 23505 raised by a concurrent INSERT on the same conflict target is caught
// and retried as an UPDATE, so two near-simultaneous submissions still resolve
// to exactly one row (Req 15.9, 15.11).
//
// Requirements: 11.12, 11.13, 12.7, 12.9, 15.9, 15.11, 16.3, 25.1, 25.2, 26.4

import { createAdminClient } from "@/lib/supabase/admin";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import type { CustomerCategory, ParameterValue } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Postgres SQLSTATE for a unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/** Shape of a `health_logs` row in the database (snake_case). */
export interface HealthLogRow {
  id: string;
  customer_profile_id: string;
  log_date: string;
  author_type: "DIETITIAN" | "CUSTOMER";
  author_user_id: string;
  customer_category: CustomerCategory;
  parameters: Record<string, ParameterValue>;
  custom_parameters: unknown;
  closing_comment: string;
  submitted_at: string;
  submission_date_ist: string;
  clinic_id: string | null;
  franchise_id: string | null;
  /** The owning Report_Card, or `null` for a log outside every Logging_Window. */
  report_card_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for creating or updating a Dietitian_Log via {@link upsertHealthLog}. */
export interface UpsertHealthLogInput {
  customer_profile_id: string;
  log_date: string;
  author_user_id: string;
  customer_category: CustomerCategory;
  parameters: Record<string, ParameterValue>;
  custom_parameters: unknown;
  closing_comment: string;
  /** Submission timestamp, ISO 8601 (Req 15.12). */
  submitted_at: string;
  /** IST calendar date of submission, YYYY-MM-DD (Req 15.12). */
  submission_date_ist: string;
  clinic_id?: string | null;
  franchise_id?: string | null;
  /**
   * The Report_Card whose Logging_Window contains `log_date`
   * (report-card-lifecycle). `null` when the date falls outside every window —
   * such a log belongs to no report. Optional so pre-feature callers still
   * compile; omitting it leaves the column untouched on an UPDATE.
   */
  report_card_id?: string | null;
}

/**
 * One row of the Health_Log read model, `v_health_log_timeline` (Req 26.4).
 * `source` names the underlying table the row came from; legacy sources never
 * carry an `author_user_id` because those tables record no author.
 */
export interface TimelineRow {
  id: string;
  customer_profile_id: string;
  log_date: string;
  author_type: "DIETITIAN" | "CUSTOMER";
  author_user_id: string | null;
  source:
    | "health_logs"
    | "admin_health_logs"
    | "customer_health_logs"
    | "kit_daily_logs";
  parameters: Record<string, ParameterValue>;
  custom_parameters: unknown;
  closing_comment: string | null;
  submitted_at: string;
}

/**
 * One `kit_daily_logs` row read for the Self_Log adherence panel (Req 16.3).
 * Only the columns the adherence panel needs — the timeline itself is read
 * through `v_health_log_timeline`, not this function.
 */
export interface KitAdherenceLogRow {
  id: string;
  log_date: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
}

/**
 * One `kit_daily_logs` row with every field the customer can submit from the
 * KIT day-log dialog, for the Dietitian's day-by-day Self_Log view
 * (Req 25.6 — read-only reference data).
 */
export interface KitSelfLogDayRow {
  log_date: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  weight_kg: number | string | null;
  step_count: number | null;
  physical_activity_minutes: number | null;
  physical_activity_name: string | null;
  water_intake_liters: number | string | null;
  buttermilk_intake: string | null;
  fat_consumption: string | null;
  main_dish: string | null;
  protein_curry: string | null;
  veg_curry: string | null;
  soup_name_qty: string | null;
  eggs_count: number | null;
  salads_qty: string | null;
}

/** The governing KIT Tracker window plus every Self_Log recorded inside it. */
export interface KitSelfLogTrackerRows {
  subscriptionId: string;
  /** Customer-confirmed receipt date — the tracker start, or `null` if unconfirmed. */
  receivedDate: string | null;
  /** Trigger-maintained tracker end date, or `null` before receipt. */
  trackerEndDate: string | null;
  durationDays: number | null;
  totalSkippedDays: number;
  status: string;
  logs: KitSelfLogDayRow[];
}

const KIT_SELF_LOG_COLUMNS =
  "log_date, status, weight_kg, step_count, physical_activity_minutes, physical_activity_name, water_intake_liters, buttermilk_intake, fat_consumption, main_dish, protein_curry, veg_curry, soup_name_qty, eggs_count, salads_qty";

const HEALTH_LOG_COLUMNS =
  "id, customer_profile_id, log_date, author_type, author_user_id, customer_category, parameters, custom_parameters, closing_comment, submitted_at, submission_date_ist, clinic_id, franchise_id, report_card_id, created_at, updated_at";

const TIMELINE_COLUMNS =
  "id, customer_profile_id, log_date, author_type, author_user_id, source, parameters, custom_parameters, closing_comment, submitted_at";

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create or update the Dietitian_Log for a Customer_Record and log date.
 *
 * Performs a check-then-write against the `(customer_profile_id, log_date)
 * WHERE author_type = 'DIETITIAN'` conflict target: an existing row is
 * UPDATEd in place (Req 15.9's same-day edit path, Req 15.11's at-most-one
 * rule), otherwise a new row is INSERTed. A unique-violation raised by a
 * concurrent INSERT on the same target is treated as "someone else just
 * created it" and retried once as an UPDATE, so the function is safe under
 * concurrent submission without needing a database-side upsert function.
 *
 * `author_type` is always persisted as `'DIETITIAN'` — this repository is the
 * single write path for Dietitian_Logs; Self_Logs are written by the
 * Customer_Portal directly into the legacy tables (Req 25.4, 25.5) and never
 * through this function.
 *
 * Req 11.12, 11.13, 15.9, 15.11
 */
export async function upsertHealthLog(
  input: UpsertHealthLogInput
): Promise<HealthLogRow> {
  const admin = createAdminClient();

  const { data: existing, error: findError } = await admin
    .from("health_logs")
    .select("id")
    .eq("customer_profile_id", input.customer_profile_id)
    .eq("log_date", input.log_date)
    .eq("author_type", "DIETITIAN")
    .maybeSingle();

  if (findError) {
    throw new Error(
      `Failed to look up existing dietitian log for customer ${input.customer_profile_id} on ${input.log_date}: ${findError.message}`
    );
  }

  if (existing) {
    return updateHealthLogById((existing as { id: string }).id, input);
  }

  const { data, error } = await admin
    .from("health_logs")
    .insert({
      customer_profile_id: input.customer_profile_id,
      log_date: input.log_date,
      author_type: "DIETITIAN",
      author_user_id: input.author_user_id,
      customer_category: input.customer_category,
      parameters: input.parameters,
      custom_parameters: input.custom_parameters,
      closing_comment: input.closing_comment,
      submitted_at: input.submitted_at,
      submission_date_ist: input.submission_date_ist,
      clinic_id: input.clinic_id ?? null,
      franchise_id: input.franchise_id ?? null,
      report_card_id: input.report_card_id ?? null,
    })
    .select(HEALTH_LOG_COLUMNS)
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // A concurrent submission won the race and inserted first. Re-read and
      // update that row instead of surfacing a spurious failure.
      const { data: winner, error: refetchError } = await admin
        .from("health_logs")
        .select("id")
        .eq("customer_profile_id", input.customer_profile_id)
        .eq("log_date", input.log_date)
        .eq("author_type", "DIETITIAN")
        .single();

      if (refetchError || !winner) {
        throw new Error(
          `Failed to resolve concurrent dietitian log write for customer ${input.customer_profile_id} on ${input.log_date}: ${
            refetchError?.message ?? "row not found after conflict"
          }`
        );
      }

      return updateHealthLogById((winner as { id: string }).id, input);
    }

    throw new Error(
      `Failed to insert dietitian log for customer ${input.customer_profile_id} on ${input.log_date}: ${error.message}`
    );
  }

  return data as HealthLogRow;
}

/** Shared UPDATE path used by both branches of {@link upsertHealthLog}. */
async function updateHealthLogById(
  id: string,
  input: UpsertHealthLogInput
): Promise<HealthLogRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_logs")
    .update({
      author_user_id: input.author_user_id,
      customer_category: input.customer_category,
      parameters: input.parameters,
      custom_parameters: input.custom_parameters,
      closing_comment: input.closing_comment,
      submitted_at: input.submitted_at,
      submission_date_ist: input.submission_date_ist,
      clinic_id: input.clinic_id ?? null,
      franchise_id: input.franchise_id ?? null,
      // Backfills the link on a pre-feature log the first time it is edited,
      // while `?? null` keeps an already-linked row correct.
      report_card_id: input.report_card_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(HEALTH_LOG_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update dietitian log ${id}: ${error.message}`);
  }

  return data as HealthLogRow;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read a Customer_Record's full Health_Log timeline from
 * `v_health_log_timeline` — Dietitian_Logs and Self_Logs from every source
 * table, in one date-ordered set (Req 25.1, 25.2, 25.3, 26.4).
 *
 * Ordered ascending by `log_date` then `submitted_at`, i.e. oldest first, so
 * callers building a trend series (Report_Card) or a chronological timeline
 * do not need to re-sort; a caller that wants newest-first (e.g. a reverse-
 * chronological comment history) reverses the returned array.
 */
export async function getHealthLogTimeline(
  customerProfileId: string
): Promise<TimelineRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("v_health_log_timeline")
    .select(TIMELINE_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .order("log_date", { ascending: true })
    .order("submitted_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get health log timeline for customer ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as TimelineRow[];
}

/**
 * Read the Health_Log timeline for ONE Report_Card's Logging_Window
 * (report-card-lifecycle Phase 2) — the per-subscription / per-stay slice of
 * the customer-wide {@link getHealthLogTimeline}.
 *
 * WHY THIS FILTERS BY WINDOW AND NOT BY `report_card_id`:
 * `health_logs.report_card_id` exists, but the other three sources unioned into
 * `v_health_log_timeline` — `admin_health_logs`, `customer_health_logs` and
 * `kit_daily_logs` — have no such column and never will; they predate the
 * feature and are read-only legacy tables. Filtering on `report_card_id` would
 * therefore silently drop every legacy reading from a report, which is exactly
 * the historical data a report for an older subscription/stay is made of.
 * The Report_Card's window is the durable, source-agnostic boundary.
 *
 * `report_card_id` remains the right key for the WRITE gate, which only ever
 * concerns `health_logs` rows.
 *
 * Bounds are inclusive on both ends, matching the Logging_Window definition.
 * Ordered oldest-first, like {@link getHealthLogTimeline}.
 */
export async function getHealthLogTimelineForWindow(
  customerProfileId: string,
  windowStart: string,
  windowEnd: string
): Promise<TimelineRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("v_health_log_timeline")
    .select(TIMELINE_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .gte("log_date", windowStart)
    .lte("log_date", windowEnd)
    .order("log_date", { ascending: true })
    .order("submitted_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get health log timeline for customer ${customerProfileId} in ${windowStart}..${windowEnd}: ${error.message}`
    );
  }

  return (data ?? []) as TimelineRow[];
}

/**
 * Read raw `kit_daily_logs` rows for one KIT subscription, optionally bounded
 * to a Logging_Window, for the Self_Log adherence panel (Req 16.3).
 *
 * Returns only `id`, `log_date` and `status` — the counts (Skipped_Self_Log
 * count, missing-date count) are derived by the service layer against the
 * customer's Logging_Window and Paused_Days, not by this function. Ordered
 * ascending by `log_date`.
 */
export async function getKitAdherenceLogs(
  subscriptionId: string,
  windowStart?: string,
  windowEnd?: string
): Promise<KitAdherenceLogRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("kit_daily_logs")
    .select("id, log_date, status")
    .eq("subscription_id", subscriptionId);

  if (windowStart) query = query.gte("log_date", windowStart);
  if (windowEnd) query = query.lte("log_date", windowEnd);

  const { data, error } = await query.order("log_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get self-log adherence rows for subscription ${subscriptionId}: ${error.message}`
    );
  }

  return (data ?? []) as KitAdherenceLogRow[];
}

/**
 * Read the governing KIT Tracker window for one Customer_Record together with
 * every Self_Log the customer recorded inside it, for the Dietitian's
 * day-by-day Self_Log view on the Log Customer page (Req 16.3, 25.6).
 *
 * The governing KIT subscription is the customer's most recently created `KIT`
 * `subscriptions` row — the same "latest wins" rule
 * `cadenceRepository.getGoverningRecords` applies — so the view always tracks
 * the kit the cadence slots were derived from. Returns `null` when the
 * customer holds no KIT subscription at all.
 *
 * Read-only: there is no companion write function anywhere in this repository
 * for `kit_daily_logs` (Req 25.4).
 */
export async function getKitSelfLogTracker(
  customerProfileId: string
): Promise<KitSelfLogTrackerRows | null> {
  const admin = createAdminClient();

  const { data: subscription, error: subError } = await admin
    .from("subscriptions")
    .select(
      "id, status, kit_received_date, kit_tracker_end_date, kit_duration_days, kit_total_skipped_days"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) {
    throw new Error(
      `Failed to resolve the KIT subscription for customer ${customerProfileId}: ${subError.message}`
    );
  }

  if (!subscription) return null;

  const { data: logs, error: logsError } = await admin
    .from("kit_daily_logs")
    .select(KIT_SELF_LOG_COLUMNS)
    .eq("subscription_id", subscription.id)
    .order("log_date", { ascending: true });

  if (logsError) {
    throw new Error(
      `Failed to load KIT self-logs for subscription ${subscription.id}: ${logsError.message}`
    );
  }

  return {
    subscriptionId: subscription.id as string,
    receivedDate: (subscription.kit_received_date as string | null) ?? null,
    trackerEndDate: (subscription.kit_tracker_end_date as string | null) ?? null,
    durationDays: (subscription.kit_duration_days as number | null) ?? null,
    totalSkippedDays: (subscription.kit_total_skipped_days as number | null) ?? 0,
    status: (subscription.status as string) ?? "",
    logs: (logs ?? []) as unknown as KitSelfLogDayRow[],
  };
}

/**
 * Read the Self_Log(s) recorded for one Customer_Record on one log date,
 * read-only, for the SelfLogReferencePanel beside the Dietitian's log form
 * (Req 25.1, 25.2, 25.6). Reads from `v_health_log_timeline` — the same
 * read-only `UNION ALL` view `getHealthLogTimeline` reads — filtered to
 * `author_type = 'CUSTOMER'` so a Dietitian_Log for the same date is never
 * returned here.
 *
 * There is no corresponding write function: this repository (and this
 * feature) has no writable path to a Self_Log (Req 25.4).
 */
export async function getSelfLogForDate(
  customerProfileId: string,
  logDate: string
): Promise<TimelineRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("v_health_log_timeline")
    .select(TIMELINE_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .eq("log_date", logDate)
    .eq("author_type", "CUSTOMER");

  if (error) {
    throw new Error(
      `Failed to get self-log for customer ${customerProfileId} on ${logDate}: ${error.message}`
    );
  }

  return (data ?? []) as TimelineRow[];
}

/**
 * Distinct Custom_Parameter labels previously used on a customer's
 * Dietitian_Logs, in ascending alphabetical order — offered as suggestions
 * when a Dietitian opens the log form (Req 12.9).
 *
 * Reads every Dietitian_Log's `custom_parameters` column and de-duplicates in
 * application code: Custom_Parameters live in a JSONB array with no
 * supporting index, and the per-customer row count is small, so this avoids a
 * bespoke SQL function for a low-volume, non-critical-path read. Labels are
 * de-duplicated by exact string; `deserializeCustomParameters` is the same
 * lenient reader the timeline uses, so a malformed legacy row is skipped
 * rather than failing the whole read.
 */
export async function getCustomParameterLabelSuggestions(
  customerProfileId: string
): Promise<string[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_logs")
    .select("custom_parameters")
    .eq("customer_profile_id", customerProfileId)
    .eq("author_type", "DIETITIAN");

  if (error) {
    throw new Error(
      `Failed to get custom parameter suggestions for customer ${customerProfileId}: ${error.message}`
    );
  }

  const labels = new Set<string>();
  for (const row of data ?? []) {
    const raw = (row as { custom_parameters: unknown }).custom_parameters;
    for (const parameter of deserializeCustomParameters(raw)) {
      labels.add(parameter.label);
    }
  }

  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}
