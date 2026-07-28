// src/repositories/healthReportRepository.ts
//
// Data-access layer for the MEAL Subscription History / ACCOMMODATION stay
// history surfaces and the
// per-subscription Health Report (the meal-customer equivalent of the KIT
// report). Mirrors `kitLifecycleRepository` in shape: Supabase reads only, no
// business validation and no `'use server'` wrappers.
//
// The Health Report shows ONLY the health-log values authored by the
// customer's Dietitian (`health_logs.author_type = 'DIETITIAN'`) that fall
// inside the subscription's own date window, so a customer sees exactly what
// their Dietitian recorded for that subscription — nothing self-logged, and
// nothing from a different subscription period.

import { createAdminClient } from "@/lib/supabase/admin";
import type { ParameterValue } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One MEAL subscription row for the Subscription History list. */
export interface MealSubscriptionRow {
  id: string;
  subscriptionCode: string | null;
  planName: string | null;
  status: string;
  startsOn: string | null;
  /** `effective_end_on` when set, else `ends_on`. */
  endsOn: string | null;
  totalDays: number | null;
  createdAt: string;
}

/** A single MEAL subscription with owner + window, for report authorization. */
export interface MealSubscriptionDetailRow {
  id: string;
  customerProfileId: string;
  customerCategory: string;
  status: string;
  subscriptionCode: string | null;
  planName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  effectiveEndOn: string | null;
  totalDays: number | null;
}

/** A Dietitian-authored health_logs row scoped to a subscription window. */
export interface DietitianHealthLogRow {
  id: string;
  logDate: string;
  authorUserId: string | null;
  parameters: Record<string, ParameterValue>;
  customParameters: unknown;
  closingComment: string | null;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Supabase returns an embedded to-one relation as an object OR a 1-element array. */
function firstEmbed<T>(embed: T | T[] | null | undefined): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * All MEAL subscriptions for a customer, newest first, with the joined plan
 * name. Non-MEAL subscriptions (KIT/ACCOMMODATION) are excluded — those have
 * their own history surfaces.
 */
export async function getMealSubscriptionsForCustomer(
  customerProfileId: string,
): Promise<MealSubscriptionRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, subscription_code, status, starts_on, ends_on, effective_end_on, total_days, created_at, subscription_plans(name)",
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "MEAL")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load meal subscriptions: ${error.message}`);
  }

  return ((data ?? []) as RawMealSubscriptionRow[]).map((row) => ({
    id: row.id,
    subscriptionCode: row.subscription_code ?? null,
    planName: firstEmbed(row.subscription_plans)?.name ?? null,
    status: row.status,
    startsOn: row.starts_on ?? null,
    endsOn: row.effective_end_on ?? row.ends_on ?? null,
    totalDays: row.total_days ?? null,
    createdAt: row.created_at,
  }));
}

/**
 * A single subscription with the fields the report needs to authorize the
 * request (owner + category) and to bound the health-log window. Returns
 * `null` when the subscription does not exist.
 */
export async function getMealSubscriptionForReport(
  subscriptionId: string,
): Promise<MealSubscriptionDetailRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, customer_profile_id, customer_category, status, subscription_code, starts_on, ends_on, effective_end_on, total_days, subscription_plans(name)",
    )
    .eq("id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load subscription ${subscriptionId}: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as RawMealSubscriptionDetailRow;
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    customerCategory: row.customer_category,
    status: row.status,
    subscriptionCode: row.subscription_code ?? null,
    planName: firstEmbed(row.subscription_plans)?.name ?? null,
    startsOn: row.starts_on ?? null,
    endsOn: row.ends_on ?? null,
    effectiveEndOn: row.effective_end_on ?? null,
    totalDays: row.total_days ?? null,
  };
}

/**
 * The Dietitian-authored health logs for a customer whose `log_date` falls in
 * `[windowStart, windowEnd]` inclusive, ascending by date. Only
 * `author_type = 'DIETITIAN'` rows are returned — the customer report never
 * surfaces self-logged data (Req: "only data mentioned by the dietitian").
 */
export async function getDietitianHealthLogsInWindow(
  customerProfileId: string,
  windowStart: string,
  windowEnd: string,
): Promise<DietitianHealthLogRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("health_logs")
    .select("id, log_date, author_user_id, parameters, custom_parameters, closing_comment, submitted_at")
    .eq("customer_profile_id", customerProfileId)
    .eq("author_type", "DIETITIAN")
    .gte("log_date", windowStart)
    .lte("log_date", windowEnd)
    .order("log_date", { ascending: true })
    .order("submitted_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load dietitian health logs: ${error.message}`);
  }

  return ((data ?? []) as RawDietitianHealthLogRow[]).map((row) => ({
    id: row.id,
    logDate: row.log_date,
    authorUserId: row.author_user_id ?? null,
    parameters: (row.parameters as Record<string, ParameterValue>) ?? {},
    customParameters: row.custom_parameters,
    closingComment: row.closing_comment ?? null,
    submittedAt: row.submitted_at,
  }));
}

