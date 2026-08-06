"use server";

// src/actions/stayInvoiceActions.ts
//
// Server Action for generating the Final_Consolidated_Invoice for a stay.
//
// Idempotent on the internal path: returns the existing invoice when one is
// already present. An explicit manual retrigger (`{ manualRetrigger: true }`)
// instead rejects when an invoice already exists (Req 8.10).
// Serves checkout, the Backdated_Stay "Generate Final Invoice" action, and
// the manual retry path after a generation failure (Req 8.7, 8.9).
//
// Rejects a stay that is neither a fully-paid Backdated_Stay nor a stay
// already finalised through checkout.
//
// Requirements: 8.1, 8.2, 8.6, 8.7, 8.9, 8.10, 9.2, 9.3

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import * as stayRepository from "@/repositories/stayRepository";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import * as AccommodationService from "@/services/AccommodationService";

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string };
type ActionResult<T> = ActionSuccess<T> | ActionError;

type GenerateInvoiceActionData =
  | { paymentId: string; alreadyExisted: boolean }
  | { invoiceStatus: "NOT_APPLICABLE" };

/**
 * Call-site intent for {@link generateFinalStayInvoiceAction}.
 *
 * `manualRetrigger: true` marks an explicit admin-initiated generation — the
 * "Invoice generation failed — retry" button and the Backdated_Stay
 * "Generate Final Invoice" action. Omitted / false means an internal
 * invocation (checkout), which stays silently idempotent.
 */
export type GenerateFinalStayInvoiceOptions = {
  manualRetrigger?: boolean;
};

/** Pinned rejection wording for a manual retrigger over an existing invoice (Req 8.10). */
const DUPLICATE_MANUAL_TRIGGER_ERROR =
  "A final invoice already exists for this stay.";

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Generates the single Final_Consolidated_Invoice for a stay.
 *
 * Eligibility gate: the stay must be EITHER:
 *   (a) a fully-paid Backdated_Stay (status FINISHED + is_backdated), OR
 *   (b) a stay already finalised through checkout (status FINISHED + checked_out_at set).
 *
 * If neither condition holds, the action rejects — it is NOT a general-purpose
 * invoice generator.
 *
 * Internal path (checkout): idempotent — if an invoice already exists, returns
 * it with `alreadyExisted: true` (Req 8.7).
 *
 * Explicit manual retrigger (`opts.manualRetrigger === true`): rejects with
 * "A final invoice already exists for this stay." when the stay already carries
 * a final invoice (Req 8.10). It still succeeds when no invoice exists, which
 * is the manual retry path after a recorded generation failure (Req 8.9).
 *
 * Either way no second `payments` row is written — the manual branch returns
 * before the service is reached, and the service itself short-circuits on an
 * existing `final_invoice_payment_id`; `uniq_final_stay_invoice_per_stay` is
 * the database backstop.
 *
 * On shared-payment / zero-total stays, returns `invoiceStatus: "NOT_APPLICABLE"`.
 * On failure, the service layer records the error on the stay and the action
 * surfaces it (Req 8.7).
 *
 * Req 8.1, 8.2, 8.6, 8.7, 8.9, 8.10, 9.2, 9.3
 */
export async function generateFinalStayInvoiceAction(
  stayId: string,
  opts?: GenerateFinalStayInvoiceOptions
): Promise<ActionResult<GenerateInvoiceActionData>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Fetch the stay
  const stayRow = await stayRepository.getStayById(stayId);
  if (!stayRow) {
    return { error: "Stay entry not found." };
  }

  // 3. Explicit manual retrigger over an existing invoice → reject (Req 8.10).
  //    The internal path falls through and stays idempotent (Req 8.7).
  if (opts?.manualRetrigger === true && stayRow.final_invoice_payment_id !== null) {
    return { error: DUPLICATE_MANUAL_TRIGGER_ERROR };
  }

  // 4. Eligibility gate
  const isFinished = stayRow.status === "FINISHED";
  const isBackdated = stayRow.is_backdated;
  const isCheckedOut = stayRow.checked_out_at !== null;

  if (!isFinished) {
    return { error: "Invoice generation is only available for finished stays." };
  }

  // Must be either a backdated stay or a stay finalised through checkout
  if (!isBackdated && !isCheckedOut) {
    return {
      error:
        "Invoice generation is only available for stays checked out or backdated stays with full payment.",
    };
  }

  // For backdated stays (not checked out), verify the balance is zero
  if (isBackdated && !isCheckedOut) {
    const transactions = await stayPaymentRepository.listTransactionsByStay(stayId);
    const mappedTransactions = transactions.map((row) => ({
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
    }));

    const balance = AccommodationService.deriveStayBalance(
      stayRow.payment_amount,
      mappedTransactions
    );

    if (!balance.isFullyPaid) {
      return {
        error: `Cannot generate invoice: outstanding balance of ₹${balance.remainingBalance}.`,
      };
    }
  }

  // 5. Delegate to AccommodationService.generateFinalInvoice (idempotent)
  const result = await AccommodationService.generateFinalInvoice(stayId);

  // 6. Map the result
  if (!result.ok) {
    return { error: result.error };
  }

  if ("invoiceStatus" in result) {
    return { success: true, data: { invoiceStatus: result.invoiceStatus } };
  }

  return {
    success: true,
    data: { paymentId: result.paymentId, alreadyExisted: result.alreadyExisted },
  };
}
