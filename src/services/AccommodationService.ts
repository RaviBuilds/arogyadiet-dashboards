// src/services/AccommodationService.ts
//
// Business logic layer for the ACCOMMODATION customer category.
// Handles GST calculation, date computations, status transitions,
// and profile completion logic. Server Actions delegate to this
// service — keeping actions thin and business rules testable.
//
// Requirements: 4.1, 4.5, 4.6, 5.1, 5.2, 5.3, 6.3

import { addDays, differenceInDays, parseISO, format } from "date-fns";

import { createAdminClient } from "@/lib/supabase/admin";
import { getISTDateString, addDaysToISODate } from "@/lib/dates/ist";
import {
  MAX_BACKDATED_DAYS,
  MAX_FORWARD_START_DAYS,
} from "@/validations/accommodationSchema";
import * as stayRepository from "@/repositories/stayRepository";
import type { StayEntryRow, CreateStayEntryInput } from "@/repositories/stayRepository";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import type { StayPaymentTransactionRow } from "@/repositories/stayPaymentRepository";
import {
  computeEndDate,
  determineInitialStatus,
} from "@/lib/accommodation/backdatedStay";
import {
  PAYMENT_TRANSACTION_LABELS,
  type StayStatus,
  type StayType,
  type OccupancyType,
  type MealPreference,
  type StayPaymentTransaction,
  type StayBalanceSnapshot,
  type StayEntry,
  type StayActionVisibility,
  type EarlyCheckoutOutcome,
  type PaymentHistoryRow,
  type PaymentReceiptData,
} from "@/types/accommodation";

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
// GST Calculation — Single-Path Invariant
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

/**
 * The single canonical path for computing a stay's GST breakup from its
 * current Total_Stay_Amount.
 *
 * **Single-path invariant (Req 4.8, 8.3, 11.3):**
 * Every operation that changes Total_Stay_Amount — onboarding, extension,
 * and early checkout — MUST recompute the GST breakup by calling this
 * function with the *new* total. The breakup is never accumulated from
 * per-operation deltas; it is always derived fresh from the current total.
 *
 * This ensures base_amount and tax_amount stored on the stay are always
 * consistent with the current total, regardless of how many extensions or
 * recalculations have been applied.
 *
 * Delegates to `calculateGstBreakup` which implements the formula:
 *   baseAmount = round(total / 1.18, 2)
 *   taxAmount  = round(total - baseAmount, 2)
 */
export function gstFromTotal(total: number): {
  baseAmount: number;
  taxAmount: number;
  taxPercentage: number;
} {
  return calculateGstBreakup(total);
}

// ---------------------------------------------------------------------------
// Exact Money Arithmetic (integer paise)
// ---------------------------------------------------------------------------

/**
 * Converts a rupee amount to an integer number of paise.
 * Uses Math.round to avoid floating-point drift (e.g., 0.1 + 0.2 ≠ 0.3).
 *
 * Req 6.3, 7.2 (Design Decision 4)
 */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Converts an integer paise amount back to rupees.
 *
 * Req 6.3, 7.2
 */
export function fromPaise(paise: number): number {
  return paise / 100;
}

// ---------------------------------------------------------------------------
// Balance Derivation
// ---------------------------------------------------------------------------

/**
 * Derives the money position of a stay from its Total_Stay_Amount and
 * the full Payment_Transaction ledger. Never persisted — always recomputed.
 *
 * Reduction is order-independent: every ADVANCE and PARTIAL_BALANCE_PAYMENT
 * adds to Total_Paid; every REFUND subtracts. All arithmetic is performed in
 * integer paise to guarantee exact zero-balance gating (Req 7.2).
 *
 * An empty ledger yields `totalPaid = 0`, `remainingBalance = totalStayAmount`,
 * `isFullyPaid = (totalStayAmount === 0)`, `refundDue = 0`.
 *
 * Req 6.3, 6.4, 6.7, 7.2
 */
