// src/types/subscriptionPayment.ts
//
// Types for the MEAL subscription partial-payment lifecycle.
//
// Feature: meal-subscription-partial-payment
// Plan:    docs/meal-partial-payment-plan.md (Phase 2.1)
//
// Backed by `public.subscription_payment_transactions` and the
// `public.subscription_payment_balances` view (see
// scripts/create-subscription-payment-lifecycle.sql).
//
// KEY INVARIANT: a balance is NEVER stored as truth. It is always derived from
// the ledger via the single formula
//   Total_Paid = SUM(type === 'REFUND' ? -amount : +amount)
//   Balance    = Total_Payable - Total_Paid
// `payments.amount_paid` / `payments.balance_due` are a denormalised projection
// of that derivation onto the one invoice row, maintained for cheap rendering —
// not an independent source of truth.

/**
 * The kind of money movement a ledger row records. `amount` is ALWAYS positive;
 * direction comes from this discriminator.
 *
 *   ADVANCE                  the single payment collected at onboarding. At most
 *                            one per subscription, enforced by the partial unique
 *                            index `uniq_subscription_advance_transaction`.
 *   PARTIAL_BALANCE_PAYMENT  a later instalment against the outstanding balance.
 *   REFUND                   money returned. Present for symmetry with the
 *                            accommodation ledger; no meal flow issues one yet.
 */
export type SubscriptionTransactionType =
  | "ADVANCE"
  | "PARTIAL_BALANCE_PAYMENT"
  | "REFUND";

