// src/repositories/stayRepository.ts
// Data-access layer for ACCOMMODATION stay entry management.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for stay_entries operations (creation, status transitions, extensions,
// history, cron transitions, early checkout, checkout finalisation, and final
// invoice linkage). It applies NO business validation or GST math (that lives
// in `src/services/AccommodationService.ts`) and contains NO `'use server'`
// wrappers (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring the kitLifecycleRepository pattern.
//
// Requirements: 3.4, 4.1, 4.2, 4.3, 7.3, 8.1, 8.2, 8.3, 8.7, 9.2, 11.1, 11.3,
// 11.5, 12.6, 12.15, 14.1, 14.3, 14.5

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
  /** True when the stay was onboarded with a past start date (Backdated_Stay). */
  is_backdated: boolean;
  /** True once an Early_Checkout recalculation has been applied to this stay. */
  early_checkout_applied: boolean;
  /** Nights actually stayed; set only by Early_Checkout. */
  actual_nights_stayed: number | null;
  /** Booked nights before the first Early_Checkout; preserved on first application only. */
  original_total_nights: number | null;
  /** Total_Stay_Amount before the first Early_Checkout; preserved on first application only. */
  original_total_amount: number | null;
  /** Timestamp the stay was finalised through checkout. */
  checked_out_at: string | null;
  /** `payments.id` of the single Final_Consolidated_Invoice for this stay. */
  final_invoice_payment_id: string | null;
  /** Timestamp the Final_Consolidated_Invoice was generated. */
  final_invoice_generated_at: string | null;
  /** Last invoice generation failure message; drives the retry affordance. */
  final_invoice_error: string | null;
}

/**
 * Column list shared by every `stay_entries` read/write so the row shape
 * stays consistent everywhere (Req 8.1, 9.2, 12.6, 12.15).
 */
const STAY_ENTRY_COLUMNS =
  "id, customer_profile_id, start_date, total_nights, stay_type, occupancy_type, status, payment_amount, base_amount, tax_amount, tax_percentage, payment_host_profile_id, meal_preference, created_at, updated_at, is_backdated, early_checkout_applied, actual_nights_stayed, original_total_nights, original_total_amount, checked_out_at, final_invoice_payment_id, final_invoice_generated_at, final_invoice_error";

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
  /**
   * True when the stay's initial status resolved to FINISHED at creation
   * time (a Backdated_Stay whose Computed_End_Date had already passed).
   * Defaults to false. Req 3.1.
   */
  is_backdated?: boolean;
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
    .select(STAY_ENTRY_COLUMNS)
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
    .select(STAY_ENTRY_COLUMNS)
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
    .select(STAY_ENTRY_COLUMNS)
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
    .select(STAY_ENTRY_COLUMNS)
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
    .select(STAY_ENTRY_COLUMNS)
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
    .select(STAY_ENTRY_COLUMNS)
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
      is_backdated: input.is_backdated ?? false,
    })
    .select(STAY_ENTRY_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create stay entry: ${error.message}`);
  }

  return data as StayEntryRow;
}

/**
 * Delete a stay entry by ID.
 *
 * Used exclusively as the compensating rollback step in
 * `AccommodationService.createStay` when the post-creation ADVANCE ledger
 * insert fails — the stay row itself must be unwound so the caller's
 * existing subscription → profile → user → auth rollback chain sees no
 * orphaned stay entry.
 *
 * Req 5.1 (design decision 5), extending the onboarding rollback chain.
 */
export async function deleteStayEntry(stayId: string): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.from("stay_entries").delete().eq("id", stayId);

  if (error) {
    throw new Error(`Failed to delete stay ${stayId}: ${error.message}`);
  }
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
 * Extend a stay by adding additional nights and folding an additional cost
 * amount into the running Total_Stay_Amount.
 *
 * `newTotalStayAmount` / `newBaseAmount` / `newTaxAmount` are the RECOMPUTED
 * ABSOLUTE values for the stay after the extension (single-path GST
 * invariant — Req 11.3), not deltas: the caller (service layer) computes the
 * new total first, runs it through `gstFromTotal`, and passes the absolute
 * results down here to be SET rather than accumulated. `total_nights` is
 * still incremented by `additionalNights`.
 *
 * Defensively rejects a non-ACTIVE stay (Req 11.5) — the server action
 * already checks this, but the repository must not silently extend a stay
 * that isn't ACTIVE if called directly.
 *
 * Req 11.1, 11.3, 11.5, 14.1, 14.3, 14.5
 */
export async function extendStay(
  stayId: string,
  additionalNights: number,
  newTotalStayAmount: number,
  newBaseAmount: number,
  newTaxAmount: number
): Promise<StayEntryRow> {
  const admin = createAdminClient();

  // First, fetch the current stay to get current total_nights and status.
  const { data: current, error: fetchError } = await admin
    .from("stay_entries")
    .select(STAY_ENTRY_COLUMNS)
    .eq("id", stayId)
    .single();

  if (fetchError) {
    throw new Error(
      `Failed to fetch stay ${stayId} for extension: ${fetchError.message}`
    );
  }

  const currentRow = current as StayEntryRow;

  if (currentRow.status !== "ACTIVE") {
    throw new Error(
      `Cannot extend stay ${stayId}: only active stays can be extended (current status: ${currentRow.status})`
    );
  }

  const newTotalNights = currentRow.total_nights + additionalNights;

  // Update with the recomputed absolute totals.
  const { data, error } = await admin
    .from("stay_entries")
    .update({
      total_nights: newTotalNights,
      payment_amount: newTotalStayAmount,
      base_amount: newBaseAmount,
      tax_amount: newTaxAmount,
    })
    .eq("id", stayId)
    .select(STAY_ENTRY_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to extend stay ${stayId}: ${error.message}`
    );
  }

  return data as StayEntryRow;
}

