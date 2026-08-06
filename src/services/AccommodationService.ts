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
import * as stayExtensionHistoryRepository from "@/repositories/stayExtensionHistoryRepository";
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
  type SaveStayDetailsOutcome,
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
// Nights ↔ End Date Conversion (Recalculate_Stay)
// ---------------------------------------------------------------------------

/**
 * Total nights a stay spans between an inclusive start and end date:
 * `end − start + 1`.
 *
 * The exact inverse of {@link computeEndDate} and the exact JS counterpart of
 * the `save_stay_details()` RPC's
 * `v_nights_after := (p_recalculated_end_date - v_stay.start_date) + 1`
 * (`scripts/create-stay-recalculation.sql`), so a Recalculated_Total_Nights
 * derived in the service can never disagree with the one the database writes.
 *
 * A stay whose end date equals its start date is exactly 1 night — the minimum
 * stay length, never 0.
 *
 * Req 12.3, 12.8
 */
export function nightsFromEndDate(startDate: string, endDate: string): number {
  return differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
}

/**
 * Named alias of {@link computeEndDate} (`start + nights − 1`), for the
 * Recalculate_Stay call sites where "end date from nights" reads as the
 * intent. Deliberately an alias rather than a second implementation: one date
 * convention, one implementation.
 *
 * Req 12.3, 12.8
 */
export const endDateFromNights = computeEndDate;

/**
 * Calendar-picker bounds for Recalculate_Stay. Both bounds are inclusive and
 * selectable:
 *   min = the stay's start date       (selectable — yields exactly 1 night)
 *   max = endDateFromNights(startDate, currently booked total nights)
 *
 * `max` mirrors the RPC's
 * `v_booked_end := v_stay.start_date + (v_stay.total_nights - 1)`.
 *
 * The range is never empty, so there is no availability flag to return: for a
 * 1-night stay `min === max === startDate`, a single selectable date that is
 * also that stay's current end date, which keeps "submit the current end date
 * unchanged" a genuine no-op (design decision 13, Req 12.6).
 *
 * Req 12.3, 12.8
 */
