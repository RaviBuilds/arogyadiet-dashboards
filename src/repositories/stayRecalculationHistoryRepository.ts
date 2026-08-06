// src/repositories/stayRecalculationHistoryRepository.ts
// Data-access layer for `stay_recalculation_history` — one row per
// Save_Stay_Details submission that actually changed something, purely
// informational (see scripts/create-stay-recalculation.sql for why this is its
// own table rather than a `kind` discriminator on stay_extension_history, and
// why nothing derives a balance, night count, or end date from it).
//
// READ-ONLY BY DESIGN. There is deliberately no write function here: unlike
// extension history — whose insert is a separate call after
// `stayRepository.extendStay` — the recalculation row is inserted *inside* the
// `save_stay_details()` RPC so it shares that function's single transaction and
// row lock (Req 12.16, 13.1). A Node-side insert could succeed after the stay
// update failed, or vice versa, which is exactly what Req 12.16 forbids.
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// `src/services/AccommodationService.ts`) and no `'use server'` wrappers
// (those live in `src/actions/*`). Uses the service-role admin client,
// mirroring `stayExtensionHistoryRepository.ts`.

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a `stay_recalculation_history` row as stored in the database (snake_case). */
export interface StayRecalculationHistoryRow {
  id: string;
  stay_entry_id: string;
  customer_profile_id: string;
  nights_before: number;
  nights_after: number;
  total_amount_before: number | null;
  total_amount_after: number;
  end_date_before: string; // YYYY-MM-DD, for the audit trail
  end_date_after: string; // YYYY-MM-DD
  recalculated_on: string; // YYYY-MM-DD (IST) — Req 13.1
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const HISTORY_COLUMNS =
  "id, stay_entry_id, customer_profile_id, nights_before, nights_after, total_amount_before, total_amount_after, end_date_before, end_date_after, recalculated_on, created_by, created_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List every Save_Stay_Details submission recorded for a stay, ordered
 * chronologically (created_at ascending, oldest first — matching
 * `idx_stay_recalc_history_stay` and the Payment History / Extension History
 * ordering convention).
 *
 * Returns an empty array when the stay has no recorded recalculations; the
 * Recalculation History card renders its empty state from that (Req 13.4).
 *
 * Req 13.3, 13.4, 13.5.
 */
export async function listRecalculationsByStay(
  stayEntryId: string
): Promise<StayRecalculationHistoryRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_recalculation_history")
    .select(HISTORY_COLUMNS)
    .eq("stay_entry_id", stayEntryId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list recalculation history for stay ${stayEntryId}: ${error.message}`
    );
  }

  return (data ?? []) as unknown as StayRecalculationHistoryRow[];
}

// ---------------------------------------------------------------------------
// Writes — intentionally none
// ---------------------------------------------------------------------------
// No `recordRecalculation` exists and none should be added. The history row is
// written by `save_stay_details()` alongside the stay update, inside one
// transaction under one row lock, so a mid-operation failure leaves nights,
// amount, status, and end date fully unchanged and no orphan history row behind
// (design decision 15, Req 12.16, 13.1, 13.2).
