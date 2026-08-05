// src/repositories/dietitian/cadenceRepository.ts
// Feature: dietitian-management — the four batched Cadence_Engine queries.
//
// LAYERING: Data-access ONLY. This module performs the Supabase reads that
// feed `CadenceService` (`src/services/CadenceService.ts`, task 7.16), which
// assembles them into `CadenceInput` and delegates to the pure
// `computeCadence` (`src/lib/dietitian/cadence.ts`). It applies NO business
// validation and contains NO `'use server'` wrapper — mirrors
// `src/repositories/clinic/` and `src/repositories/stayRepository.ts`. Uses the
// service-role admin client, since Dietitian writes/reads route through the
// service layer's own scope assertion rather than RLS here.
//
// Batched queries regardless of list size, then pure computation (design
// "Cadence flow" sequence diagram):
//   1. getGoverningRecords          — governing subscription OR stay
//   2. getLastDietitianLogDates     — most recent DIETITIAN `log_date`
//   3. getPausedDatesSince          — Paused_Days after a cutoff
//   3b. getKitSkippedDatesSince     — KIT Skipped_Self_Log dates after a cutoff
//   3c. getNonEligibleDatesSince    — the union of 3 and 3b
//   4. getSelfLogDatesInWindow      — Self_Log dates in a window
//
// A missing governing subscription/stay is reported by omitting that
// customer's entry from the returned map — `CadenceService` treats a missing
// entry as non-`ACTIVE` rather than throwing (design "Error Handling").
//
// _Requirements: 14.3, 14.4, 14.9, 16.3, 17.1_

import { addDaysToISODate } from "@/lib/dates/ist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CustomerCategory } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// 1. Governing subscription or stay
// ---------------------------------------------------------------------------

/**
 * The Logging_Window and status of a customer's governing record — the
 * `subscriptions` row for `MEAL`/`KIT`, or the `stay_entries` row for
 * `ACCOMMODATION` (Req 14.3, 14.4, 14.9; glossary: Logging_Window).
 *
 * `windowEnd` is the raw (unclamped) end of the window; `computeCadence`
 * clamps it to `today` (Req 14.3).
 */
export interface GoverningRecord {
  customerProfileId: string;
  category: CustomerCategory;
  /** Subscription `starts_on` or stay `start_date`, YYYY-MM-DD. */
  windowStart: string;
  /** Subscription `effective_end_on`/`ends_on`, or the computed stay end date. */
  windowEnd: string;
  /** Subscription status, or stay status; anything other than `ACTIVE` zeroes the cadence counts (Req 14.7). */
  status: string;
  /**
   * The `subscriptions.id` (MEAL/KIT) or `stay_entries.id` (ACCOMMODATION) this
   * window came from (report-card-lifecycle Phase 2). The Report_Card is keyed
   * on this, so the write path can resolve which report a new log belongs to
   * without any date matching.
   */
  recordId: string;
  /** Which table `recordId` refers to — the Report_Card's `subject_type`. */
  subjectType: "SUBSCRIPTION" | "STAY";
}

interface SubscriptionRow {
  id: string;
  customer_profile_id: string;
  customer_category: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
  /** KIT only: the customer-confirmed package receipt date (tracker start). */
  kit_received_date: string | null;
  /** KIT only: receipt date + duration − 1 + skipped days (tracker end). */
  kit_tracker_end_date: string | null;
  created_at: string;
}

interface StayRow {
  id: string;
  customer_profile_id: string;
  start_date: string;
  total_nights: number;
  status: string;
  created_at: string;
}

/** Keeps the most recently created row per customer (governing = latest). */
function latestPerCustomer<
  T extends { customer_profile_id: string; created_at: string },
>(rows: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const existing = result.get(row.customer_profile_id);
    if (!existing || row.created_at > existing.created_at) {
      result.set(row.customer_profile_id, row);
    }
  }
  return result;
}

/**
 * Stay end date, inclusive: `start_date + (total_nights − 1)` days. Mirrors
 * `AccommodationService.computeEndDate` without a cross-layer import —
 * repositories do not depend on services.
 */
function computeStayEndDate(startDate: string, totalNights: number): string {
  return addDaysToISODate(startDate, totalNights - 1);
}

