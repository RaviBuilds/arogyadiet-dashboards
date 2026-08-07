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
// Refunds (Revision 2) route through `AccommodationService.recordRefundWithInvoice`
// → `record_stay_refund_with_invoice()`, so the REFUND ledger row and its
// Refund_Invoice are written together or not at all. The generic
// `record_stay_payment_transaction` path is no longer used for refunds.
//
// The ledger read returns both history lists — extensions and recalculations —
// in one parallelised fetch, so the Accommodation tab's two history cards render
// from a single round trip. No separate recalculation action exists (Req 13.3, 13.5).
//
// Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.5, 6.6, 10.1,
// 13.3, 13.5, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import {
  recordStayPaymentSchema,
  recordStayRefundSchema,
} from "@/validations/accommodationSchema";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import * as stayRepository from "@/repositories/stayRepository";
import * as stayExtensionHistoryRepository from "@/repositories/stayExtensionHistoryRepository";
import * as stayRecalculationHistoryRepository from "@/repositories/stayRecalculationHistoryRepository";
import * as AccommodationService from "@/services/AccommodationService";
import { getISTDateString } from "@/lib/dates/ist";
import type {
  StayBalanceSnapshot,
  StayLedgerView,
  StayPaymentTransaction,
  StayExtension,
  StayRecalculation,
  PaymentReceiptData,
  StayEntry,
} from "@/types/accommodation";
import type { StayPaymentTransactionRow } from "@/repositories/stayPaymentRepository";
import type { StayExtensionHistoryRow } from "@/repositories/stayExtensionHistoryRepository";
import type { StayRecalculationHistoryRow } from "@/repositories/stayRecalculationHistoryRepository";

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

/**
 * Maps a StayRecalculationHistoryRow (snake_case) to a StayRecalculation (camelCase).
 *
 * Deliberately separate from {@link mapExtensionRow}: the two histories carry
 * different columns (`end_date_before` / `end_date_after` exist only here, and
 * `additional_nights` / `additional_amount` only there) and must never be
 * produced from each other's rows (Req 13.6, 13.7).
 */
