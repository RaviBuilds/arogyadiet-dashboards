// src/services/CadenceService.ts
// Feature: dietitian-management — CadenceService (task 7.16).
//
// Assembles the four batched `cadenceRepository` queries, injects `today` via
// `getISTDateString()`, and delegates the pure cadence math to
// `computeCadence` (`src/lib/dietitian/cadence.ts`). This is the SINGLE place
// every pending/overdue number and Self_Log-adherence count in the product
// goes through — the Log Customer list, the Report_Card, and both the Master
// and Franchise Dietitian_Activity_Reports (design "Cadence flow" sequence
// diagram).
//
// LAYERING: Orchestration only, no `'use server'` wrapper (server actions
// call this module directly) and no business validation — mirrors the
// assemble-then-delegate shape of `KitReportService`.
//
// A customer with no entry in `getGoverningRecords()` (no subscription row,
// or an `ACCOMMODATION` customer with no stay row) is treated as non-`ACTIVE`
// rather than throwing: every cadence and Self_Log count is reported as zero
// for that customer instead of raising (design "Error Handling").
//
// _Requirements: 14.7, 14.9, 16.3, 16.4, 17.1, 20.8, 24.5_

import { addDaysToISODate, getISTDateString } from "@/lib/dates/ist";
import { computeCadence, type CadenceSnapshot } from "@/lib/dietitian/cadence";
import {
  getGoverningRecords,
  getLastDietitianLogDates,
  getPausedDatesSince,
  getSelfLogDatesInWindow,
  type GoverningRecord,
  type SelfLogEntry,
} from "@/repositories/dietitian/cadenceRepository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One customer's cadence snapshot plus the Self_Log adherence counts read
 * alongside it (Req 16.3, 16.4) — the exact row shape the Log Customer list,
 * the Report_Card and both activity reports all consume.
 */
