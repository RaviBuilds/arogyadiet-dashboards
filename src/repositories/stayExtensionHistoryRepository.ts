// src/repositories/stayExtensionHistoryRepository.ts
// Data-access layer for `stay_extension_history` — one row per Stay_Extension,
// purely informational (see scripts/create-stay-extension-history.sql for why
// this is a separate table from stay_payment_transactions and does not affect
// Total_Paid / Remaining_Balance).
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// `src/services/AccommodationService.ts`) and no `'use server'` wrappers
// (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring `stayPaymentRepository.ts`.

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a `stay_extension_history` row as stored in the database (snake_case). */
export interface StayExtensionHistoryRow {
  id: string;
  stay_entry_id: string;
  customer_profile_id: string;
  additional_nights: number;
  additional_amount: number;
  nights_before: number;
  nights_after: number;
  total_amount_before: number | null;
  total_amount_after: number;
  extended_on: string; // YYYY-MM-DD
  created_by: string | null;
  created_at: string;
}

/** Input for {@link recordExtension}. */
export interface RecordExtensionInput {
  stayEntryId: string;
  customerProfileId: string;
  additionalNights: number;
  nightsBefore: number;
  nightsAfter: number;
  additionalAmount: number;
  totalAmountBefore: number | null;
  totalAmountAfter: number;
  extendedOn: string; // YYYY-MM-DD
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const HISTORY_COLUMNS =
  "id, stay_entry_id, customer_profile_id, additional_nights, additional_amount, nights_before, nights_after, total_amount_before, total_amount_after, extended_on, created_by, created_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List every Stay_Extension recorded for a stay, ordered chronologically
 * (created_at ascending, matching `idx_stay_extension_history_stay` and the
 * Payment History list's ordering convention).
 */
export async function listExtensionsByStay(
  stayEntryId: string
): Promise<StayExtensionHistoryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_extension_history")
    .select(HISTORY_COLUMNS)
    .eq("stay_entry_id", stayEntryId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list extension history for stay ${stayEntryId}: ${error.message}`
    );
  }

  return (data ?? []) as unknown as StayExtensionHistoryRow[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record one Stay_Extension via the `record_stay_extension()` RPC. Called
 * from `AccommodationService.extendStay()` immediately after
 * `stayRepository.extendStay()` succeeds — see that migration's "Concurrency"
 * note for why this is a plain insert rather than its own row lock.
 *
 * Throws only for an actual Postgrest/connection error; this insert has no
 * business-outcome failure mode to translate (unlike
 * `stayPaymentRepository.recordTransaction`), since by the time it runs the
 * extension has already been applied to the stay.
 */
export async function recordExtension(
  input: RecordExtensionInput
): Promise<StayExtensionHistoryRow> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("record_stay_extension", {
    p_stay_entry_id: input.stayEntryId,
    p_customer_profile_id: input.customerProfileId,
    p_additional_nights: input.additionalNights,
    p_nights_before: input.nightsBefore,
    p_nights_after: input.nightsAfter,
    p_additional_amount: input.additionalAmount,
    p_total_amount_before: input.totalAmountBefore,
    p_total_amount_after: input.totalAmountAfter,
    p_extended_on: input.extendedOn,
    p_created_by: input.createdBy,
  });

  if (error) {
    throw new Error(
      `Failed to record extension history for stay ${input.stayEntryId}: ${error.message}`
    );
  }

  const result = data as { ok: boolean; extension: StayExtensionHistoryRow };
  return result.extension;
}
