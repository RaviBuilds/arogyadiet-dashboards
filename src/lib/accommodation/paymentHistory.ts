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
