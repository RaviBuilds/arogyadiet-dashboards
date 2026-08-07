// src/lib/accommodation/__tests__/stayDocuments.property.test.ts
//
// Properties for `buildStayDocumentRows` — the document set behind the
// "Invoices" dialog on Accommodation History.
//
// The property that actually matters: money IN has NO `payments` row, so its
// receipt is keyed on the TRANSACTION id, while refunds and the final invoice
// are real `payments` rows keyed on the PAYMENT id. Swapping the two produces a
// link that 404s rather than an error anyone would notice in review, so every
// href is checked against the id space it belongs to.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { buildStayDocumentRows } from "@/lib/accommodation/paymentHistory";
import { PAYMENT_TRANSACTION_LABELS } from "@/types/accommodation";
import type { StayPaymentTransaction } from "@/types/accommodation";
import {
  arbLedger,
  arbNonEmptyLedger,
} from "@/test/accommodation/paymentArbitraries";

const CUSTOMER_ID = "11111111-2222-3333-4444-555555555555";
const FINAL_INVOICE_ID = "99999999-8888-7777-6666-555555555555";

/**
 * The generators predate `refundInvoicePaymentId`, so stamp a deterministic
 * one on every REFUND. Derived from the transaction id purely so each refund
 * gets a distinct, recognisable payment id.
 */
function withRefundInvoices(
  transactions: readonly StayPaymentTransaction[]
): StayPaymentTransaction[] {
  return transactions.map((tx) =>
    tx.transactionType === "REFUND"
      ? { ...tx, refundInvoicePaymentId: `ref00000-${tx.id.slice(9)}` }
      : tx
  );
}

const STAY_WITHOUT_INVOICE = {
  customerProfileId: CUSTOMER_ID,
  finalInvoicePaymentId: null,
  paymentAmount: 8000,
};

const STAY_WITH_INVOICE = {
  customerProfileId: CUSTOMER_ID,
  finalInvoicePaymentId: FINAL_INVOICE_ID,
  paymentAmount: 8000,
};

describe("buildStayDocumentRows — per-stay document set", () => {
  it("every payment-in transaction becomes exactly one receipt, keyed on the TRANSACTION id", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const rows = buildStayDocumentRows(
          withRefundInvoices(transactions),
          STAY_WITHOUT_INVOICE
        );

        const paymentsIn = transactions.filter(
          (tx) => tx.transactionType !== "REFUND"
        );
        const receipts = rows.filter((r) => r.kind === "RECEIPT");

        expect(receipts).toHaveLength(paymentsIn.length);

        for (const tx of paymentsIn) {
          const row = receipts.find((r) => r.key === `receipt-${tx.id}`);
          expect(row).toBeDefined();
          // Keyed on the ledger row, NOT a payments row.
          expect(row!.href).toBe(
            `/customers/${CUSTOMER_ID}/billing/stay-receipt/${tx.id}`
          );
          expect(row!.amount).toBe(tx.amount);
          expect(row!.date).toBe(tx.transactionDate);
          expect(row!.typeLabel).toBe(
            PAYMENT_TRANSACTION_LABELS[tx.transactionType]
          );
          // Matches what buildPaymentReceiptData prints on the document.
          expect(row!.reference).toBe(
            `RCPT-${tx.id.split("-")[0].toUpperCase()}`
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it("every refund becomes one invoice row keyed on the PAYMENT id, never the transaction id", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const stamped = withRefundInvoices(transactions);
        const rows = buildStayDocumentRows(stamped, STAY_WITHOUT_INVOICE);

        const refunds = stamped.filter((tx) => tx.transactionType === "REFUND");
        const refundRows = rows.filter((r) => r.kind === "REFUND_INVOICE");

        expect(refundRows).toHaveLength(refunds.length);

        for (const tx of refunds) {
          const row = refundRows.find((r) => r.key === `refund-${tx.id}`);
          expect(row).toBeDefined();
          expect(row!.href).toBe(
            `/customers/${CUSTOMER_ID}/billing/invoice/${tx.refundInvoicePaymentId}`
          );
          // The transaction id must NOT leak into an invoice link.
          expect(row!.href).not.toContain(tx.id);
          expect(row!.amount).toBe(tx.amount);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("a refund with no Refund_Invoice is omitted rather than rendered as a dead link", () => {
    fc.assert(
      fc.property(arbNonEmptyLedger, (transactions) => {
        // Deliberately leave refundInvoicePaymentId unset on every refund.
        const rows = buildStayDocumentRows(transactions, STAY_WITHOUT_INVOICE);

        expect(rows.filter((r) => r.kind === "REFUND_INVOICE")).toHaveLength(0);
        expect(rows.filter((r) => r.kind === "RECEIPT")).toHaveLength(
          transactions.filter((tx) => tx.transactionType !== "REFUND").length
        );
      }),
      { numRuns: 100 }
    );
  });

  it("the final invoice appears exactly once and last, only when the stay has one", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const stamped = withRefundInvoices(transactions);

        const without = buildStayDocumentRows(stamped, STAY_WITHOUT_INVOICE);
        expect(without.filter((r) => r.kind === "FINAL_INVOICE")).toHaveLength(0);

        const withInvoice = buildStayDocumentRows(stamped, STAY_WITH_INVOICE);
        const finals = withInvoice.filter((r) => r.kind === "FINAL_INVOICE");
        expect(finals).toHaveLength(1);
        // It closes the stay out, so it sits at the end.
        expect(withInvoice[withInvoice.length - 1].kind).toBe("FINAL_INVOICE");
        expect(finals[0].href).toBe(
          `/customers/${CUSTOMER_ID}/billing/invoice/${FINAL_INVOICE_ID}`
        );
        expect(finals[0].amount).toBe(8000);
      }),
      { numRuns: 100 }
    );
  });

  it("ledger-backed rows keep (transactionDate, createdAt) order regardless of input order", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const stamped = withRefundInvoices(transactions);
        const rows = buildStayDocumentRows(
          [...stamped].reverse(),
          STAY_WITH_INVOICE
        ).filter((r) => r.kind !== "FINAL_INVOICE");

        const byKey = new Map(
          stamped.map((tx) => [
            tx.transactionType === "REFUND"
              ? `refund-${tx.id}`
              : `receipt-${tx.id}`,
            tx,
          ])
        );

        for (let i = 1; i < rows.length; i++) {
          const prev = byKey.get(rows[i - 1].key)!;
          const curr = byKey.get(rows[i].key)!;
          const dateCompare = prev.transactionDate.localeCompare(
            curr.transactionDate
          );
          if (dateCompare !== 0) {
            expect(dateCompare).toBeLessThan(0);
          } else {
            expect(
              prev.createdAt.localeCompare(curr.createdAt)
            ).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("keys are unique, so no two documents collide across the two id spaces", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const rows = buildStayDocumentRows(
          withRefundInvoices(transactions),
          STAY_WITH_INVOICE
        );
        expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
      }),
      { numRuns: 100 }
    );
  });

  it("an empty ledger yields only the final invoice, or nothing at all", () => {
    expect(buildStayDocumentRows([], STAY_WITHOUT_INVOICE)).toEqual([]);

    const rows = buildStayDocumentRows([], STAY_WITH_INVOICE);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("FINAL_INVOICE");
  });
});
