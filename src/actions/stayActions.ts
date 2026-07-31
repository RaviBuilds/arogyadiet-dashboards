"use server";

// src/actions/stayActions.ts
//
// Server Actions for stay lifecycle management.
// Handles stay extension, new stay creation, expiration marking,
// and active/history stay retrieval.
//
// Requirements: 4.4, 8.1, 8.2, 8.3, 14.1, 14.2, 14.3, 14.4, 14.5

import * as stayRepository from "@/repositories/stayRepository";
import * as AccommodationService from "@/services/AccommodationService";
import {
  extendStaySchema,
  createStaySchema,
  type ExtendStayInput,
  type CreateStayInput,
} from "@/validations/accommodationSchema";
import type { StayEntry } from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a StayEntryRow (snake_case DB row) to a StayEntry (camelCase domain type)
 * including the computed endDate.
 */
function mapRowToStayEntry(
  row: stayRepository.StayEntryRow
): StayEntry {
  const endDate = AccommodationService.computeEndDate(
    row.start_date,
    row.total_nights
  );

  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    startDate: row.start_date,
    totalNights: row.total_nights,
    stayType: row.stay_type as StayEntry["stayType"],
    occupancyType: row.occupancy_type as StayEntry["occupancyType"],
    status: row.status as StayEntry["status"],
    paymentAmount: row.payment_amount,
    baseAmount: row.base_amount,
    taxAmount: row.tax_amount,
    taxPercentage: row.tax_percentage,
    paymentHostProfileId: row.payment_host_profile_id,
    mealPreference: row.meal_preference as StayEntry["mealPreference"],
    endDate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Payment-lifecycle columns are added by the additive migration and mapped
    // once StayEntryRow carries them; pre-migration rows use these defaults.
    isBackdated: false,
    earlyCheckoutApplied: false,
    actualNightsStayed: null,
    originalTotalNights: null,
    originalTotalAmount: null,
    checkedOutAt: null,
    finalInvoicePaymentId: null,
    finalInvoiceGeneratedAt: null,
    finalInvoiceError: null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Extends an active stay by adding additional nights with a new payment.
 *
 * Business rules:
 * - Stay must exist
 * - Stay must be in ACTIVE status
 *
 * Req 14.1, 14.2, 14.6
 */
export async function extendStayAction(
  stayId: string,
  input: ExtendStayInput
): Promise<{ success: true; data: { newEndDate: string } } | { error: string }> {
  // Validate input
  const parsed = extendStaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { additionalNights, paymentAmount } = parsed.data;

  // Verify stay exists and is ACTIVE
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { error: "Stay entry not found" };
  }

  if (stay.status !== "ACTIVE") {
    return { error: "Only active stays can be extended" };
  }

  // Delegate to service layer
  const { newEndDate } = await AccommodationService.extendStay(
    stayId,
    additionalNights,
    paymentAmount
  );

  return { success: true, data: { newEndDate } };
}

/**
 * Creates a new stay entry for a returning customer.
 *
 * Business rules:
 * - No existing ACTIVE or PENDING stay for the customer
 *
 * Req 14.3, 14.4
 */
export async function createNewStayAction(
  customerProfileId: string,
  input: CreateStayInput
): Promise<{ success: true; data: { stayId: string } } | { error: string }> {
  // Validate input
  const parsed = createStaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { startDate, totalNights, stayType, occupancyType, paymentAmount, mealPreference } =
    parsed.data;

  // Check for existing ACTIVE stay
  const activeStay = await stayRepository.getActiveStay(customerProfileId);
  if (activeStay) {
    return {
      error: "Current stay must be finished or expired before a new one can be created",
    };
  }

  // Check for existing PENDING stays
  const pendingStays = await stayRepository.getPendingStays(customerProfileId);
  if (pendingStays.length > 0) {
    return {
      error: "Current stay must be finished or expired before a new one can be created",
    };
  }

  // Delegate to service layer
  const newStay = await AccommodationService.createStay({
    customerProfileId,
    startDate,
    totalNights,
    stayType,
    occupancyType,
    mealPreference,
    paymentAmount,
    paymentHostProfileId: null,
  });

  return { success: true, data: { stayId: newStay.id } };
}

/**
 * Marks a PENDING stay as expired (no-show).
 *
 * Req 4.4, 4.6
 */
export async function markStayExpiredAction(
  stayId: string
): Promise<{ success: true } | { error: string }> {
  const result = await AccommodationService.markExpired(stayId);

  if ("error" in result) {
    return { error: result.error };
  }

  return { success: true };
}

/**
 * Gets the active stay for a customer. If no active stay exists,
 * returns the earliest pending stay. Returns null if neither exists.
 *
 * Req 8.1, 8.2
 */
export async function getActiveStayAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry | null } | { error: string }> {
  try {
    // Try to get the active stay first
    const activeRow = await stayRepository.getActiveStay(customerProfileId);
    if (activeRow) {
      return { success: true, data: mapRowToStayEntry(activeRow) };
    }

    // Fall back to earliest pending stay
    const pendingStays = await stayRepository.getPendingStays(customerProfileId);
    if (pendingStays.length > 0) {
      return { success: true, data: mapRowToStayEntry(pendingStays[0]) };
    }

    return { success: true, data: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch active stay";
    return { error: message };
  }
}

/**
 * Gets the stay history (FINISHED and EXPIRED) for a customer.
 *
 * Req 8.3, 14.5
 */
export async function getStayHistoryAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry[] } | { error: string }> {
  try {
    const rows = await stayRepository.getStayHistory(customerProfileId);
    const stays = rows.map(mapRowToStayEntry);
    return { success: true, data: stays };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch stay history";
    return { error: message };
  }
}
