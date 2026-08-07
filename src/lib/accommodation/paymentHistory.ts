// src/lib/accommodation/paymentHistory.ts
//
// Client-safe pure logic for building the payment history list shown on the
// Accommodation tab (accommodation-payment-lifecycle, Req 6.2, 6.5, 10.2, 10.3).
//
// Extracted out of `AccommodationService.ts` (which imports repositories that
// pull in `createAdminClient()` / the Supabase service-role key) so this pure
// sort/format logic can be imported directly from the "use client"
// `StayPaymentPanel` without bundling server-only code into the client JS.
// `AccommodationService.ts` re-exports this unchanged, mirroring the pattern
// established in `@/lib/accommodation/backdatedStay.ts`.
//
// Requirements: 6.2, 6.5, 10.2, 10.3

import {
  PAYMENT_TRANSACTION_LABELS,
  type StayPaymentTransaction,
  type PaymentHistoryRow,
} from "@/types/accommodation";

/**
 * Builds an ordered list of payment history rows from a set of transactions.
 *
 * Sorting: by (transactionDate, createdAt) non-decreasing — earliest first.
 * Both fields are ISO strings and compare lexicographically.
 *
 * Each row projects:
 * - `id`: transaction id
 * - `date`: transactionDate (YYYY-MM-DD) for display
 * - `amount`: the transaction amount
 * - `typeLabel`: human-readable label from PAYMENT_TRANSACTION_LABELS
 * - `comment`: admin comment (may be null)
 * - `remark`: admin remark (may be null)
 * - `receiptLinkTarget`: route to the payment receipt page
 *
 * This is a pure function — no side effects or DB interaction.
 *
 * Requirements: 6.2, 6.5, 10.2, 10.3
 */