export function recalculationDateBounds(stay: StayEntry): {
  min: string;
  max: string;
} {
  return {
    min: stay.startDate,
    max: endDateFromNights(stay.startDate, stay.totalNights),
  };
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
 * Used internally by orchestration functions that need the domain shape
 * expected by the pure decision-logic functions
 * (`applyStayRecalculationMath`, `isRecalculationEligible`).
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
    recalculationApplied: row.recalculation_applied,
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
  additionalCostAmount: number,
  createdBy: string | null = null
): Promise<{
  updatedStay: StayEntryRow;
  newEndDate: string;
  balance: StayBalanceSnapshot;
}> {
  const current = await stayRepository.getStayById(stayId);
  if (!current) {
    throw new Error(`Stay ${stayId} not found`);
  }

  const nightsBefore = current.total_nights;
  const totalAmountBefore = current.payment_amount;

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

  // Record this extension in the informational history list (see
  // scripts/create-stay-extension-history.sql) immediately after the stay
  // itself is updated. This does NOT touch stay_payment_transactions and has
  // no bearing on Total_Paid / Remaining_Balance (Req 11.2 is unaffected) —
  // it exists solely so the Accommodation tab can list every extension
  // applied, the way it already lists every Payment_Transaction.
  await stayExtensionHistoryRepository.recordExtension({
    stayEntryId: stayId,
    customerProfileId: updatedStay.customer_profile_id,
    additionalNights,
    nightsBefore,
    nightsAfter: updatedStay.total_nights,
    additionalAmount: additionalCostAmount,
    totalAmountBefore,
    totalAmountAfter: updatedStay.payment_amount ?? newTotalStayAmount,
    extendedOn: getISTDateString(0),
    createdBy,
  });

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
 *   Disabled (markCheckedOutEnabled false) until BOTH the balance is exactly
 *   zero AND `todayIST` has reached the stay's inclusive end date. The date
 *   condition means a normal checkout can only be actioned from 00:00 IST on
 *   the end date onward — leaving early is Save_Stay_Details' job, which
 *   recalculates the nights and the amount for the stay actually taken. Without
 *   this gate a single click silently billed the guest for nights they never
 *   stayed.
 *   `markCheckedOutEnabled` (and its `markCheckedOutBlockedReason`) keep their
 *   existing formula verbatim — `balance.isFullyPaid && todayIST >=
 *   stay.endDate` — and recalculation adds **no branch** here. `stay.endDate` is
 *   computed from `total_nights`, which Save_Stay_Details has already replaced,
 *   so the Recalculated_End_Date flows into this *existing* gate on its own.
 *   That is exactly why recalculation introduces no new path to FINISHED
 *   (Req 12.13): Mark_As_Checked_Out simply auto-enables earlier once the
 *   shortened end date is reached and the balance is exactly zero.
 * - showGenerateFinalInvoice: FINISHED + isBackdated, fully paid, no final
 *   invoice yet, positive total, non-shared.
 * - showRecalculateStay: ACTIVE + billable, and nothing else — the single truth
 *   for it is {@link isRecalculationEligible}. Repeatable: there is no
 *   `earlyCheckoutApplied` clause and no elapsed-nights clause, so a first
 *   application never suppresses the action and a late amount-only correction
 *   is never blocked (Req 12.1, 12.10).
 * - showMarkAsRefunded: ACTIVE + billable + `balance.refundDue > 0`. Derived
 *   from the *balance* rather than from "a recalculation just happened", which
 *   is what makes it standalone: it survives a page reload and stays true until
 *   the refund is actually recorded (Req 12.12, 14.1).
 *
 * By construction, showMarkCheckedOut (ACTIVE non-backdated) and
 * showGenerateFinalInvoice (FINISHED + isBackdated) are mutually exclusive.
 *
 * Req 5.1, 5.10, 7.1, 7.2, 9.1, 9.2, 9.4, 12.1, 12.10, 12.11, 12.12, 12.13, 14.1
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
      markCheckedOutBlockedReason: null,
      showGenerateFinalInvoice: false,
      showRecalculateStay: false,
      showMarkAsRefunded: false,
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

  // The stay must have actually reached its inclusive end date. YYYY-MM-DD
  // strings compare correctly lexicographically, so this is true from 00:00 IST
  // on the end date onward. Deliberately `>=` rather than `===`: an admin who
  // misses the exact day must still be able to close the stay, otherwise the
  // stay would be permanently stuck ACTIVE.
  const hasReachedEndDate = todayIST >= stay.endDate;

  const markCheckedOutEnabled =
    showMarkCheckedOut && balance.isFullyPaid && hasReachedEndDate;

  let markCheckedOutBlockedReason:
    | "BALANCE_OUTSTANDING"
    | "BEFORE_END_DATE"
    | null = null;
  if (showMarkCheckedOut && !markCheckedOutEnabled) {
    markCheckedOutBlockedReason = !balance.isFullyPaid
      ? "BALANCE_OUTSTANDING"
      : "BEFORE_END_DATE";
  }

  // Generate Final Invoice: FINISHED + isBackdated + fully paid + no invoice (Req 9.2)
  const showGenerateFinalInvoice =
    isFinished && isBackdated && balance.isFullyPaid && !hasFinalInvoice;

  // Recalculate Stay: ACTIVE + billable, nothing else. Delegated to
  // `isRecalculationEligible` rather than re-spelled as `isActive && isBillable`
  // so the button's availability and the write path's eligibility check can
  // never drift apart (Req 12.1, 12.10).
  const showRecalculateStay = isRecalculationEligible(stay);

  // Mark as refunded: ACTIVE + billable + money owed back. Read off the derived
  // balance, so it reappears on every reload until the REFUND transaction is
  // recorded (Req 12.12, 14.1).
  const showMarkAsRefunded = isActive && balance.refundDue > 0;

  return {
    showRecordPayment,
    showFullyPaidMessage,
    showMarkCheckedOut,
    markCheckedOutEnabled,
    markCheckedOutBlockedReason,
    showGenerateFinalInvoice,
    showRecalculateStay,
    showMarkAsRefunded,
  };
}

