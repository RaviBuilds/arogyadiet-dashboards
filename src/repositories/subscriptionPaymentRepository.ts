// src/repositories/subscriptionPaymentRepository.ts
//
// Data access for the MEAL subscription payment ledger.
//
// Feature: meal-subscription-partial-payment
// Plan:    docs/meal-partial-payment-plan.md (Phase 2.3)
//
// Wraps the `record_subscription_payment_transaction` RPC
// (scripts/create-subscription-payment-lifecycle.sql) and maps its typed
// `{ok, reason}` jsonb result onto a discriminated union, so callers never see a
// raw Postgres error. Mirrors `src/repositories/stayPaymentRepository.ts`.
//
// The RPC — not this module — owns every balance-mutating check. It holds a
// `SELECT ... FOR UPDATE` on the subscription row across the check-then-insert,
// so two admins recording instalments concurrently cannot both pass a check that
// only one of them fits.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  RecordSubscriptionPaymentResult,
  SubscriptionPaymentTransaction,
  SubscriptionTransactionType,
} from "@/types/subscriptionPayment";

/** Input for appending one row to the ledger. */
export interface RecordSubscriptionPaymentInput {
  subscriptionId: string;
  transactionType: SubscriptionTransactionType;
  /** Always positive; direction comes from `transactionType`. */
  amount: number;
  /** Business date of the collection (ISO `yyyy-MM-dd`). */
  transactionDate: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  comment?: string | null;
  remark?: string | null;
  /** `users.id` of the admin recording it, for audit. */
  createdBy?: string | null;
}

/** Raw ledger row as returned inside the RPC's jsonb payload. */
interface RawTransactionRow {
  id: string;
  subscription_id: string;
  customer_profile_id: string;
  transaction_type: string;
  amount: number | string;
  transaction_date: string;
  payment_method: string | null;
  payment_reference: string | null;
  comment: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
}

function mapTransaction(row: RawTransactionRow): SubscriptionPaymentTransaction {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    customerProfileId: row.customer_profile_id,
    transactionType: row.transaction_type as SubscriptionTransactionType,
    amount: Number(row.amount ?? 0),
    transactionDate: row.transaction_date,
    paymentMethod: row.payment_method ?? null,
    paymentReference: row.payment_reference ?? null,
    comment: row.comment ?? null,
    remark: row.remark ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Append one transaction to a subscription's payment ledger.
 *
 * Every business failure is modelled explicitly rather than thrown, because each
 * maps to a different pinned message in the UI — and two of them
 * (`AMOUNT_EXCEEDS_BALANCE`, `REFUND_EXCEEDS_EXCESS`) carry the authoritative
 * figure the form must re-display, since the client's copy of the balance may be
 * stale by the time it submits.
 *
 * NOTE: this appends to the ledger ONLY. Call
 * `SubscriptionPaymentService.syncInvoicePaymentProjection` afterwards to move
 * the invoice's `amount_paid` / `balance_due` / `status`. The two are separate so
 * a projection failure cannot roll back money that was actually collected.
 */
export async function recordSubscriptionPayment(
  input: RecordSubscriptionPaymentInput,
  admin: SupabaseClient = createAdminClient(),
): Promise<RecordSubscriptionPaymentResult> {
  const { data, error } = await admin.rpc(
    "record_subscription_payment_transaction",
    {
      p_subscription_id: input.subscriptionId,
      p_transaction_type: input.transactionType,
      p_amount: input.amount,
      p_transaction_date: input.transactionDate,
      p_payment_method: input.paymentMethod ?? null,
      p_payment_reference: input.paymentReference ?? null,
      p_comment: input.comment ?? null,
      p_remark: input.remark ?? null,
      p_created_by: input.createdBy ?? null,
    },
  );

  if (error) {
    return {
      ok: false,
      reason: "ERROR",
      message: error.message || "Failed to record the payment.",
    };
  }

  const result = data as Record<string, unknown> | null;

  if (!result || typeof result !== "object") {
    return {
      ok: false,
      reason: "ERROR",
      message: "The payment could not be recorded (no response from the database).",
    };
  }

  if (result.ok === true) {
    return {
      ok: true,
      transaction: mapTransaction(result.transaction as RawTransactionRow),
      totalPaid: Number(result.total_paid ?? 0),
      remainingBalance: Number(result.remaining_balance ?? 0),
    };
  }

  const reason = String(result.reason ?? "ERROR");

  switch (reason) {
    case "NOT_FOUND":
      return { ok: false, reason: "NOT_FOUND" };
    case "NO_TOTAL_PAYABLE":
      return { ok: false, reason: "NO_TOTAL_PAYABLE" };
    case "AMOUNT_NOT_POSITIVE":
      return { ok: false, reason: "AMOUNT_NOT_POSITIVE" };
    case "AMOUNT_EXCEEDS_BALANCE":
      return {
        ok: false,
        reason: "AMOUNT_EXCEEDS_BALANCE",
        remainingBalance: Number(result.remaining_balance ?? 0),
      };
    case "REFUND_EXCEEDS_EXCESS":
      return {
        ok: false,
        reason: "REFUND_EXCEEDS_EXCESS",
        excess: Number(result.excess ?? 0),
      };
    case "DUPLICATE_ADVANCE":
      return { ok: false, reason: "DUPLICATE_ADVANCE" };
    default:
      return {
        ok: false,
        reason: "ERROR",
        message: `The payment could not be recorded (${reason}).`,
      };
  }
}

/**
 * Every ledger row for a subscription, oldest first.
 *
 * Chronological because this is a statement of account: the ADVANCE taken at
 * onboarding should read first, followed by each instalment in the order it was
 * collected.
 */
export async function listSubscriptionPayments(
  subscriptionId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<SubscriptionPaymentTransaction[]> {
  const { data, error } = await admin
    .from("subscription_payment_transactions")
    .select(
      "id, subscription_id, customer_profile_id, transaction_type, amount, transaction_date, payment_method, payment_reference, comment, remark, created_by, created_at",
    )
    .eq("subscription_id", subscriptionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load the payment ledger for subscription ${subscriptionId}: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => mapTransaction(row as RawTransactionRow));
}