/** One append-only row of `subscription_payment_transactions`. */
export interface SubscriptionPaymentTransaction {
  id: string;
  subscriptionId: string;
  customerProfileId: string;
  transactionType: SubscriptionTransactionType;
  /** Always positive. Direction is carried by `transactionType`. */
  amount: number;
  /** Business date of the collection (not the row's insert timestamp). */
  transactionDate: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  comment: string | null;
  remark: string | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * A subscription's derived payment position.
 *
 * Produced by `SubscriptionPaymentService.deriveSubscriptionBalance`, which
 * computes in integer paise to avoid the float drift that makes a "fully paid"
 * subscription report a balance of 0.0000000001.
 */
export interface SubscriptionBalanceSnapshot {
  subscriptionId: string;
  /** Total_Payable snapshot: plan/kit + delivery + misc, frozen at creation. */
  totalPayable: number;
  /** Sum of the ledger, refunds subtracted. */
  totalPaid: number;
  /** `totalPayable - totalPaid`. Negative means a refund is due. */
  remainingBalance: number;
  /** True when the balance is exactly zero — this is the "final invoice" state. */
  isFullyPaid: boolean;
  /** True when `remainingBalance > 0`, i.e. the customer still owes money. */
  hasOutstanding: boolean;
}

/**
 * A customer's aggregate outstanding position across all their subscriptions.
 *
 * IMPORTANT (plan finding 0.5): this is LEDGER-derived. Only subscriptions that
 * have at least one ledger row are considered, because the balance view INNER
 * JOINs the ledger. A subscription with an empty ledger was paid in full at
 * onboarding and can never be outstanding — which is what keeps all pre-existing
 * customers out of the new-subscription gate without needing any backfill.
 */
export interface CustomerOutstandingBalance {
  hasOutstanding: boolean;
  /** Sum of positive remaining balances. Refund-due (negative) rows excluded. */
  totalOutstanding: number;
  /** Per-subscription detail, only for subscriptions that actually owe money. */
  outstandingSubscriptions: SubscriptionBalanceSnapshot[];
}

/**
 * Typed failure reasons returned by the `record_subscription_payment_transaction`
 * RPC. It returns `jsonb {ok, reason}` rather than raising, so each reason maps
 * to a pinned user-facing message instead of leaking a Postgres error.
 */
export type RecordSubscriptionPaymentFailure =
  /** No such subscription. */
  | { reason: "NOT_FOUND" }
  /** total_payable is 0 — a legacy or paid-in-full subscription has no balance. */
  | { reason: "NO_TOTAL_PAYABLE" }
  | { reason: "AMOUNT_NOT_POSITIVE" }
  /** Includes the authoritative balance the caller must display. */
  | { reason: "AMOUNT_EXCEEDS_BALANCE"; remainingBalance: number }
  /** A refund cannot exceed the excess already paid. */
  | { reason: "REFUND_EXCEEDS_EXCESS"; excess: number }
  /** `uniq_subscription_advance_transaction` rejected a second ADVANCE. */
  | { reason: "DUPLICATE_ADVANCE" }
  | { reason: "ERROR"; message: string };

/** Outcome of appending to the ledger. */
export type RecordSubscriptionPaymentResult =
  | {
      ok: true;
      transaction: SubscriptionPaymentTransaction;
      totalPaid: number;
      remainingBalance: number;
    }
  | ({ ok: false } & RecordSubscriptionPaymentFailure);

/**
 * How the invoice's payment position is rendered. THREE states, not two
 * booleans — see plan finding 0.4.
 *
 * A legacy PENDING invoice has `balance_due = 0`, so a naive
 * `isFullyPaid = balanceDue <= 0` would stamp "FULLY PAID" on an unpaid invoice.
 * Derive from `payments.status` first and use `balance_due` only for figures.
 *
 *   PAID            fully settled. This is the FINAL invoice.
 *   PARTIALLY_PAID  an advance was collected; a balance remains.
 *   PENDING         nothing collected (legacy / Proforma rendering).
 */
export type InvoicePaymentState = "PAID" | "PARTIALLY_PAID" | "PENDING";

/** The `payments.status` value written when a balance remains. */
export const PARTIALLY_PAID_STATUS = "PARTIALLY_PAID" as const;

/**
 * Shown to the CUSTOMER when an unsettled balance blocks a new purchase.
 *
 * Deliberately tells them to contact the admin rather than offering a "pay now"
 * route: balance collection happens at the counter, so a self-service payment
 * path would create a second, unreconciled way for money to arrive.
 *
 * Lives in this types module (which has no server-only imports) so the server
 * pages, the server actions and the client components all render the SAME
 * sentence — a gate whose message drifts between surfaces reads like a bug.
 */
export const OUTSTANDING_BALANCE_CUSTOMER_MESSAGE =
  "Please contact admin to clear the due of existing / previous subscription to purchase new subscription";

/** Shown to an ADMIN or FRANCHISE user attempting the same action. */
export const OUTSTANDING_BALANCE_ADMIN_MESSAGE =
  "Balance due on an existing subscription. Settle the balance to perform this action.";

/**
 * Statuses that mean "this invoice has been settled in full". Kept beside
 * `PARTIALLY_PAID_STATUS` so every consumer reads the same vocabulary.
 * `SUCCESS` and `CAPTURED` are legacy values present in live data.
 */
export const SETTLED_PAYMENT_STATUSES = ["PAID", "SUCCESS", "CAPTURED"] as const;

/**
 * Maps a raw `payments.status` to the three-state render model.
 *
 * @param status      raw `payments.status`
 * @param balanceDue  raw `payments.balance_due` (used only as a tiebreak)
 */
export function resolveInvoicePaymentState(
  status: string | null | undefined,
  balanceDue: number | null | undefined,
): InvoicePaymentState {
  const normalized = (status ?? "").toUpperCase();

  if (normalized === PARTIALLY_PAID_STATUS) return "PARTIALLY_PAID";

  if ((SETTLED_PAYMENT_STATUSES as readonly string[]).includes(normalized)) {
    // Defensive: a settled row that somehow still carries a balance is a
    // partial payment whose projection was not synced. Trust the money.
    return Number(balanceDue ?? 0) > 0 ? "PARTIALLY_PAID" : "PAID";
  }

  // PENDING, FAILED, and anything unrecognised keep today's Proforma treatment.
  return "PENDING";
}