// ---------------------------------------------------------------------------
// Early Checkout, Checkout Finalisation, and Final Invoice Linkage
// ---------------------------------------------------------------------------

/**
 * Applies an Early_Checkout recalculation to an ACTIVE stay: sets
 * `total_nights` / `payment_amount` / GST breakup to the recalculated
 * values, records `actual_nights_stayed`, and marks
 * `early_checkout_applied = true`.
 *
 * On the FIRST application (early_checkout_applied currently false),
 * `original_total_nights` / `original_total_amount` are set to the stay's
 * pre-recalculation totals as an audit trail. On a subsequent application
 * those original values are preserved unchanged.
 *
 * Req 12.6, 12.15
 */
export async function applyEarlyCheckout(
  stayId: string,
  actualNightsStayed: number,
  recalculatedStayAmount: number,
  gst: { baseAmount: number; taxAmount: number }
): Promise<StayEntryRow> {
  const admin = createAdminClient();

  const { data: current, error: fetchError } = await admin
    .from("stay_entries")
    .select(STAY_ENTRY_COLUMNS)
    .eq("id", stayId)
    .single();

  if (fetchError) {
    throw new Error(
      `Failed to fetch stay ${stayId} for early checkout: ${fetchError.message}`
    );
  }

  const currentRow = current as StayEntryRow;

  const isFirstApplication = !currentRow.early_checkout_applied;

  const update: Record<string, unknown> = {
    total_nights: actualNightsStayed,
    payment_amount: recalculatedStayAmount,
    base_amount: gst.baseAmount,
    tax_amount: gst.taxAmount,
    actual_nights_stayed: actualNightsStayed,
    early_checkout_applied: true,
  };

  if (isFirstApplication) {
    update.original_total_nights = currentRow.total_nights;
    update.original_total_amount = currentRow.payment_amount;
  }
  // else: preserve the existing original_total_nights / original_total_amount.

  const { data, error } = await admin
    .from("stay_entries")
    .update(update)
    .eq("id", stayId)
    .select(STAY_ENTRY_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to apply early checkout to stay ${stayId}: ${error.message}`
    );
  }

  return data as StayEntryRow;
}

/** Outcome of {@link finalizeCheckout}. Mirrors the `finalize_stay_checkout` RPC's jsonb shape. */
export type FinalizeCheckoutResult =
  | { ok: true; stay: StayEntryRow }
  | {
      ok: false;
      reason: "NOT_FOUND" | "NOT_ACTIVE" | "BALANCE_OUTSTANDING";
      status?: string;
      remainingBalance?: number;
    };

/**
 * Finalises checkout for a stay via the row-locking `finalize_stay_checkout`
 * RPC: re-checks the stay is ACTIVE and the balance is exactly zero, then
 * transitions status to FINISHED and stamps `checked_out_at`.
 *
 * Business-outcome failures (NOT_FOUND / NOT_ACTIVE / BALANCE_OUTSTANDING)
 * are returned as a typed result, not thrown — only actual connection errors
 * throw. Follows the RPC-result-mapping pattern used by
 * `customerOnboardingRepository.onboardCustomerAtomic`.
 *
 * Req 7.3, 7.4, 7.5
 */
export async function finalizeCheckout(
  stayId: string
): Promise<FinalizeCheckoutResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("finalize_stay_checkout", {
    p_stay_entry_id: stayId,
  });

  if (error) {
    throw new Error(
      `Failed to finalize checkout for stay ${stayId}: ${error.message}`
    );
  }

  const result = data as {
    ok: boolean;
    reason?: "NOT_FOUND" | "NOT_ACTIVE" | "BALANCE_OUTSTANDING";
    status?: string;
    remaining_balance?: number;
  } | null;

  if (!result) {
    throw new Error(
      `finalize_stay_checkout returned no result for stay ${stayId}`
    );
  }

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? "NOT_FOUND",
      status: result.status,
      remainingBalance: result.remaining_balance,
    };
  }

  // The RPC only returns the balance, not the full row — re-fetch so callers
  // (invoice generation, action responses) get the up-to-date stay.
  const stay = await getStayById(stayId);
  if (!stay) {
    throw new Error(
      `finalize_stay_checkout succeeded but stay ${stayId} could not be re-fetched`
    );
  }

  return { ok: true, stay };
}

/**
 * Links the single Final_Consolidated_Invoice to a stay after it has been
 * generated, and clears any prior generation-failure record.
 *
 * Req 8.1, 8.7
 */
export async function attachFinalInvoice(
  stayId: string,
  paymentId: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("stay_entries")
    .update({
      final_invoice_payment_id: paymentId,
      final_invoice_generated_at: new Date().toISOString(),
      final_invoice_error: null,
    })
    .eq("id", stayId);

  if (error) {
    throw new Error(
      `Failed to attach final invoice to stay ${stayId}: ${error.message}`
    );
  }
}

/**
 * Records a Final_Consolidated_Invoice generation failure without disturbing
 * the already-committed FINISHED status or `checked_out_at` timestamp
 * (Req 8.7 — the status transition must survive an invoice failure).
 *
 * Req 8.7
 */
export async function recordFinalInvoiceFailure(
  stayId: string,
  errorMessage: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("stay_entries")
    .update({ final_invoice_error: errorMessage })
    .eq("id", stayId);

  if (error) {
    throw new Error(
      `Failed to record final invoice failure for stay ${stayId}: ${error.message}`
    );
  }
}

/**
 * Get ALL stays for a customer regardless of status, ordered by start_date
 * descending. Unlike the status-filtered getters above, this is used by the
 * Accommodation tab because a Backdated_Stay is FINISHED at creation yet
 * still needs the payment panel and checkout/invoice actions (Req 9.1, 9.2).
 *
 * Req 9.2
 */
export async function getStaysByCustomer(
  customerProfileId: string
): Promise<StayEntryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_entries")
    .select(STAY_ENTRY_COLUMNS)
    .eq("customer_profile_id", customerProfileId)
    .order("start_date", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to get stays for customer ${customerProfileId}: ${error.message}`
    );
  }

  return (data ?? []) as StayEntryRow[];
}
