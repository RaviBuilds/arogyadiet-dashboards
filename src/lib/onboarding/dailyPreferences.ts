// src/lib/onboarding/dailyPreferences.ts
// Feature: onboarding-past-date-flexibility — Pure daily preferences generation
// logic for past-date onboarding (Requirements 3.3, 4.1–4.6, 6.1–6.7).
//
// This module contains PURE functions that compute the daily preference records
// and subscription adjustments for past-date onboarding. They depend only on
// their inputs and produce deterministic outputs, making them fully testable
// without mocking.
//
// The caller (OnboardingService.onboard) resolves meal_category_ids and
// delivery_address_ids from the DB, then passes them here for the pure
// computation. The results are then persisted within the transaction.

import { addDaysToISODate } from "@/lib/dates/ist";
import type { PastDayStatus } from "@/types/onboarding";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single daily preference record ready for DB insertion. */
export interface DailyPreferenceRecord {
  subscription_id: string;
  customer_profile_id: string;
  preference_date: string; // YYYY-MM-DD
  meal_category_id: string;
  delivery_address_id: string;
  is_paused: boolean;
  pause_credit_used: boolean;
}

/** Context needed to generate daily preferences for past-date onboarding. */
export interface DailyPreferencesContext {
  subscriptionId: string;
  customerProfileId: string;
  /** The subscription start date (YYYY-MM-DD). */
  startsOn: string;
  /** Original end date based on plan duration (YYYY-MM-DD). */
  originalEndsOn: string;
  /** Plan duration in days. */
  totalDays: number;
  /** The initial meal category ID (resolved from the selected meal preference). */
  initialMealCategoryId: string;
  /** The primary address ID (resolved from the just-created address). */
  primaryAddressId: string;
  /** The secondary address ID, if one exists. Null when customer has only one address. */
  secondaryAddressId: string | null;
  /** Map from meal type codes (VEG, EGG, CHICKEN) to their meal_category_id UUIDs. */
  mealCategoryMap: Record<string, string>;
  /** The boundary date (inclusive, YYYY-MM-DD) — past days are startDate..boundaryDate. */
  boundaryDate: string;
  /** The captured past day statuses. */
  pastDayStatuses: PastDayStatus[];
}

/** The result of generating daily preferences for past-date onboarding. */
export interface DailyPreferencesResult {
  /** The generated daily preference records ready for insertion. */
  records: DailyPreferenceRecord[];
  /** Number of skipped days in the past period. */
  skippedCount: number;
  /** The adjusted effective end date (original end date + skippedCount days). */
  effectiveEndOn: string;
  /** The total expected record count (totalDays + skippedCount). */
  expectedRecordCount: number;
}

/** Error thrown when the record count validation fails. */
export class RecordCountMismatchError extends Error {
  constructor(
    public expected: number,
    public actual: number,
  ) {
    super(
      `Daily preferences record count mismatch: expected ${expected}, got ${actual}.`,
    );
    this.name = "RecordCountMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Pure generation logic
// ---------------------------------------------------------------------------

/**
 * Generate daily preference records for a past-date onboarding.
 *
 * The logic:
 *   - Past days (startDate..boundaryDate inclusive): use the captured statuses.
 *     - Delivered → is_paused=false, pause_credit_used=false, mapped meal_category_id
 *       and delivery_address_id from the captured mealType/deliveryAddress.
 *     - Skipped → is_paused=true, pause_credit_used=true, initial meal preference,
 *       primary address.
 *   - Future days (boundaryDate+1..effectiveEndOn inclusive): use initial meal
 *     preference and primary address, is_paused=false, pause_credit_used=false.
 *
 * The effective end date is extended by the number of skipped days, so the
 * customer receives the full planDuration of active delivery days.
 *
 * Total records = totalDays + skippedCount
 *   (totalDays original days + skippedCount extension days)
 *
 * Throws RecordCountMismatchError if the generated count doesn't match the
 * expected count, which would indicate a logic error.
 *
 * Pure over its inputs.
 * Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5
 */
export function generateDailyPreferences(
  ctx: DailyPreferencesContext,
): DailyPreferencesResult {
  const {
    subscriptionId,
    customerProfileId,
    startsOn,
    originalEndsOn,
    totalDays,
    initialMealCategoryId,
    primaryAddressId,
    secondaryAddressId,
    mealCategoryMap,
    boundaryDate,
    pastDayStatuses,
  } = ctx;

  // Calculate skipped count from the past day statuses.
  const skippedCount = pastDayStatuses.filter(
    (s) => s.mealStatus === "Skipped",
  ).length;

  // Adjust effective end date: original + skippedCount days.
  const effectiveEndOn = addDaysToISODate(originalEndsOn, skippedCount);

  // Build a lookup map from date → PastDayStatus for O(1) access.
  const statusByDate = new Map<string, PastDayStatus>();
  for (const status of pastDayStatuses) {
    statusByDate.set(status.date, status);
  }

  const records: DailyPreferenceRecord[] = [];

  // Generate records from startsOn through effectiveEndOn (inclusive).
  let currentDate = startsOn;
  while (currentDate <= effectiveEndOn) {
    const pastStatus = statusByDate.get(currentDate);

    if (pastStatus) {
      // This is a past day with a captured status.
      if (pastStatus.mealStatus === "Delivered") {
        // Delivered: use the captured meal type and delivery address.
        const mealCategoryId =
          mealCategoryMap[pastStatus.mealType!] ?? initialMealCategoryId;
        const deliveryAddressId = resolveDeliveryAddress(
          pastStatus.deliveryAddress!,
          primaryAddressId,
          secondaryAddressId,
        );

        records.push({
          subscription_id: subscriptionId,
          customer_profile_id: customerProfileId,
          preference_date: currentDate,
          meal_category_id: mealCategoryId,
          delivery_address_id: deliveryAddressId,
          is_paused: false,
          pause_credit_used: false,
        });
      } else {
        // Skipped: use initial meal preference and primary address.
        records.push({
          subscription_id: subscriptionId,
          customer_profile_id: customerProfileId,
          preference_date: currentDate,
          meal_category_id: initialMealCategoryId,
          delivery_address_id: primaryAddressId,
          is_paused: true,
          pause_credit_used: true,
        });
      }
    } else {
      // Future day (or a day beyond the boundary): use initial defaults.
      records.push({
        subscription_id: subscriptionId,
        customer_profile_id: customerProfileId,
        preference_date: currentDate,
        meal_category_id: initialMealCategoryId,
        delivery_address_id: primaryAddressId,
        is_paused: false,
        pause_credit_used: false,
      });
    }

    currentDate = addDaysToISODate(currentDate, 1);
  }

  // Validate record count: total_days + skippedCount (Req 6.5).
  const expectedRecordCount = totalDays + skippedCount;
  if (records.length !== expectedRecordCount) {
    throw new RecordCountMismatchError(expectedRecordCount, records.length);
  }

  return {
    records,
    skippedCount,
    effectiveEndOn,
    expectedRecordCount,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the delivery address ID based on the captured "Primary" or "Secondary"
 * selection. Falls back to primary if secondary is null (customer has only one
 * address).
 */
function resolveDeliveryAddress(
  addressLabel: "Primary" | "Secondary",
  primaryAddressId: string,
  secondaryAddressId: string | null,
): string {
  if (addressLabel === "Secondary" && secondaryAddressId) {
    return secondaryAddressId;
  }
  return primaryAddressId;
}