/**
 * Batched lookup of the governing subscription or stay for each customer in
 * `customerProfileIds`.
 *
 * For `MEAL`/`KIT`, the governing record is the customer's most recently
 * created `subscriptions` row. For `ACCOMMODATION`, the Customer_Category
 * still comes from the `subscriptions` row (Req 26.4/onboarding), but the
 * Logging_Window and status come from the customer's most recently created
 * `stay_entries` row instead, per the Logging_Window definition.
 *
 * A customer with no subscription row, or an `ACCOMMODATION` customer with no
 * stay row, is omitted from the returned map — the caller (`CadenceService`)
 * treats a missing entry as non-`ACTIVE` rather than throwing.
 *
 * Req 14.3, 14.4, 14.9
 */
export async function getGoverningRecords(
  customerProfileIds: readonly string[],
): Promise<Map<string, GoverningRecord>> {
  const result = new Map<string, GoverningRecord>();
  if (customerProfileIds.length === 0) return result;

  const admin = createAdminClient();

  const { data: subsData, error: subsError } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, starts_on, ends_on, effective_end_on, kit_received_date, kit_tracker_end_date, created_at",
    )
    .in("customer_profile_id", customerProfileIds);

  if (subsError) {
    throw new Error(
      `Failed to load governing subscriptions: ${subsError.message}`,
    );
  }

  const latestSubscriptions = latestPerCustomer(
    (subsData ?? []) as SubscriptionRow[],
  );

  // ACCOMMODATION's Logging_Window comes from the stay, not the subscription.
  const accommodationCustomerIds = [...latestSubscriptions.values()]
    .filter((sub) => sub.customer_category === "ACCOMMODATION")
    .map((sub) => sub.customer_profile_id);

  let latestStays = new Map<string, StayRow>();
  if (accommodationCustomerIds.length > 0) {
    const { data: staysData, error: staysError } = await admin
      .from("stay_entries")
      .select(
        "id, customer_profile_id, start_date, total_nights, status, created_at",
      )
      .in("customer_profile_id", accommodationCustomerIds);

    if (staysError) {
      throw new Error(`Failed to load governing stays: ${staysError.message}`);
    }

    latestStays = latestPerCustomer((staysData ?? []) as StayRow[]);
  }

  for (const sub of latestSubscriptions.values()) {
    const category = sub.customer_category as CustomerCategory;

    if (category === "ACCOMMODATION") {
      const stay = latestStays.get(sub.customer_profile_id);
      if (!stay) continue; // no governing stay — treated as non-ACTIVE by the caller
      result.set(sub.customer_profile_id, {
        customerProfileId: sub.customer_profile_id,
        category,
        windowStart: stay.start_date,
        windowEnd: computeStayEndDate(stay.start_date, stay.total_nights),
        status: stay.status,
        recordId: stay.id,
        subjectType: "STAY",
      });
      continue;
    }

    // KIT's Logging_Window is the KIT Tracker window, not the raw
    // subscription dates: a KIT plan only starts running the day the customer
    // confirms receipt (`kit_received_date`) and ends on the trigger-maintained
    // `kit_tracker_end_date`, which already accounts for skipped days. Those
    // columns are also the only dates a KIT row is guaranteed to carry —
    // `starts_on`/`ends_on` stay NULL until receipt is confirmed — so reading
    // `starts_on` alone left every KIT customer without a Logging_Window and
    // therefore without a single Log_Slot.
    const windowStart =
      category === "KIT"
        ? (sub.kit_received_date ?? sub.starts_on)
        : sub.starts_on;

    if (!windowStart) continue; // no Logging_Window start — treated as non-ACTIVE

    const windowEnd =
      category === "KIT"
        ? (sub.kit_tracker_end_date ??
          sub.effective_end_on ??
          sub.ends_on ??
          windowStart)
        : (sub.effective_end_on ?? sub.ends_on ?? windowStart);

    result.set(sub.customer_profile_id, {
      customerProfileId: sub.customer_profile_id,
      category,
      windowStart,
      windowEnd,
      status: sub.status,
      recordId: sub.id,
      subjectType: "SUBSCRIPTION",
    });
  }

  return result;
}

