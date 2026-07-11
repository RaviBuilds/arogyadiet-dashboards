// src/services/AccommodationService.ts
//
// Business logic layer for the ACCOMMODATION customer category.
// Handles GST calculation, date computations, status transitions,
// and profile completion logic. Server Actions delegate to this
// service — keeping actions thin and business rules testable.
//
// Requirements: 4.1, 4.5, 4.6, 5.1, 5.2, 5.3, 6.3

import { addDays, parseISO, format } from "date-fns";

import { getISTDateString } from "@/lib/dates/ist";
import { createAdminClient } from "@/lib/supabase/admin";
import * as stayRepository from "@/repositories/stayRepository";
import type { StayEntryRow, CreateStayEntryInput } from "@/repositories/stayRepository";
import type { StayStatus, StayType, OccupancyType, MealPreference } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Valid Status Transitions
// ---------------------------------------------------------------------------

/**
 * Defines which status transitions are allowed for a Stay_Entry.
 *
 * - PENDING → ACTIVE (cron activates when start date arrives)
 * - PENDING → EXPIRED (admin marks as no-show)
 * - ACTIVE → FINISHED (cron finishes when end date passes)
 * - FINISHED → (terminal)
 * - EXPIRED → (terminal)
 *
 * Req 4.6
 */
export const VALID_TRANSITIONS: Record<StayStatus, StayStatus[]> = {
  PENDING: ["ACTIVE", "EXPIRED"],
  ACTIVE: ["FINISHED"],
  FINISHED: [],
  EXPIRED: [],
};

// ---------------------------------------------------------------------------
// GST Calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the GST breakup from a total (GST-inclusive) amount.
 *
 * Formula:
 *   baseAmount = round(totalAmount / 1.18, 2)
 *   taxAmount  = round(totalAmount - baseAmount, 2)
 *   taxPercentage = 18
 *
 * Req 5.1, 5.2, 5.3
 */
export function calculateGstBreakup(totalAmount: number): {
  baseAmount: number;
  taxAmount: number;
  taxPercentage: number;
} {
  const baseAmount = Math.round((totalAmount / 1.18) * 100) / 100;
  const taxAmount = Math.round((totalAmount - baseAmount) * 100) / 100;
  return { baseAmount, taxAmount, taxPercentage: 18 };
}

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
 * Determines the initial Stay_Status for a new Stay_Entry based on start date.
 *
 * Comparison is performed in IST (Asia/Kolkata) timezone:
 * - If startDate is after today → PENDING
 * - If startDate equals today → ACTIVE
 *
 * Req 4.1
 */
export function determineInitialStatus(
  startDate: string
): "PENDING" | "ACTIVE" {
  const todayIST = getISTDateString(0);
  // YYYY-MM-DD strings compare correctly lexicographically
  if (startDate > todayIST) {
    return "PENDING";
  }
  return "ACTIVE";
}

// ---------------------------------------------------------------------------
// Status Transition Enforcement
// ---------------------------------------------------------------------------

/**
 * Validates and enforces a status transition for a Stay_Entry.
 *
 * Returns { success: true } if the transition is valid, or
 * { error: string } with a descriptive message if the transition is invalid.
 *
 * Req 4.6
 */