export function deriveStayBalance(
  totalStayAmount: number | null,
  transactions: readonly StayPaymentTransaction[]
): StayBalanceSnapshot {
  const totalAmountRupees = totalStayAmount ?? 0;
  const totalAmountPaise = toPaise(totalAmountRupees);

  // Sum Total_Paid in paise — ADVANCE/PARTIAL add, REFUND subtracts
  const totalPaidPaise = transactions.reduce((sum, tx) => {
    const amountPaise = toPaise(tx.amount);
    return tx.transactionType === "REFUND"
      ? sum - amountPaise
      : sum + amountPaise;
  }, 0);

  const remainingBalancePaise = totalAmountPaise - totalPaidPaise;

  return {
    totalStayAmount: totalAmountRupees,
    totalPaid: fromPaise(totalPaidPaise),
    remainingBalance: fromPaise(remainingBalancePaise),
    isFullyPaid: remainingBalancePaise === 0,
    refundDue: fromPaise(Math.max(0, -remainingBalancePaise)),
  };
}

// ---------------------------------------------------------------------------
// End Date Computation, Initial Status Assignment, Backdated Onboarding
// Helpers — extracted to `@/lib/accommodation/backdatedStay` (client-safe,
// no repository/Supabase imports) so `QuickOnboardingForm` ("use client")
// can import them directly. Re-exported here unchanged so every existing
// server-side call site and test keeps working. Req 1.2, 1.3, 1.4, 2.1, 2.3,
// 2.5, 3.1, 3.2, 3.3, 4.1, 4.5
// ---------------------------------------------------------------------------

export {
  computeEndDate,
  determineInitialStatus,
  backdatedStayRange,
  forwardStayRange,
  describeBackdatedStayOutcome,
  type BackdatedStayOutcome,
} from "@/lib/accommodation/backdatedStay";

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
  /**
   * Legacy single payment amount. Superseded by `totalStayAmount` /
   * `advanceAmountPaid` (Req 4.1). Retained so the not-yet-rewired
   * `accommodationOnboardingActions.onboardAccommodationCustomerAction`
   * call site (task 7.6 rewires it) keeps compiling. When `totalStayAmount`
   * is provided it takes precedence over this field.
   *
   * @deprecated Use `totalStayAmount` and `advanceAmountPaid`.
   */
  paymentAmount: number | null;
  paymentHostProfileId: string | null;
  /** The ACCOMMODATION subscription ID — used to link the payment record. */
  subscriptionId?: string | null;
  /**
   * Total_Stay_Amount inclusive of 18% GST (Req 4.2, 4.5, 4.6). Takes
   * precedence over the deprecated `paymentAmount` when provided.
   * TODO(task 7.6): accommodationOnboardingActions will pass this through
   * from the onboarding schema's `totalStayAmount` field instead of the
   * legacy `paymentAmount`.
   */
  totalStayAmount?: number | null;
  /**
   * Advance_Amount collected at onboarding (Req 4.5, 4.6, 4.7). Zero (or
   * omitted) means no ADVANCE ledger row is created.
   * TODO(task 7.6): accommodationOnboardingActions will pass this through
   * from the onboarding schema's `advanceAmountPaid` field.
   */
  advanceAmountPaid?: number;
  /**
   * Backdated_Stay_Toggle value from onboarding (Req 3.1, 3.2). Only used
   * for documentation/intent at the call site — `is_backdated` is actually
   * derived from whether `determineInitialStatus` resolves to FINISHED, not
   * from this flag directly, so a mismatched flag can never desync the
   * stored column from the real computed outcome.
   * TODO(task 7.6): accommodationOnboardingActions will pass this through
   * from the onboarding schema's `backdatedStayEnabled` field.
   */
  backdatedStayEnabled?: boolean;
  /** Actor to attribute the onboarding ADVANCE transaction to, if known. */
  createdBy?: string | null;
}

