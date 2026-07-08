// Feature: customer-mobile-onboarding — 5 PM (17:00 IST) subscription start-date
// cutoff logic (Requirements 7.5, 7.6, 7.7).
//
// This module is PURE and deterministic over its inputs: it never reads the
// wall clock itself — the caller passes `now` — so the same `now` always yields
// the same result and the logic is unit- and property-testable without mocking
// the clock.
//
// The rule (Cutoff_Time = 17:00 IST):
//   - BEFORE 17:00 IST on the current IST day  → earliest selectable start date
//     is the next-day date (IST today + 1 day).            (Req 7.5)
//   - AT/AFTER 17:00 IST on the current IST day → earliest selectable start date
//     is the day-after date (IST today + 2 days).          (Req 7.6)
// A submitted start date strictly earlier than the earliest selectable date is
// not permitted.                                            (Req 7.7)
//
// It reuses the single source of truth for IST math in `src/lib/dates/ist.ts`
// so onboarding and the existing rider/customer cutoff share one definition.

import {
  addDaysToISODate,
  istDateStringOf,
  istHourOf,
  RIDER_DAY_ROLLOVER_HOUR_IST,
} from "@/lib/dates/ist";

export type { PastDayStatus } from "@/types/onboarding";

/**
 * Cutoff hour (0–23) in IST after which the earliest selectable start date
 * shifts from tomorrow to the day-after-tomorrow. 17 = 5:00 PM IST. This is the
 * same operational deadline as the rider day rollover.
 */
export const ONBOARDING_CUTOFF_HOUR_IST = RIDER_DAY_ROLLOVER_HOUR_IST;

/**
 * Returns the earliest selectable subscription start date as a YYYY-MM-DD string
 * in IST, given the instant `now`.
 *
 *   - `now` before `cutoffHourIST` on its IST day  → IST today + 1 day (Req 7.5)
 *   - `now` at/after `cutoffHourIST` on its IST day → IST today + 2 days (Req 7.6)
 *
 * Pure over `now` and `cutoffHourIST`.
 */
export function earliestStartDate(
  now: Date,
  cutoffHourIST: number = ONBOARDING_CUTOFF_HOUR_IST,
): string {
  const istHour = istHourOf(now);
  const istToday = istDateStringOf(now);
  const daysToAdd = istHour >= cutoffHourIST ? 2 : 1;
  return addDaysToISODate(istToday, daysToAdd);
}

/**
 * Returns `true` iff `startDate` (YYYY-MM-DD) is on or after the earliest
 * selectable start date for the instant `now` (Req 7.7). A start date strictly
 * earlier than the earliest selectable date is not permitted.
 *
 * Pure over its inputs. YYYY-MM-DD strings compare correctly lexicographically.
 */
export function isStartDateAllowed(
  startDate: string,
  now: Date,
  cutoffHourIST: number = ONBOARDING_CUTOFF_HOUR_IST,
): boolean {
  return startDate >= earliestStartDate(now, cutoffHourIST);
}


// ─── Past-Date Onboarding Utilities ────────────────────────────────────────────
//
// Feature: onboarding-past-date-flexibility — past-date subscription start logic
// (Requirements 1.2, 3.1, 3.2).
//
// These helpers support the admin "Past date start date" toggle, which unlocks a
// 30-day-back date range and requires capturing past day delivery statuses via
// the Past Day Status Popup.

/** Maximum number of days in the past that a start date can be set. */
export const PAST_DATE_MAX_DAYS = 30;

/**
 * Returns the boundary date (YYYY-MM-DD, inclusive) up to which past day
 * delivery statuses must be captured.
 *
 *   - At/after 17:00 IST → today's IST date (today's delivery outcome is known)
 *   - Before 17:00 IST   → yesterday's IST date (today's delivery is still in
 *     progress and cannot be confirmed yet)
 *
 * Pure over `now`. (Requirements 3.1, 3.2)
 */
export function pastDayStatusBoundary(now: Date): string {
  const istHour = istHourOf(now);
  const istToday = istDateStringOf(now);
  if (istHour >= ONBOARDING_CUTOFF_HOUR_IST) {
    return istToday;
  }
  return addDaysToISODate(istToday, -1);
}

/**
 * Returns `true` iff `startDate` (YYYY-MM-DD) is a valid past start date for
 * onboarding: it must be strictly before today AND at most 30 days in the past.
 *
 *   - startDate < istToday
 *   - startDate >= istToday − 30 days
 *
 * Pure over `startDate` and `now`. (Requirements 1.2)
 */
export function isPastStartDateValid(startDate: string, now: Date): boolean {
  const istToday = istDateStringOf(now);
  const thirtyDaysAgo = addDaysToISODate(istToday, -PAST_DATE_MAX_DAYS);
  // YYYY-MM-DD strings compare correctly lexicographically.
  return startDate < istToday && startDate >= thirtyDaysAgo;
}

/**
 * Returns the selectable past-date range as { start, end } (inclusive, YYYY-MM-DD)
 * given today's IST date string.
 *
 *   - start = today − 30 days
 *   - end   = today − 1 day (yesterday)
 *
 * Pure over `today`. (Requirements 1.2)
 */
export function getPastDateRange(today: string): { start: string; end: string } {
  return {
    start: addDaysToISODate(today, -PAST_DATE_MAX_DAYS),
    end: addDaysToISODate(today, -1),
  };
}