export function buildPaymentHistoryRows(
  transactions: readonly StayPaymentTransaction[]
): PaymentHistoryRow[] {
  // Sort a copy by (transactionDate, createdAt) ascending
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.transactionDate.localeCompare(b.transactionDate);
    if (dateCompare !== 0) return dateCompare;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return sorted.map((tx) => ({
    id: tx.id,
    date: tx.transactionDate,
    amount: tx.amount,
    typeLabel: PAYMENT_TRANSACTION_LABELS[tx.transactionType],
    comment: tx.comment,
    remark: tx.remark,
    receiptLinkTarget: `/admin/customers/${tx.customerProfileId}/billing/stay-receipt/${tx.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Extension history (below Payment History on the Accommodation tab)
// ---------------------------------------------------------------------------

import type { StayExtension, ExtensionHistoryRow } from "@/types/accommodation";

/**
 * Builds an ordered list of extension history rows from a stay's recorded
 * Stay_Extensions. Purely informational — has no bearing on Total_Paid or
 * Remaining_Balance, which are derived exclusively from
 * `buildPaymentHistoryRows`'s source, `StayPaymentTransaction`.
 *
 * Sorting: by (extendedOn, createdAt) non-decreasing — earliest first,
 * mirroring `buildPaymentHistoryRows`.
 *
 * This is a pure function — no side effects or DB interaction.
 */
export function buildExtensionHistoryRows(
  extensions: readonly StayExtension[]
): ExtensionHistoryRow[] {
  const sorted = [...extensions].sort((a, b) => {
    const dateCompare = a.extendedOn.localeCompare(b.extendedOn);
    if (dateCompare !== 0) return dateCompare;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return sorted.map((ext) => ({
    id: ext.id,
    date: ext.extendedOn,
    additionalNights: ext.additionalNights,
    additionalAmount: ext.additionalAmount,
    nightsBefore: ext.nightsBefore,
    nightsAfter: ext.nightsAfter,
    totalAmountAfter: ext.totalAmountAfter,
  }));
}

// ---------------------------------------------------------------------------
// Per-stay document set (the "Invoices" dialog on Accommodation History)
// ---------------------------------------------------------------------------

/**
 * One downloadable money document belonging to a stay.
 *
 * Two different backing records sit behind these rows, which is why `kind`
 * exists rather than a single flat list:
 *
 * - RECEIPT — an ADVANCE or PARTIAL_BALANCE_PAYMENT ledger row. Money IN has no
 *   `payments` row at all; its document is generated on demand from the ledger
 *   entry by `buildPaymentReceiptData`, so it is keyed on the TRANSACTION id.
 * - REFUND_INVOICE / FINAL_INVOICE — real `payments` rows, keyed on the PAYMENT
 *   id, and rendered by the shared invoice route.
 *
 * Getting those two keys the wrong way round produces a 404, so the href is
 * built here once rather than at each call site.
 */
export interface StayDocumentRow {
  /** Stable React key — unique across both id spaces. */
  key: string;
  kind: "RECEIPT" | "REFUND_INVOICE" | "FINAL_INVOICE";
  typeLabel: string;
  amount: number;
  /** YYYY-MM-DD for a ledger row; null for the final invoice, which has no ledger date. */
  date: string | null;
  /**
   * Reference shown to the admin. Receipts use the exact `RCPT-` form the
   * printed receipt carries (see `buildPaymentReceiptData`) so the two match;
   * invoices use the short id, which is what the Billing tab's Reference column
   * already shows for the same row. Neither is invented for display only.
   */
  reference: string;
  /**
   * Portal-relative path. No `/admin` prefix: the middleware prefixes the
   * portal itself, and the Billing tab's invoice link uses the same shape.
   */
  href: string;
}

/** `RCPT-<first uuid segment, uppercased>` — identical to buildPaymentReceiptData. */
function receiptNumber(transactionId: string): string {
  return `RCPT-${transactionId.split("-")[0].toUpperCase()}`;
}

/**
 * Builds the full set of downloadable documents for one stay, oldest first,
 * with the Final_Consolidated_Invoice last because it closes the stay out.
 *
 * Every payment the customer made is included, not just the invoiced ones: an
 * ADVANCE and each PARTIAL_BALANCE_PAYMENT get a receipt, each REFUND gets its
 * Refund_Invoice, and the stay gets its one final invoice once it exists. A
 * REFUND whose `refundInvoicePaymentId` is missing is skipped rather than
 * rendered as a dead link — that can only happen for rows predating the
 * Refund_Invoice migration.
 *
 * Pure function — no side effects, and neither argument is mutated.
 */
export function buildStayDocumentRows(
  transactions: readonly StayPaymentTransaction[],
  stay: {
    customerProfileId: string;
    finalInvoicePaymentId: string | null;
    paymentAmount: number | null;
  }
): StayDocumentRow[] {
  const base = `/customers/${stay.customerProfileId}/billing`;

  // Same ordering as buildPaymentHistoryRows, so the dialog and the
  // Accommodation tab's Payment History read in the same sequence.
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.transactionDate.localeCompare(b.transactionDate);
    if (dateCompare !== 0) return dateCompare;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const rows: StayDocumentRow[] = [];

  for (const tx of sorted) {
    if (tx.transactionType === "REFUND") {
      if (!tx.refundInvoicePaymentId) continue;
      rows.push({
        key: `refund-${tx.id}`,
        kind: "REFUND_INVOICE",
        typeLabel: PAYMENT_TRANSACTION_LABELS.REFUND,
        amount: tx.amount,
        date: tx.transactionDate,
        reference: tx.refundInvoicePaymentId.slice(0, 8),
        href: `${base}/invoice/${tx.refundInvoicePaymentId}`,
      });
      continue;
    }

    rows.push({
      key: `receipt-${tx.id}`,
      kind: "RECEIPT",
      typeLabel: PAYMENT_TRANSACTION_LABELS[tx.transactionType],
      amount: tx.amount,
      date: tx.transactionDate,
      reference: receiptNumber(tx.id),
      href: `${base}/stay-receipt/${tx.id}`,
    });
  }

  if (stay.finalInvoicePaymentId) {
    rows.push({
      key: `final-${stay.finalInvoicePaymentId}`,
      kind: "FINAL_INVOICE",
      typeLabel: "Final Invoice",
      amount: stay.paymentAmount ?? 0,
      date: null,
      reference: stay.finalInvoicePaymentId.slice(0, 8),
      href: `${base}/invoice/${stay.finalInvoicePaymentId}`,
    });
  }

  return rows;
}
