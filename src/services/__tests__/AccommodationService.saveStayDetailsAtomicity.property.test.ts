// src/services/__tests__/AccommodationService.saveStayDetailsAtomicity.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 30: Save Stay Details is atomic under failure
//
// **Validates: Requirements 12.16**
//
// When `stayRepository.saveStayDetails` (the RPC) fails — by throwing
// (simulating a transaction abort) — NO partial write persists. The stay row,
// the extension history, and the recalculation history must all remain
// byte-identical to their pre-call state.
//
// Mock `stayRepository.saveStayDetails` to (a) throw on the first call,
// simulating a transaction abort, then (b) succeed on a retry. Before the first
// call, snapshot the stay row. After the throw, assert the stay row is identical
// to the snapshot. Then call again (the retry) and assert success.
//
// Uses `arbActiveBillableStayEntry`, `arbValidRecalculateStaySubmission` from
// paymentArbitraries. 100 iterations.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory store + failure injection (hoisted for vi.mock) ───────
const H = vi.hoisted(() => {
  let currentStayRow: any = null;
  let currentLedgerRows: any[] = [];
  let currentRecalculationHistory: any[] = [];
  let currentExtensionHistory: any[] = [];

  /** When > 0, the next N saveStayDetails calls will throw. */
  let failCount = 0;

  function reset() {
    currentStayRow = null;
    currentLedgerRows = [];
    currentRecalculationHistory = [];
    currentExtensionHistory = [];
    failCount = 0;
  }

  return {
    reset,
    get currentStayRow() { return currentStayRow; },
    set currentStayRow(v: any) { currentStayRow = v; },
    get currentLedgerRows() { return currentLedgerRows; },
    set currentLedgerRows(v: any[]) { currentLedgerRows = v; },
    get currentRecalculationHistory() { return currentRecalculationHistory; },
    set currentRecalculationHistory(v: any[]) { currentRecalculationHistory = v; },
    get currentExtensionHistory() { return currentExtensionHistory; },
    set currentExtensionHistory(v: any[]) { currentExtensionHistory = v; },
    get failCount() { return failCount; },
    set failCount(v: number) { failCount = v; },
  };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getStayById: vi.fn(async (_stayId: string) => {
      return H.currentStayRow;
    }),
    /**
     * Mock of the `save_stay_details()` RPC:
     *
     * - When `failCount > 0`: THROWS an infrastructure error simulating a
     *   transaction abort. In the real system, the Postgres transaction rolls
     *   back and nothing is committed. Our mock mirrors this by NOT modifying
     *   the stay row or history arrays — the throw is the only observable
     *   effect (Req 12.16: "discard any partial changes").
     *
     * - When `failCount === 0`: simulates the successful RPC path — updates
     *   the stay row and appends a history row iff something changed.
     */
    saveStayDetails: vi.fn(async (input: any) => {
      if (H.failCount > 0) {
        H.failCount--;
        // Simulate infrastructure-level failure (connection timeout,
        // Postgres crash mid-transaction, etc.). The real `stayRepository`
        // wraps the RPC call and throws on `error` (see the implementation).
        // Crucially: NO state is modified — the transaction rolled back.
        throw new Error(
          "simulated transaction abort: connection reset during save_stay_details"
        );
      }

      // ─── Successful path ──────────────────────────────────────────────
      const current = H.currentStayRow;
      if (!current) {
        return { ok: false as const, reason: "NOT_FOUND" as const };
      }
      if (current.status !== "ACTIVE") {
        return {
          ok: false as const,
          reason: "NOT_ACTIVE" as const,
          status: current.status,
        };
      }

      const isFirstApplication = !current.recalculation_applied;
      const shortens = input.recalculatedTotalNights < current.total_nights;
      const changed =
        input.recalculatedTotalNights !== current.total_nights ||
        input.recalculatedStayAmount !== current.payment_amount;

      const updated = {
        ...current,
        total_nights: input.recalculatedTotalNights,
        payment_amount: input.recalculatedStayAmount,
        base_amount: input.gst.baseAmount,
        tax_amount: input.gst.taxAmount,
        recalculation_applied: true,
        early_checkout_applied: current.early_checkout_applied || shortens,
        actual_nights_stayed: shortens
          ? input.recalculatedTotalNights
          : current.actual_nights_stayed,
      };
      if (isFirstApplication) {
        updated.original_total_nights = current.total_nights;
        updated.original_total_amount = current.payment_amount;
      }
      H.currentStayRow = updated;

      // The RPC inserts a recalculation history row in the SAME transaction
      // iff something changed (Req 13.1, 13.2).
      if (changed) {
        H.currentRecalculationHistory = [
          ...H.currentRecalculationHistory,
          {
            id: `recalc-${H.currentRecalculationHistory.length + 1}`,
            stay_entry_id: current.id,
            customer_profile_id: current.customer_profile_id,
            nights_before: current.total_nights,
            nights_after: input.recalculatedTotalNights,
            total_amount_before: current.payment_amount,
            total_amount_after: input.recalculatedStayAmount,
            end_date_before: "derived",
            end_date_after: input.recalculatedEndDate,
            recalculated_on: input.recalculatedOn,
            created_by: input.createdBy,
            created_at: new Date().toISOString(),
          },
        ];
      }

      return {
        ok: true as const,
        stay: { ...updated },
        historyRecorded: changed,
      };
    }),
    finalizeCheckout: vi.fn(async () => {
      throw new Error("finalizeCheckout must NEVER be called by saveStayDetails");
    }),
    attachFinalInvoice: vi.fn(async () => {
      throw new Error("attachFinalInvoice must NEVER be called");
    }),
    recordFinalInvoiceFailure: vi.fn(async () => {
      throw new Error("recordFinalInvoiceFailure must NEVER be called");
    }),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    listTransactionsByStay: vi.fn(async (_stayId: string) => {
      return H.currentLedgerRows;
    }),
    recordTransaction: vi.fn(async () => {
      throw new Error("recordTransaction must NEVER be called");
    }),
    insertAdvanceTransaction: vi.fn(async () => {
      throw new Error("insertAdvanceTransaction must NEVER be called");
    }),
    recordRefundWithInvoice: vi.fn(async () => {
      throw new Error("recordRefundWithInvoice must NEVER be called");
    }),
  };
});