/**
 * EVERY Logging_Window a customer has ever had — one entry per MEAL/KIT
 * subscription and per accommodation stay, newest window first
 * (report-card-lifecycle Phase 2).
 *
 * {@link getGoverningRecords} deliberately collapses to the single most
 * recently created record, because the Cadence_Engine only ever cares about the
 * one currently in force. The Report_Card history needs the opposite: all of
 * them, including records whose report was never finished, so a Dietitian can
 * go back and complete an older subscription's report while a newer one runs.
 *
 * Window formulas are identical to `getGoverningRecords` — deliberately so, as
 * the two must never disagree about what period a record covers. Records with
 * no resolvable window start are omitted, mirroring that function.
 *
 * NOTE the KIT branch: an ACTIVE KIT subscription carries `starts_on = NULL`
 * until the customer confirms receipt, so its window exists only via
 * `kit_received_date`. Filtering on `starts_on` alone would silently drop live
 * KIT plans.
 */
export async function listLoggingWindowsForCustomer(
  customerProfileId: string,
): Promise<GoverningRecord[]> {
  const admin = createAdminClient();

  const { data: subsData, error: subsError } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, starts_on, ends_on, effective_end_on, kit_received_date, kit_tracker_end_date, created_at",
    )
    .eq("customer_profile_id", customerProfileId);

  if (subsError) {
    throw new Error(
      `Failed to load logging windows for customer ${customerProfileId}: ${subsError.message}`,
    );
  }

  const subs = (subsData ?? []) as SubscriptionRow[];
  const records: GoverningRecord[] = [];

  // The Customer_Category still comes from the subscription row even for
  // ACCOMMODATION, matching getGoverningRecords.
  const isAccommodationCustomer = subs.some(
    (sub) => sub.customer_category === "ACCOMMODATION",
  );

  for (const sub of subs) {
    const category = sub.customer_category as CustomerCategory;
    if (category === "ACCOMMODATION") continue; // handled via stay_entries below

    const windowStart =
      category === "KIT"
        ? (sub.kit_received_date ?? sub.starts_on)
        : sub.starts_on;
    if (!windowStart) continue;

    const windowEnd =
      category === "KIT"
        ? (sub.kit_tracker_end_date ??
          sub.effective_end_on ??
          sub.ends_on ??
          windowStart)
        : (sub.effective_end_on ?? sub.ends_on ?? windowStart);

    records.push({
      customerProfileId: sub.customer_profile_id,
      category,
      windowStart,
      windowEnd,
      status: sub.status,
      recordId: sub.id,
      subjectType: "SUBSCRIPTION",
    });
  }

  if (isAccommodationCustomer) {
    const { data: staysData, error: staysError } = await admin
      .from("stay_entries")
      .select(
        "id, customer_profile_id, start_date, total_nights, status, created_at",
      )
      .eq("customer_profile_id", customerProfileId);

    if (staysError) {
      throw new Error(
        `Failed to load stay logging windows for customer ${customerProfileId}: ${staysError.message}`,
      );
    }

    for (const stay of (staysData ?? []) as StayRow[]) {
      if (!stay.start_date || stay.total_nights == null) continue;
      records.push({
        customerProfileId: stay.customer_profile_id,
        category: "ACCOMMODATION",
        windowStart: stay.start_date,
        windowEnd: computeStayEndDate(stay.start_date, stay.total_nights),
        status: stay.status,
        recordId: stay.id,
        subjectType: "STAY",
      });
    }
  }

  // Newest window first — the current period leads, older periods follow.
  return records.sort((a, b) => b.windowStart.localeCompare(a.windowStart));
}

// ---------------------------------------------------------------------------
// 2. Last Dietitian_Log date per customer
// ---------------------------------------------------------------------------

/**
 * Batched lookup of the most recent `DIETITIAN` `log_date` for each customer
 * in `customerProfileIds` (Last_Dietitian_Log_Date). A customer with no
 * Dietitian_Log is omitted from the returned map — `computeCadence` treats a
 * missing/`null` value as the Logging_Window start date minus one day
 * (Req 14.6).
 *
 * Req 14.4
 */
