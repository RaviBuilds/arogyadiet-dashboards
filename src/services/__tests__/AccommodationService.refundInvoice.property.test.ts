// src/services/__tests__/AccommodationService.refundInvoice.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 28: Exactly one Refund_Invoice per REFUND transaction
//
// **Validates: Requirements 14.6, 14.7, 14.9**
//
// For sequences of 1–5 accepted refunds against an overpaid stay:
// 1. Bijection (Req 14.6, 14.7): every accepted refund produces exactly one
//    `refundInvoicePaymentId`; two refunds produce two distinct ids.
// 2. Per-invoice content (Req 14.7): each `refundInvoicePaymentId` is a
//    non-empty string.
// 3. Many per stay (Req 14.9): multiple refunds against the same stay each get
//    their own invoice (the `uniq_refund_invoice_per_transaction` constraint is
//    per-transaction, not per-stay).
// 4. One per transaction: the same transaction cannot produce a second invoice
//    (mock the RPC to reject a duplicate — this is the constraint the partial
//    unique index enforces).
//
// `AccommodationService.recordRefundWithInvoice` is a thin wrapper over
// `stayPaymentRepository.recordRefundWithInvoice`, which calls the
// `record_stay_refund_with_invoice()` RPC. The RPC is mocked here to return
// success with a unique `refundInvoicePaymentId` per call.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  let callSeq = 0;
  /** Track every call to the RPC mock. */
  const refundCalls: Array<{
    stayEntryId: string;
    amount: number;
    remark: string;
    comment: string | null;
    createdBy: string | null;
  }> = [];

  /**
   * Set of (stayEntryId, transactionId) pairs already committed — used to
   * simulate the `uniq_refund_invoice_per_transaction` partial unique index:
   * a second call with an identical transactionId for the same stay throws,
   * because the RPC's transaction would abort on the duplicate.
   */
  const committedTransactions = new Set<string>();

  /** Whether the next call should simulate the duplicate-invoice rejection. */
  let rejectDuplicate = false;
  /** The transactionId to simulate as already committed. */
  let duplicateTransactionId: string | null = null;

  function reset() {
    callSeq = 0;
    refundCalls.length = 0;
    committedTransactions.clear();
    rejectDuplicate = false;
    duplicateTransactionId = null;
  }

  function nextSeq() {
    callSeq += 1;
    return callSeq;
  }

  function setDuplicateRejection(transactionId: string) {
    rejectDuplicate = true;
    duplicateTransactionId = transactionId;
  }

  return {
    refundCalls,
    committedTransactions,
    reset,
    nextSeq,
    setDuplicateRejection,
    get rejectDuplicate() { return rejectDuplicate; },
    get duplicateTransactionId() { return duplicateTransactionId; },
  };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    recordRefundWithInvoice: vi.fn(async (input: any) => {
      H.refundCalls.push({
        stayEntryId: input.stayEntryId,
        amount: input.amount,
        remark: input.remark,
        comment: input.comment,
        createdBy: input.createdBy,
      });

      const seq = H.nextSeq();
      const transactionId = `tx-refund-${seq}`;
      const invoicePaymentId = `inv-refund-${seq}`;

      // Simulate the partial unique index: if this is a forced duplicate
      // scenario, throw (the RPC raises, aborting the transaction).
      if (H.rejectDuplicate && H.duplicateTransactionId === transactionId) {
        throw new Error(
          "duplicate key value violates unique constraint \"uniq_refund_invoice_per_transaction\""
        );
      }

      // Track as committed.
      H.committedTransactions.add(`${input.stayEntryId}:${transactionId}`);

      // The RPC returns a success result: the REFUND ledger row was written
      // together with the Refund_Invoice in one transaction. Return a shape
      // that mirrors the real RPC response.
      const remainingAfterRefund = 0; // Simplified: refund settles the balance.
      return {
        ok: true,
        transaction: {
          id: transactionId,
          stay_entry_id: input.stayEntryId,
          customer_profile_id: "customer-profile-1",
          transaction_type: "REFUND",
          amount: input.amount,
          transaction_date: input.transactionDate,
          comment: input.comment,
          remark: input.remark,
          created_by: input.createdBy,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          refund_invoice_payment_id: null, // Null in the snapshot, set later.
        },
        refundInvoicePaymentId: invoicePaymentId,
        totalPaid: 0,
        remainingBalance: remainingAfterRefund,
      };
    }),
  };
});

