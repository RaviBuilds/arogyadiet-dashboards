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
// Four batched queries regardless of list size, then pure computation (design
// "Cadence flow" sequence diagram):
//   1. getGoverningRecords          — governing subscription OR stay
//   2. getLastDietitianLogDates     — most recent DIETITIAN `log_date`
//   3. getPausedDatesSince          — Paused_Days after a cutoff
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
}

interface SubscriptionRow {
  id: string;
  customer_profile_id: string;
  customer_category: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
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
      "id, customer_profile_id, customer_category, status, starts_on, ends_on, effective_end_on, created_at",
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
      });
      continue;
    }

    if (!sub.starts_on) continue; // no Logging_Window start — treated as non-ACTIVE
    result.set(sub.customer_profile_id, {
      customerProfileId: sub.customer_profile_id,
      category,
      windowStart: sub.starts_on,
      windowEnd: sub.effective_end_on ?? sub.ends_on ?? sub.starts_on,
      status: sub.status,
    });
  }

  return result;
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
