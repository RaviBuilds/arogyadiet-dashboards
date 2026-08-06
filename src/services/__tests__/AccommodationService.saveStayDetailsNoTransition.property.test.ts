// src/services/__tests__/AccommodationService.saveStayDetailsNoTransition.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 24: Save Stay Details never transitions status and never invoices
//
// **Validates: Requirements 12.9, 12.13**
//
// For ANY valid Save_Stay_Details submission — including the critical case where
// the stay has reached its end date AND the balance is exactly zero (the exact
// state that would have triggered an immediate checkout under the retired
// `earlyCheckout`) — the returned `status` is always "ACTIVE", `nextAction` is
// never "CHECKED_OUT", `stayRepository.finalizeCheckout` is NEVER called,
// `AccommodationService.generateFinalInvoice` is NEVER called, and no `payments`
// row is ever written.
//
// This structural decoupling is the core guarantee of Revision 2: saving
// recalculated stay details and checking out a guest are separate, deliberate
// admin actions. Save Stay Details only persists nights + amount, it never
// finishes the stay or generates any invoice.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory store + call log (hoisted so vi.mock factories can
// close over it) ─────────────────────────────────────────────────────────
const H = vi.hoisted(() => {
  const calls: any = {
    getStayById: [] as string[],
    saveStayDetails: [] as any[],
    finalizeCheckout: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    listTransactionsByStay: [] as string[],
    recordTransaction: [] as any[],
    insertAdvanceTransaction: [] as any[],
    recordRefundWithInvoice: [] as any[],
    paymentsInsert: [] as any[],
  };

  let currentStayRow: any = null;
  let currentLedgerRows: any[] = [];

  function reset() {
    calls.getStayById = [];
    calls.saveStayDetails = [];
    calls.finalizeCheckout = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.listTransactionsByStay = [];
    calls.recordTransaction = [];
    calls.insertAdvanceTransaction = [];
    calls.recordRefundWithInvoice = [];
    calls.paymentsInsert = [];
    currentStayRow = null;
    currentLedgerRows = [];
  }

  return { calls, reset, get currentStayRow() { return currentStayRow; }, set currentStayRow(v: any) { currentStayRow = v; }, get currentLedgerRows() { return currentLedgerRows; }, set currentLedgerRows(v: any[]) { currentLedgerRows = v; } };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      return H.currentStayRow;
    }),
    // Mirrors the row-locked `save_stay_details()` RPC: derives nights from
    // the submitted end date, replaces the total, pins `original_total_*` on
    // first application only, flags `early_checkout_applied` when the
    // submission shortens the stay, and NEVER touches `status` (Req 12.9).
    saveStayDetails: vi.fn(async (input: any) => {
      calls.saveStayDetails.push(input);
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
      return {
        ok: true as const,
        stay: { ...updated },
        historyRecorded: changed,
      };
    }),
    // Should NEVER be called by saveStayDetails — assertions verify this.
    finalizeCheckout: vi.fn(async (stayId: string) => {
      calls.finalizeCheckout.push(stayId);
      throw new Error(
        "finalizeCheckout must NEVER be called by saveStayDetails"
      );
    }),
    attachFinalInvoice: vi.fn(async (stayId: string, paymentId: string) => {
      calls.attachFinalInvoice.push({ stayId, paymentId });
      throw new Error(
        "attachFinalInvoice must NEVER be called by saveStayDetails"
      );
    }),
    recordFinalInvoiceFailure: vi.fn(
      async (stayId: string, message: string) => {
        calls.recordFinalInvoiceFailure.push({ stayId, message });
        throw new Error(
          "recordFinalInvoiceFailure must NEVER be called by saveStayDetails"
        );
      }
    ),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    listTransactionsByStay: vi.fn(async (stayId: string) => {
      calls.listTransactionsByStay.push(stayId);
      return H.currentLedgerRows;
    }),
    // Should NEVER be called by saveStayDetails — no payment rows written.
    recordTransaction: vi.fn(async (input: any) => {
      calls.recordTransaction.push(input);
      throw new Error(
        "recordTransaction must NEVER be called by saveStayDetails"
      );
    }),
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      throw new Error(
        "insertAdvanceTransaction must NEVER be called by saveStayDetails"
      );
    }),
    recordRefundWithInvoice: vi.fn(async (input: any) => {
      calls.recordRefundWithInvoice.push(input);
      throw new Error(
        "recordRefundWithInvoice must NEVER be called by saveStayDetails"
      );
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "payments") {
        return {
          insert(row: Record<string, unknown>) {
            H.calls.paymentsInsert.push(row);
            throw new Error(
              "payments insert must NEVER be called by saveStayDetails"
            );
          },
        };
      }
      throw new Error(`Unexpected table in fake admin client: ${table}`);
    },
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { saveStayDetails } from "@/services/AccommodationService";
import type { StayEntry } from "@/types/accommodation";
import type { StayEntryRow } from "@/repositories/stayRepository";
import {
  arbActiveBillableStayEntry,
  arbLedgerWith,
  arbValidRecalculateStaySubmission,
  arbTransactionSeed,
  materializeTransaction,
  REFERENCE_TODAY_IST,
  shiftISODate,
  computeReferenceEndDate,
  referenceGstBreakup,
  fixtureUuid,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  REFERENCE_TAX_PERCENTAGE,
  arbTotalStayAmount,
  roundToPaise,
} from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts a generated domain `StayEntry` into the snake_case row shape the
 * mocked repositories deal in. */
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