export interface CadenceResult extends CadenceSnapshot {
  /**
   * Count of the customer's Self_Logs within the Logging_Window whose status
   * is `FOOD_SKIPPED`. Zero outside `KIT` (Req 16.4).
   */
  skippedSelfLogCount: number;
  /**
   * Count of dates within the Logging_Window that have no Self_Log of either
   * status. Zero outside `KIT` (Req 16.4).
   */
  datesWithoutSelfLogCount: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes the cadence snapshot and Self_Log adherence counts for every
 * customer in `customerProfileIds`, in at most four batched repository
 * queries regardless of list size (design "Cadence flow").
 *
 * A customer missing from `getGoverningRecords()` is reported with every
 * count zeroed — the same "nothing pending" outcome Req 14.7 defines for a
 * non-`ACTIVE` governing subscription — rather than throwing (design "Error
 * Handling": "A missing governing subscription/stay ... CadenceService
 * treats a missing entry as non-ACTIVE rather than throwing").
 *
 * Req 14.7, 14.9, 16.3, 16.4, 17.1, 20.8, 24.5
 */
export async function computeCadenceForCustomers(
  customerProfileIds: readonly string[],
): Promise<Map<string, CadenceResult>> {
  const result = new Map<string, CadenceResult>();
  if (customerProfileIds.length === 0) return result;

  const today = getISTDateString();

  // 1. Governing subscription or stay — Req 14.3, 14.4, 14.9.
  const governingRecords = await getGoverningRecords(customerProfileIds);
  const presentRecords = [...governingRecords.values()];

  // No customer in this batch has a governing record — every count is zero
  // and the remaining three queries would return nothing useful, so skip them.
  if (presentRecords.length === 0) {
    for (const customerProfileId of customerProfileIds) {
      result.set(customerProfileId, zeroCadenceResult(today));
    }
    return result;
  }

  // A single shared cutoff/range is safe to pass to every batched query
  // below: no Eligible_Day or Self_Log date before the earliest
  // Logging_Window start across the batch can ever be relevant to any
  // customer in it (mirrors the guidance in
  // `cadenceRepository.getPausedDatesSince`).
  let earliestWindowStart = presentRecords[0].windowStart;
  let latestWindowEnd = presentRecords[0].windowEnd;
  for (const record of presentRecords) {
    if (record.windowStart < earliestWindowStart) {
      earliestWindowStart = record.windowStart;
    }
    if (record.windowEnd > latestWindowEnd) {
      latestWindowEnd = record.windowEnd;
    }
  }
  const latestEffectiveWindowEnd =
    latestWindowEnd < today ? latestWindowEnd : today;

  // 2. Last DIETITIAN log_date per customer — Req 14.4, 14.6.
  const lastLogDates = await getLastDietitianLogDates(customerProfileIds);

  // 3. Paused dates after the shared cutoff — Req 14.9.
  const pausedDates = await getPausedDatesSince(
    customerProfileIds,
    earliestWindowStart,
  );

  // 4. Self-log dates in the shared window — Req 16.3, 16.4, 17.1.
  const selfLogDates = await getSelfLogDatesInWindow(
    customerProfileIds,
    earliestWindowStart,
    latestEffectiveWindowEnd,
  );

  for (const customerProfileId of customerProfileIds) {
    const record = governingRecords.get(customerProfileId);

    if (!record) {
      result.set(customerProfileId, zeroCadenceResult(today));
      continue;
    }

    const snapshot = computeCadence({
      category: record.category,
      windowStart: record.windowStart,
      windowEnd: record.windowEnd,
      today,
      pausedDates: pausedDates.get(customerProfileId) ?? [],
      lastDietitianLogDate: lastLogDates.get(customerProfileId) ?? null,
      subscriptionStatus: record.status,
    });

    const { skippedSelfLogCount, datesWithoutSelfLogCount } =
      computeSelfLogAdherence(
        record,
        today,
        selfLogDates.get(customerProfileId) ?? [],
      );

    result.set(customerProfileId, {
      ...snapshot,
      skippedSelfLogCount,
      datesWithoutSelfLogCount,
    });
  }

  return result;
}

/**
 * Convenience wrapper for a single customer — the Report_Card and the
 * Customer_360 adherence panel each need exactly one row rather than a Map.
 *
 * Req 14.7, 14.9, 16.3, 16.4
 */
export async function getCadenceForCustomer(
  customerProfileId: string,
): Promise<CadenceResult> {
  const results = await computeCadenceForCustomers([customerProfileId]);
  return (
    results.get(customerProfileId) ?? zeroCadenceResult(getISTDateString())
  );
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Self_Log adherence within one customer's Logging_Window (Req 16.3):
 * `skippedSelfLogCount` counts `FOOD_SKIPPED` entries inside the window,
 * `datesWithoutSelfLogCount` counts window dates with no Self_Log of either
 * status. Both are zero outside `KIT` (Req 16.4) — `getSelfLogDatesInWindow`
 * already resolves MEAL/ACCOMMODATION customers to an empty list, but the
 * category check is kept explicit so this holds even if that changes.
 *
 * The Logging_Window used here is NOT gated on the governing status: unlike
 * the cadence counts (zeroed by `computeCadence` for a non-ACTIVE status),
 * the glossary's Logging_Window definition carries no status condition, so a
 * paused/expired customer's Self_Log adherence still reflects real data.
 */
function computeSelfLogAdherence(
  record: GoverningRecord,
  today: string,
  entries: readonly SelfLogEntry[],
): { skippedSelfLogCount: number; datesWithoutSelfLogCount: number } {
  if (record.category !== "KIT") {
    return { skippedSelfLogCount: 0, datesWithoutSelfLogCount: 0 };
  }

  const effectiveWindowEnd =
    record.windowEnd < today ? record.windowEnd : today;

  if (record.windowStart > effectiveWindowEnd) {
    return { skippedSelfLogCount: 0, datesWithoutSelfLogCount: 0 };
  }

  const loggedDates = new Set<string>();
  let skippedSelfLogCount = 0;
  for (const entry of entries) {
    if (
      entry.logDate < record.windowStart ||
      entry.logDate > effectiveWindowEnd
    ) {
      continue;
    }
    loggedDates.add(entry.logDate);
    if (entry.status === "FOOD_SKIPPED") skippedSelfLogCount += 1;
  }

  let datesWithoutSelfLogCount = 0;
  for (
    let date = record.windowStart;
    date <= effectiveWindowEnd;
    date = addDaysToISODate(date, 1)
  ) {
    if (!loggedDates.has(date)) datesWithoutSelfLogCount += 1;
  }

  return { skippedSelfLogCount, datesWithoutSelfLogCount };
}

/**
 * Every count zeroed — the outcome for a customer with no governing record
 * and the safe fallback for `getCadenceForCustomer`.
 */
function zeroCadenceResult(today: string): CadenceResult {
  return {
    cadenceInterval: 0,
    effectiveLastLogDate: today,
    daysNotLogged: 0,
    pendingLogCount: 0,
    pausedDaysCount: 0,
    eligibleDaysInWindow: 0,
    skippedSelfLogCount: 0,
    datesWithoutSelfLogCount: 0,
  };
}