export function transitionStatus(
  currentStatus: StayStatus,
  targetStatus: StayStatus
): { success: true } | { error: string } {
  const allowed = VALID_TRANSITIONS[currentStatus];

  if (allowed.includes(targetStatus)) {
    return { success: true };
  }

  if (allowed.length === 0) {
    return {
      error: `Cannot transition from ${currentStatus}: it is a terminal status with no valid transitions.`,
    };
  }

  return {
    error: `Invalid transition from ${currentStatus} to ${targetStatus}. Allowed transitions from ${currentStatus}: ${allowed.join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Profile Completion Helper
// ---------------------------------------------------------------------------

/**
 * Determines whether the profile completion button should be enabled.
 *
 * Returns true if:
 * - The medical history textarea has at least 1 non-whitespace character, OR
 * - The medical history confirmation checkbox is checked (true)
 *
 * Used for the "Mark complete onboarding" button enablement logic in the
 * Profile_Completion_Popup.
 *
 * Req 6.3
 */
export function isProfileComplete(
  medicalHistoryText: string | null,
  medicalHistoryConfirmed: boolean
): boolean {
  if (medicalHistoryConfirmed) {
    return true;
  }
  if (medicalHistoryText && medicalHistoryText.trim().length > 0) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Stay Lifecycle Methods
// ---------------------------------------------------------------------------

/**
 * Input for creating a new stay via the service layer.
 */
export interface CreateStayInput {
  customerProfileId: string;
  startDate: string;
  totalNights: number;
  stayType: StayType;
  occupancyType: OccupancyType;
  mealPreference: MealPreference;
  paymentAmount: number | null;
  paymentHostProfileId: string | null;
  /** The ACCOMMODATION subscription ID — used to link the payment record. */
  subscriptionId?: string | null;
}

/**
 * Creates a new stay entry with proper GST calculation and status assignment.
 *
 * - If paymentHostProfileId is set (shared payment), GST breakup is skipped
 *   and payment fields are stored as null.
 * - Initial status is determined based on startDate vs. today (IST).
 *
 * Req 2.6, 3.4, 4.1, 14.3
 */
export async function createStay(
  input: CreateStayInput
): Promise<StayEntryRow> {
  const status = determineInitialStatus(input.startDate);

  let paymentAmount: number | null = null;
  let baseAmount: number | null = null;
  let taxAmount: number | null = null;
  let taxPercentage = 18;

  // Skip billing when shared payment (paymentHostProfileId is set)
  if (!shouldSkipBilling(input.paymentHostProfileId) && input.paymentAmount) {
    const gst = calculateGstBreakup(input.paymentAmount);
    paymentAmount = input.paymentAmount;
    baseAmount = gst.baseAmount;
    taxAmount = gst.taxAmount;
    taxPercentage = gst.taxPercentage;
  }

  const repoInput: CreateStayEntryInput = {
    customer_profile_id: input.customerProfileId,
    start_date: input.startDate,
    total_nights: input.totalNights,
    stay_type: input.stayType,
    occupancy_type: input.occupancyType,
    status,
    payment_amount: paymentAmount,
    base_amount: baseAmount,
    tax_amount: taxAmount,
    tax_percentage: taxPercentage,
    payment_host_profile_id: input.paymentHostProfileId,
    meal_preference: input.mealPreference,
  };

  const stay = await stayRepository.createStayEntry(repoInput);

  // Insert a corresponding `payments` row so the payment shows up in Billing
  // views (admin Billing tab + customer Billing page). Skipped for shared-
  // payment stays (Req 2.7, 5.5).
  if (paymentAmount && !shouldSkipBilling(input.paymentHostProfileId)) {
    const admin = createAdminClient();
    await admin.from("payments").insert({
      customer_profile_id: input.customerProfileId,
      subscription_id: input.subscriptionId ?? null,
      payment_method: "Manual",
      amount: paymentAmount,
      base_amount: baseAmount,
      tax_percent: taxPercentage,
      tax_amount: taxAmount,
      discount_amount: 0,
      status: "PAID",
      paid_at: new Date().toISOString(),
      invoice_type: "ACCOMMODATION_STAY",
      payment_notes: `Stay: ${input.stayType}, ${input.totalNights} nights from ${input.startDate}`,
    });
  }

  return stay;
}

/**
 * Extends an active stay by adding additional nights with a new payment.
 *
 * Calculates GST breakup for the extension payment and delegates to the
 * repository to increment total_nights and accumulate payment amounts.
 * Returns the updated stay entry with the new end date.
 *
 * Req 14.1, 14.2, 14.6
 */
export async function extendStay(
  stayId: string,
  additionalNights: number,
  paymentAmount: number
): Promise<{ updatedStay: StayEntryRow; newEndDate: string }> {
  const gst = calculateGstBreakup(paymentAmount);

  const updatedStay = await stayRepository.extendStay(
    stayId,
    additionalNights,
    paymentAmount,
    gst.baseAmount,
    gst.taxAmount
  );

  const newEndDate = computeEndDate(
    updatedStay.start_date,
    updatedStay.total_nights
  );

  // Insert a `payments` row for the extension payment so it appears in
  // Billing views (Req 14.1, 14.6).
  const admin = createAdminClient();
  await admin.from("payments").insert({
    customer_profile_id: updatedStay.customer_profile_id,
    subscription_id: null,
    payment_method: "Manual",
    amount: paymentAmount,
    base_amount: gst.baseAmount,
    tax_percent: gst.taxPercentage,
    tax_amount: gst.taxAmount,
    discount_amount: 0,
    status: "PAID",
    paid_at: new Date().toISOString(),
    invoice_type: "ACCOMMODATION_EXTENSION",
    payment_notes: `Stay extension: +${additionalNights} nights (new end: ${newEndDate})`,
  });

  return { updatedStay, newEndDate };
}

/**
 * Batch transition stays for the daily cron job.
 *
 * Logic:
 * - PENDING stays: if startDate <= currentDate AND endDate >= currentDate → ACTIVE
 * - ACTIVE stays: if endDate < currentDate → FINISHED
 *
 * Returns counts of activated and finished transitions.
 *
 * Req 4.2, 4.3
 */
export async function transitionStays(
  currentDate: string
): Promise<{ activated: number; finished: number }> {
  const stays = await stayRepository.getStaysForTransition(currentDate);

  let activated = 0;
  let finished = 0;

  for (const stay of stays) {
    const endDate = computeEndDate(stay.start_date, stay.total_nights);

    if (stay.status === "PENDING") {
      // PENDING → ACTIVE: start_date <= currentDate AND endDate >= currentDate
      if (stay.start_date <= currentDate && endDate >= currentDate) {
        const result = transitionStatus(
          stay.status as StayStatus,
          "ACTIVE"
        );
        if ("success" in result) {
          await stayRepository.updateStayStatus(stay.id, "ACTIVE");
          activated++;
        }
      }
    } else if (stay.status === "ACTIVE") {
      // ACTIVE → FINISHED: endDate < currentDate
      if (endDate < currentDate) {
        const result = transitionStatus(
          stay.status as StayStatus,
          "FINISHED"
        );
        if ("success" in result) {
          await stayRepository.updateStayStatus(stay.id, "FINISHED");
          finished++;
        }
      }
    }
  }

  return { activated, finished };
}

/**
 * Admin marks a PENDING stay as no-show (EXPIRED).
 *
 * Validates:
 * - Stay exists
 * - Stay has PENDING status
 * - PENDING → EXPIRED is a valid transition
 *
 * Req 4.4, 4.6
 */
export async function markExpired(
  stayId: string
): Promise<{ success: true } | { error: string }> {
  const stay = await stayRepository.getStayById(stayId);

  if (!stay) {
    return { error: `Stay entry with id ${stayId} not found.` };
  }

  if (stay.status !== "PENDING") {
    return {
      error: `Cannot mark stay as expired: current status is ${stay.status}. Only PENDING stays can be marked as expired.`,
    };
  }

  const transition = transitionStatus(
    stay.status as StayStatus,
    "EXPIRED"
  );

  if ("error" in transition) {
    return { error: transition.error };
  }

  await stayRepository.updateStayStatus(stayId, "EXPIRED");
  return { success: true };
}

/**
 * Determines whether billing should be skipped for a stay entry.
 *
 * Returns true if paymentHostProfileId is set (non-null), indicating
 * the stay is covered by a shared payment from another customer.
 * Used by actions to determine whether to create payment/invoice records.
 *
 * Req 2.6, 2.7
 */
export function shouldSkipBilling(
  paymentHostProfileId: string | null
): boolean {
  return paymentHostProfileId !== null;
}
