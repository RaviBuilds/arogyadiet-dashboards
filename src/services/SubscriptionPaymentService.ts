// src/services/SubscriptionPaymentService.ts
//
// Business service for the MEAL subscription partial-payment lifecycle.
//
// Feature: meal-subscription-partial-payment
// Plan:    docs/meal-partial-payment-plan.md (Phase 2.4)
//
// LAYERING: server-only. Balance math is a PURE function
// (`deriveSubscriptionBalance`) so it can be unit-tested and pinned against the
// SQL formula in `subscription_payment_balances` by a parity test. Everything
// that touches the database is a thin wrapper around it.
//
// MONEY ARITHMETIC: all comparisons happen in integer PAISE. Comparing rupees as
// IEEE-754 doubles makes a fully-settled subscription report a residual balance
// of ~1e-13, which would leave the invoice stuck on "PARTIAL PAYMENT PENDING"
// forever and keep the customer blocked from buying again. Same discipline as
// `AccommodationService.deriveStayBalance`.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  PARTIALLY_PAID_STATUS,
  resolveInvoicePaymentState,
  type CustomerOutstandingBalance,
  type InvoicePaymentState,
  type SubscriptionBalanceSnapshot,
  type SubscriptionPaymentTransaction,
  type SubscriptionTransactionType,
} from "@/types/subscriptionPayment";

// ---------------------------------------------------------------------------
// Paise helpers
// ---------------------------------------------------------------------------

/**
 * Rupees → integer paise. Rounds, so a value that arrived as 1971.4499999998
 * from a float multiplication becomes 197145 rather than truncating to 197144.
 */
