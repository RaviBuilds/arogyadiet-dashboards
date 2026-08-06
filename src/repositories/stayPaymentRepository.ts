// src/repositories/stayPaymentRepository.ts
// Data-access layer for the Stay_Entry Payment_Transaction ledger.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for `stay_payment_transactions`. It applies NO business validation (that
// lives in `src/services/AccommodationService.ts`) and contains NO
// `'use server'` wrappers (those live in `src/actions/*`). Uses the
// service-role admin client, mirroring `stayRepository.ts`.
//
// Balance-mutating appends are NOT plain inserts: `recordTransaction`
// delegates to the row-locked `record_stay_payment_transaction()` RPC, which
// owns the "amount <= remaining balance" check atomically (design decision 5).
// The one exception is `insertAdvanceTransaction`, a direct insert used only
// at onboarding — at creation time there is no existing ledger to race
// against and the stay row does not need locking.
//
// REFUNDS (Revision 2) go through their own RPC:
// `recordRefundWithInvoice` delegates to `record_stay_refund_with_invoice()`,
// which writes the REFUND ledger row AND its Refund_Invoice `payments` row in
// ONE transaction, so a failure at either step leaves Total_Paid untouched
// (Req 14.8, design decision 16). There is deliberately NO Node-side
// compensating delete here: such a delete is itself a write that can fail,
// which is precisely the failure mode Req 14.8 addresses.
//
// Requirements: 5.8, 6.1, 6.2, 6.5, 10.1, 12.11, 14.6, 14.7, 14.8

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Payment_Transaction type, as stored in `transaction_type`. */
export type StayPaymentTransactionType =
  | "ADVANCE"
  | "PARTIAL_BALANCE_PAYMENT"
  | "REFUND";

/** Shape of a `stay_payment_transactions` row as stored in the database (snake_case). */
export interface StayPaymentTransactionRow {
  id: string;
  stay_entry_id: string;
  customer_profile_id: string;
  transaction_type: StayPaymentTransactionType;
  amount: number;
  transaction_date: string; // YYYY-MM-DD (IST)
  comment: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * `payments.id` of this REFUND row's Refund_Invoice. NULL for every
   * non-REFUND row, and NULL for a REFUND row written by the legacy
   * `record_stay_payment_transaction()` path. Set inside
   * `record_stay_refund_with_invoice()`'s transaction, so a Refund_Invoice can
   * never be orphaned from its ledger row.
   *
   * Req 14.7
   */
  refund_invoice_payment_id: string | null;
}

/** Input for {@link recordTransaction}. */
export interface RecordTransactionInput {
  stayEntryId: string;
  transactionType: StayPaymentTransactionType;
  amount: number;
  transactionDate: string; // YYYY-MM-DD (IST)
  comment: string | null;
  remark: string | null;
  createdBy: string | null;
}

/**
 * Outcome of {@link recordTransaction}, mirroring the
 * `record_stay_payment_transaction()` RPC's jsonb shape exactly. These are
 * expected business outcomes, not exceptions — the caller (service layer)
 * maps each `reason` to its pinned message.
 */
export type RecordTransactionResult =
  | {
      ok: true;
      transaction: StayPaymentTransactionRow;
      totalPaid: number;
      remainingBalance: number;
    }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "SHARED_PAYMENT"
        | "AMOUNT_NOT_POSITIVE"
        | "AMOUNT_EXCEEDS_BALANCE"
        | "REFUND_EXCEEDS_EXCESS";
      remainingBalance?: number;
      excess?: number;
    };

/** Input for {@link recordRefundWithInvoice}. */
export interface RecordRefundWithInvoiceInput {
  stayEntryId: string;
  amount: number;
  transactionDate: string; // YYYY-MM-DD (IST)
  remark: string;
  comment: string | null;
  createdBy: string | null;
}

/**
 * Outcome of {@link recordRefundWithInvoice}, mirroring the
 * `record_stay_refund_with_invoice()` RPC's jsonb shape exactly. Like
 * {@link RecordTransactionResult} these are expected business outcomes rather
 * than exceptions — the service layer maps each `reason` to its pinned message.
 *
 * The reason set deliberately differs from `recordTransaction`'s: there is no
 * `AMOUNT_EXCEEDS_BALANCE` (a refund is bounded by the *excess*, not by the
 * remaining balance), and `NOT_ACTIVE`, `NO_EXCESS_TO_REFUND`, and
 * `REMARK_INVALID` have no counterpart there.
 *
 * Req 14.4, 14.5, 14.6, 14.7
 */