// ---------------------------------------------------------------------------
// Stay Recalculation Math (Save_Stay_Details)
// ---------------------------------------------------------------------------

/**
 * Computes the number of full nights elapsed between the stay start date and
 * today (IST). This is the difference in days between start and today.
 *
 * - If todayIST === startDate, 0 nights have elapsed (guest arrived today).
 * - If todayIST is before startDate, returns 0 (not yet started).
 *
 * Used informatively — to prefill and to describe elapsed nights in the
 * Recalculate_Stay dialog. It does NOT gate the Recalculate_Stay action and
 * is deliberately absent from {@link isRecalculationEligible}.
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
 * Determines whether a stay is eligible for the Recalculate_Stay action.
 * REPLACES the retired `isEarlyCheckoutEligible`.
 *
 * Eligibility is ACTIVE + billable, and nothing else:
 * 1. Stay status is ACTIVE
 * 2. Stay is not a shared-payment stay (paymentHostProfileId is null)
 * 3. Stay has a positive Total_Stay_Amount
 *
 * Two clauses the old predicate carried are deliberately **gone**:
 * - `!stay.earlyCheckoutApplied` — recalculation is **repeatable** while the
 *   stay is ACTIVE (Req 12.10), so a first application must not suppress the
 *   action. `earlyCheckoutApplied` is now only a historical "ended earlier
 *   than booked" marker and no gate reads it.
 * - any elapsed-nights clause — the picker bounds
 *   ({@link recalculationDateBounds}) constrain the submitted date, not the
 *   button's availability, and those bounds are never empty (design decision
 *   13). {@link computeElapsedNights} stays purely informational.
 *
 * Req 12.1, 12.10
 */
export function isRecalculationEligible(stay: StayEntry): boolean {
  if (stay.status !== "ACTIVE") return false;
  if (stay.paymentHostProfileId !== null) return false;
  if (stay.paymentAmount === null || stay.paymentAmount <= 0) return false;
  return true;
}

/**
 * Applies the Save_Stay_Details recalculation math: the derived nights, the new
 * balance, the single money follow-up the tab must present, and the two flags
 * the write path needs. REPLACES the retired `applyEarlyCheckoutMath`.
 *
 * Note what is **absent**: there is no branch that checks the stay out, no
 * `CHECKED_OUT` value, and no invoice decision anywhere in here. The exact
 * balance is instead reported as `SETTLED`, and reaching FINISHED remains the
 * separate Mark_As_Checked_Out action's sole job (Req 12.9, 12.13).
 *
 * Logic:
 * 1. `totalNights` is **derived** from `recalculatedEndDate` via
 *    {@link nightsFromEndDate} — never typed, and identical to the
 *    `save_stay_details()` RPC's `v_nights_after`.
 * 2. The balance comes from `deriveStayBalance(recalculatedStayAmount,
 *    transactions)`: the total becomes the recalculated amount while Total_Paid
 *    stays untouched (no transaction is modified).
 * 3. `nextAction` is selected on the **paise-converted** remaining balance so a
 *    float representation can never mis-route it: `> 0` COLLECT_BALANCE
 *    (Req 12.11), `< 0` RECORD_REFUND (Req 12.12), `=== 0` SETTLED.
 * 4. `changesSomething` drives whether a Recalculation_History row is written
 *    (Req 13.1, 13.2) and must agree with the RPC's `v_changed`
 *    (`v_nights_after <> total_nights OR payment_amount IS DISTINCT FROM
 *    p_recalculated_amount`). Nights compare directly; the amount compares in
 *    integer paise, so a float-representation difference that is the same money
 *    is not a change. A **null** `paymentAmount` is treated as distinct from any
 *    amount rather than coerced to 0, mirroring SQL's `IS DISTINCT FROM`.
 * 5. `shortensStay` is the Early_Checkout case — a lexicographic YYYY-MM-DD
 *    comparison against the currently booked Computed_End_Date, matching the
 *    RPC's `v_shortens`.
 *
 * Pure function — no DB interaction, and the input `stay` is never mutated.
 *
 * Req 12.8, 12.9, 12.10, 12.11, 12.12, 13.1, 13.2
 */