/**
 * Creates a new stay entry with proper GST calculation and status assignment.
 *
 * - If paymentHostProfileId is set (shared payment), GST breakup is skipped
 *   and payment fields are stored as null — no Total_Stay_Amount and no
 *   Payment_Transaction are created for a shared-payment stay (Req 4.7).
 * - Otherwise, Total_Stay_Amount is `totalStayAmount` (falling back to the
 *   deprecated `paymentAmount` while the onboarding action call site has not
 *   yet been rewired), and its GST breakup is stored via the single
 *   canonical `gstFromTotal` path (Req 4.8).
 * - Initial status is determined based on startDate vs. today (IST);
 *   `is_backdated` is set exactly when that status resolves to FINISHED
 *   (Req 3.1, 3.2).
 * - When shared payment is off and the advance is greater than zero, exactly
 *   one ADVANCE Payment_Transaction is inserted after the stay row is
 *   created (Req 4.5, 4.6, 6.1). If that insert fails, the just-created stay
 *   row is deleted and the error re-thrown, extending the caller's existing
 *   compensating-rollback chain (subscription → profile → user → auth) by
 *   exactly one step (design decision 5).
 *
 * Req 2.6, 3.1, 3.2, 3.4, 4.1, 4.5, 4.6, 4.7, 4.8, 6.1, 14.3
 */
export async function createStay(
  input: CreateStayInput
): Promise<StayEntryRow> {
  const status = determineInitialStatus(input.startDate, input.totalNights);
  const isBackdated = status === "FINISHED";

  const isSharedPayment = shouldSkipBilling(input.paymentHostProfileId);
  const effectiveTotal = input.totalStayAmount ?? input.paymentAmount;

  let paymentAmount: number | null = null;
  let baseAmount: number | null = null;
  let taxAmount: number | null = null;
  let taxPercentage = 18;

  // Skip billing when shared payment (paymentHostProfileId is set) — no
  // Total_Stay_Amount and no ledger row for that stay (Req 4.7).
  if (!isSharedPayment && effectiveTotal) {
    // Single-path: GST always recomputed from the current total (Req 4.8)
    const gst = gstFromTotal(effectiveTotal);
    paymentAmount = effectiveTotal;
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
    is_backdated: isBackdated,
  };

  const stay = await stayRepository.createStayEntry(repoInput);

  // Insert exactly one ADVANCE ledger row iff shared payment is off and the
  // advance is greater than zero (Req 4.5, 4.6, 6.1). On failure, unwind the
  // stay row we just created and re-throw so the caller's existing
  // compensating-rollback chain (subscription → profile → user → auth)
  // continues to work unchanged (design decision 5).
  const advanceAmount = input.advanceAmountPaid ?? 0;
  if (!isSharedPayment && advanceAmount > 0) {
    try {
      await stayPaymentRepository.insertAdvanceTransaction({
        stayEntryId: stay.id,
        customerProfileId: input.customerProfileId,
        amount: advanceAmount,
        transactionDate: getISTDateString(0),
        createdBy: input.createdBy ?? null,
      });
    } catch (err) {
      await stayRepository.deleteStayEntry(stay.id);
      throw err;
    }
  }

  return stay;
}

/**
 * Maps a StayEntryRow (snake_case DB row) to a StayEntry (camelCase domain
 * type), including the computed endDate and all payment-lifecycle columns.
 * Used internally by orchestration functions (`earlyCheckout`) that need the
 * domain shape expected by the pure decision-logic functions
 * (`applyEarlyCheckoutMath`, `isEarlyCheckoutEligible`).
 */