vi.mock("@/repositories/stayRecalculationHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    listRecalculationsByStay: vi.fn(async () => {
      return H.currentRecalculationHistory;
    }),
  };
});

vi.mock("@/repositories/stayExtensionHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    listExtensionsByStay: vi.fn(async () => {
      return H.currentExtensionHistory;
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(_table: string) {
      return {
        insert() { throw new Error("Unexpected insert in atomicity test"); },
        select() {
          return { eq: () => ({ order: () => ({ data: [], error: null }) }) };
        },
      };
    },
  }),
}));

// ─── System under test (imported after mocks) ───────────────────────────────
import { saveStayDetails } from "@/services/AccommodationService";
import type { StayEntry } from "@/types/accommodation";
import type { StayEntryRow } from "@/repositories/stayRepository";
import {
  arbActiveBillableStayEntry,
  arbValidRecalculateStaySubmission,
  arbLedgerWith,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts a domain StayEntry to the snake_case row the repository returns. */
function rowFromDomainStay(stay: StayEntry): StayEntryRow {
  return {
    id: stay.id,
    customer_profile_id: stay.customerProfileId,
    start_date: stay.startDate,
    total_nights: stay.totalNights,
    stay_type: stay.stayType,
    occupancy_type: stay.occupancyType,
    status: stay.status,
    payment_amount: stay.paymentAmount,
    base_amount: stay.baseAmount,
    tax_amount: stay.taxAmount,
    tax_percentage: stay.taxPercentage,
    payment_host_profile_id: stay.paymentHostProfileId,
    meal_preference: stay.mealPreference,
    created_at: stay.createdAt,
    updated_at: stay.updatedAt,
    is_backdated: stay.isBackdated,
    early_checkout_applied: stay.earlyCheckoutApplied,
    actual_nights_stayed: stay.actualNightsStayed,
    original_total_nights: stay.originalTotalNights,
    original_total_amount: stay.originalTotalAmount,
    recalculation_applied: stay.recalculationApplied,
    checked_out_at: stay.checkedOutAt,
    final_invoice_payment_id: stay.finalInvoicePaymentId,
    final_invoice_generated_at: stay.finalInvoiceGeneratedAt,
    final_invoice_error: stay.finalInvoiceError,
  };
}

/** Deep-clone a value for snapshotting (JSON round-trip). */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ─── Property 30 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 30: Save Stay Details is atomic under failure", () => {
  it("a thrown failure leaves the stay row and both history tables byte-identical to their pre-call state, and an unimpeded retry succeeds", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbActiveBillableStayEntry,
        arbValidRecalculateStaySubmission,
        arbLedgerWith({ minLength: 0, maxLength: 8 }),
        async (stay, submission, ledger) => {
          H.reset();

          // Adapt the stay to match the submission's date bounds.
          const bookedNights =
            Math.round(
              (new Date(submission.bookedEndDate).getTime() -
                new Date(submission.startDate).getTime()) /
                86_400_000
            ) + 1;

          const adaptedStay: StayEntry = {
            ...stay,
            startDate: submission.startDate,
            totalNights: bookedNights,
            endDate: submission.bookedEndDate,
          };

          const row = rowFromDomainStay(adaptedStay);
          H.currentStayRow = row;

          // Build the ledger rows in snake_case.
          H.currentLedgerRows = ledger.map((tx) => ({
            id: tx.id,
            stay_entry_id: tx.stayEntryId,
            customer_profile_id: tx.customerProfileId,
            transaction_type: tx.transactionType,
            amount: tx.amount,
            transaction_date: tx.transactionDate,
            comment: tx.comment,
            remark: tx.remark,
            created_by: tx.createdBy,
            created_at: tx.createdAt,
            updated_at: tx.createdAt,
          }));

          // Seed pre-existing history (must survive the failure unchanged).
          H.currentRecalculationHistory = [
            {
              id: "pre-existing-recalc-1",
              stay_entry_id: adaptedStay.id,
              customer_profile_id: adaptedStay.customerProfileId,
              nights_before: 10,
              nights_after: 7,
              total_amount_before: 50000,
              total_amount_after: 35000,
              end_date_before: "2025-01-10",
              end_date_after: "2025-01-07",
              recalculated_on: "2025-01-05",
              created_by: null,
              created_at: "2025-01-05T00:00:00.000Z",
            },
          ];
          H.currentExtensionHistory = [
            {
              id: "pre-existing-ext-1",
              stay_entry_id: adaptedStay.id,
              customer_profile_id: adaptedStay.customerProfileId,
              additional_nights: 3,
              additional_amount: 15000,
              nights_before: 7,
              nights_after: 10,
              total_amount_before: 35000,
              total_amount_after: 50000,
              extended_on: "2025-01-03",
              created_by: null,
              created_at: "2025-01-03T00:00:00.000Z",
            },
          ];

          // ─── SNAPSHOT before the failing call ─────────────────────────
          const stayRowBefore = snapshot(H.currentStayRow);
          const recalcHistoryBefore = snapshot(H.currentRecalculationHistory);
          const extensionHistoryBefore = snapshot(H.currentExtensionHistory);

          // ─── FIRST CALL: inject failure (RPC throws) ──────────────────
          H.failCount = 1;

          let threwOnFailure = false;
          try {
            await saveStayDetails(
              adaptedStay.id,
              submission.recalculatedEndDate,
              submission.recalculatedStayAmount
            );
          } catch {
            threwOnFailure = true;
          }

          // The service propagates the RPC throw — it should have thrown.
          expect(threwOnFailure).toBe(true);

          // ─── INVARIANT 1: Stay row is unchanged after failure ─────────
          expect(H.currentStayRow).toEqual(stayRowBefore);

          // ─── INVARIANT 2: Recalculation history is unchanged ──────────
          expect(H.currentRecalculationHistory).toEqual(recalcHistoryBefore);

          // ─── INVARIANT 3: Extension history is unchanged ──────────────
          expect(H.currentExtensionHistory).toEqual(extensionHistoryBefore);

          // ─── RETRY: the same call succeeds (failCount is now 0) ───────
          const retryResult = await saveStayDetails(
            adaptedStay.id,
            submission.recalculatedEndDate,
            submission.recalculatedStayAmount
          );

          // The retry must succeed (the stay is still ACTIVE, bounds valid).
          expect((retryResult as any).ok).not.toBe(false);
          expect((retryResult as any).status).toBe("ACTIVE");
          expect((retryResult as any).stayId).toBe(adaptedStay.id);
        }
      ),
      { numRuns: 100 }
    );
  });
});