/**
 * Resolve the customer's display name and the assigned Dietitian's name for
 * the report header. Both fall back to sensible defaults when missing.
 */
export async function getReportHeaderInfo(
  customerProfileId: string,
): Promise<{ customerName: string; dietitianName: string | null }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customer_profiles")
    .select("dietitian_id, users!customer_profiles_user_id_fkey(full_name)")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load report header info: ${error.message}`);
  }

  const customerName =
    firstEmbed((data as RawHeaderRow | null)?.users)?.full_name?.trim() || "Customer";
  const dietitianId = (data as RawHeaderRow | null)?.dietitian_id ?? null;

  let dietitianName: string | null = null;
  if (dietitianId) {
    const { data: dietitian } = await admin
      .from("users")
      .select("full_name")
      .eq("id", dietitianId)
      .maybeSingle();
    dietitianName = (dietitian as { full_name: string | null } | null)?.full_name?.trim() || null;
  }

  return { customerName, dietitianName };
}

// ---------------------------------------------------------------------------
// Raw row shapes (as returned by Supabase, snake_case)
// ---------------------------------------------------------------------------

interface RawMealSubscriptionRow {
  id: string;
  subscription_code: string | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
  total_days: number | null;
  created_at: string;
  subscription_plans: { name: string | null } | { name: string | null }[] | null;
}

interface RawMealSubscriptionDetailRow {
  id: string;
  customer_profile_id: string;
  customer_category: string;
  status: string;
  subscription_code: string | null;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
  total_days: number | null;
  subscription_plans: { name: string | null } | { name: string | null }[] | null;
}

interface RawDietitianHealthLogRow {
  id: string;
  log_date: string;
  author_user_id: string | null;
  parameters: unknown;
  custom_parameters: unknown;
  closing_comment: string | null;
  submitted_at: string;
}

interface RawHeaderRow {
  dietitian_id: string | null;
  users: { full_name: string | null } | { full_name: string | null }[] | null;
}

// ---------------------------------------------------------------------------
// Accommodation stays — the ACCOMMODATION equivalent of a MEAL subscription
// ---------------------------------------------------------------------------

/** One `stay_entries` row for the Accommodation History list / report. */
export interface StayReportRow {
  id: string;
  customerProfileId: string;
  startDate: string;
  totalNights: number;
  stayType: string | null;
  occupancyType: string | null;
  status: string;
  createdAt: string;
  /** Inclusive end date: startDate + (totalNights - 1). */
  endDate: string;
}

/** Inclusive stay end date, mirroring `AccommodationService.computeEndDate`. */
function computeStayEndDate(startDate: string, totalNights: number): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.max(0, totalNights - 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapStayRow(row: RawStayRow): StayReportRow {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    startDate: row.start_date,
    totalNights: row.total_nights,
    stayType: row.stay_type ?? null,
    occupancyType: row.occupancy_type ?? null,
    status: row.status,
    createdAt: row.created_at,
    endDate: computeStayEndDate(row.start_date, row.total_nights),
  };
}

const STAY_SELECT =
  "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, created_at";

/** All stays for a customer, newest first. */
export async function getStaysForCustomer(
  customerProfileId: string,
): Promise<StayReportRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(STAY_SELECT)
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load stays: ${error.message}`);
  }

  return ((data ?? []) as RawStayRow[]).map(mapStayRow);
}

/** A single stay, for report authorization + window bounding. */
export async function getStayForReport(
  stayId: string,
): Promise<StayReportRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(STAY_SELECT)
    .eq("id", stayId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load stay ${stayId}: ${error.message}`);
  }
  if (!data) return null;

  return mapStayRow(data as unknown as RawStayRow);
}

interface RawStayRow {
  id: string;
  customer_profile_id: string;
  start_date: string;
  total_nights: number;
  stay_type: string | null;
  occupancy_type: string | null;
  status: string;
  created_at: string;
}