function mapStayRowToDomain(row: StayEntryRow): StayEntry {
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
    endDate: computeEndDate(row.start_date, row.total_nights),
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

/**
 * Maps a StayPaymentTransactionRow (snake_case DB row) to a
 * StayPaymentTransaction (camelCase domain type), mirroring the
 * `mapRowToStayEntry` pattern already used for stay entries
 * (`src/actions/stayActions.ts`).
 */
function mapTransactionRowToDomain(
  row: StayPaymentTransactionRow
): StayPaymentTransaction {
  return {
    id: row.id,
    stayEntryId: row.stay_entry_id,
    customerProfileId: row.customer_profile_id,
    transactionType: row.transaction_type,
    amount: row.amount,
    transactionDate: row.transaction_date,
    comment: row.comment,
    remark: row.remark,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Extends an active stay by adding additional nights and an additional cost
 * amount, folded into the running Total_Stay_Amount.
 *
 * The single-path GST invariant (Req 11.3) requires the stored breakup be
 * RECOMPUTED from the new Total_Stay_Amount rather than accumulated per
 * extension: the current total is fetched first, the additional cost is
 * added to it, `gstFromTotal` runs on that new total, and the resulting
 * absolute base/tax values are passed to the repository to be SET.
 *
 * No `payments` row and no Payment_Transaction ledger row is written for the
 * extension cost (Req 11.2) — Remaining_Balance is recalculated against the
 * unchanged Total_Paid by deriving the balance from the stay's existing
 * ledger against the new Total_Stay_Amount.
 *
 * Req 11.1, 11.2, 11.3, 11.5, 11.6, 14.1, 14.2, 14.6
 */
export async function extendStay(
  stayId: string,
  additionalNights: number,
  additionalCostAmount: number
): Promise<{
  updatedStay: StayEntryRow;
  newEndDate: string;
  balance: StayBalanceSnapshot;
}> {
  const current = await stayRepository.getStayById(stayId);
  if (!current) {
    throw new Error(`Stay ${stayId} not found`);
  }

  const newTotalStayAmount =
    (current.payment_amount ?? 0) + additionalCostAmount;
  const gst = gstFromTotal(newTotalStayAmount);

  const updatedStay = await stayRepository.extendStay(
    stayId,
    additionalNights,
    newTotalStayAmount,
    gst.baseAmount,
    gst.taxAmount
  );

  const newEndDate = computeEndDate(
    updatedStay.start_date,
    updatedStay.total_nights
  );

  // Total_Paid is unchanged by the extension — derive Remaining_Balance
  // against the existing ledger and the new Total_Stay_Amount (Req 11.2).
  const transactionRows = await stayPaymentRepository.listTransactionsByStay(
    stayId
  );
  const transactions = transactionRows.map(mapTransactionRowToDomain);
  const balance = deriveStayBalance(updatedStay.payment_amount, transactions);

  return { updatedStay, newEndDate, balance };
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

// ---------------------------------------------------------------------------
// Action Visibility Predicates
// ---------------------------------------------------------------------------

/**
 * Determines which payment and checkout affordances the Accommodation tab
 * should render for a given stay's current state.
 *
 * Rules:
 * - Non-billable stays (shared-payment OR zero/null total) show none of
 *   the money-related actions.
 * - showRecordPayment: (ACTIVE or FINISHED+isBackdated), positive total,
 *   non-shared, and balance not yet fully paid.
 * - showFullyPaidMessage: same status eligibility, positive total, non-shared,
 *   and balance IS fully paid.
 * - showMarkCheckedOut: ACTIVE, non-backdated, non-shared, positive total.
 *   Disabled until the balance is exactly zero (markCheckedOutEnabled).
 * - showGenerateFinalInvoice: FINISHED + isBackdated, fully paid, no final
 *   invoice yet, positive total, non-shared.
 * - showEarlyCheckout: ACTIVE, non-shared, positive total, not already
 *   early-checkout-applied.
 *
 * By construction, showMarkCheckedOut (ACTIVE non-backdated) and
 * showGenerateFinalInvoice (FINISHED + isBackdated) are mutually exclusive.
 *
 * Req 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1
 */
export function deriveStayActionVisibility(
  stay: StayEntry,
  balance: StayBalanceSnapshot,
  hasFinalInvoice: boolean,
  todayIST: string
): StayActionVisibility {
  // Non-billable: shared-payment stays (paymentHostProfileId set) or zero/null total
  const isSharedPayment = stay.paymentHostProfileId !== null;
  const hasPositiveTotal =
    stay.paymentAmount !== null && stay.paymentAmount > 0;
  const isBillable = !isSharedPayment && hasPositiveTotal;

  // If the stay is non-billable, none of the money-related actions apply
  if (!isBillable) {
    return {
      showRecordPayment: false,
      showFullyPaidMessage: false,
      showMarkCheckedOut: false,
      markCheckedOutEnabled: false,
      showGenerateFinalInvoice: false,
      showEarlyCheckout: false,
    };
  }

  const isActive = stay.status === "ACTIVE";
  const isFinished = stay.status === "FINISHED";
  const isBackdated = stay.isBackdated;

  // Statuses eligible for payment collection / fully-paid display:
  // ACTIVE, or FINISHED with isBackdated (Req 5.1, 9.1)
  const paymentEligible = isActive || (isFinished && isBackdated);

  const showRecordPayment = paymentEligible && !balance.isFullyPaid;
  const showFullyPaidMessage = paymentEligible && balance.isFullyPaid;

  // Mark as Checked Out: ACTIVE, non-backdated (Req 7.1)
  // Disjoint from Generate Final Invoice by construction (ACTIVE vs FINISHED)
  const showMarkCheckedOut = isActive && !isBackdated;
  const markCheckedOutEnabled = showMarkCheckedOut && balance.isFullyPaid;

  // Generate Final Invoice: FINISHED + isBackdated + fully paid + no invoice (Req 9.2)
  const showGenerateFinalInvoice =
    isFinished && isBackdated && balance.isFullyPaid && !hasFinalInvoice;

  // Early Checkout: ACTIVE, not already early-checkout-applied (Req 12.1)
  const showEarlyCheckout = isActive && !stay.earlyCheckoutApplied;

  return {
    showRecordPayment,
    showFullyPaidMessage,
    showMarkCheckedOut,
    markCheckedOutEnabled,
    showGenerateFinalInvoice,
    showEarlyCheckout,
  };
}

// ---------------------------------------------------------------------------
// Early Checkout Math
// ---------------------------------------------------------------------------

/**
 * Computes the number of full nights elapsed between the stay start date and
 * today (IST). This is the difference in days between start and today.
 *
 * - If todayIST === startDate, 0 nights have elapsed (guest arrived today).
 * - If todayIST is before startDate, returns 0 (not yet started).
 *
 * Used informatively (e.g., to pre-fill the Actual_Nights_Stayed field);
 * does NOT gate the early checkout action.
 *
 * Req 12.1
 */
export function computeElapsedNights(
  startDate: string,
  todayIST: string
): number {
  const start = parseISO(startDate);
  const today = parseISO(todayIST);
  const diff = differenceInDays(today, start);
  return Math.max(0, diff);
}

/**
 * Determines whether a stay is eligible for the Early_Checkout action.
 *
 * Eligibility criteria (all must hold):
 * 1. Stay status is ACTIVE
 * 2. Stay is not a shared-payment stay (paymentHostProfileId is null)
 * 3. Stay has a positive Total_Stay_Amount
 * 4. Stay has not already had an early checkout applied
 *
 * Note: The design states eligibility does NOT require that elapsed nights < total
 * nights — that constraint is on the form input (actualNightsStayed < totalNights),
 * not on button visibility. The button is visible for any ACTIVE, non-shared,
 * positive-total stay that hasn't already been early-checked-out (Req 12.1).
 *
 * Req 12.1
 */
export function isEarlyCheckoutEligible(stay: StayEntry): boolean {
  if (stay.status !== "ACTIVE") return false;
  if (stay.paymentHostProfileId !== null) return false;
  if (stay.paymentAmount === null || stay.paymentAmount <= 0) return false;
  if (stay.earlyCheckoutApplied) return false;
  return true;
}

/**
 * Applies the early-checkout recalculation math to determine the new balance
 * and the next step the UI must present.
 *
 * Logic:
 * 1. Derive the new balance using `deriveStayBalance(recalculatedStayAmount, transactions)`.
 *    - The total changes to the recalculated amount; Total_Paid stays unchanged
 *      (existing transactions are not modified).
 * 2. Determine `nextStep` from remainingBalance:
 *    - > 0: COLLECT_BALANCE (admin must record a payment before checkout)
 *    - < 0: RECORD_REFUND (guest overpaid; admin must record a refund)
 *    - === 0: CHECKED_OUT (balance is exact; can finalise immediately)
 * 3. Return the stay id, actualNightsStayed as the new totalNights,
 *    recalculatedStayAmount as the new totalStayAmount, the balance,
 *    nextStep, and refundDue from the balance.
 *
 * This is a pure function — no DB interaction.
 *
 * Req 12.6, 12.7, 12.8, 12.12, 12.15
 */
export function applyEarlyCheckoutMath(
  stay: StayEntry,
  actualNightsStayed: number,
  recalculatedStayAmount: number,
  transactions: readonly StayPaymentTransaction[]
): {
  balance: StayBalanceSnapshot;
  nextStep: EarlyCheckoutOutcome["nextStep"];
  refundDue: number;
} {
  // Derive the new balance with the recalculated total against existing payments
  const balance = deriveStayBalance(recalculatedStayAmount, transactions);

  // Determine the branch based on the remaining balance (exact in paise)
  const remainingPaise = toPaise(balance.remainingBalance);
  let nextStep: EarlyCheckoutOutcome["nextStep"];

  if (remainingPaise > 0) {
    nextStep = "COLLECT_BALANCE";
  } else if (remainingPaise < 0) {
    nextStep = "RECORD_REFUND";
  } else {
    nextStep = "CHECKED_OUT";
  }

  return {
    balance,
    nextStep,
    refundDue: balance.refundDue,
  };
}

// ---------------------------------------------------------------------------
// Payment History Ordering and Formatting — extracted to
// `@/lib/accommodation/paymentHistory` (client-safe, no repository/Supabase
// imports) so `StayPaymentPanel` ("use client") can import it directly.
// Re-exported here unchanged so every existing server-side call site and
// test keeps working. Req 6.2, 6.5, 10.2, 10.3
// ---------------------------------------------------------------------------

export { buildPaymentHistoryRows } from "@/lib/accommodation/paymentHistory";

/**
 * Builds the printable Payment_Receipt data for a single Payment_Transaction.
 *
 * - `receiptNumber`: "RCPT-" + the first hyphen-delimited segment of the
 *   transaction id, uppercased.
 * - `typeLabel`: human-readable label from PAYMENT_TRANSACTION_LABELS.
 * - Customer/stay header fields are taken directly from the passed-in
 *   `stay`/`customer` params — no DB access here.
 *
 * This is a pure function — no side effects or DB interaction.
 *
 * Requirements: 10.1, 10.2, 10.4, 10.5
 */
export function buildPaymentReceiptData(
  transaction: StayPaymentTransaction,
  stay: { stayType: StayType; startDate: string; endDate: string },
  customer: { fullName: string; mobile: string }
): PaymentReceiptData {
  return {
    receiptNumber: `RCPT-${transaction.id.split("-")[0].toUpperCase()}`,
    transaction,
    typeLabel: PAYMENT_TRANSACTION_LABELS[transaction.transactionType],
    customerName: customer.fullName,
    customerMobile: customer.mobile,
    stayType: stay.stayType,
    stayDates: {
      startDate: stay.startDate,
      endDate: stay.endDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Checkout, Final Invoice, and Early Checkout Orchestration
// ---------------------------------------------------------------------------

/** Outcome of {@link generateFinalInvoice}. */
export type GenerateInvoiceResult =
  | { ok: true; paymentId: string; alreadyExisted: boolean }
  | { ok: true; invoiceStatus: "NOT_APPLICABLE" }
  | { ok: false; error: string };

/** Outcome of {@link checkoutStay}. Mirrors `markStayCheckedOutAction`'s success shape (design.md). */
export type CheckoutResult =
  | {
      ok: true;
      status: "FINISHED";
      invoiceStatus: "GENERATED" | "PENDING_RETRY" | "NOT_APPLICABLE";
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "NOT_ACTIVE" | "BALANCE_OUTSTANDING";
      remainingBalance?: number;
    };

/**
 * Generates the single Final_Consolidated_Invoice for a stay (Req 8.1, 8.6).
 *
 * Idempotent: if a final invoice already exists (`final_invoice_payment_id`
 * is set), returns it immediately with `alreadyExisted: true` — no new row
 * is inserted (Property 12).
 *
 * Non-applicable (Req 8.2): a shared-payment stay (`payment_host_profile_id`
 * set) or a stay with a null/zero Total_Stay_Amount needs no invoice — the
 * caller (`checkoutStay`) maps this into `invoiceStatus: "NOT_APPLICABLE"`.
 *
 * On success, inserts a `payments` row with
 * `invoice_type = 'ACCOMMODATION_FINAL_INVOICE'` (design decision 6) and
 * links it via `stayRepository.attachFinalInvoice`, clearing any prior
 * `final_invoice_error`.
 *
 * On failure (e.g. a race hitting `uniq_final_stay_invoice_per_stay`), the
 * failure is recorded via `stayRepository.recordFinalInvoiceFailure` and a
 * typed failure is returned — this function never throws for an insert
 * failure, since design decision 8 requires FINISHED to survive it
 * (Req 8.7, Property 15).
 *
 * Req 7.3, 7.4, 7.5, 8.1, 8.2, 8.6, 8.7, 9.3
 */
export async function generateFinalInvoice(
  stayId: string
): Promise<GenerateInvoiceResult> {
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { ok: false, error: `Stay ${stayId} not found` };
  }

  // Idempotent: an invoice already exists for this stay.
  if (stay.final_invoice_payment_id) {
    return {
      ok: true,
      paymentId: stay.final_invoice_payment_id,
      alreadyExisted: true,
    };
  }

  // Non-applicable: shared-payment or zero/null-total stays need no invoice.
  const isSharedPayment = stay.payment_host_profile_id !== null;
  const hasPositiveTotal =
    stay.payment_amount !== null && stay.payment_amount > 0;
  if (isSharedPayment || !hasPositiveTotal) {
    return { ok: true, invoiceStatus: "NOT_APPLICABLE" };
  }

  const admin = createAdminClient();

  const { data: newPayment, error } = await admin
    .from("payments")
    .insert({
      customer_profile_id: stay.customer_profile_id,
      stay_entry_id: stayId,
      payment_method: "Manual",
      amount: stay.payment_amount,
      base_amount: stay.base_amount,
      tax_percent: stay.tax_percentage,
      tax_amount: stay.tax_amount,
      discount_amount: 0,
      status: "PAID",
      paid_at: new Date().toISOString(),
      invoice_type: "ACCOMMODATION_FINAL_INVOICE",
    })
    .select("id")
    .single();

  if (error || !newPayment) {
    const message = error?.message ?? "Failed to insert final invoice";
    await stayRepository.recordFinalInvoiceFailure(stayId, message);
    return { ok: false, error: message };
  }

  await stayRepository.attachFinalInvoice(stayId, newPayment.id as string);

  return { ok: true, paymentId: newPayment.id as string, alreadyExisted: false };
}

/**
 * Checks out a stay: finalises the ACTIVE → FINISHED status transition
 * first, then generates the Final_Consolidated_Invoice (design decision 8).
 *
 * The status transition via `stayRepository.finalizeCheckout` is committed
 * BEFORE invoice generation is attempted, so FINISHED survives an invoice
 * failure (Req 8.7). If `finalizeCheckout` itself fails business validation
 * (NOT_FOUND / NOT_ACTIVE / BALANCE_OUTSTANDING), nothing has changed and
 * that failure is returned directly — invoice generation is never attempted
 * (Property 11).
 *
 * Once the transition is committed, `generateFinalInvoice` is called and its
 * outcome mapped to this function's own `invoiceStatus`:
 * - invoice inserted → "GENERATED"
 * - skipped (zero-total / shared-payment) → "NOT_APPLICABLE"
 * - insert failed (already recorded as `final_invoice_error`) → "PENDING_RETRY"
 *
 * Checkout itself always reports success once the transition commits,
 * regardless of the invoice outcome (Req 8.7).
 *
 * Req 7.3, 7.4, 7.5, 8.1, 8.2, 8.6, 8.7, 9.3
 */
export async function checkoutStay(stayId: string): Promise<CheckoutResult> {
  const finalized = await stayRepository.finalizeCheckout(stayId);

  if (!finalized.ok) {
    return {
      ok: false,
      reason: finalized.reason,
      remainingBalance: finalized.remainingBalance,
    };
  }

  // Status transition is committed — proceed to invoice generation.
  const invoiceResult = await generateFinalInvoice(stayId);

  let invoiceStatus: "GENERATED" | "PENDING_RETRY" | "NOT_APPLICABLE";
  if (!invoiceResult.ok) {
    invoiceStatus = "PENDING_RETRY";
  } else if ("invoiceStatus" in invoiceResult) {
    invoiceStatus = invoiceResult.invoiceStatus;
  } else {
    invoiceStatus = "GENERATED";
  }

  return { ok: true, status: "FINISHED", invoiceStatus };
}

/**
 * Orchestrates an Early_Checkout: rejects any non-ACTIVE stay (including one
 * already early-checked-out — Req 12.14), applies the pure recalculation
 * math (`applyEarlyCheckoutMath`), persists it via
 * `stayRepository.applyEarlyCheckout`, and — when the recalculated amount
 * already equals Total_Paid — immediately finalises the stay through
 * `checkoutStay` (Req 12.12, 12.13).
 *
 * Req 7.3, 7.4, 7.5, 8.1, 8.2, 8.6, 8.7, 9.3, 11.5, 12.12, 12.13, 12.14
 */
export async function earlyCheckout(
  stayId: string,
  actualNightsStayed: number,
  recalculatedStayAmount: number
): Promise<EarlyCheckoutOutcome | { ok: false; error: string }> {
  const stayRow = await stayRepository.getStayById(stayId);
  if (!stayRow) {
    return { ok: false, error: `Stay ${stayId} not found` };
  }

  // Reject any non-ACTIVE stay, including one already early-checked-out
  // (Req 12.14) — no mutation.
  if (stayRow.status !== "ACTIVE") {
    return {
      ok: false,
      error: "Only active stays can be checked out early.",
    };
  }

  const stay = mapStayRowToDomain(stayRow);

  const transactionRows = await stayPaymentRepository.listTransactionsByStay(
    stayId
  );
  const transactions = transactionRows.map(mapTransactionRowToDomain);

  const math = applyEarlyCheckoutMath(
    stay,
    actualNightsStayed,
    recalculatedStayAmount,
    transactions
  );

  const gst = gstFromTotal(recalculatedStayAmount);
  await stayRepository.applyEarlyCheckout(
    stayId,
    actualNightsStayed,
    recalculatedStayAmount,
    { baseAmount: gst.baseAmount, taxAmount: gst.taxAmount }
  );

  const outcome: EarlyCheckoutOutcome = {
    stayId,
    totalNights: actualNightsStayed,
    totalStayAmount: recalculatedStayAmount,
    balance: math.balance,
    nextStep: math.nextStep,
    refundDue: math.refundDue,
  };

  if (math.nextStep === "CHECKED_OUT") {
    const checkoutResult = await checkoutStay(stayId);
    if (checkoutResult.ok && checkoutResult.invoiceStatus !== "NOT_APPLICABLE") {
      outcome.invoiceStatus = checkoutResult.invoiceStatus;
    }
  }

  return outcome;
}
