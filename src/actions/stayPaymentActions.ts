"use server";

// src/actions/stayPaymentActions.ts
//
// Server Actions for the stay payment ledger: recording payments, refunds,
// fetching the ledger view, and payment receipts.
//
// Pattern: admin-group authorisation → Zod re-validation → repository/RPC →
// mapped result in the project's { success: true; data } | { error; fieldErrors? } shape.
//
// Every mutation returns a fresh StayBalanceSnapshot so the panel can re-render
// without a second round trip (Req 5.9).
//
// Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.5, 6.6, 10.1, 12.9, 12.10, 12.11

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import {
  recordStayPaymentSchema,
  recordStayRefundSchema,
} from "@/validations/accommodationSchema";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import * as stayRepository from "@/repositories/stayRepository";
import * as stayExtensionHistoryRepository from "@/repositories/stayExtensionHistoryRepository";
import * as AccommodationService from "@/services/AccommodationService";
import { getISTDateString } from "@/lib/dates/ist";
import type {
  StayBalanceSnapshot,
  StayLedgerView,
  StayPaymentTransaction,
  StayExtension,
  PaymentReceiptData,
  StayEntry,
} from "@/types/accommodation";
import type { StayPaymentTransactionRow } from "@/repositories/stayPaymentRepository";
import type { StayExtensionHistoryRow } from "@/repositories/stayExtensionHistoryRepository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a StayExtensionHistoryRow (snake_case) to a StayExtension (camelCase). */
function mapExtensionRow(row: StayExtensionHistoryRow): StayExtension {
  return {
    id: row.id,
    stayEntryId: row.stay_entry_id,
    customerProfileId: row.customer_profile_id,
    additionalNights: row.additional_nights,
    additionalAmount: row.additional_amount,
    nightsBefore: row.nights_before,
    nightsAfter: row.nights_after,
    totalAmountBefore: row.total_amount_before,
    totalAmountAfter: row.total_amount_after,
    extendedOn: row.extended_on,
    createdAt: row.created_at,
  };
}

/** Maps a StayPaymentTransactionRow (snake_case) to a StayPaymentTransaction (camelCase). */
function mapTransactionRow(row: StayPaymentTransactionRow): StayPaymentTransaction {
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

/** Maps a StayEntryRow to a StayEntry domain type, mirroring stayActions. */
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
 * Records a partial/balance payment against a stay.
 *
 * Flow: admin auth → Zod validate → RPC (row-locked) → mapped result.
 * On success, returns a fresh StayBalanceSnapshot.
 *
 * Req 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
 */
export async function recordStayPaymentAction(
  stayId: string,
  input: unknown
): Promise<ActionResult<StayBalanceSnapshot>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Zod re-validation
  const parsed = recordStayPaymentSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path && !fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return {
      error: firstIssue?.message ?? "Invalid input",
      fieldErrors,
    };
  }

  const { amount, comment, remark } = parsed.data;

  // 3. Repository/RPC call
  const result = await stayPaymentRepository.recordTransaction({
    stayEntryId: stayId,
    transactionType: "PARTIAL_BALANCE_PAYMENT",
    amount,
    transactionDate: getISTDateString(0),
    comment,
    remark: remark ?? null,
    createdBy: ctx.userId,
  });

  // 4. Map RPC reasons to pinned messages
  if (!result.ok) {
    return mapRpcError(result.reason, result.remainingBalance, result.excess);
  }

  // 5. Return fresh balance snapshot
  const snapshot: StayBalanceSnapshot = {
    totalStayAmount: result.totalPaid + result.remainingBalance,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    isFullyPaid: AccommodationService.toPaise(result.remainingBalance) === 0,
    refundDue: Math.max(0, -result.remainingBalance),
  };

  return { success: true, data: snapshot };
}

/**
 * Records a refund against a stay (used after Early_Checkout when excess is owed).
 *
 * Flow: admin auth → Zod validate → RPC (row-locked) → mapped result.
 * On success, returns a fresh StayBalanceSnapshot.
 *
 * Req 12.9, 12.10, 12.11
 */
export async function recordStayRefundAction(
  stayId: string,
  input: unknown
): Promise<ActionResult<StayBalanceSnapshot>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Zod re-validation
  const parsed = recordStayRefundSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path && !fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      fieldErrors,
    };
  }

  const { amount, remark, comment } = parsed.data;

  // 3. Repository/RPC call
  const result = await stayPaymentRepository.recordTransaction({
    stayEntryId: stayId,
    transactionType: "REFUND",
    amount,
    transactionDate: getISTDateString(0),
    comment: comment ?? null,
    remark,
    createdBy: ctx.userId,
  });

  // 4. Map RPC reasons to pinned messages
  if (!result.ok) {
    return mapRpcError(result.reason, result.remainingBalance, result.excess);
  }

  // 5. Return fresh balance snapshot
  const snapshot: StayBalanceSnapshot = {
    totalStayAmount: result.totalPaid + result.remainingBalance,
    totalPaid: result.totalPaid,
    remainingBalance: result.remainingBalance,
    isFullyPaid: AccommodationService.toPaise(result.remainingBalance) === 0,
    refundDue: Math.max(0, -result.remainingBalance),
  };

  return { success: true, data: snapshot };
}