// ─── Property 24 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 24: Save Stay Details never transitions status and never invoices", () => {
  it("status is always ACTIVE, nextAction is never CHECKED_OUT, finalizeCheckout is never called, generateFinalInvoice is never called, and no payments row is ever written — for any valid submission", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbActiveBillableStayEntry,
        arbValidRecalculateStaySubmission,
        arbLedgerWith({ minLength: 0, maxLength: 10 }),
        async (stay, submission, ledger) => {
          H.reset();

          // Override the stay to match the submission's dates so the
          // submission is valid against this stay's bounds.
          const adaptedStay: StayEntry = {
            ...stay,
            startDate: submission.startDate,
            totalNights:
              Math.round(
                (new Date(submission.bookedEndDate).getTime() -
                  new Date(submission.startDate).getTime()) /
                  86_400_000
              ) + 1,
            endDate: submission.bookedEndDate,
          };

          const row = rowFromDomainStay(adaptedStay);
          H.currentStayRow = row;

          // Build the ledger rows in snake_case for the repository mock.
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

          const result = await saveStayDetails(
            adaptedStay.id,
            submission.recalculatedEndDate,
            submission.recalculatedStayAmount
          );

          // ─── Invariant 1: returned status is always "ACTIVE" ──────────
          expect("ok" in result && (result as any).ok === false).toBe(false);
          if (!("ok" in result && (result as any).ok === false)) {
            expect(result.status).toBe("ACTIVE");
          }

          // ─── Invariant 2: nextAction is never "CHECKED_OUT" ───────────
          if (!("ok" in result && (result as any).ok === false)) {
            expect(["COLLECT_BALANCE", "RECORD_REFUND", "SETTLED"]).toContain(
              result.nextAction
            );
            expect((result as any).nextAction).not.toBe("CHECKED_OUT");
          }

          // ─── Invariant 3: finalizeCheckout is NEVER called ────────────
          expect(calls.finalizeCheckout).toHaveLength(0);

          // ─── Invariant 4: generateFinalInvoice is NEVER called ────────
          // (checked by attachFinalInvoice which is the downstream step
          // generateFinalInvoice would trigger)
          expect(calls.attachFinalInvoice).toHaveLength(0);
          expect(calls.recordFinalInvoiceFailure).toHaveLength(0);

          // ─── Invariant 5: no `payments` row is ever written ───────────
          expect(calls.paymentsInsert).toHaveLength(0);
          expect(calls.recordTransaction).toHaveLength(0);
          expect(calls.insertAdvanceTransaction).toHaveLength(0);
          expect(calls.recordRefundWithInvoice).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("CRITICAL: the settled, end-date-reached state (balance exactly zero, today >= end date) — which the retired earlyCheckout would have checked out — still does NOT transition status or invoice", async () => {
    // This generator arm deliberately constructs the EXACT scenario that the
    // old `earlyCheckout` code would have triggered an immediate checkout:
    // - The stay is ACTIVE
    // - The recalculated amount equals Total_Paid exactly (balance = 0)
    // - The recalculated end date has been reached (today >= end date)
    // Under the new architecture, Save Stay Details STILL only persists the
    // numbers — checkout remains a separate, deliberate admin step.
    await fc.assert(
      fc.asyncProperty(
        arbTotalStayAmount,
        fc.integer({ min: 1, max: 60 }),
        async (totalPaid, nightsFromToday) => {
          H.reset();

          // Build an ACTIVE stay whose end date is in the past or today
          // (nightsFromToday days before today).
          const startDate = shiftISODate(
            REFERENCE_TODAY_IST,
            -(nightsFromToday + 5)
          );
          const bookedTotalNights = nightsFromToday + 5;
          const bookedEndDate = computeReferenceEndDate(
            startDate,
            bookedTotalNights
          );

          // The recalculated end date is today or earlier — the stay has
          // "reached its end date".
          const recalculatedEndDate = shiftISODate(
            REFERENCE_TODAY_IST,
            -nightsFromToday
          );
          // The recalculated amount equals Total_Paid exactly — balance is 0.
          const recalculatedStayAmount = Math.round(totalPaid);
          // Avoid amount out of range
          const clampedAmount = Math.max(
            1,
            Math.min(9_999_999, recalculatedStayAmount)
          );

          const gst = referenceGstBreakup(clampedAmount);
          const row: StayEntryRow = {
            id: DEFAULT_STAY_ID,
            customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
            start_date: startDate,
            total_nights: bookedTotalNights,
            stay_type: "AC Villa",
            occupancy_type: "Single",
            status: "ACTIVE",
            payment_amount: clampedAmount + 5000, // original amount different
            base_amount: gst.baseAmount,
            tax_amount: gst.taxAmount,
            tax_percentage: REFERENCE_TAX_PERCENTAGE,
            payment_host_profile_id: null,
            meal_preference: "VEG",
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2025-01-10T00:00:00.000Z",
            is_backdated: false,
            early_checkout_applied: false,
            actual_nights_stayed: null,
            original_total_nights: null,
            original_total_amount: null,
            recalculation_applied: false,
            checked_out_at: null,
            final_invoice_payment_id: null,
            final_invoice_generated_at: null,
            final_invoice_error: null,
          };
          H.currentStayRow = row;

          // Construct a ledger where Total_Paid exactly equals
          // the recalculated amount (balance will be zero).
          const advanceRow = {
            id: fixtureUuid(44, 1),
            stay_entry_id: DEFAULT_STAY_ID,
            customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
            transaction_type: "ADVANCE",
            amount: roundToPaise(clampedAmount),
            transaction_date: startDate,
            comment: null,
            remark: null,
            created_by: null,
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2025-01-01T00:00:00.000Z",
          };
          H.currentLedgerRows = [advanceRow];

          const result = await saveStayDetails(
            DEFAULT_STAY_ID,
            recalculatedEndDate,
            clampedAmount
          );

          // The old code would have invoked `checkoutStay` here because
          // balance === 0 and nights match. The new code MUST NOT.

          // ─── Invariant 1: status is "ACTIVE" ──────────────────────────
          expect("ok" in result && (result as any).ok === false).toBe(false);
          if (!("ok" in result && (result as any).ok === false)) {
            expect(result.status).toBe("ACTIVE");
          }

          // ─── Invariant 2: nextAction is "SETTLED" (balance zero), never
          // "CHECKED_OUT" ─────────────────────────────────────────────────
          if (!("ok" in result && (result as any).ok === false)) {
            expect(result.nextAction).toBe("SETTLED");
            expect((result as any).nextAction).not.toBe("CHECKED_OUT");
          }

          // ─── Invariant 3: finalizeCheckout NEVER called ───────────────
          expect(calls.finalizeCheckout).toHaveLength(0);

          // ─── Invariant 4: no invoice generated ────────────────────────
          expect(calls.attachFinalInvoice).toHaveLength(0);
          expect(calls.recordFinalInvoiceFailure).toHaveLength(0);

          // ─── Invariant 5: no payments row written ─────────────────────
          expect(calls.paymentsInsert).toHaveLength(0);
          expect(calls.recordTransaction).toHaveLength(0);
          expect(calls.insertAdvanceTransaction).toHaveLength(0);
          expect(calls.recordRefundWithInvoice).toHaveLength(0);

          // ─── The stay row itself is still ACTIVE ──────────────────────
          expect(H.currentStayRow.status).toBe("ACTIVE");
          expect(H.currentStayRow.checked_out_at).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
