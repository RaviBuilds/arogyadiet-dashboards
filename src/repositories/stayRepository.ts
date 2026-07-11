// src/repositories/stayRepository.ts
// Data-access layer for ACCOMMODATION stay entry management.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for stay_entries operations (creation, status transitions, extensions,
// history, cron transitions). It applies NO business validation (that lives in
// `src/services/AccommodationService.ts`) and contains NO `'use server'`
// wrappers (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring the kitLifecycleRepository pattern.
//
// Requirements: 3.4, 4.1, 4.2, 4.3, 8.1, 8.2, 8.3, 14.1, 14.3, 14.5

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a stay_entries row as stored in the database (snake_case). */
export interface StayEntryRow {
  id: string;
  customer_profile_id: string;
  start_date: string;
  total_nights: number;
  stay_type: string;
  occupancy_type: string;
  status: string;
  payment_amount: number | null;
  base_amount: number | null;
  tax_amount: number | null;
  tax_percentage: number;
  payment_host_profile_id: string | null;
  meal_preference: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for creating a new stay entry. */
export interface CreateStayEntryInput {
  customer_profile_id: string;
  start_date: string;
  total_nights: number;
  stay_type: string;
  occupancy_type: string;
  status: string;
  payment_amount?: number | null;
  base_amount?: number | null;
  tax_amount?: number | null;
  tax_percentage?: number;
  payment_host_profile_id?: string | null;
  meal_preference: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Get a single stay entry by ID.
 *
 * Returns `null` when no stay with the given ID exists.
 *
 * Req 4.4, 14.2
 */
export async function getStayById(
  stayId: string
): Promise<StayEntryRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("id", stayId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get stay ${stayId}: ${error.message}`);
  }

  return (data as StayEntryRow) ?? null;
}

/**
 * Get the currently ACTIVE stay for a customer.
 *
 * Returns `null` when no active stay exists.
 *
 * Req 4.1, 8.1
 */
export async function getActiveStay(
  customerProfileId: string
): Promise<StayEntryRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get active stay for customer ${customerProfileId}: ${error.message}`
    );
  }

  return (data as StayEntryRow) ?? null;
}

/**
 * Get all PENDING stays for a customer, ordered by start_date ascending.
 *
 * Req 4.1, 8.2
 */
export async function getPendingStays(
  customerProfileId: string
): Promise<StayEntryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "PENDING")
    .order("start_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to get pending stays for customer ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as StayEntryRow[];
}

/**
 * Get stay history (FINISHED and EXPIRED) for a customer, ordered by
 * start_date descending (most recent first).
 *
 * Req 8.2, 8.3
 */
export async function getStayHistory(
  customerProfileId: string
): Promise<StayEntryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("customer_profile_id", customerProfileId)
    .in("status", ["FINISHED", "EXPIRED"])
    .order("start_date", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get stay history for customer ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as StayEntryRow[];
}

/**
 * Get all stays eligible for status transitions by the daily cron job.
 *
 * Returns:
 * - PENDING stays where start_date <= currentDate (should become ACTIVE)
 * - ACTIVE stays (service layer will check end date to determine FINISHED)
 *
 * Req 4.2, 4.3
 */
export async function getStaysForTransition(
  currentDate: string
): Promise<StayEntryRow[]> {
  const admin = createAdminClient();

  // Fetch PENDING stays where start_date has arrived
  const { data: pendingData, error: pendingError } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("status", "PENDING")
    .lte("start_date", currentDate);

  if (pendingError) {
    throw new Error(
      `Failed to get pending stays for transition: ${pendingError.message}`
    );
  }

  // Fetch all ACTIVE stays (service layer determines which have ended)
  const { data: activeData, error: activeError } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("status", "ACTIVE");

  if (activeError) {
    throw new Error(
      `Failed to get active stays for transition: ${activeError.message}`
    );
  }

  return [
    ...((pendingData ?? []) as StayEntryRow[]),
    ...((activeData ?? []) as StayEntryRow[]),
  ];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Insert a new stay entry and return the created row.
 *
 * Req 3.4, 4.1
 */
export async function createStayEntry(
  input: CreateStayEntryInput
): Promise<StayEntryRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .insert({
      customer_profile_id: input.customer_profile_id,
      start_date: input.start_date,
      total_nights: input.total_nights,
      stay_type: input.stay_type,
      occupancy_type: input.occupancy_type,
      status: input.status,
      payment_amount: input.payment_amount ?? null,
      base_amount: input.base_amount ?? null,
      tax_amount: input.tax_amount ?? null,
      tax_percentage: input.tax_percentage ?? 18.0,
      payment_host_profile_id: input.payment_host_profile_id ?? null,
      meal_preference: input.meal_preference,
    })
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(`Failed to create stay entry: ${error.message}`);
  }

  return data as StayEntryRow;
}

/**
 * Update the status of a stay entry.
 *
 * Req 4.2, 4.3
 */
export async function updateStayStatus(
  stayId: string,
  newStatus: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("stay_entries")
    .update({ status: newStatus })
    .eq("id", stayId);

  if (error) {
    throw new Error(
      `Failed to update stay ${stayId} status to ${newStatus}: ${error.message}`
    );
  }
}

/**
 * Extend a stay by adding additional nights and recording extension payment.
 *
 * Increments total_nights and updates payment fields with the extension amounts.
 *
 * Req 14.1, 14.3, 14.5
 */
export async function extendStay(
  stayId: string,
  additionalNights: number,
  paymentAmount: number,
  baseAmount: number,
  taxAmount: number
): Promise<StayEntryRow> {
  const admin = createAdminClient();

  // First, fetch the current stay to get current total_nights and payment_amount
  const { data: current, error: fetchError } = await admin
    .from("stay_entries")
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .eq("id", stayId)
    .single();

  if (fetchError) {
    throw new Error(
      `Failed to fetch stay ${stayId} for extension: ${fetchError.message}`
    );
  }

  const currentRow = current as StayEntryRow;
  const newTotalNights = currentRow.total_nights + additionalNights;
  const newPaymentAmount = (currentRow.payment_amount ?? 0) + paymentAmount;
  const newBaseAmount = (currentRow.base_amount ?? 0) + baseAmount;
  const newTaxAmount = (currentRow.tax_amount ?? 0) + taxAmount;

  // Update with new totals
  const { data, error } = await admin
    .from("stay_entries")
    .update({
      total_nights: newTotalNights,
      payment_amount: newPaymentAmount,
      base_amount: newBaseAmount,
      tax_amount: newTaxAmount,
    })
    .eq("id", stayId)
    .select(
      "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to extend stay ${stayId}: ${error.message}`
    );
  }

  return data as StayEntryRow;
}