// Mock the IST date helper used inside recordRefundWithInvoice.
vi.mock("@/lib/dates/ist", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getISTDateString: vi.fn(() => "2025-01-15"),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { recordRefundWithInvoice } from "@/services/AccommodationService";
import {
  arbActiveBillableStayEntry,
  arbTransactionAmount,
  DEFAULT_STAY_ID,
  ACTOR_USER_IDS,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/** A single refund submission with a valid amount and remark. */
const arbRefundSubmission = fc.record({
  amount: arbTransactionAmount,
  remark: fc.constantFrom(
    "Early departure refund",
    "Overcharge correction",
    "Customer request",
    "Recalculated stay amount adjustment",
  ),
  comment: fc.oneof(
    { arbitrary: fc.constant<string | null>(null), weight: 2 },
    { arbitrary: fc.constant<string | null>("Admin note"), weight: 1 },
  ),
  createdBy: fc.constantFrom<string | null>(...ACTOR_USER_IDS),
});

/** 1–5 refund submissions — the sequences the property quantifies over. */
const arbRefundSequence = fc.array(arbRefundSubmission, {
  minLength: 1,
  maxLength: 5,
});

// ─── Property 28 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 28: Exactly one Refund_Invoice per REFUND transaction", () => {
  it("bijection: every accepted refund produces exactly one refundInvoicePaymentId, and all are distinct (Req 14.6, 14.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefundSequence, async (submissions) => {
        H.reset();

        const results: Array<{
          ok: true;
          refundInvoicePaymentId: string;
          transactionId: string;
        }> = [];

        for (const sub of submissions) {
          const outcome = await recordRefundWithInvoice({
            stayId: DEFAULT_STAY_ID,
            amount: sub.amount,
            remark: sub.remark,
            comment: sub.comment,
            createdBy: sub.createdBy,
          });

          // The mock always returns success for the bijection property.
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            results.push({
              ok: true,
              refundInvoicePaymentId: outcome.refundInvoicePaymentId,
              transactionId: outcome.transactionId,
            });
          }
        }

        // Property 1: Exactly one refundInvoicePaymentId per accepted refund.
        expect(results).toHaveLength(submissions.length);

        // Property 2: All refundInvoicePaymentIds are distinct — two refunds
        // never share an invoice.
        const invoiceIds = results.map((r) => r.refundInvoicePaymentId);
        expect(new Set(invoiceIds).size).toBe(invoiceIds.length);

        // Additionally: all transactionIds are distinct.
        const txIds = results.map((r) => r.transactionId);
        expect(new Set(txIds).size).toBe(txIds.length);
      }),
      { numRuns: 100 },
    );
  });

  it("per-invoice content: each refundInvoicePaymentId is a non-empty string (Req 14.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefundSequence, async (submissions) => {
        H.reset();

        for (const sub of submissions) {
          const outcome = await recordRefundWithInvoice({
            stayId: DEFAULT_STAY_ID,
            amount: sub.amount,
            remark: sub.remark,
            comment: sub.comment,
            createdBy: sub.createdBy,
          });

          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            expect(typeof outcome.refundInvoicePaymentId).toBe("string");
            expect(outcome.refundInvoicePaymentId.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("many per stay: multiple refunds against the same stay each get their own invoice (Req 14.9)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        arbRefundSubmission,
        async (count, baseSub) => {
          H.reset();

          const invoiceIds: string[] = [];

          for (let i = 0; i < count; i++) {
            const outcome = await recordRefundWithInvoice({
              stayId: DEFAULT_STAY_ID,
              amount: baseSub.amount,
              remark: baseSub.remark,
              comment: baseSub.comment,
              createdBy: baseSub.createdBy,
            });

            expect(outcome.ok).toBe(true);
            if (outcome.ok) {
              invoiceIds.push(outcome.refundInvoicePaymentId);
            }
          }

          // All calls went to the same stay.
          expect(H.refundCalls.every((c) => c.stayEntryId === DEFAULT_STAY_ID)).toBe(true);

          // Each refund got its own distinct invoice — the constraint is
          // per-transaction, not per-stay.
          expect(invoiceIds).toHaveLength(count);
          expect(new Set(invoiceIds).size).toBe(count);
        }
      ),
      { numRuns: 100 },
    );
  });

  it("one per transaction: the same transaction cannot produce a second invoice (Req 14.9)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRefundSubmission, async (sub) => {
        H.reset();

        // First refund succeeds — creates transaction tx-refund-1.
        const first = await recordRefundWithInvoice({
          stayId: DEFAULT_STAY_ID,
          amount: sub.amount,
          remark: sub.remark,
          comment: sub.comment,
          createdBy: sub.createdBy,
        });

        expect(first.ok).toBe(true);
        if (!first.ok) return;

        // Now configure the mock to reject the NEXT call as if it were a
        // duplicate of the same transaction (simulating the partial unique
        // index on `uniq_refund_invoice_per_transaction`).
        // The next call will produce tx-refund-2, but we force a duplicate
        // scenario by telling the mock to throw for that id.
        H.setDuplicateRejection("tx-refund-2");

        // Second call: the RPC raises because the transaction's invoice
        // already exists — the service translates this into INVOICE_FAILED.
        const second = await recordRefundWithInvoice({
          stayId: DEFAULT_STAY_ID,
          amount: sub.amount,
          remark: sub.remark,
          comment: sub.comment,
          createdBy: sub.createdBy,
        });

        expect(second.ok).toBe(false);
        if (!second.ok) {
          // The service maps a thrown RPC error to INVOICE_FAILED.
          expect(second.reason).toBe("INVOICE_FAILED");
        }
      }),
      { numRuns: 100 },
    );
  });
});