export type RecordRefundWithInvoiceResult =
  | {
      ok: true;
      /**
       * The inserted REFUND row as the RPC snapshotted it, i.e. before the
       * back-reference was written — so its `refund_invoice_payment_id` is
       * `null` here. Use {@link refundInvoicePaymentId} for the linkage; a
       * subsequent read of the row returns it populated.
       */
      transaction: StayPaymentTransactionRow;
      /** `payments.id` of the Refund_Invoice written in the same transaction (Req 14.7). */
      refundInvoicePaymentId: string;
      /** Authoritative Total_Paid after the refund, derived inside the row lock. */
      totalPaid: number;
      /** Authoritative Remaining_Balance after the refund. */
      remainingBalance: number;
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
        | "REMARK_INVALID";
      /** Present with `NOT_ACTIVE` — the stay's current Stay_Status. */
      status?: string;
      /** Present with `REFUND_EXCEEDS_EXCESS` — the live excess the form must show. */
      excess?: number;
    };

/** Input for {@link insertAdvanceTransaction}. */
export interface AdvanceTransactionInput {
  stayEntryId: string;
  customerProfileId: string;
  amount: number;
  transactionDate: string; // YYYY-MM-DD (IST)
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const TRANSACTION_COLUMNS =
  "id, stay_entry_id, customer_profile_id, transaction_type, amount, transaction_date, comment, remark, created_by, created_at, updated_at, refund_invoice_payment_id";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List every Payment_Transaction for a stay, ordered chronologically
 * (created_at ascending, matching `idx_stay_payment_tx_stay`).
 *
 * Req 6.5, 10.1
 */
export async function listTransactionsByStay(
  stayEntryId: string
): Promise<StayPaymentTransactionRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_payment_transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("stay_entry_id", stayEntryId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list payment transactions for stay ${stayEntryId}: ${error.message}`
    );
  }

  return (data ?? []) as unknown as StayPaymentTransactionRow[];
}

/**
 * Get a single Payment_Transaction by ID.
 *
 * Returns `null` when no transaction with the given ID exists.
 *
 * Req 10.1
 */
export async function getTransactionById(
  transactionId: string
): Promise<StayPaymentTransactionRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_payment_transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get payment transaction ${transactionId}: ${error.message}`
    );
  }

  return (data as unknown as StayPaymentTransactionRow) ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Append a Payment_Transaction by invoking the row-locked
 * `record_stay_payment_transaction()` RPC. The RPC owns locking the stay row
 * and validating the amount against the authoritative, ledger-derived
 * balance; this function only translates its jsonb response into a typed
 * result and does not throw for business-outcome failures (`ok: false`) —
 * only for an actual Postgrest/connection error calling the RPC itself.
 *
 * Its `REFUND` branch is retained unchanged for legacy/direct invocation, but
 * **no application path passes `'REFUND'` any more** — every refund goes
 * through {@link recordRefundWithInvoice}, so the Refund_Invoice can never be
 * orphaned from its ledger row (Req 14.7, 14.8).
 *
 * Req 5.8, 6.1, 6.2, 12.11
 */
export async function recordTransaction(
  input: RecordTransactionInput
): Promise<RecordTransactionResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("record_stay_payment_transaction", {
    p_stay_entry_id: input.stayEntryId,
    p_transaction_type: input.transactionType,
    p_amount: input.amount,
    p_transaction_date: input.transactionDate,
    p_comment: input.comment,
    p_remark: input.remark,
    p_created_by: input.createdBy,
  });

  if (error) {
    throw new Error(
      `Failed to record payment transaction for stay ${input.stayEntryId}: ${error.message}`
    );
  }

  const result = data as {
    ok: boolean;
    reason?:
      | "NOT_FOUND"
      | "SHARED_PAYMENT"
      | "AMOUNT_NOT_POSITIVE"
      | "AMOUNT_EXCEEDS_BALANCE"
      | "REFUND_EXCEEDS_EXCESS";
    transaction?: StayPaymentTransactionRow;
    total_paid?: number;
    remaining_balance?: number;
    excess?: number;
  };

  if (result.ok) {
    return {
      ok: true,
      transaction: result.transaction as StayPaymentTransactionRow,
      totalPaid: result.total_paid as number,
      remainingBalance: result.remaining_balance as number,
    };
  }

  return {
    ok: false,
    reason: result.reason as NonNullable<typeof result.reason>,
    remainingBalance: result.remaining_balance,
    excess: result.excess,
  };
}

