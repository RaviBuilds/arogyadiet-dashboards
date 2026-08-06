// src/services/__tests__/AccommodationService.refundRollback.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 29: A failed Refund_Invoice rolls the refund back
//
// **Validates: Requirements 14.8**
//
// When `recordRefundWithInvoice` delegates to `stayPaymentRepository.recordRefundWithInvoice`
// (the atomic RPC) and the RPC throws (simulating an invoice-insert failure inside the
// transaction), the REFUND ledger row was also rolled back — nothing persists.
// The service translates the throw into `{ ok: false, reason: "INVOICE_FAILED" }`.
//
// Mock strategy:
//  (a) throw on the first call — simulates invoice failure within the RPC transaction.
//  (b) succeed on the second — simulates the condition clearing and retry succeeding.
//
// Assertions:
//  - Deep-equality snapshot of the ledger (via `listTransactionsByStay`) before/after
//    the failure: the ledger must be IDENTICAL after a failed refund attempt.
//  - On the successful retry, a new `refundInvoicePaymentId` is returned.
//
// Uses `arbActiveBillableStayEntry`, `arbTransactionAmount` from paymentArbitraries.
// 100 iterations.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared state (hoisted so vi.mock factories can close over it) ───────────
const H = vi.hoisted(() => {
  /** How many times `recordRefundWithInvoice` has been called within a test run. */
  let callCount = 0;
  /** Whether the next RPC call should throw (simulating invoice-insert failure). */
  let shouldThrowOnNext = false;

  /**
   * In-memory ledger: the array `listTransactionsByStay` returns. The mock for
   * `recordRefundWithInvoice` appends to this ONLY on success — on failure
   * (throw) nothing is appended, matching the RPC's transactional rollback.
   */
  let ledgerRows: any[] = [];

  /** The initial ledger rows (pre-existing transactions) set per test run. */
  let initialLedger: any[] = [];

  function reset() {
    callCount = 0;
    shouldThrowOnNext = false;
    ledgerRows = [];
    initialLedger = [];
  }

  function setInitialLedger(rows: any[]) {
    initialLedger = [...rows];
    ledgerRows = [...rows];
  }

  function armFailure() {
    shouldThrowOnNext = true;
  }

  function disarmFailure() {
    shouldThrowOnNext = false;
  }

  function getCallCount() {
    return callCount;
  }

  function incrementCallCount() {
    callCount += 1;
    return callCount;
  }

  function getLedger() {
    return [...ledgerRows];
  }

  function appendToLedger(row: any) {
    ledgerRows.push(row);
  }

  return {
    reset,
    setInitialLedger,
    armFailure,
    disarmFailure,
    getCallCount,
    incrementCallCount,
    getLedger,
    appendToLedger,
    get shouldThrowOnNext() { return shouldThrowOnNext; },
  };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    listTransactionsByStay: vi.fn(async (_stayId: string) => {
      // Returns a deep copy so mutations in test code don't pollute the ledger.
      return H.getLedger().map((row: any) => ({ ...row }));
    }),
    recordRefundWithInvoice: vi.fn(async (input: any) => {
      const seq = H.incrementCallCount();

      if (H.shouldThrowOnNext) {
        // Simulate: the RPC's transaction aborted because the Refund_Invoice
        // insert failed. The REFUND ledger row is rolled back — nothing persists.
        // The repository throws, and the service catches it (Req 14.8).
        throw new Error(
          "Failed to record refund with invoice for stay " +
            input.stayEntryId +
            ": could not insert refund invoice row"
        );
      }

      // Success path: both the REFUND row and the Refund_Invoice were committed.
      const transactionId = `tx-refund-${seq}`;
      const invoicePaymentId = `inv-refund-${seq}`;

      const newRow = {
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
        refund_invoice_payment_id: invoicePaymentId,
      };

      // Append to the in-memory ledger — this mimics the RPC committing.
      H.appendToLedger(newRow);

      return {
        ok: true,
        transaction: { ...newRow, refund_invoice_payment_id: null },
        refundInvoicePaymentId: invoicePaymentId,
        totalPaid: 0, // Simplified: post-refund total.
        remainingBalance: 0,
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

// ─── System under test (imported after the mocks are registered) ─────────────
import { recordRefundWithInvoice } from "@/services/AccommodationService";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import {
  arbActiveBillableStayEntry,
  arbTransactionAmount,
  DEFAULT_STAY_ID,
  ACTOR_USER_IDS,
  fixtureUuid,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A pre-existing ledger of 0–5 ADVANCE/PARTIAL_BALANCE_PAYMENT rows — the state
 * before the refund attempt. Simulates a stay that has received some payments
 * and is now overpaid (the precondition for Mark as refunded).
 */
const arbPreExistingLedger = fc
  .array(
    fc.record({
      type: fc.constantFrom("ADVANCE", "PARTIAL_BALANCE_PAYMENT") as fc.Arbitrary<string>,
      amount: arbTransactionAmount,
    }),
    { minLength: 0, maxLength: 5 }
  )
  .map((seeds) =>
    seeds.map((seed, i) => ({
      id: fixtureUuid(44, i + 1),
      stay_entry_id: DEFAULT_STAY_ID,
      customer_profile_id: "customer-profile-1",
      transaction_type: seed.type,
      amount: seed.amount,
      transaction_date: "2025-01-10",
      comment: i === 0 ? "Advance at check-in" : `Payment ${i + 1}`,
      remark: null,
      created_by: ACTOR_USER_IDS[0],
      created_at: new Date(Date.UTC(2025, 0, 10, 6, i, 0)).toISOString(),
      updated_at: new Date(Date.UTC(2025, 0, 10, 6, i, 0)).toISOString(),
      refund_invoice_payment_id: null,
    }))
  );

/** A refund submission with a positive amount and a valid remark. */
const arbRefundInput = fc.record({
  amount: arbTransactionAmount,
  remark: fc.constantFrom(
    "Early departure refund",
    "Overcharge correction",
    "Customer request",
    "Recalculated stay amount — excess returned",
  ),
  comment: fc.oneof(
    { arbitrary: fc.constant<string | null>(null), weight: 2 },
    { arbitrary: fc.constant<string | null>("Admin note"), weight: 1 },
  ),
  createdBy: fc.constantFrom<string | null>(...ACTOR_USER_IDS),
});

// ─── Property 29 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 29: A failed Refund_Invoice rolls the refund back", () => {
  it("ledger is unchanged after a failed refund attempt (Req 14.8)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPreExistingLedger,
        arbRefundInput,
        async (existingLedger, refundInput) => {
          H.reset();
          vi.clearAllMocks();

          // Seed the in-memory ledger with pre-existing transactions.
          H.setInitialLedger(existingLedger);

          // Snapshot the ledger BEFORE the failed attempt.
          const ledgerBefore = await stayPaymentRepository.listTransactionsByStay(
            DEFAULT_STAY_ID
          );

          // Arm the failure: the next RPC call will throw.
          H.armFailure();

          // Attempt the refund — this should fail with INVOICE_FAILED.
          const failedResult = await recordRefundWithInvoice({
            stayId: DEFAULT_STAY_ID,
            amount: refundInput.amount,
            remark: refundInput.remark,
            comment: refundInput.comment,
            createdBy: refundInput.createdBy,
          });

          // The service must report INVOICE_FAILED — not throw, not succeed.
          expect(failedResult.ok).toBe(false);
          if (!failedResult.ok) {
            expect(failedResult.reason).toBe("INVOICE_FAILED");
          }

          // Snapshot the ledger AFTER the failed attempt.
          const ledgerAfter = await stayPaymentRepository.listTransactionsByStay(
            DEFAULT_STAY_ID
          );

          // DEEP EQUALITY: nothing was persisted — the ledger is identical.
          expect(ledgerAfter).toEqual(ledgerBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("successful retry after failure produces a refundInvoicePaymentId (Req 14.8)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPreExistingLedger,
        arbRefundInput,
        async (existingLedger, refundInput) => {
          H.reset();
          vi.clearAllMocks();

          // Seed the in-memory ledger with pre-existing transactions.
          H.setInitialLedger(existingLedger);

          // Snapshot the ledger BEFORE either attempt.
          const ledgerBefore = await stayPaymentRepository.listTransactionsByStay(
            DEFAULT_STAY_ID
          );

          // ── First call: FAILS (invoice-insert failure). ──
          H.armFailure();

          const failedResult = await recordRefundWithInvoice({
            stayId: DEFAULT_STAY_ID,
            amount: refundInput.amount,
            remark: refundInput.remark,
            comment: refundInput.comment,
            createdBy: refundInput.createdBy,
          });

          expect(failedResult.ok).toBe(false);
          if (!failedResult.ok) {
            expect(failedResult.reason).toBe("INVOICE_FAILED");
          }

          // Ledger unchanged after failure.
          const ledgerAfterFailure = await stayPaymentRepository.listTransactionsByStay(
            DEFAULT_STAY_ID
          );
          expect(ledgerAfterFailure).toEqual(ledgerBefore);

          // ── Second call: SUCCEEDS (condition cleared). ──
          H.disarmFailure();

          const successResult = await recordRefundWithInvoice({
            stayId: DEFAULT_STAY_ID,
            amount: refundInput.amount,
            remark: refundInput.remark,
            comment: refundInput.comment,
            createdBy: refundInput.createdBy,
          });

          // Must succeed with a refundInvoicePaymentId.
          expect(successResult.ok).toBe(true);
          if (successResult.ok) {
            expect(typeof successResult.refundInvoicePaymentId).toBe("string");
            expect(successResult.refundInvoicePaymentId.length).toBeGreaterThan(0);
            expect(typeof successResult.transactionId).toBe("string");
            expect(successResult.transactionId.length).toBeGreaterThan(0);
          }

          // Ledger now has exactly one new row (the successful REFUND).
          const ledgerAfterSuccess = await stayPaymentRepository.listTransactionsByStay(
            DEFAULT_STAY_ID
          );
          expect(ledgerAfterSuccess).toHaveLength(ledgerBefore.length + 1);

          // The new row is a REFUND with the submitted amount and remark.
          const newRow = ledgerAfterSuccess[ledgerAfterSuccess.length - 1];
          expect(newRow.transaction_type).toBe("REFUND");
          expect(newRow.amount).toBe(refundInput.amount);
          expect(newRow.remark).toBe(refundInput.remark);
        }
      ),
      { numRuns: 100 }
    );
  });
});
