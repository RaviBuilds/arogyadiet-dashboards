// src/services/__tests__/AccommodationService.paymentHistory.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 9: Payment history ordering and completeness
//
// **Validates: Requirements 6.2, 6.5**
//
// For any list of Payment_Transaction records for a Stay_Entry, the rendered
// payment history SHALL present them in non-decreasing order of (transaction
// date, creation timestamp), and each rendered entry SHALL contain that
// transaction's date, amount, Payment_Transaction_Type label, comment, and remark.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { buildPaymentHistoryRows } from "@/services/AccommodationService";
import { PAYMENT_TRANSACTION_LABELS } from "@/types/accommodation";
import {
  arbLedger,
  arbNonEmptyLedger,
  arbShuffledLedger,
  arbTransaction,
  PAYMENT_TRANSACTION_TYPES,
  REFERENCE_TODAY_IST,
  materializeTransaction,
  arbTransactionSeed,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 9: Payment history ordering and completeness", () => {
  it("rows are in non-decreasing order of (transactionDate, createdAt)", () => {
    fc.assert(
      fc.property(arbShuffledLedger, (transactions) => {
        const rows = buildPaymentHistoryRows(transactions);

        // Find the original transaction for each row to check createdAt ordering
        const txById = new Map(transactions.map((tx) => [tx.id, tx]));

        for (let i = 1; i < rows.length; i++) {
          const prev = txById.get(rows[i - 1].id)!;
          const curr = txById.get(rows[i].id)!;

          // Primary sort: transactionDate non-decreasing
          const dateCompare = prev.transactionDate.localeCompare(curr.transactionDate);
          expect(dateCompare).toBeLessThanOrEqual(0);

          // Secondary sort (tie-break): createdAt non-decreasing when dates are equal
          if (dateCompare === 0) {
            expect(prev.createdAt.localeCompare(curr.createdAt)).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("each rendered entry contains the transaction's date, amount, type label, comment, and remark", () => {
    fc.assert(
      fc.property(arbNonEmptyLedger, (transactions) => {
        const rows = buildPaymentHistoryRows(transactions);

        // Every transaction must appear in the output
        expect(rows.length).toBe(transactions.length);

        const txById = new Map(transactions.map((tx) => [tx.id, tx]));

        for (const row of rows) {
          const tx = txById.get(row.id);
          expect(tx).toBeDefined();

          // date matches transactionDate
          expect(row.date).toBe(tx!.transactionDate);

          // amount matches
          expect(row.amount).toBe(tx!.amount);

          // typeLabel matches the PAYMENT_TRANSACTION_LABELS mapping
          expect(row.typeLabel).toBe(PAYMENT_TRANSACTION_LABELS[tx!.transactionType]);

          // comment carried through
          expect(row.comment).toBe(tx!.comment);

          // remark carried through
          expect(row.remark).toBe(tx!.remark);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("output length equals the number of input transactions (completeness — no rows lost or duplicated)", () => {
    fc.assert(
      fc.property(arbLedger, (transactions) => {
        const rows = buildPaymentHistoryRows(transactions);
        expect(rows.length).toBe(transactions.length);
      }),
      { numRuns: 100 },
    );
  });

  it("every transaction id appears exactly once in the output", () => {
    fc.assert(
      fc.property(arbNonEmptyLedger, (transactions) => {
        const rows = buildPaymentHistoryRows(transactions);

        const outputIds = rows.map((r) => r.id);
        const inputIds = transactions.map((tx) => tx.id);

        // Same set of ids, same cardinality
        expect(new Set(outputIds).size).toBe(outputIds.length);
        expect(new Set(outputIds)).toEqual(new Set(inputIds));
      }),
      { numRuns: 100 },
    );
  });

  it("each row carries a receiptLinkTarget containing the transaction id", () => {
    fc.assert(
      fc.property(arbNonEmptyLedger, (transactions) => {
        const rows = buildPaymentHistoryRows(transactions);

        for (const row of rows) {
          // The receipt link should contain the transaction's own id
          expect(row.receiptLinkTarget).toContain(row.id);
          // And should be a valid route path
          expect(row.receiptLinkTarget).toMatch(/^\/admin\/customers\/.+\/billing\/stay-receipt\/.+$/);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("an empty ledger produces an empty history", () => {
    const rows = buildPaymentHistoryRows([]);
    expect(rows).toEqual([]);
  });

  it("ordering is stable when all transactions share the same date (sorted by createdAt)", () => {
    fc.assert(
      fc.property(
        fc.array(arbTransactionSeed({ dateSpread: 0 }), { minLength: 2, maxLength: 10 }),
        (seeds) => {
          // All seeds get dateSlot = 0 (same transaction date), but different createdAt
          // because materializeTransaction uses index * 60 + jitter for the timestamp.
          const transactions = seeds.map((seed, index) =>
            materializeTransaction(seed, index),
          );

          // Shuffle the input to ensure sort is actually applied
          const shuffled = [...transactions].reverse();
          const rows = buildPaymentHistoryRows(shuffled);

          // Should be ordered by createdAt (which ascends with index)
          const txById = new Map(transactions.map((tx) => [tx.id, tx]));
          for (let i = 1; i < rows.length; i++) {
            const prev = txById.get(rows[i - 1].id)!;
            const curr = txById.get(rows[i].id)!;
            expect(prev.createdAt.localeCompare(curr.createdAt)).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