export async function getLastDietitianLogDates(
  customerProfileIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (customerProfileIds.length === 0) return result;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_logs")
    .select("customer_profile_id, log_date")
    .in("customer_profile_id", customerProfileIds)
    .eq("author_type", "DIETITIAN")
    .order("log_date", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to load last dietitian log dates: ${error.message}`,
    );
  }

  // Rows are newest-first, so the first occurrence per customer is the
  // Last_Dietitian_Log_Date.
  for (const row of (data ?? []) as Array<{
    customer_profile_id: string;
    log_date: string;
  }>) {
    if (!result.has(row.customer_profile_id)) {
      result.set(row.customer_profile_id, row.log_date);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Paused dates after a cutoff
// ---------------------------------------------------------------------------

/**
 * Batched lookup of every Paused_Day on or after `sinceDate` for each customer
 * in `customerProfileIds`, read from `subscription_daily_preferences`
 * (Req 14.9). `sinceDate` is a single cutoff applied across the whole batch —
 * callers pass the earliest date that could still be relevant (e.g. the
 * earliest Last_Dietitian_Log_Date or Logging_Window start across the list) so
 * the query stays batched regardless of how many distinct cutoffs the pure
 * Cadence_Engine will apply per customer.
 *
 * `subscription_daily_preferences` rows exist only for `MEAL` subscriptions
 * today (Req baseline), so `KIT` and `ACCOMMODATION` customers naturally
 * resolve to an empty list.
 *
 * A customer with no paused dates is omitted from the returned map.
 *
 * Req 14.9
 */
export async function getPausedDatesSince(
  customerProfileIds: readonly string[],
  sinceDate: string,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (customerProfileIds.length === 0) return result;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscription_daily_preferences")
    .select("customer_profile_id, preference_date")
    .in("customer_profile_id", customerProfileIds)
    .eq("is_paused", true)
    .gte("preference_date", sinceDate);

  if (error) {
    throw new Error(`Failed to load paused dates: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{
    customer_profile_id: string;
    preference_date: string;
  }>) {
    const list = result.get(row.customer_profile_id);
    if (list) list.push(row.preference_date);
    else result.set(row.customer_profile_id, [row.preference_date]);
  }

  for (const list of result.values()) list.sort();

  return result;
}

/**
 * Batched lookup of every KIT date on or after `sinceDate` the customer marked
 * as `FOOD_SKIPPED` in `kit_daily_logs`.
 *
 * A skipped KIT day is the KIT equivalent of a MEAL Paused_Day: the plan does
 * not run that day, and `trg_kit_daily_logs_sync` pushes
 * `kit_tracker_end_date` out by one day for each of them. Counting such a day
 * as an Eligible_Day would both inflate Days_Not_Logged and add a Log_Slot the
 * plan never earned, so callers that need Eligible_Days use
 * `getNonEligibleDatesSince` (which unions this with the paused dates) rather
 * than `getPausedDatesSince` alone.
 *
 * Non-KIT customers resolve to an empty list — `kit_daily_logs` only ever
 * carries rows for KIT subscriptions (enforced by
 * `trg_kit_daily_logs_category_guard`).
 */
