// Feature: new-plan-past-date-start — overlap detection and server-side
// validation helpers for the Admin Add Subscription form.
//
// All functions are PURE and deterministic over their inputs — no wall-clock
// reads, no side effects. This makes them unit- and property-testable without
// mocking.
//
// Requirements: 1.3, 1.4, 1.5, 2.1, 2.4, 5.1, 5.4, 5.5

import { addDaysToISODate } from "@/lib/dates/ist";
import { PAST_DATE_MAX_DAYS } from "@/lib/onboarding/cutoff";
import type { PastDayStatus } from "@/types/onboarding";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Represents an existing subscription used for overlap checking.
 * Only ACTIVE and PENDING subscriptions are considered for overlap.
 */
export interface ExistingSubscription {
  starts_on: string;
  effective_end_on: string;
  status: string;
}

// ─── Overlap Detection ─────────────────────────────────────────────────────────

/**
 * Returns `true` if the proposed subscription range [newStart, newEnd] overlaps
 * with any existing subscription that has status ACTIVE or PENDING.
 *
 * Two date ranges [A_start, A_end] and [B_start, B_end] overlap iff:
 *   A_start <= B_end AND A_end >= B_start
 *
 * Pure over its inputs. (Requirements 2.4, 5.2)
 */
export function hasOverlap(
  newStart: string,
  newEnd: string,
  existingSubscriptions: ExistingSubscription[],
): boolean {
  return existingSubscriptions.some((sub) => {
    if (sub.status !== "ACTIVE" && sub.status !== "PENDING") {
      return false;
    }
    return sub.starts_on <= newEnd && sub.effective_end_on >= newStart;
  });
}

// ─── Server-Side Past Start Date Validation ────────────────────────────────────

/**
 * Returns `true` if `startDate` is a valid past start date for the Admin Add
 * Subscription form:
 *   (a) startDate is strictly before istToday
 *   (b) startDate is strictly after previousEndDate (when it exists)
 *   (c) startDate is within the last 30 days from istToday
 *
 * Pure over its inputs. (Requirements 5.1)
 */
export function isValidPastStartDate(
  startDate: string,
  istToday: string,
  previousEndDate: string | null,
): boolean {
  // (a) Must be in the past
  if (startDate >= istToday) {
    return false;
  }

  // (b) Must be after previousEndDate when it exists
  if (previousEndDate && startDate <= previousEndDate) {
    return false;
  }

  // (c) Must be within 30 days from today
  const thirtyDaysAgo = addDaysToISODate(istToday, -PAST_DATE_MAX_DAYS);
  if (startDate < thirtyDaysAgo) {
    return false;
  }

  return true;
}

// ─── Past Day Statuses Validation ──────────────────────────────────────────────

/** Valid meal types for delivered entries. */
const VALID_MEAL_TYPES = new Set(["VEG", "EGG", "CHICKEN"]);

/** Valid delivery addresses for delivered entries. */
const VALID_DELIVERY_ADDRESSES = new Set(["Primary", "Secondary"]);

/**
 * Validates an array of PastDayStatus entries against the required date range.
 *
 * Returns `{ valid: true }` if ALL of the following hold:
 *   (a) entries cover every date from startDate through boundaryDate (inclusive)
 *   (b) each entry has mealStatus "Delivered" or "Skipped"
 *   (c) "Delivered" entries have non-null mealType in {VEG, EGG, CHICKEN}
 *       and non-null deliveryAddress in {Primary, Secondary}
 *   (d) entry count is between 1 and 30 inclusive
 *
 * Returns `{ valid: false, reason: string }` otherwise.
 *
 * Pure over its inputs. (Requirements 5.4, 5.5)
 */
export function validatePastDayStatuses(
  entries: PastDayStatus[],
  startDate: string,
  boundaryDate: string,
): { valid: true } | { valid: false; reason: string } {
  // (d) Entry count must be between 1 and 30
  if (entries.length < 1 || entries.length > 30) {
    return {
      valid: false,
      reason: `Entry count must be between 1 and 30, got ${entries.length}.`,
    };
  }

  // Build set of expected dates from startDate through boundaryDate (inclusive)
  const expectedDates = new Set<string>();
  let current = startDate;
  while (current <= boundaryDate) {
    expectedDates.add(current);
    current = addDaysToISODate(current, 1);
  }

  // (a) entries must cover every expected date
  if (entries.length !== expectedDates.size) {
    return {
      valid: false,
      reason: `Expected ${expectedDates.size} entries (from ${startDate} to ${boundaryDate}), got ${entries.length}.`,
    };
  }

  const entryDates = new Set<string>();
  for (const entry of entries) {
    // Check entry date is in expected range
    if (!expectedDates.has(entry.date)) {
      return {
        valid: false,
        reason: `Entry date ${entry.date} is outside the expected range ${startDate} to ${boundaryDate}.`,
      };
    }

    // Check for duplicate dates
    if (entryDates.has(entry.date)) {
      return {
        valid: false,
        reason: `Duplicate entry for date ${entry.date}.`,
      };
    }
    entryDates.add(entry.date);

    // (b) mealStatus must be "Delivered" or "Skipped"
    if (entry.mealStatus !== "Delivered" && entry.mealStatus !== "Skipped") {
      return {
        valid: false,
        reason: `Invalid mealStatus "${entry.mealStatus}" for date ${entry.date}.`,
      };
    }

    // (c) Delivered entries must have valid mealType and deliveryAddress
    if (entry.mealStatus === "Delivered") {
      if (!entry.mealType || !VALID_MEAL_TYPES.has(entry.mealType)) {
        return {
          valid: false,
          reason: `Delivered entry for ${entry.date} must have a valid mealType (VEG, EGG, or CHICKEN).`,
        };
      }
      if (
        !entry.deliveryAddress ||
        !VALID_DELIVERY_ADDRESSES.has(entry.deliveryAddress)
      ) {
        return {
          valid: false,
          reason: `Delivered entry for ${entry.date} must have a valid deliveryAddress (Primary or Secondary).`,
        };
      }
    }
  }

  // Verify all expected dates are covered
  for (const expected of expectedDates) {
    if (!entryDates.has(expected)) {
      return {
        valid: false,
        reason: `Missing entry for date ${expected}.`,
      };
    }
  }

  return { valid: true };
}
