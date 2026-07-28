// src/lib/dietitian/cadence.ts
// Feature: dietitian-management — the Cadence_Engine (pure).
//
// One implementation of the "how overdue is this dietitian" question, consumed
// by the Log Customer list, the dietitian filters, the Report_Card and both
// activity reports, so every surface reports the same number (Req 14, 17, 19,
// 20, 24).
//
// The module is PURE: every date is a `YYYY-MM-DD` IST calendar date compared
// lexicographically and `today` is injected by the caller (via
// `getISTDateString()` in `src/lib/dates/ist.ts`), so nothing here reads a clock
// or performs I/O and IST correctness lives in one already-tested place
// (Req 14.14).
//
// _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.14_

import { addDaysToISODate } from "@/lib/dates/ist";
import type { CustomerCategory } from "@/types/dietitian";

export type { CustomerCategory };

/**
 * Cadence_Interval per Customer_Category: the maximum number of Eligible_Days
 * permitted between two consecutive Dietitian_Logs (Req 14.1, 14.2).
 */
export const CADENCE_INTERVALS: Record<CustomerCategory, number> = {
  ACCOMMODATION: 1,
  MEAL: 3,
  KIT: 3,
};

/** The only governing-subscription status that produces non-zero counts (Req 14.7). */
export const ACTIVE_SUBSCRIPTION_STATUS = "ACTIVE";

/** Cadence_Interval for a Customer_Category (Req 14.1, 14.2). */
export function cadenceIntervalFor(category: CustomerCategory): number {
  return CADENCE_INTERVALS[category] ?? CADENCE_INTERVALS.MEAL;
}

export interface CadenceInput {
  category: CustomerCategory;
  /** Logging_Window start, YYYY-MM-DD (subscription `starts_on` or stay `start_date`). */
  windowStart: string;
  /** Logging_Window end before clamping, YYYY-MM-DD. */
  windowEnd: string;
  /** Current IST calendar date, YYYY-MM-DD (injected, never read from the clock). */
  today: string;
  /** Paused IST dates for the governing subscription. */
  pausedDates: readonly string[];
  /** Most recent DIETITIAN `log_date`, or null when none exists. */
  lastDietitianLogDate: string | null;
  /** Governing subscription status; anything other than ACTIVE zeroes the counts. */
  subscriptionStatus: string;
}

export interface CadenceSnapshot {
  cadenceInterval: number;
  /** `windowStart − 1` day when `lastDietitianLogDate` is null (Req 14.6). */
  effectiveLastLogDate: string;
  daysNotLogged: number;
  pendingLogCount: number;
  pausedDaysCount: number;
  eligibleDaysInWindow: number;
}

/**
 * Computes the cadence snapshot for one customer.
 *
 * Rules encoded:
 * - The Logging_Window end is clamped to `today`: `min(windowEnd, today)`. A
 *   window that has not started yet or ended before `windowStart` is empty.
 * - An Eligible_Day is a date inside the clamped window that is not a
 *   Paused_Day (Req 14.3, 14.8).
 * - `effectiveLastLogDate` is `lastDietitianLogDate`, or `windowStart − 1` day
 *   when the customer has no Dietitian_Log (Req 14.6).
 * - `daysNotLogged` counts Eligible_Days strictly after `effectiveLastLogDate`
 *   through `today` (Req 14.4), so a log dated today yields 0 (Req 14.10).
 * - `pausedDaysCount` counts the Paused_Days of the same interval (Req 14.9);
 *   together with `daysNotLogged` it accounts for every window day strictly
 *   after `effectiveLastLogDate`.
 * - `pendingLogCount = floor(daysNotLogged / cadenceInterval)` (Req 14.5).
 * - A governing subscription whose status is not `ACTIVE` zeroes every count
 *   (Req 14.7).
 */
export function computeCadence(input: CadenceInput): CadenceSnapshot {
  const cadenceInterval = cadenceIntervalFor(input.category);

  // Req 14.6 — no Dietitian_Log means the day before the window start.
  const effectiveLastLogDate =
    input.lastDietitianLogDate ?? addDaysToISODate(input.windowStart, -1);

  // Req 14.7 — a non-ACTIVE subscription reports nothing pending.
  if (input.subscriptionStatus !== ACTIVE_SUBSCRIPTION_STATUS) {
    return {
      cadenceInterval,
      effectiveLastLogDate,
      daysNotLogged: 0,
      pendingLogCount: 0,
      pausedDaysCount: 0,
      eligibleDaysInWindow: 0,
    };
  }

  // The window end never runs past the current IST date.
  const effectiveWindowEnd =
    input.windowEnd < input.today ? input.windowEnd : input.today;
  const pausedDates = new Set(input.pausedDates);

  // Req 14.4, 14.9 — count strictly after the Last_Dietitian_Log_Date, and
  // never before the window start.
  const dayAfterLastLog = addDaysToISODate(effectiveLastLogDate, 1);
  const countFrom =
    dayAfterLastLog > input.windowStart ? dayAfterLastLog : input.windowStart;

  let eligibleDaysInWindow = 0;
  let daysNotLogged = 0;
  let pausedDaysCount = 0;

  for (
    let date = input.windowStart;
    date <= effectiveWindowEnd;
    date = addDaysToISODate(date, 1)
  ) {
    const isPaused = pausedDates.has(date);
    if (!isPaused) eligibleDaysInWindow += 1;
    if (date < countFrom) continue;
    if (isPaused) pausedDaysCount += 1;
    else daysNotLogged += 1;
  }

  return {
    cadenceInterval,
    effectiveLastLogDate,
    daysNotLogged,
    // Req 14.5 — integer quotient, so > 0 exactly when daysNotLogged >= interval.
    pendingLogCount: Math.floor(daysNotLogged / cadenceInterval),
    pausedDaysCount,
    eligibleDaysInWindow,
  };
}