function mapRecalculationRow(
  row: StayRecalculationHistoryRow
): StayRecalculation {
  return {
    id: row.id,
    stayEntryId: row.stay_entry_id,
    customerProfileId: row.customer_profile_id,
    nightsBefore: row.nights_before,
    nightsAfter: row.nights_after,
    totalAmountBefore: row.total_amount_before,
    totalAmountAfter: row.total_amount_after,
    endDateBefore: row.end_date_before,
    endDateAfter: row.end_date_after,
    recalculatedOn: row.recalculated_on,
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
    // The repository already selects this column; dropping it here left every
    // REFUND row on the client with no way to reach its Refund_Invoice.
    refundInvoicePaymentId: row.refund_invoice_payment_id,
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
    recalculationApplied: row.recalculation_applied,
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
 * Records a refund against a stay — the "Mark as refunded" action (Revision 2).
 *
 * No longer a branch of Early_Checkout: it is callable **whenever** an ACTIVE
 * stay's Total_Paid exceeds its current Total_Stay_Amount, with no preceding
 * recalculation required (Req 14.1). Availability is a property of the live
 * balance, so it survives a reload.
 *
 * Flow: admin auth → Zod re-validation → `AccommodationService.recordRefundWithInvoice`
 * → mapped result. The service delegates to the `record_stay_refund_with_invoice()`
 * RPC, which writes the REFUND ledger row, its Refund_Invoice `payments` row, and
 * the back-reference in ONE row-locked transaction — so the invoice can never be
 * orphaned from its ledger row, and an invoice failure rolls the refund back with
 * it (Req 14.6, 14.7, 14.8). There is deliberately no Node-side compensating
 * delete, cleanup, or retry here: the atomicity lives in the RPC.
 *
 * It writes no `status` and no `checked_out_at`. A refund that settles the
 * balance only makes the stay *eligible* for Mark as Checked Out — the admin
 * still has to press it (Req 14.10).
 *
 * On success returns the authoritative post-refund balance **and** the
 * `payments.id` of the generated Refund_Invoice, so the dialog can link straight
 * to the document without a second round trip.
 *
 * Req 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.10
 */
export async function recordStayRefundAction(
  stayId: string,
  input: unknown
): Promise<
  ActionResult<{
    balance: StayBalanceSnapshot;
    /** Req 14.7 — always present on success. */
    refundInvoicePaymentId: string;
  }>
> {
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

  // 3. Service orchestration — the refund + Refund_Invoice RPC, not the generic
  //    `record_stay_payment_transaction` path (which no application code may
  //    call with 'REFUND' any more).
  const result = await AccommodationService.recordRefundWithInvoice({
    stayId,
    amount,
    remark,
    comment: comment ?? null,
    createdBy: ctx.userId,
  });

  // 4. Map every reason to its pinned message — no raw SQL error surfaces
  if (!result.ok) {
    return mapRefundReason(result.reason, result.excess);
  }

  // 5. Return the authoritative balance plus the Refund_Invoice link
  return {
    success: true,
    data: {
      balance: result.balance,
      refundInvoicePaymentId: result.refundInvoicePaymentId,
    },
  };
}

/**
 * Fetches the full ledger view for a stay: the stay entry, transactions, both
 * history lists (extensions and recalculations), the derived balance, and the
 * action visibility flags.
 *
 * Signature unchanged from Revision 1 — the returned `StayLedgerView` simply
 * also carries `recalculations` now, so the Recalculation History card renders
 * from the very same round trip the Extension History card already used.
 *
 * Req 6.5, 6.6, 13.3, 13.5
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

  // 3. Fetch the ledger and both history lists in ONE round trip.
  //
  //    The two history lists are independent of each other and of the ledger, so
  //    they are awaited together rather than in sequence. Recalculation history
  //    rides along here on purpose: the Recalculation History card and the
  //    Extension History card render from this single fetch, and no separate
  //    server action exists for either — two fetch paths for one panel would be
  //    two truths (Req 13.3, 13.5).
  //
  //    Both histories are informational: neither feeds the balance derived below.
  const [transactionRows, extensionRows, recalculationRows] = await Promise.all([
    stayPaymentRepository.listTransactionsByStay(stayId),
    stayExtensionHistoryRepository.listExtensionsByStay(stayId),
    stayRecalculationHistoryRepository.listRecalculationsByStay(stayId),
  ]);

  const transactions = transactionRows.map(mapTransactionRow);
  const extensions = extensionRows.map(mapExtensionRow);
  // Ordering comes from the repository (created_at ascending, oldest first) and
  // is preserved here — no re-sort, so there is one ordering authority (Req 13.5).
  const recalculations = recalculationRows.map(mapRecalculationRow);

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
    recalculations,
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

/**
 * Maps a `recordRefundWithInvoice` reason to its pinned message.
 *
 * Kept separate from {@link mapRpcError} on purpose: the refund path runs a
 * different RPC with a different reason set (`NO_EXCESS_TO_REFUND`,
 * `REMARK_INVALID`, `NOT_ACTIVE`) plus the service-level `INVOICE_FAILED`, and a
 * shared mapper would have to fall through to "An unexpected error occurred."
 * for exactly the reasons this feature adds. The `switch` is exhaustive over the
 * union — no `default` — so a new reason becomes a compile error rather than a
 * silent generic message.
 *
 * Req 14.3, 14.4, 14.5, 14.8
 */
function mapRefundReason(
  // Sourced from the service's own union rather than re-declared, so a reason
  // added there cannot silently go unmapped here.
  reason: Extract<
    AccommodationService.RecordRefundOutcome,
    { ok: false }
  >["reason"],
  excess?: number
): ActionError {
  switch (reason) {
    case "NO_EXCESS_TO_REFUND":
      // Req 14.5 — the excess was consumed between render and submit (or never
      // existed). Nothing was written.
      return { error: "There is no excess payment to refund for this stay." };
    case "REFUND_EXCEEDS_EXCESS":
      // Req 14.4 — `excess` is the LIVE figure derived inside the row lock, so
      // the form re-prefills against the truth rather than its stale render.
      return {
        error: "Refund amount exceeds the refundable excess.",
        fieldErrors: {
          amount: `Refund amount exceeds the refundable excess of ₹${excess ?? 0}.`,
        },
      };
    case "AMOUNT_NOT_POSITIVE":
      return {
        error: "Refund amount must be greater than zero.",
        fieldErrors: {
          amount: "Refund amount must be greater than zero.",
        },
      };
    case "REMARK_INVALID":
      // Req 14.3 — the RPC re-checks the remark and the comment inside the lock
      // but reports one reason for both, so the field error is pinned to the
      // mandatory field. Zod above has already rejected an over-long comment
      // with its own `fieldErrors.comment`, so reaching here means the remark.
      return {
        error: "A remark describing how the refund was initiated is required.",
        fieldErrors: {
          remark:
            "A remark describing how the refund was initiated is required.",
        },
      };
    case "NOT_ACTIVE":
      return { error: "Refunds can be recorded only for active stays." };
    case "SHARED_PAYMENT":
      return { error: "Payment tracking is disabled for shared-payment stays." };
    case "INVOICE_FAILED":
      // Req 14.8 — the RPC aborted, so the REFUND row rolled back with the
      // invoice and Total_Paid is untouched. Retry is safe.
      return {
        error:
          "The refund could not be completed — no change was made. Please try again.",
      };
    case "NOT_FOUND":
      return { error: "Stay entry not found." };
  }
}
