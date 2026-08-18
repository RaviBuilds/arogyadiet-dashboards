// src/types/partialPayment.ts
//
// Types for the admin Customers → "Partial Payment" directory: the one board
// listing every customer who onboarded against an ADVANCE and still owes a
// balance, across MEAL subscriptions and ACCOMMODATION stays.
//
// Backed by the two existing ledgers — `subscription_payment_transactions` and
// `stay_payment_transactions` — and their balance views. NOTHING here is a new
// source of truth: every figure is derived by the same two audited functions the
// rest of the app uses (`deriveSubscriptionBalance`, `deriveStayBalance`).
//
// ── THE MEMBERSHIP RULE (read this before changing any query) ────────────────
//
// A row belongs on this board only when BOTH hold:
//
//   1. The entity HAS AT LEAST ONE LEDGER ROW.
//   2. Its derived remaining balance is STRICTLY POSITIVE, compared in paise.
//
// Rule 1 is not decoration, it is the whole correctness story on the
// accommodation side. `stay_payment_balances` LEFT JOINs the ledger, so a stay
// created before the payment-lifecycle feature — no ledger rows at all, paid in
// full at the counter — reports `total_paid = 0` and therefore
// `remaining_balance = total_stay_amount`. At the time of writing that is 33
// legacy stays carrying ~₹11.2 lakh of entirely fictional dues, against ~₹1.45
// lakh that is genuinely outstanding across 8 real part-paid stays. Dropping
// rule 1 does not slightly inflate this board, it makes it wrong by 8x.
//
// (`subscription_payment_balances` INNER JOINs the ledger and so is already safe
// by construction. Rule 1 is applied uniformly anyway, so the two domains cannot
// drift apart as those view definitions evolve.)
//
// Rule 2 is strictly-greater-than-zero, never `>=` and never `!= 0`:
//   - a zero balance is SETTLED and must disappear from the board the moment the
//     final instalment lands;
//   - a NEGATIVE balance is refund-due (over-collected, e.g. after an early
//     closure recalculation), which is money we owe the customer, not money they
//     owe us. It has no business on a collections list.

import type { CustomerData } from "@/shared/components/admin/customers/CustomerDashboard";

/**
 * Which ledger a row came from.
 *
 * KIT is deliberately absent. Partial payment is not offered on KIT
 * subscriptions at all, so a KIT row appearing here would mean a data-entry
 * mistake upstream, not a balance to chase. The server action filters
 * `customer_category = 'MEAL'` rather than "not accommodation", so a future
 * category cannot leak onto this board by default either.
 */
export type PartialPaymentSource = "MEAL" | "STAY";

/**
 * One entry of the payment breakup — a single row of the underlying ledger,
 * rendered verbatim in the expandable sub-row.
 *
 * `amount` is ALWAYS positive; direction comes from `transactionType`. Callers
 * that need a signed figure must apply the sign themselves via the one formula
 * (`REFUND` subtracts, everything else adds).
 */
export interface PartialPaymentBreakupEntry {
  id: string;
  transactionType: "ADVANCE" | "PARTIAL_BALANCE_PAYMENT" | "REFUND";
  /** Always positive. */
  amount: number;
  /** Business date the money was collected, not the row's insert timestamp. */
  transactionDate: string;
  /**
   * Present for MEAL rows only. `stay_payment_transactions` has no
   * `payment_method` column, so this is always `null` for a STAY row — the UI
   * renders a placeholder rather than implying the method is unknown.
   */
  paymentMethod: string | null;
  comment: string | null;
  remark: string | null;
}

/**
 * The payment position of ONE entity (a subscription or a stay) that still owes
 * money, with its full collection history.
 *
 * Keyed by `entityId`, not by customer: one customer can hold two outstanding
 * entities (say a meal plan and a stay) and each is chased separately, on its
 * own due date, for its own amount.
 */
