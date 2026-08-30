// src/lib/payments/partialPaymentBreakup.ts
//
// Pure ledger helpers shared by the ADMIN and FRANCHISE partial-payment boards.
//
// Moved VERBATIM out of `admin-actions/partialPaymentActions.ts`, where they were
// module-private, so the franchise board can reuse them rather than restate them.
// The summary semantics are exactly the thing that must not drift between the two
// portals: if one board decided "advance" meant "the first payment" while the
// other read the ADVANCE row, the same customer would show different figures
// depending on who opened the page.
//
// PURE: no Supabase, no `server-only`, no `next/*`.

import type { PartialPaymentBreakupEntry } from "@/types/partialPayment";

/** Chronological, oldest first — the order a collection history reads in. */
export function byDateAsc(
  a: PartialPaymentBreakupEntry,
  b: PartialPaymentBreakupEntry,
): number {
  return a.transactionDate.localeCompare(b.transactionDate);
}

/**
 * Roll a ledger up into the summary figures a board row displays.
 *
 * `advance` is read from the ADVANCE row rather than "the first payment": the
 * partial unique indexes (`uniq_stay_advance_transaction`,
 * `uniq_subscription_advance_transaction`) guarantee at most one, so this is
 * exact rather than an assumption about insert order.
 */
export function summarise(breakup: PartialPaymentBreakupEntry[]) {
  const advance = breakup.find((entry) => entry.transactionType === "ADVANCE");
  const collections = breakup.filter(
    (entry) => entry.transactionType !== "REFUND",
  );
  return {
    advanceAmount: advance?.amount ?? 0,
    advanceDate: advance?.transactionDate ?? null,
    instalmentCount: breakup.filter(
      (entry) => entry.transactionType === "PARTIAL_BALANCE_PAYMENT",
    ).length,
    lastPaymentDate:
      collections.length > 0
        ? collections[collections.length - 1].transactionDate
        : null,
  };
}