function toPaise(rupees: number | string | null | undefined): number {
  const value = Number(rupees ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Integer paise → rupees with exactly 2 decimals of precision. */
function toRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

// ---------------------------------------------------------------------------
// Pure balance derivation
// ---------------------------------------------------------------------------

/** The minimum a ledger row must expose for the balance formula. */
export interface BalanceLedgerEntry {
  transactionType: SubscriptionTransactionType | string;
  amount: number | string;
}

/**
 * Derive a subscription's payment position from its ledger.
 *
 * THE formula, identical to the SQL in `subscription_payment_balances` and in
 * `record_subscription_payment_transaction`:
 *   Total_Paid = SUM(type === 'REFUND' ? -amount : +amount)
 *   Balance    = Total_Payable - Total_Paid
 *
 * A negative `remainingBalance` means a refund is due (over-collected); it is
 * deliberately NOT clamped, because callers need to tell "owes ₹500" from
 * "is owed ₹500". `hasOutstanding` is the strictly-positive test, so a
 * refund-due subscription never blocks a new purchase.
 *
 * @param totalPayable `subscriptions.total_payable`
 * @param entries      every ledger row for the subscription
 */
export function deriveSubscriptionBalance(
  subscriptionId: string,
  totalPayable: number | string | null | undefined,
  entries: readonly BalanceLedgerEntry[],
): SubscriptionBalanceSnapshot {
  const totalPayablePaise = toPaise(totalPayable);

  const totalPaidPaise = entries.reduce((acc, entry) => {
    const amountPaise = toPaise(entry.amount);
    return entry.transactionType === "REFUND"
      ? acc - amountPaise
      : acc + amountPaise;
  }, 0);

  const remainingPaise = totalPayablePaise - totalPaidPaise;

  return {
    subscriptionId,
    totalPayable: toRupees(totalPayablePaise),
    totalPaid: toRupees(totalPaidPaise),
    remainingBalance: toRupees(remainingPaise),
    // Exact zero, compared in paise — not `<= 0`, so an over-collection is not
    // silently reported as a clean settlement.
    isFullyPaid: remainingPaise === 0,
    hasOutstanding: remainingPaise > 0,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A row of the `subscription_payment_balances` view. */
interface BalanceViewRow {
  subscription_id: string;
  customer_profile_id: string;
  total_payable: number | string | null;
  total_paid: number | string | null;
  remaining_balance: number | string | null;
}

function fromBalanceViewRow(row: BalanceViewRow): SubscriptionBalanceSnapshot {
  const totalPayablePaise = toPaise(row.total_payable);
  const totalPaidPaise = toPaise(row.total_paid);
  // Recompute rather than trusting the view's `remaining_balance`, so the paise
  // comparison — not NUMERIC arithmetic crossing a driver boundary as a string —
  // decides `isFullyPaid`.
  const remainingPaise = totalPayablePaise - totalPaidPaise;

  return {
    subscriptionId: row.subscription_id,
    totalPayable: toRupees(totalPayablePaise),
    totalPaid: toRupees(totalPaidPaise),
    remainingBalance: toRupees(remainingPaise),
    isFullyPaid: remainingPaise === 0,
    hasOutstanding: remainingPaise > 0,
  };
}

/**
 * A single subscription's derived balance, or `null` when the subscription has
 * no ledger rows.
 *
 * `null` is the normal, expected answer for every subscription paid in full at
 * onboarding — including all pre-existing ones. It means "nothing was ever
 * collected in instalments", NOT "not found".
 */
export async function getSubscriptionBalance(
  subscriptionId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<SubscriptionBalanceSnapshot | null> {
  const { data, error } = await admin
    .from("subscription_payment_balances")
    .select("subscription_id, customer_profile_id, total_payable, total_paid, remaining_balance")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load the payment balance for subscription ${subscriptionId}: ${error.message}`,
    );
  }

  return data ? fromBalanceViewRow(data as BalanceViewRow) : null;
}

/**
 * A customer's aggregate outstanding position, used to gate the purchase of a
 * new subscription.
 *
 * WHY THIS CANNOT BLOCK EXISTING CUSTOMERS (plan finding 0.5): the view INNER
 * JOINs `subscription_payment_transactions`. Every pre-existing subscription was
 * a single full payment and has zero ledger rows, so it is simply absent from
 * the view and cannot contribute an outstanding balance. No backfill required.
 *
 * Refund-due (negative balance) subscriptions are excluded — being owed money is
 * not a reason to block a purchase.
 */
export async function getOutstandingBalanceForCustomer(
  customerProfileId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<CustomerOutstandingBalance> {
  const { data, error } = await admin
    .from("subscription_payment_balances")
    .select("subscription_id, customer_profile_id, total_payable, total_paid, remaining_balance")
    .eq("customer_profile_id", customerProfileId);

  if (error) {
    throw new Error(
      `Failed to load outstanding balances for customer ${customerProfileId}: ${error.message}`,
    );
  }

  const snapshots = (data ?? []).map((row) =>
    fromBalanceViewRow(row as BalanceViewRow),
  );
  const outstanding = snapshots.filter((s) => s.hasOutstanding);

  const totalOutstandingPaise = outstanding.reduce(
    (acc, s) => acc + toPaise(s.remainingBalance),
    0,
  );

  return {
    hasOutstanding: outstanding.length > 0,
    totalOutstanding: toRupees(totalOutstandingPaise),
    outstandingSubscriptions: outstanding,
  };
}

// ---------------------------------------------------------------------------
// Invoice projection
// ---------------------------------------------------------------------------

/**
 * Re-project the ledger onto the subscription's single invoice row, updating
 * `payments.amount_paid`, `payments.balance_due` and `payments.status`.
 *
 * Design decision D3: there is exactly ONE invoice per subscription, and this is
 * how it moves from "PARTIAL PAYMENT PENDING" to "FULLY PAID" (the final-invoice
 * state) as instalments arrive. No new invoice row is ever created.
 *
 * Kept OUT of `record_subscription_payment_transaction` on purpose: a failure to
 * update this denormalised projection must not roll back a collection that was
 * genuinely taken from the customer. The ledger is the source of truth; this is a
 * cache, and it is idempotent — safe to re-run to repair drift.
 */
export async function syncInvoicePaymentProjection(
  subscriptionId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ ok: boolean; message?: string }> {
  const balance = await getSubscriptionBalance(subscriptionId, admin);

  // No ledger means the subscription was paid in full at onboarding; the invoice
  // row already reflects that and must be left alone.
  if (!balance) return { ok: true };

  const remainingPaise = toPaise(balance.remainingBalance);
  // Clamp at zero: an over-collection is a refund matter, not a negative
  // balance_due, and the column has a `>= 0` CHECK.
  const balanceDue = toRupees(Math.max(remainingPaise, 0));

  const { error } = await admin
    .from("payments")
    .update({
      amount_paid: balance.totalPaid,
      balance_due: balanceDue,
      status: remainingPaise > 0 ? PARTIALLY_PAID_STATUS : "PAID",
    })
    .eq("subscription_id", subscriptionId)
    .eq("invoice_type", "SUBSCRIPTION");

  if (error) {
    return {
      ok: false,
      message: `Failed to sync the invoice payment figures: ${error.message}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-subscription payment summary (admin Customer 360 → Subscription tab)
// ---------------------------------------------------------------------------

/**
 * A subscription's full payment position, itemised for display.
 *
 * Figures are resolved so the card is CORRECT WITH OR WITHOUT the cosmetic
 * backfill having run. A legacy settled invoice still has `amount_paid = 0` in
 * the database; reading that column blindly would render "Paid ₹0.00" against a
 * subscription that was in fact paid in full years ago. So `status` decides, and
 * the columns are only trusted for the `PARTIALLY_PAID` rows the new flow writes.
 */
export interface SubscriptionPaymentSummary {
  subscriptionId: string;
  /** `payments.id` — the single invoice for this subscription (D3). */
  paymentId: string | null;
  subscriptionCode: string | null;
  planName: string | null;
  customerCategory: string | null;
  subscriptionStatus: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /** Plan duration in days — the meal analogue of a stay's "N nights". */
  totalDays: number | null;

  /** Itemised breakup. Sums to `totalPayable`. */
  baseAmount: number;
  taxAmount: number;
  deliveryCharge: number;
  miscCharge: number;
  /** Admin-supplied name; printed verbatim, never "Miscellaneous". */
  miscChargeLabel: string | null;
  discountAmount: number;

  totalPayable: number;
  amountPaid: number;
  /** Positive = customer owes. Never negative; see `refundDue`. */
  balanceDue: number;
  /** Positive = the customer was over-collected and is owed a refund. */
  refundDue: number;

  paymentState: InvoicePaymentState;
  isFullyPaid: boolean;
  paymentMethod: string | null;
  /** Chronological ledger. Empty for a subscription paid in full at onboarding. */
  transactions: SubscriptionPaymentTransaction[];
}

/** What the Subscription tab needs to render and to decide on gating. */
export interface CustomerSubscriptionPaymentOverview {
  summaries: SubscriptionPaymentSummary[];
  /** Any subscription where the customer still owes money. */
  hasOutstanding: boolean;
  /** Any subscription that was over-collected. */
  hasRefundDue: boolean;
  totalOutstanding: number;
  totalRefundDue: number;
  /**
   * A new subscription may only be added when every existing subscription is
   * exactly settled — no money owed AND no refund pending.
   */
  canAddSubscription: boolean;
}

interface SummaryPaymentRow {
  id: string;
  subscription_id: string | null;
  amount: number | string | null;
  base_amount: number | string | null;
  tax_amount: number | string | null;
  discount_amount: number | string | null;
  delivery_charge: number | string | null;
  misc_charge: number | string | null;
  misc_charge_label: string | null;
  amount_paid: number | string | null;
  balance_due: number | string | null;
  status: string | null;
  payment_method: string | null;
  created_at: string | null;
  subscriptions: {
    subscription_code: string | null;
    customer_category: string | null;
    status: string | null;
    starts_on: string | null;
    ends_on: string | null;
    effective_end_on: string | null;
    total_payable: number | string | null;
    total_days: number | null;
    subscription_plans: { name: string | null } | { name: string | null }[] | null;
  } | null;
}

/**
 * Build the payment summary for every subscription of a customer that still
 * matters: ACTIVE, PENDING, or carrying a non-zero balance.
 *
 * A terminal subscription with an unsettled balance is deliberately INCLUDED —
 * it is precisely the thing blocking a new purchase, so hiding it would leave
 * the admin unable to see why the Add form is unavailable.
 */
export async function getSubscriptionPaymentOverview(
  customerProfileId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<CustomerSubscriptionPaymentOverview> {
  const { data, error } = await admin
    .from("payments")
    .select(
      `id, subscription_id, amount, base_amount, tax_amount, discount_amount,
       delivery_charge, misc_charge, misc_charge_label, amount_paid, balance_due,
       status, payment_method, created_at,
       subscriptions!inner (
         subscription_code, customer_category, status, starts_on, ends_on,
         effective_end_on, total_payable, total_days,
         subscription_plans ( name )
       )`,
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("invoice_type", "SUBSCRIPTION")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to load subscription payment summaries for customer ${customerProfileId}: ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as SummaryPaymentRow[];

  // One query for every ledger row, then grouped in memory — a per-subscription
  // query would be N round trips for a page that already does several.
  const subscriptionIds = rows
    .map((r) => r.subscription_id)
    .filter((id): id is string => Boolean(id));

  const ledgerBySubscription = new Map<string, SubscriptionPaymentTransaction[]>();

  if (subscriptionIds.length > 0) {
    const { data: ledger, error: ledgerError } = await admin
      .from("subscription_payment_transactions")
      .select(
        "id, subscription_id, customer_profile_id, transaction_type, amount, transaction_date, payment_method, payment_reference, comment, remark, created_by, created_at",
      )
      .in("subscription_id", subscriptionIds)
      .order("created_at", { ascending: true });

    if (ledgerError) {
      throw new Error(
        `Failed to load the payment ledger for customer ${customerProfileId}: ${ledgerError.message}`,
      );
    }

    for (const row of ledger ?? []) {
      const list = ledgerBySubscription.get(row.subscription_id as string) ?? [];
      list.push({
        id: row.id as string,
        subscriptionId: row.subscription_id as string,
        customerProfileId: row.customer_profile_id as string,
        transactionType: row.transaction_type as SubscriptionTransactionType,
        amount: Number(row.amount ?? 0),
        transactionDate: row.transaction_date as string,
        paymentMethod: (row.payment_method as string | null) ?? null,
        paymentReference: (row.payment_reference as string | null) ?? null,
        comment: (row.comment as string | null) ?? null,
        remark: (row.remark as string | null) ?? null,
        createdBy: (row.created_by as string | null) ?? null,
        createdAt: row.created_at as string,
      });
      ledgerBySubscription.set(row.subscription_id as string, list);
    }
  }

  const summaries: SubscriptionPaymentSummary[] = rows.map((row) => {
    const sub = row.subscriptions;
    const plan = Array.isArray(sub?.subscription_plans)
      ? sub?.subscription_plans[0]
      : sub?.subscription_plans;

    const totalPaise = toPaise(row.amount);
    const paymentState = resolveInvoicePaymentState(
      row.status,
      Number(row.balance_due ?? 0),
    );

    // Resolve paid/owed from the STATE, not from the raw columns — see the note
    // on SubscriptionPaymentSummary. This is what makes the card truthful on
    // legacy rows that were never backfilled.
    let paidPaise: number;
    let balancePaise: number;

    if (paymentState === "PARTIALLY_PAID") {
      paidPaise = toPaise(row.amount_paid);
      balancePaise = toPaise(row.balance_due);
    } else if (paymentState === "PAID") {
      paidPaise = totalPaise;
      balancePaise = 0;
    } else {
      // PENDING — nothing collected.
      paidPaise = 0;
      balancePaise = totalPaise;
    }

    const remainingPaise = totalPaise - paidPaise;

    return {
      subscriptionId: row.subscription_id as string,
      paymentId: row.id,
      subscriptionCode: sub?.subscription_code ?? null,
      planName: plan?.name ?? null,
      customerCategory: sub?.customer_category ?? null,
      subscriptionStatus: sub?.status ?? null,
      startsOn: sub?.starts_on ?? null,
      endsOn: sub?.effective_end_on ?? sub?.ends_on ?? null,
      totalDays: sub?.total_days ?? null,

      baseAmount: Number(row.base_amount ?? 0) || 0,
      taxAmount: Number(row.tax_amount ?? 0) || 0,
      deliveryCharge: Number(row.delivery_charge ?? 0) || 0,
      miscCharge: Number(row.misc_charge ?? 0) || 0,
      miscChargeLabel:
        typeof row.misc_charge_label === "string" &&
        row.misc_charge_label.trim() !== ""
          ? row.misc_charge_label.trim()
          : null,
      discountAmount: Number(row.discount_amount ?? 0) || 0,

      totalPayable: toRupees(totalPaise),
      amountPaid: toRupees(paidPaise),
      balanceDue: toRupees(Math.max(balancePaise, 0)),
      refundDue: toRupees(Math.max(-remainingPaise, 0)),

      paymentState,
      isFullyPaid: remainingPaise === 0,
      paymentMethod: row.payment_method ?? null,
      transactions: ledgerBySubscription.get(row.subscription_id as string) ?? [],
    };
  });

  // Keep only what the admin needs to act on or understand.
  const relevant = summaries.filter(
    (s) =>
      s.subscriptionStatus === "ACTIVE" ||
      s.subscriptionStatus === "PENDING" ||
      s.balanceDue > 0 ||
      s.refundDue > 0,
  );

  // Unsettled first — the blocker should never be below the fold.
  relevant.sort((a, b) => {
    const aUnsettled = a.balanceDue > 0 || a.refundDue > 0 ? 0 : 1;
    const bUnsettled = b.balanceDue > 0 || b.refundDue > 0 ? 0 : 1;
    return aUnsettled - bUnsettled;
  });

  const totalOutstandingPaise = relevant.reduce(
    (acc, s) => acc + toPaise(s.balanceDue),
    0,
  );
  const totalRefundPaise = relevant.reduce(
    (acc, s) => acc + toPaise(s.refundDue),
    0,
  );

  const hasOutstanding = totalOutstandingPaise > 0;
  const hasRefundDue = totalRefundPaise > 0;

  return {
    summaries: relevant,
    hasOutstanding,
    hasRefundDue,
    totalOutstanding: toRupees(totalOutstandingPaise),
    totalRefundDue: toRupees(totalRefundPaise),
    // Exactly settled on both sides. A pending refund blocks a new sale too:
    // stacking another subscription on top of money we owe the customer makes
    // the account harder to reconcile, not easier.
    canAddSubscription: !hasOutstanding && !hasRefundDue,
  };
}