export function applyStayRecalculationMath(
  stay: StayEntry,
  recalculatedEndDate: string,
  recalculatedStayAmount: number,
  transactions: readonly StayPaymentTransaction[]
): {
  /** Recalculated_Total_Nights, derived from `recalculatedEndDate`. */
  totalNights: number;
  balance: StayBalanceSnapshot;
  nextAction: SaveStayDetailsOutcome["nextAction"];
  refundDue: number;
  /** true iff nights or amount differ from the stay's current values (Req 13.1, 13.2). */
  changesSomething: boolean;
  /** true iff the submission shortens the stay — the Early_Checkout case. */
  shortensStay: boolean;
} {
  // Req 12.8 — nights are DERIVED from the calendar-picked end date.
  const totalNights = nightsFromEndDate(stay.startDate, recalculatedEndDate);

  // New total against the unchanged ledger; Total_Paid is untouched.
  const balance = deriveStayBalance(recalculatedStayAmount, transactions);

  // Exactly one follow-up, chosen on the exact paise balance.
  const remainingPaise = toPaise(balance.remainingBalance);
  const nextAction: SaveStayDetailsOutcome["nextAction"] =
    remainingPaise > 0
      ? "COLLECT_BALANCE"
      : remainingPaise < 0
        ? "RECORD_REFUND"
        : "SETTLED";

  // SQL parity: NULL IS DISTINCT FROM <any amount> is true, so a stay with no
  // stored total always counts as changed — never coerced to 0 first.
  const amountChanged =
    stay.paymentAmount === null ||
    toPaise(recalculatedStayAmount) !== toPaise(stay.paymentAmount);

  return {
    totalNights,
    balance,
    nextAction,
    refundDue: balance.refundDue,
    changesSomething: totalNights !== stay.totalNights || amountChanged,
    shortensStay:
      recalculatedEndDate < endDateFromNights(stay.startDate, stay.totalNights),
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
// Checkout, Final Invoice, and Save Stay Details Orchestration
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

/** Failure shape of {@link saveStayDetails}. Mirrors the action layer's own
 *  `{ error, fieldErrors? }` contract (design.md — Service Layer). */
export type SaveStayDetailsFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string>;
};

/**
 * Orchestrates a Save_Stay_Details submission. **REPLACES the retired
 * `earlyCheckout`.**
 *
 * Flow: fetch the stay → reject a non-ACTIVE one (Req 12.14) → run the pure
 * {@link applyStayRecalculationMath} → recompute the GST breakup from the new
 * total through the single {@link gstFromTotal} path (Req 11.3's single-path
 * invariant) → delegate the ENTIRE write to
 * `stayRepository.saveStayDetails`, which is one `save_stay_details()` RPC call
 * under one row lock in one transaction, so a mid-operation failure leaves
 * nights, amount, status, and end date fully unchanged (Req 12.16).
 *
 * What this function deliberately does **NOT** do, and why that is the whole
 * point of the revision (Req 12.9, 12.13):
 * - it never calls {@link checkoutStay};
 * - it never calls {@link generateFinalInvoice};
 * - it writes no `status` and no `checked_out_at` — neither here nor inside the
 *   RPC. `Mark as Checked Out` (`finalizeCheckout`) remains the sole path to
 *   FINISHED, and it auto-enables on its own once the recalculated end date is
 *   reached and the balance is exactly zero, because
 *   `deriveStayActionVisibility` reads `stay.endDate`, which is computed from
 *   the `total_nights` this write has already replaced.
 *
 * The returned `nextAction` is therefore always a *money* follow-up —
 * COLLECT_BALANCE (Req 12.11), RECORD_REFUND (Req 12.12), or SETTLED — never a
 * checkout, and `status` is the literal `"ACTIVE"`.
 *
 * Repeatable while the stay is ACTIVE (Req 12.10): nothing here reads
 * `recalculationApplied` or `earlyCheckoutApplied`, so a second, third, or
 * amount-only submission is accepted exactly like the first. A submission that
 * changes nothing is accepted as a no-op and reports
 * `historyRecorded: false` (Req 12.6, 13.2).
 *
 * The service-level ACTIVE check is belt-and-braces: the RPC re-checks it
 * inside the row lock, and *that* check is the authoritative one under
 * concurrency. Both are kept.
 *
 * Business-outcome failures are RETURNED, never thrown — same convention as
 * {@link checkoutStay}. The repository's typed reasons map to pinned messages
 * with the field errors the Recalculate_Stay form binds to.
 *
 * Req 12.8, 12.9, 12.10, 12.14, 12.16, 13.1, 13.2
 */
export async function saveStayDetails(
  stayId: string,
  recalculatedEndDate: string,
  recalculatedStayAmount: number,
  createdBy: string | null = null
): Promise<SaveStayDetailsOutcome | SaveStayDetailsFailure> {
  const stayRow = await stayRepository.getStayById(stayId);
  if (!stayRow) {
    return { ok: false, error: `Stay ${stayId} not found` };
  }

  // Req 12.14 — only ACTIVE stays may be recalculated. Belt-and-braces on top
  // of the RPC's own re-check inside the row lock; no mutation either way.
  if (stayRow.status !== "ACTIVE") {
    return {
      ok: false,
      error: "Only active stays can be recalculated.",
    };
  }

  const stay = mapStayRowToDomain(stayRow);

  const transactionRows = await stayPaymentRepository.listTransactionsByStay(
    stayId
  );
  const transactions = transactionRows.map(mapTransactionRowToDomain);

  // Pure math: nights DERIVED from the submitted end date (Req 12.8), the new
  // balance against the unchanged ledger, and the single money follow-up.
  const math = applyStayRecalculationMath(
    stay,
    recalculatedEndDate,
    recalculatedStayAmount,
    transactions
  );

  // Single-path GST: always recomputed from the NEW total, never accumulated.
  const gst = gstFromTotal(recalculatedStayAmount);

  const result = await stayRepository.saveStayDetails({
    stayId,
    recalculatedEndDate,
    // The RPC derives nights itself from the locked `start_date`; this is the
    // same value by construction (`nightsFromEndDate` is the exact JS
    // counterpart of its `v_nights_after`) and is passed because it is part of
    // the repository's input shape.
    recalculatedTotalNights: math.totalNights,
    recalculatedStayAmount,
    gst: { baseAmount: gst.baseAmount, taxAmount: gst.taxAmount },
    recalculatedOn: getISTDateString(0),
    createdBy,
  });

  if (!result.ok) {
    return mapSaveStayDetailsFailure(stayId, recalculatedEndDate, result);
  }

  return {
    stayId,
    totalNights: math.totalNights,
    recalculatedEndDate,
    totalStayAmount: recalculatedStayAmount,
    balance: math.balance,
    nextAction: math.nextAction,
    refundDue: math.refundDue,
    // Exactly the RPC's `v_changed` — no history row for a no-op (Req 13.2).
    historyRecorded: result.historyRecorded,
    // Save_Stay_Details never transitions status (Req 12.9).
    status: "ACTIVE",
  };
}

/**
 * Maps `stayRepository.saveStayDetails`'s typed failure reasons to the pinned
 * messages and field errors the Recalculate_Stay form binds to, following the
 * same reason-mapping convention {@link checkoutStay} uses for
 * `finalizeCheckout` (Req 12.3, 12.4, 12.5, 12.14). Raw SQL errors are never
 * surfaced — the repository throws for those.
 */
function mapSaveStayDetailsFailure(
  stayId: string,
  submittedEndDate: string,
  result: Extract<stayRepository.SaveStayDetailsResult, { ok: false }>
): SaveStayDetailsFailure {
  switch (result.reason) {
    case "NOT_FOUND":
      return { ok: false, error: `Stay ${stayId} not found` };

    case "NOT_ACTIVE":
      return { ok: false, error: "Only active stays can be recalculated." };

    case "INVALID_END_DATE": {
      // The RPC returns the authoritative inclusive bounds; the message names
      // whichever bound the submitted date breached (Req 12.3, 12.5).
      // YYYY-MM-DD compares correctly lexicographically.
      const { minEndDate, maxEndDate } = result;
      const message =
        maxEndDate !== undefined && submittedEndDate > maxEndDate
          ? `End date cannot be later than the currently booked ${maxEndDate}. Use Extend Stay to lengthen the stay.`
          : `End date must be on or after the stay's start date${minEndDate ? ` ${minEndDate}` : ""}; selecting the start date itself gives a 1-night stay.`;
      return {
        ok: false,
        error: message,
        fieldErrors: { recalculatedEndDate: message },
      };
    }

    case "AMOUNT_OUT_OF_RANGE": {
      const message =
        "Recalculated total stay amount must be a whole number between 1 and 9,999,999.";
      return {
        ok: false,
        error: message,
        fieldErrors: { recalculatedStayAmount: message },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Refund + Refund_Invoice Orchestration (Mark_As_Refunded)
// ---------------------------------------------------------------------------

/** Input for {@link recordRefundWithInvoice}. */
export interface RecordRefundInput {
  stayId: string;
  amount: number;
  /** Required — describes how the refund was initiated (Req 14.3). */
  remark: string;
  comment?: string | null;
  createdBy: string | null;
}

/**
 * Outcome of {@link recordRefundWithInvoice}.
 *
 * The reason union is the design's seven **plus `REMARK_INVALID`**, and the two
 * additions come from opposite directions:
 *
 * - `REMARK_INVALID` is a real `record_stay_refund_with_invoice()` outcome — the
 *   RPC validates the remark and the comment server-side inside the row lock
 *   (Req 14.3), independently of the Zod layer above it. It is passed through
 *   verbatim rather than folded into another reason, because collapsing it would
 *   either lose the field the form must highlight or mislabel a validation
 *   failure as a system failure.
 * - `INVOICE_FAILED` is **not** an RPC-returned reason and never can be: when
 *   the Refund_Invoice insert aborts the transaction, the whole function raises
 *   and the repository throws, so there is no jsonb reason to read. It is this
 *   service's translation of that throw — "nothing was written, the ledger is
 *   untouched, retry is safe" (Req 14.8).
 *
 * So the two are complementary, not alternatives: one is a returned business
 * outcome, the other is a thrown-and-caught system outcome.
 */
export type RecordRefundOutcome =
  | {
      ok: true;
      /** Authoritative post-refund balance, derived inside the RPC's row lock. */
      balance: StayBalanceSnapshot;
      /** `payments.id` of the Refund_Invoice written in the same transaction (Req 14.7). */
      refundInvoicePaymentId: string;
      /** `stay_payment_transactions.id` of the REFUND row. */
      transactionId: string;
    }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "SHARED_PAYMENT"
        | "NOT_ACTIVE"
        | "AMOUNT_NOT_POSITIVE"
        | "NO_EXCESS_TO_REFUND"
        | "REFUND_EXCEEDS_EXCESS"
        | "REMARK_INVALID"
        | "INVOICE_FAILED";
      /** Present with `REFUND_EXCEEDS_EXCESS` — the live excess the form must show. */
      excess?: number;
    };

/**
 * Builds a {@link StayBalanceSnapshot} from the authoritative Total_Paid and
 * Remaining_Balance the RPC derived **inside the stay row lock**, so the
 * snapshot cannot disagree with the figures the refund was validated against
 * even when two admins act at once.
 *
 * All arithmetic runs through {@link toPaise} / {@link fromPaise}, exactly as
 * {@link deriveStayBalance} does, so `isFullyPaid` stays an exact-zero predicate
 * (Req 7.2) and Total_Stay_Amount is reconstructed without float drift.
 * Deliberately NOT a second balance formula: the derived quantities
 * (`totalStayAmount`, `isFullyPaid`, `refundDue`) follow the same definitions as
 * `deriveStayBalance`, only sourced from the locked figures instead of a
 * re-read ledger.
 */
function balanceFromAuthoritativeTotals(
  totalPaid: number,
  remainingBalance: number
): StayBalanceSnapshot {
  const totalPaidPaise = toPaise(totalPaid);
  const remainingPaise = toPaise(remainingBalance);

  return {
    // Total_Stay_Amount = Total_Paid + Remaining_Balance, by definition of
    // Remaining_Balance (Req 6.4).
    totalStayAmount: fromPaise(totalPaidPaise + remainingPaise),
    totalPaid: fromPaise(totalPaidPaise),
    remainingBalance: fromPaise(remainingPaise),
    isFullyPaid: remainingPaise === 0,
    refundDue: fromPaise(Math.max(0, -remainingPaise)),
  };
}

/**
 * Records a REFUND Payment_Transaction together with its Refund_Invoice
 * (Mark_As_Refunded). A **thin wrapper** over
 * `stayPaymentRepository.recordRefundWithInvoice`: the atomicity Req 14.8
 * demands lives entirely in the `record_stay_refund_with_invoice()` RPC, which
 * writes the ledger row, the `payments` row, and the back-reference in ONE
 * transaction.
 *
 * There is deliberately **no Node-side compensating delete, cleanup, or retry**
 * here (design decision 16). A compensating delete is itself a write that can
 * fail, which is precisely the failure mode Req 14.8 addresses — adding one back
 * would reintroduce the bug the RPC exists to prevent. When the RPC throws
 * because the invoice insert aborted the transaction, nothing was committed:
 * this function reports `INVOICE_FAILED` and stops, and Total_Paid is exactly
 * what it was before the call.
 *
 * It also writes **no `status` and no `checked_out_at`**, and never calls
 * {@link checkoutStay} or {@link generateFinalInvoice}. A refund that settles
 * the balance only makes the stay *eligible* for Mark as Checked Out — the
 * admin still has to press it (Req 14.10). This mirrors the same decoupling
 * {@link saveStayDetails} enforces: `deriveStayActionVisibility` picks the
 * newly-zero balance up on its own through the existing gate.
 *
 * Business-outcome failures are RETURNED as `ok: false` reasons, never thrown —
 * same convention as {@link checkoutStay} and {@link saveStayDetails}. The
 * action layer maps each reason to its pinned message; no raw SQL error is ever
 * surfaced.
 *
 * Req 14.1, 14.6, 14.7, 14.8, 14.10
 */
export async function recordRefundWithInvoice(
  input: RecordRefundInput
): Promise<RecordRefundOutcome> {
  let result: Awaited<
    ReturnType<typeof stayPaymentRepository.recordRefundWithInvoice>
  >;

  try {
    result = await stayPaymentRepository.recordRefundWithInvoice({
      stayEntryId: input.stayId,
      amount: input.amount,
      transactionDate: getISTDateString(0),
      remark: input.remark,
      comment: input.comment ?? null,
      createdBy: input.createdBy,
    });
  } catch {
    // The RPC raised, so its transaction aborted: neither the REFUND ledger row
    // nor the Refund_Invoice was committed and Total_Paid is untouched
    // (Req 14.8). Nothing to undo — and nothing IS undone here, on purpose.
    return { ok: false, reason: "INVOICE_FAILED" };
  }

  if (!result.ok) {
    // Every RPC reason, `REMARK_INVALID` included, is passed through unchanged.
    return { ok: false, reason: result.reason, excess: result.excess };
  }

  return {
    ok: true,
    // Authoritative figures from inside the row lock — not re-derived from a
    // second ledger read, which could observe a later concurrent write.
    balance: balanceFromAuthoritativeTotals(
      result.totalPaid,
      result.remainingBalance
    ),
    // The separate field, NOT `result.transaction.refund_invoice_payment_id`:
    // the RPC snapshots the ledger row before writing the back-reference, so the
    // row's own column is still null in this response (Req 14.7).
    refundInvoicePaymentId: result.refundInvoicePaymentId,
    transactionId: result.transaction.id,
  };
}