export interface PartialPaymentBalance {
  source: PartialPaymentSource;
  /** `subscriptions.id` for MEAL, `stay_entries.id` for STAY. */
  entityId: string;
  customerProfileId: string;
  /** `subscriptions.status` / `stay_entries.status`. */
  entityStatus: string;
  /** Plan name for MEAL, stay unit for STAY. Shown as the row's sub-line. */
  entityLabel: string | null;
  periodStart: string | null;
  /**
   * The date the money is effectively due: the subscription's
   * `effective_end_on ?? ends_on`, or the stay's checkout
   * (`checked_out_at ?? start_date + total_nights`). This is what the
   * "ending soon" filter and the overdue badge both read, so the date a row is
   * filtered on is always the date it displays.
   */
  dueDate: string | null;
  /** STAY only: nights booked, for the row's sub-line. */
  totalNights: number | null;
  /** `subscriptions.total_payable` / `stay_entries.payment_amount`. */
  totalAmount: number;
  /** The ADVANCE ledger row's amount, or 0 when there is none. */
  advanceAmount: number;
  advanceDate: string | null;
  /** Ledger sum, refunds subtracted. */
  totalPaid: number;
  /** `totalAmount - totalPaid`. Always strictly positive on this board. */
  remainingBalance: number;
  /** Count of `PARTIAL_BALANCE_PAYMENT` rows — instalments after the advance. */
  instalmentCount: number;
  /** Date of the most recent non-refund collection. */
  lastPaymentDate: string | null;
  /** Whole ledger, oldest first. */
  breakup: PartialPaymentBreakupEntry[];
  /**
   * The customer's directory row as read by the server action.
   *
   * Required for ACCOMMODATION rows, which cannot be resolved from a
   * clinic-scoped admin's customer list at all (every accommodation customer has
   * `clinic_id = NULL`, so a clinic-confined query excludes them). See
   * {@link PartialPaymentVisibilityNote}.
   *
   * MEAL rows carry it too, but the table prefers the joined directory row for
   * them so that clinic / franchise / dietitian scoping stays enforced by the
   * page rather than duplicated here.
   */
  customerSnapshot: CustomerData;
}

/**
 * A {@link PartialPaymentBalance} paired with the customer it belongs to, which
 * is what the table actually renders.
 *
 * Where `customer` comes from depends on the domain, and that difference IS the
 * visibility rule — see {@link PartialPaymentBalance.customerSnapshot}.
 */
export interface PartialPaymentRow extends PartialPaymentBalance {
  customer: CustomerData;
}

/**
 * ── VISIBILITY: WHY THE TWO DOMAINS DIFFER ──────────────────────────────────
 *
 * MEAL and ACCOMMODATION balances are scoped by different rules, on purpose:
 *
 *   MEAL          confined to the admin's assigned clinic. A Clinic_Scoped_Admin
 *                 (e.g. a Madhapur front desk) sees Madhapur's meal dues and no
 *                 other clinic's.
 *   ACCOMMODATION visible to EVERY admin, clinic-scoped or not. Accommodation is
 *                 a single shared property, not a per-clinic operation.
 *
 * That is a business rule, but there is also a hard data reason it cannot work
 * any other way: every accommodation customer has `clinic_id = NULL` (52 of 52
 * at the time of writing). Accommodation onboarding never assigns a clinic,
 * because a guest checks into the property, not into a clinic. So a
 * clinic-confined read (`WHERE clinic_id = <clinic>`) matches ZERO accommodation
 * customers — which is exactly why a clinic-scoped admin's Customers Overview
 * reports "Accommodation 0".
 *
 * Consequence for this board: accommodation rows CANNOT be resolved by joining
 * against a clinic-scoped admin's customer directory, because they are not in
 * it. They need their identity supplied directly by the server action, which is
 * what {@link PartialPaymentBalance.customerSnapshot} is for.
 *
 * Meal rows deliberately keep using the join, so they continue to inherit the
 * page's clinic, franchise AND dietitian scoping without this action restating
 * any of those rules.
 */
export type PartialPaymentVisibilityNote = never;

/** Default sort: biggest debt first, which is the question this board answers. */
export type PartialPaymentSort =
  | "BALANCE_DESC"
  | "BALANCE_ASC"
  | "DUE_SOONEST"
  | "LAST_PAID";

export type PartialPaymentTypeFilter = "ALL" | PartialPaymentSource;