/**
 * Record a REFUND Payment_Transaction together with its Refund_Invoice by
 * invoking the row-locked `record_stay_refund_with_invoice()` RPC. The ledger
 * row and the `payments` row are written in ONE transaction, so a failure at
 * either step leaves Total_Paid untouched (Req 14.8). There is deliberately no
 * Node-side compensating delete: the atomicity lives entirely in the RPC,
 * because a compensating delete is itself a write that can fail — precisely
 * the failure mode Req 14.8 addresses (design decision 16).
 *
 * The RPC derives Total_Paid from the ledger inside the row lock, so the
 * excess its checks use is authoritative even with two admins acting at once.
 * As with {@link recordTransaction}, business-outcome failures come back as
 * `ok: false` results; only an actual Postgrest/connection error — including
 * one raised by the RPC when the invoice insert fails and the whole
 * transaction aborts — throws.
 *
 * Req 14.6, 14.7, 14.8
 */
export async function recordRefundWithInvoice(
  input: RecordRefundWithInvoiceInput
): Promise<RecordRefundWithInvoiceResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("record_stay_refund_with_invoice", {
    p_stay_entry_id: input.stayEntryId,
    p_amount: input.amount,
    p_transaction_date: input.transactionDate,
    p_remark: input.remark,
    p_comment: input.comment,
    p_created_by: input.createdBy,
  });

  if (error) {
    throw new Error(
      `Failed to record refund with invoice for stay ${input.stayEntryId}: ${error.message}`
    );
  }

  const result = data as {
    ok: boolean;
    reason?:
      | "NOT_FOUND"
      | "SHARED_PAYMENT"
      | "NOT_ACTIVE"
      | "AMOUNT_NOT_POSITIVE"
      | "NO_EXCESS_TO_REFUND"
      | "REFUND_EXCEEDS_EXCESS"
      | "REMARK_INVALID";
    transaction?: StayPaymentTransactionRow;
    refund_invoice_payment_id?: string;
    total_paid?: number;
    remaining_balance?: number;
    status?: string;
    excess?: number;
  };

  if (result.ok) {
    return {
      ok: true,
      transaction: result.transaction as StayPaymentTransactionRow,
      refundInvoicePaymentId: result.refund_invoice_payment_id as string,
      totalPaid: result.total_paid as number,
      remainingBalance: result.remaining_balance as number,
    };
  }

  return {
    ok: false,
    reason: result.reason as NonNullable<typeof result.reason>,
    status: result.status,
    excess: result.excess,
  };
}

/**
 * Insert the one-time onboarding Advance_Amount as a direct write, bypassing
 * the RPC. At onboarding time the stay row is brand new — there is no
 * existing ledger to race against and no concurrent writer to serialise
 * against — so the row lock the RPC provides is unnecessary here. The
 * `uniq_stay_advance_transaction` partial unique index still enforces at
 * most one ADVANCE per stay at the database level.
 *
 * Req 5.8, 6.1
 */
export async function insertAdvanceTransaction(
  input: AdvanceTransactionInput
): Promise<StayPaymentTransactionRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stay_payment_transactions")
    .insert({
      stay_entry_id: input.stayEntryId,
      customer_profile_id: input.customerProfileId,
      transaction_type: "ADVANCE",
      amount: input.amount,
      transaction_date: input.transactionDate,
      comment: null,
      remark: null,
      created_by: input.createdBy,
    })
    .select(TRANSACTION_COLUMNS)
    .single();

  if (error) {
    throw new Error(
      `Failed to insert advance transaction for stay ${input.stayEntryId}: ${error.message}`
    );
  }

  return data as unknown as StayPaymentTransactionRow;
}
