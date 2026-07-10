// src/repositories/healthLogRepository.ts
// Data-access layer for accommodation health log operations.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for health log operations (customer daily logs and admin health metrics).
// It applies NO business validation (that lives in
// `src/services/AccommodationService.ts`) and contains NO `'use server'`
// wrappers (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring the kitLifecycleRepository pattern.
//
// Requirements: 9.2, 9.3, 9.5, 10.1, 13.5, 13.6

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a customer_health_logs row in the database (snake_case). */
export interface CustomerHealthLogRow {
  id: string;
  stay_entry_id: string;
  customer_profile_id: string;
  log_date: string;
  water_intake_liters: number;
  activity_name: string | null;
  activity_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

/** Shape of an admin_health_logs row in the database (snake_case). */
export interface AdminHealthLogRow {
  id: string;
  stay_entry_id: string;
  customer_profile_id: string;
  log_date: string;
  weight_kg: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  sugar_level_mgdl: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for upserting a customer health log entry. */
export interface UpsertCustomerHealthLogInput {
  stay_entry_id: string;
  customer_profile_id: string;
  log_date: string;
  water_intake_liters: number;
  activity_name?: string | null;
  activity_duration_minutes?: number | null;
}

/** Input for inserting an admin health log entry. */
export interface InsertAdminHealthLogInput {
  stay_entry_id: string;
  customer_profile_id: string;
  log_date: string;
  weight_kg?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  sugar_level_mgdl?: number | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Customer Health Logs
// ---------------------------------------------------------------------------

/**
 * Upsert a customer health log entry.
 *
 * Uses Supabase's `.upsert()` with `onConflict: 'stay_entry_id,log_date'`
 * to ensure only one entry exists per day per stay. If a record already exists
 * for the given (stay_entry_id, log_date), it is updated with the new values.
 *
 * Returns the upserted row.
 *
 * Req 9.2, 9.3
 */
export async function upsertCustomerHealthLog(
  input: UpsertCustomerHealthLogInput
): Promise<CustomerHealthLogRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customer_health_logs")
    .upsert(
      {
        stay_entry_id: input.stay_entry_id,
        customer_profile_id: input.customer_profile_id,
        log_date: input.log_date,
        water_intake_liters: input.water_intake_liters,
        activity_name: input.activity_name ?? null,
        activity_duration_minutes: input.activity_duration_minutes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stay_entry_id,log_date" }
    )
    .select(
      "id, stay_entry_id, customer_profile_id, log_date, water_intake_liters, activity_name, activity_duration_minutes, created_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to upsert customer health log for stay ${input.stay_entry_id} on ${input.log_date}: ${error.message}`
    );
  }

  return data as CustomerHealthLogRow;
}

/**
 * Get all customer health logs for a stay entry, ordered by log_date descending.
 *
 * Returns an empty array if no logs exist for the stay.
 *
 * Req 9.5, 13.6
 */
export async function getCustomerHealthLogs(
  stayEntryId: string
): Promise<CustomerHealthLogRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customer_health_logs")
    .select(
      "id, stay_entry_id, customer_profile_id, log_date, water_intake_liters, activity_name, activity_duration_minutes, created_at, updated_at"
    )
    .eq("stay_entry_id", stayEntryId)
    .order("log_date", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get customer health logs for stay ${stayEntryId}: ${error.message}`
    );
  }

  return (data ?? []) as CustomerHealthLogRow[];
}

// ---------------------------------------------------------------------------
// Admin Health Logs
// ---------------------------------------------------------------------------

/**
 * Insert a new admin health log entry.
 *
 * Returns the created row. Admin logs do not use upsert since multiple
 * entries per date may be valid (though typically one per checkup session).
 *
 * Req 10.1, 13.5
 */
export async function insertAdminHealthLog(
  input: InsertAdminHealthLogInput
): Promise<AdminHealthLogRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_health_logs")
    .insert({
      stay_entry_id: input.stay_entry_id,
      customer_profile_id: input.customer_profile_id,
      log_date: input.log_date,
      weight_kg: input.weight_kg ?? null,
      bp_systolic: input.bp_systolic ?? null,
      bp_diastolic: input.bp_diastolic ?? null,
      sugar_level_mgdl: input.sugar_level_mgdl ?? null,
      notes: input.notes ?? null,
    })
    .select(
      "id, stay_entry_id, customer_profile_id, log_date, weight_kg, bp_systolic, bp_diastolic, sugar_level_mgdl, notes, created_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to insert admin health log for stay ${input.stay_entry_id} on ${input.log_date}: ${error.message}`
    );
  }

  return data as AdminHealthLogRow;
}

/**
 * Get all admin health logs for a stay entry, ordered by log_date ascending.
 *
 * Returns entries in chronological order (oldest first) for health report display.
 * Returns an empty array if no logs exist for the stay.
 *
 * Req 10.1, 13.5
 */
export async function getAdminHealthLogs(
  stayEntryId: string
): Promise<AdminHealthLogRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_health_logs")
    .select(
      "id, stay_entry_id, customer_profile_id, log_date, weight_kg, bp_systolic, bp_diastolic, sugar_level_mgdl, notes, created_at, updated_at"
    )
    .eq("stay_entry_id", stayEntryId)
    .order("log_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get admin health logs for stay ${stayEntryId}: ${error.message}`
    );
  }

  return (data ?? []) as AdminHealthLogRow[];
}
