"use server";

// src/actions/stayActions.ts
//
// Server Actions for stay lifecycle management.
// Handles stay extension, new stay creation, expiration marking,
// checkout, early checkout, and active/history stay retrieval.
//
// Requirements: 4.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 11.1, 11.2,
//   11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13, 12.14,
//   14.1, 14.2, 14.3, 14.4, 14.5

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { getISTDateString } from "@/lib/dates/ist";
import * as stayRepository from "@/repositories/stayRepository";
import * as AccommodationService from "@/services/AccommodationService";
import {
  extendStaySchema,
  createStaySchema,
  createEarlyCheckoutSchema,
  type ExtendStayInput,
  type CreateStayInput,
} from "@/validations/accommodationSchema";
import type {
  StayEntry,
  StayBalanceSnapshot,
  EarlyCheckoutOutcome,
} from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a StayEntryRow (snake_case DB row) to a StayEntry (camelCase domain type)
 * including the computed endDate and all payment-lifecycle columns.
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
    isBackdated: row.is_backdated,
    earlyCheckoutApplied: row.early_checkout_applied,
    actualNightsStayed: row.actual_nights_stayed,
    originalTotalNights: row.original_total_nights,
    originalTotalAmount: row.original_total_amount,
    checkedOutAt: row.checked_out_at,
    finalInvoicePaymentId: row.final_invoice_payment_id,
    finalInvoiceGeneratedAt: row.final_invoice_generated_at,
    finalInvoiceError: row.final_invoice_error,
  };
}

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Extends an active stay by adding additional nights with an additional cost amount.
 *
 * Business rules:
 * - Admin auth required
 * - Stay must exist
 * - Stay must be in ACTIVE status
 * - No Payment_Transaction is created for the extension cost (Req 11.2)
 * - Returns the new end date and the updated balance snapshot (Req 11.4)
 *
 * Req 11.1, 11.2, 11.4, 14.1, 14.2, 14.6
 */
export async function extendStayAction(
  stayId: string,
  input: ExtendStayInput
): Promise<ActionResult<{ newEndDate: string; balance: StayBalanceSnapshot }>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Validate input
  const parsed = extendStaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { additionalNights, paymentAmount } = parsed.data;

  // 3. Verify stay exists and is ACTIVE
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { error: "Stay entry not found" };
  }

  if (stay.status !== "ACTIVE") {
    return { error: "Only active stays can be extended" };
  }

  // 4. Delegate to service layer — returns newEndDate + balance snapshot
  const { newEndDate, balance } = await AccommodationService.extendStay(
    stayId,
    additionalNights,
    paymentAmount,
    ctx.userId
  );

  return { success: true, data: { newEndDate, balance } };
}

/**
 * Marks an ACTIVE stay as checked out (FINISHED).
 *
 * Server-side gate: rejects an outstanding balance and a non-ACTIVE stay
 * regardless of client-side button state.
 *
 * Flow: admin auth → call AccommodationService.checkoutStay → map reason
 * to user-facing error or return the outcome.
 *
 * Req 7.1, 7.2, 7.3, 7.4, 7.5
 */
export async function markStayCheckedOutAction(
  stayId: string
): Promise<
  ActionResult<{
    status: "FINISHED";
    invoiceStatus: "GENERATED" | "PENDING_RETRY" | "NOT_APPLICABLE";
  }>
> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. End-date gate. A normal checkout may only be actioned once the stay has
  //    reached its inclusive end date; leaving early goes through
  //    earlyCheckoutStayAction, which recalculates the amount for the nights
  //    actually stayed. Enforced here in the action rather than inside
  //    AccommodationService.checkoutStay, because `earlyCheckout` calls
  //    checkoutStay internally once the balance settles — and that call is by
  //    definition before the end date, so gating the service would break it.
  const stayForDateGate = await stayRepository.getStayById(stayId);
  if (!stayForDateGate) {
    return { error: "Stay entry not found." };
  }

  const endDate = AccommodationService.computeEndDate(
    stayForDateGate.start_date,
    stayForDateGate.total_nights
  );
  const todayIST = getISTDateString(0);

  // YYYY-MM-DD strings compare correctly lexicographically.
  if (todayIST < endDate) {
    return {
      error: `This stay runs until ${endDate}. Checkout opens on that date — use Early Checkout to close it sooner and recalculate the amount.`,
    };
  }

  // 3. Delegate to service orchestration
  const result = await AccommodationService.checkoutStay(stayId);

  if (!result.ok) {
    // Map RPC reasons to user-facing messages
    switch (result.reason) {
      case "BALANCE_OUTSTANDING":
        return {
          error: `The full balance must be paid before checkout. Outstanding: ₹${result.remainingBalance ?? 0}.`,
        };
      case "NOT_ACTIVE":
        return { error: "Checkout applies only to active stays." };
      case "NOT_FOUND":
        return { error: "Stay entry not found." };
      default:
        return { error: "Checkout failed." };
    }
  }

  return {
    success: true,
    data: { status: result.status, invoiceStatus: result.invoiceStatus },
  };
}

/**
 * Applies an early checkout to an ACTIVE stay: recalculates nights and amount,
 * determines the follow-up step the Accommodation tab must render.
 *
 * Flow: admin auth → fetch stay to get total_nights → validate input through
 * createEarlyCheckoutSchema(bookedTotalNights) → call
 * AccommodationService.earlyCheckout → return the EarlyCheckoutOutcome.
 *
 * Req 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.12, 12.13, 12.14
 */
export async function earlyCheckoutStayAction(
  stayId: string,
  input: unknown
): Promise<ActionResult<EarlyCheckoutOutcome>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Fetch the stay to get total_nights for schema construction
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { error: "Stay entry not found." };
  }

  // 3. Validate input through the dynamic schema bounded by the stay's booked nights
  const schema = createEarlyCheckoutSchema(stay.total_nights);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString();
      if (field) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      fieldErrors,
    };
  }

  const { actualNightsStayed, recalculatedStayAmount } = parsed.data;

  // 4. Delegate to service orchestration
  const result = await AccommodationService.earlyCheckout(
    stayId,
    actualNightsStayed,
    recalculatedStayAmount
  );

  // Service returns { ok: false; error } on failure
  if ("ok" in result && !result.ok) {
    return { error: result.error };
  }

  // Success path — result is an EarlyCheckoutOutcome
  return { success: true, data: result as EarlyCheckoutOutcome };
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

/**
 * Gets ALL stays for a customer (every Stay_Status), ordered by start_date
 * descending (most recent first). Used by the Accommodation_Tab so a
 * Backdated_Stay — FINISHED immediately at creation — is still selectable
 * and reachable for its payment panel and invoice action (Req 9.1, 9.2).
 *
 * Req 9.1, 9.2
 */
export async function getAllStaysAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry[] } | { error: string }> {
  try {
    const rows = await stayRepository.getStaysByCustomer(customerProfileId);
    const stays = rows.map(mapRowToStayEntry);
    return { success: true, data: stays };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch stays";
    return { error: message };
  }
}
