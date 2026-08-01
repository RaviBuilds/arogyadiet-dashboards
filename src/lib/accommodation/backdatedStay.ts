// src/lib/accommodation/backdatedStay.ts
//
// Client-safe pure logic for the Backdated_Stay_Toggle on the Quick_Onboard_Form
// (accommodation-payment-lifecycle, Req 1.2, 1.3, 2.1, 2.3, 2.5, 3.1, 3.2, 3.3).
//
// Extracted out of `AccommodationService.ts` (which imports repositories that
// pull in `createAdminClient()` / the Supabase service-role key) so this pure
// date/status math can be imported directly from the "use client"
// `QuickOnboardingForm` without bundling server-only code into the client
// JS. `AccommodationService.ts` re-exports everything from here unchanged, so
// existing server-side call sites and tests are unaffected.
//
// Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 2.5, 3.1, 3.2, 3.3

import { addDays, parseISO, format } from "date-fns";

import { getISTDateString, addDaysToISODate } from "@/lib/dates/ist";
import {
  MAX_BACKDATED_DAYS,
  MAX_FORWARD_START_DAYS,
} from "@/validations/accommodationSchema";

// ---------------------------------------------------------------------------
// End Date Computation
// ---------------------------------------------------------------------------

/**
 * Computes the end date of a stay given a start date and total nights.
 *
 * End date is inclusive: a 1-night stay starting on 2024-01-10 ends on 2024-01-10.
 * Formula: endDate = startDate + (totalNights - 1) days
 *
 * Returns YYYY-MM-DD formatted string.
 *
 * Req 4.5
 */
export function computeEndDate(startDate: string, totalNights: number): string {
  const start = parseISO(startDate);
  const end = addDays(start, totalNights - 1);
  return format(end, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Initial Status Assignment
// ---------------------------------------------------------------------------

/**
 * Determines the initial Stay_Status for a new Stay_Entry based on start date
 * and total nights relative to the current IST date.
 *
 * Decision logic (lexicographic date comparison):
 * - If startDate > todayIST → PENDING (future stay)
 * - If startDate <= todayIST AND computeEndDate(startDate, totalNights) < todayIST → FINISHED
 *   (backdated stay whose computed end has already passed — Req 3.1)
 * - Otherwise (startDate <= todayIST AND endDate >= todayIST) → ACTIVE (Req 3.2)
 *
 * The FINISHED branch is an initial-status ASSIGNMENT, not a transition —
 * `VALID_TRANSITIONS` remains untouched (Req 3.3).
 *
 * `todayIST` defaults to the current IST date so tests can inject a deterministic value.
 *
 * Req 3.1, 3.2, 3.3, 4.1
 */
export function determineInitialStatus(
  startDate: string,
  totalNights: number,
  todayIST: string = getISTDateString(0)
): "PENDING" | "ACTIVE" | "FINISHED" {
  // YYYY-MM-DD strings compare correctly lexicographically
  if (startDate > todayIST) {
    return "PENDING";
  }

  // Start date is on or before today — check if the stay has already ended
  const endDate = computeEndDate(startDate, totalNights);
  if (endDate < todayIST) {
    return "FINISHED";
  }

  return "ACTIVE";
}

// ---------------------------------------------------------------------------
// Backdated Onboarding Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the allowable date range when the Backdated_Stay_Toggle is ON:
 *   min = todayIST − MAX_BACKDATED_DAYS (30 days ago)
 *   max = todayIST − 1 (yesterday)
 *
 * Both boundaries are YYYY-MM-DD strings suitable for direct calendar use and
 * lexicographic comparison.
 *
 * Req 1.3
 */
export function backdatedStayRange(todayIST: string = getISTDateString(0)): {
  min: string;
  max: string;
} {
  return {
    min: addDaysToISODate(todayIST, -MAX_BACKDATED_DAYS),
    max: addDaysToISODate(todayIST, -1),
  };
}

/**
 * Returns the allowable date range when the Backdated_Stay_Toggle is OFF
 * (the standard forward-looking range):
 *   min = todayIST (today)
 *   max = todayIST + MAX_FORWARD_START_DAYS (365 days from today)
 *
 * Both boundaries are YYYY-MM-DD strings.
 *
 * Req 1.2
 */
export function forwardStayRange(todayIST: string = getISTDateString(0)): {
  min: string;
  max: string;
} {
  return {
    min: todayIST,
    max: addDaysToISODate(todayIST, MAX_FORWARD_START_DAYS),
  };
}

/**
 * Outcome descriptor for a backdated stay onboarding preview.
 * Drives the UI alert that warns when a stay will be created FINISHED immediately.
 */
export interface BackdatedStayOutcome {
  /** End date of the stay (inclusive): startDate + totalNights − 1. */
  computedEndDate: string;
  /** The status that will be assigned at creation time. */
  projectedStatus: "PENDING" | "ACTIVE" | "FINISHED";
  /** True iff the projected status is FINISHED (drives the completion alert). */
  showCompletionAlert: boolean;
}

/**
 * Describes the outcome of creating a stay with a given start date and total nights.
 * Used by the QuickOnboardingForm to show/hide the completion alert in real time
 * as the admin adjusts total nights.
 *
 * - `computedEndDate`: the inclusive end date (start + nights − 1)
 * - `projectedStatus`: what `determineInitialStatus` would return
 * - `showCompletionAlert`: true exactly when the projected status is FINISHED
 *   (Req 2.1 — end date before today means instant FINISHED)
 *
 * Req 2.1, 2.3, 2.5
 */
export function describeBackdatedStayOutcome(
  startDate: string,
  totalNights: number,
  todayIST: string = getISTDateString(0)
): BackdatedStayOutcome {
  const computedEndDate = computeEndDate(startDate, totalNights);
  const projectedStatus = determineInitialStatus(startDate, totalNights, todayIST);
  return {
    computedEndDate,
    projectedStatus,
    showCompletionAlert: projectedStatus === "FINISHED",
  };
}