export async function getKitSkippedDatesSince(
  customerProfileIds: readonly string[],
  sinceDate: string,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (customerProfileIds.length === 0) return result;

  const admin = createAdminClient();

  const { data: subsData, error: subsError } = await admin
    .from("subscriptions")
    .select("id, customer_profile_id")
    .in("customer_profile_id", customerProfileIds)
    .eq("customer_category", "KIT");

  if (subsError) {
    throw new Error(
      `Failed to resolve KIT subscriptions for skipped-date lookup: ${subsError.message}`,
    );
  }

  const subscriptionToCustomer = new Map<string, string>();
  for (const row of (subsData ?? []) as KitSubscriptionRow[]) {
    subscriptionToCustomer.set(row.id, row.customer_profile_id);
  }

  const subscriptionIds = [...subscriptionToCustomer.keys()];
  if (subscriptionIds.length === 0) return result;

  const { data, error } = await admin
    .from("kit_daily_logs")
    .select("subscription_id, log_date")
    .in("subscription_id", subscriptionIds)
    .eq("status", "FOOD_SKIPPED")
    .gte("log_date", sinceDate);

  if (error) {
    throw new Error(`Failed to load KIT skipped dates: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{
    subscription_id: string;
    log_date: string;
  }>) {
    const customerProfileId = subscriptionToCustomer.get(row.subscription_id);
    if (!customerProfileId) continue;
    const list = result.get(customerProfileId);
    if (list) list.push(row.log_date);
    else result.set(customerProfileId, [row.log_date]);
  }

  for (const list of result.values()) list.sort();

  return result;
}

/**
 * Every date on or after `sinceDate` that is NOT an Eligible_Day: the union of
 * the MEAL Paused_Days (`getPausedDatesSince`) and the KIT skipped days
 * (`getKitSkippedDatesSince`), de-duplicated and sorted per customer.
 *
 * This is what the Cadence_Engine and the Log_Slot schedule consume, so both
 * MEAL pauses and KIT skips shift a customer's slots and cadence counters the
 * same way. `getPausedDatesSince` stays the narrower read used by the
 * Health_Log write gate, which is defined against Paused_Days only (Req 15.8).
 */
export async function getNonEligibleDatesSince(
  customerProfileIds: readonly string[],
  sinceDate: string,
): Promise<Map<string, string[]>> {
  const [pausedDates, skippedDates] = await Promise.all([
    getPausedDatesSince(customerProfileIds, sinceDate),
    getKitSkippedDatesSince(customerProfileIds, sinceDate),
  ]);

  const result = new Map<string, string[]>();
  for (const source of [pausedDates, skippedDates]) {
    for (const [customerProfileId, dates] of source) {
      const merged = result.get(customerProfileId);
      if (merged) merged.push(...dates);
      else result.set(customerProfileId, [...dates]);
    }
  }

  for (const [customerProfileId, dates] of result) {
    result.set(customerProfileId, [...new Set(dates)].sort());
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Self_Log dates in window
// ---------------------------------------------------------------------------

/** One KIT Self_Log row, as recorded in `kit_daily_logs`. */
export interface SelfLogEntry {
  logDate: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
}

interface KitSubscriptionRow {
  id: string;
  customer_profile_id: string;
}

/**
 * Batched lookup of KIT Self_Logs between `fromDate` and `toDate` (inclusive)
 * for each customer in `customerProfileIds`, used for the Self_Log adherence
 * panel and list filters (Req 16.3, 17.1).
 *
 * `kit_daily_logs` is keyed to `subscription_id`, not `customer_profile_id`, so
 * this resolves every KIT `subscriptions` row for the given customers first
 * and then reads the logs for those subscription ids in a second batched
 * query — still one repository call, and no per-customer round trip.
 *
 * `MEAL` and `ACCOMMODATION` customers have no KIT subscription and therefore
 * resolve to an empty map entry (Req 16.4 — their Self_Log counts are zero).
 *
 * Req 16.3, 17.1
 */
export async function getSelfLogDatesInWindow(
  customerProfileIds: readonly string[],
  fromDate: string,
  toDate: string,
): Promise<Map<string, SelfLogEntry[]>> {
  const result = new Map<string, SelfLogEntry[]>();
  if (customerProfileIds.length === 0) return result;

  const admin = createAdminClient();

  const { data: subsData, error: subsError } = await admin
    .from("subscriptions")
    .select("id, customer_profile_id")
    .in("customer_profile_id", customerProfileIds)
    .eq("customer_category", "KIT");

  if (subsError) {
    throw new Error(
      `Failed to resolve KIT subscriptions for self-log lookup: ${subsError.message}`,
    );
  }

  const subscriptionToCustomer = new Map<string, string>();
  for (const row of (subsData ?? []) as KitSubscriptionRow[]) {
    subscriptionToCustomer.set(row.id, row.customer_profile_id);
  }

  const subscriptionIds = [...subscriptionToCustomer.keys()];
  if (subscriptionIds.length === 0) return result;

  const { data: logsData, error: logsError } = await admin
    .from("kit_daily_logs")
    .select("subscription_id, log_date, status")
    .in("subscription_id", subscriptionIds)
    .gte("log_date", fromDate)
    .lte("log_date", toDate);

  if (logsError) {
    throw new Error(`Failed to load self-log dates: ${logsError.message}`);
  }

  for (const row of (logsData ?? []) as Array<{
    subscription_id: string;
    log_date: string;
    status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  }>) {
    const customerProfileId = subscriptionToCustomer.get(row.subscription_id);
    if (!customerProfileId) continue;
    const entry: SelfLogEntry = { logDate: row.log_date, status: row.status };
    const list = result.get(customerProfileId);
    if (list) list.push(entry);
    else result.set(customerProfileId, [entry]);
  }

  for (const list of result.values()) list.sort((a, b) => a.logDate.localeCompare(b.logDate));

  return result;
}