/**
 * Fetches the full ledger view for a stay: the stay entry, transactions,
 * derived balance, and action visibility flags.
 *
 * Req 6.5, 6.6
 */
export async function getStayPaymentLedgerAction(
  stayId: string
): Promise<ActionResult<StayLedgerView>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Fetch stay
  const stayRow = await stayRepository.getStayById(stayId);
  if (!stayRow) {
    return { error: "Stay entry not found." };
  }

  const stay = mapRowToStayEntry(stayRow);

  // 3. Fetch ledger
  const transactionRows = await stayPaymentRepository.listTransactionsByStay(stayId);
  const transactions = transactionRows.map(mapTransactionRow);

  // 3b. Fetch extension history (informational — does not affect balance below)
  const extensionRows = await stayExtensionHistoryRepository.listExtensionsByStay(stayId);
  const extensions = extensionRows.map(mapExtensionRow);

  // 4. Derive balance
  const balance = AccommodationService.deriveStayBalance(
    stay.paymentAmount,
    transactions
  );

  // 5. Derive action visibility
  const hasFinalInvoice = stay.finalInvoicePaymentId !== null;
  const todayIST = getISTDateString(0);
  const visibility = AccommodationService.deriveStayActionVisibility(
    stay,
    balance,
    hasFinalInvoice,
    todayIST
  );

  // 6. Return the ledger view
  const ledgerView: StayLedgerView = {
    stay,
    transactions,
    extensions,
    balance,
    hasFinalInvoice,
    visibility,
  };

  return { success: true, data: ledgerView };
}

/**
 * Fetches receipt data for a single payment transaction.
 *
 * Req 10.1
 */
export async function getStayPaymentReceiptAction(
  transactionId: string
): Promise<ActionResult<PaymentReceiptData>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Fetch transaction
  const txRow = await stayPaymentRepository.getTransactionById(transactionId);
  if (!txRow) {
    return { error: "Payment transaction not found." };
  }

  // 3. Fetch stay
  const stayRow = await stayRepository.getStayById(txRow.stay_entry_id);
  if (!stayRow) {
    return { error: "Stay entry not found." };
  }

  const stay = mapRowToStayEntry(stayRow);

  // 4. Fetch customer info (name + mobile) via a users join from customer_profiles
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  // `customer_profiles` has two FKs into `users` (user_id and dietitian_id), so a
  // bare `users(...)` embed is ambiguous and PostgREST rejects the whole query —
  // which silently emptied the receipt's "Received From" block. Pin the FK.
  const { data: profileData, error: profileError } = await admin
    .from("customer_profiles")
    .select("id, users!customer_profiles_user_id_fkey(full_name, mobile)")
    .eq("id", txRow.customer_profile_id)
    .single();

  if (profileError) {
    console.error("[getStayPaymentReceiptAction] customer lookup failed", profileError);
  }

  const users = profileData?.users as
    | { full_name: string; mobile: string }
    | { full_name: string; mobile: string }[]
    | null;
  const userInfo = Array.isArray(users) ? users[0] : users;

  // 5. Build PaymentReceiptData via the pure builder
  const transaction = mapTransactionRow(txRow);
  const receiptData = AccommodationService.buildPaymentReceiptData(
    transaction,
    { stayType: stay.stayType, startDate: stay.startDate, endDate: stay.endDate },
    {
      fullName: userInfo?.full_name ?? "Unknown",
      mobile: userInfo?.mobile ?? "",
    }
  );

  return { success: true, data: receiptData };
}

// ---------------------------------------------------------------------------
// Pinned RPC reason → ActionError mapping
// ---------------------------------------------------------------------------

function mapRpcError(
  reason: string,
  remainingBalance?: number,
  excess?: number
): ActionError {
  switch (reason) {
    case "AMOUNT_EXCEEDS_BALANCE":
      return {
        error: "Amount exceeds the remaining balance.",
        fieldErrors: {
          amount: `Amount exceeds the remaining balance of ₹${remainingBalance ?? 0}.`,
        },
      };
    case "REFUND_EXCEEDS_EXCESS":
      return {
        error: "Refund amount exceeds the refundable excess.",
        fieldErrors: {
          amount: `Refund amount exceeds the refundable excess of ₹${excess ?? 0}.`,
        },
      };
    case "SHARED_PAYMENT":
      return { error: "Payment tracking is disabled for shared-payment stays." };
    case "AMOUNT_NOT_POSITIVE":
      return {
        error: "Amount must be greater than zero.",
        fieldErrors: {
          amount: "Amount must be greater than zero.",
        },
      };
    case "NOT_FOUND":
      return { error: "Stay entry not found." };
    default:
      return { error: "An unexpected error occurred." };
  }
}
