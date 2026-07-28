// src/lib/dietitian/logDates.ts
// Feature: dietitian-management — selectable log dates for the Health_Log form (pure).
//
// Requirement 15.6: a Dietitian may set the log date to any Eligible_Day within
// the trailing 7 days (up to and including the current IST calendar date).
//
// "Eligible_Day" is NOT re-derived here. The rule (inside the Logging_Window,
// never after `today`, never a Paused_Day) already has exactly one
// implementation in `./cadence`, and this module defers to it so the picker and
// the cadence counters can never disagree (design: one cadence implementation
// for Req 14, 15, 17, 19, 20, 24).
//
// The module is PURE: every date is a `YYYY-MM-DD` IST calendar date compared
// lexicographically and `today` is injected by the caller (via
// `getISTDateString()` in `src/lib/dates/ist.ts`), so nothing here reads a clock
// or performs I/O.
//
// _Requirements: 15.6_

import { addDaysToISODate } from "@/lib/dates/ist";
import { computeCadence, type CadenceInput } from "@/lib/dietitian/cadence";

/**
 * Length of the trailing selection window, in calendar days, inclusive of the
 * current IST date (Req 15.6).
 */
export const SELECTABLE_LOG_DATE_WINDOW_DAYS = 7;

/**
 * Everything needed to decide which dates the log form may offer.
 *
 * Derived from `CadenceInput` on purpose: the picker reads the same
 * Logging_Window and Paused_Day inputs as the cadence counters, so the two
 * cannot drift apart. `category` and the subscription status are irrelevant to
 * eligibility and are therefore not part of this input.
 */
export type SelectableLogDatesInput = Pick<
  CadenceInput,
  "windowStart" | "windowEnd" | "today" | "pausedDates"
>;

/**
 * True when `date` is an Eligible_Day of the Logging_Window.
 *
 * Delegates to `computeCadence` over the single-day window `[date, date]`: that
 * call reports `eligibleDaysInWindow === 1` exactly when the day is not after
 * `today` (the engine clamps the window end to `today`) and is not a Paused_Day.
 * Membership in the real Logging_Window is a lexicographic bounds check on the
 * same `YYYY-MM-DD` strings.
 */
export function isEligibleLogDate(
  date: string,
  input: SelectableLogDatesInput,
): boolean {
  if (date < input.windowStart || date > input.windowEnd) return false;

  const { eligibleDaysInWindow } = computeCadence({
    // Cadence_Interval plays no part in eligibility; any category yields the
    // same 0/1 answer for a single-day window.
    category: "MEAL",
    windowStart: date,
    windowEnd: date,
    today: input.today,
    pausedDates: input.pausedDates,
    lastDietitianLogDate: null,
    subscriptionStatus: "ACTIVE",
  });

  return eligibleDaysInWindow === 1;
}

/**
 * The dates the Health_Log form may offer: the Eligible_Days that fall within
 * the trailing 7 days up to and including `today`, in ascending order
 * (Req 15.6).
 *
 * Returns an empty list when the trailing window and the Logging_Window do not
 * overlap on any unpaused day — for example a Logging_Window that starts in the
 * future, or one whose last 7 days are entirely paused.
 */
export function selectableLogDates(input: SelectableLogDatesInput): string[] {
  const dates: string[] = [];

  for (let offset = SELECTABLE_LOG_DATE_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDaysToISODate(input.today, -offset);
    if (isEligibleLogDate(date, input)) dates.push(date);
  }

  return dates;
}

/**
 * The date the form should pre-select: the current IST date when it is
 * selectable, otherwise the most recent selectable date, otherwise null
 * (Req 15.5 defaults to `today`; this keeps the default inside the offered set).
 */
export function defaultLogDate(input: SelectableLogDatesInput): string | null {
  const dates = selectableLogDates(input);
  return dates.length > 0 ? dates[dates.length - 1] : null;
}
