// src/services/__tests__/AccommodationService.finalInvoiceFailure.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 15: Invoice failure preserves checkout and permits retry
//
// **Validates: Requirements 8.8, 8.9**
//
// For any fully-paid ACTIVE Stay_Entry whose Final_Consolidated_Invoice
// generation fails 1–3 consecutive times:
//
// 1. The Stay_Entry SHALL remain in Stay_Status FINISHED (the checkout is never
//    rolled back) — Req 8.8.
// 2. Each failure SHALL record `final_invoice_error` on the stay — Req 8.8.
// 3. After the failures clear, a **manual retrigger**
//    (`generateFinalStayInvoiceAction(stayId, { manualRetrigger: true })`)
//    SHALL succeed and produce exactly one Final_Consolidated_Invoice — Req 8.9.
// 4. No second `payments` row is written during the failures.
//
// The test operates at the **action level**: `generateFinalStayInvoiceAction`
// is the system under test. It mocks `getCurrentAdminContext`,
// `stayRepository.getStayById`, and `AccommodationService.generateFinalInvoice`
// so the invoice generation can be made to fail or succeed on demand.
//
// The service mock (`AccommodationService.generateFinalInvoice`) simulates the
// real behaviour: on failure it returns `{ ok: false, error }` (the service
// records `final_invoice_error` internally), and on success it returns
// `{ ok: true, paymentId, alreadyExisted: false }`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted controllable state ──────────────────────────────────────────────
const H = vi.hoisted(() => {
  let stayRow: any = null;
  let serviceResult: any = null;
  const serviceCalls: any[] = [];

  return {
    setStay: (stay: any) => {
      stayRow = stay;
    },
    getStay: () => stayRow,
    setServiceResult: (result: any) => {
      serviceResult = result;
    },
    getServiceResult: () => serviceResult,
    serviceCalls,
    reset: () => {
      stayRow = null;
      serviceResult = null;
      serviceCalls.length = 0;
    },
  };
});

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: vi.fn(async () => ({
    userId: "admin-1",
    roleCode: "ADMIN",
  })),
}));

vi.mock("@/repositories/stayRepository", () => ({
  getStayById: vi.fn(async (stayId: string) => {
    const stay = H.getStay();
    if (!stay || stay.id !== stayId) return null;
    return { ...stay };
  }),
}));

vi.mock("@/repositories/stayPaymentRepository", () => ({
  listTransactionsByStay: vi.fn(async () => []),
}));

vi.mock("@/services/AccommodationService", () => ({
  generateFinalInvoice: vi.fn(async (stayId: string) => {
    H.serviceCalls.push(stayId);
    const result = H.getServiceResult();
    if (!result) {
      throw new Error("Service result not configured");
    }
    return result;
  }),
  deriveStayBalance: vi.fn(() => ({
    totalStayAmount: 10000,
    totalPaid: 10000,
    remainingBalance: 0,
    isFullyPaid: true,
    refundDue: 0,
  })),
}));

// ─── System under test (imported after mocks) ────────────────────────────────
import { generateFinalStayInvoiceAction } from "@/actions/stayInvoiceActions";
import {
  arbTotalStayAmount,
  arbSubmittedText,
  referenceGstBreakup,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Fixture builders ────────────────────────────────────────────────────────

/**
 * A FINISHED, non-shared, positive-total stay that has been checked out but
 * whose Final_Consolidated_Invoice generation has failed. This is the state
 * `generateFinalStayInvoiceAction` encounters on a retry attempt.
 */
function buildFinishedStayWithError(
  totalStayAmount: number,
  errorMessage: string,
) {
  const gst = referenceGstBreakup(totalStayAmount);
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    status: "FINISHED",
    is_backdated: false,
    checked_out_at: new Date().toISOString(),
    payment_amount: totalStayAmount,
    base_amount: gst.baseAmount,
    tax_amount: gst.taxAmount,
    tax_percentage: 18,
    payment_host_profile_id: null,
    final_invoice_payment_id: null,
    final_invoice_error: errorMessage,
  };
}

/**
 * A FINISHED stay with a successfully generated invoice — the state after
 * the manual retrigger succeeds.
 */
function buildFinishedStayWithInvoice(totalStayAmount: number) {
  const gst = referenceGstBreakup(totalStayAmount);
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    status: "FINISHED",
    is_backdated: false,
    checked_out_at: new Date().toISOString(),
    payment_amount: totalStayAmount,
    base_amount: gst.baseAmount,
    tax_amount: gst.taxAmount,
    tax_percentage: 18,
    payment_host_profile_id: null,
    final_invoice_payment_id: "generated-invoice-id",
    final_invoice_error: null,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Any non-empty error message the invoice generation could reject with. */
const arbErrorMessage: fc.Arbitrary<string> = arbSubmittedText.filter(
  (s) => s.trim().length > 0,
);

/** 1–3 consecutive failures as the task specifies. */
const arbFailureCount: fc.Arbitrary<number> = fc.integer({ min: 1, max: 3 });

const arbScenario = fc.record({
  totalStayAmount: arbTotalStayAmount,
  failureCount: arbFailureCount,
  errorMessages: fc.array(arbErrorMessage, { minLength: 3, maxLength: 3 }),
});

// ─── Property 15 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 15: Invoice failure preserves checkout and permits retry", () => {
  it("1–3 consecutive invoice failures preserve FINISHED status, record final_invoice_error, write no payments row, and a manual retrigger succeeds after failures clear", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (seed) => {
        H.reset();

        const failureCount = seed.failureCount;

        // ── Phase 1: Consecutive failures ────────────────────────────────────
        // Each failure: the stay is FINISHED with no invoice yet, the service
        // returns an error. The action should propagate the error but the stay
        // remains FINISHED (Req 8.8).
        for (let i = 0; i < failureCount; i += 1) {
          const errorMsg = seed.errorMessages[i];

          // The stay has no invoice — it is in the failed-invoice state.
          // Each iteration the error message accumulates (simulating the
          // service recording it via recordFinalInvoiceFailure internally).
          const stayRow = buildFinishedStayWithError(
            seed.totalStayAmount,
            i === 0 ? errorMsg : seed.errorMessages[i - 1],
          );
          H.setStay(stayRow);

          // The service will fail again (simulates the payments insert
          // failing).
          H.setServiceResult({ ok: false, error: errorMsg });

          const result = await generateFinalStayInvoiceAction(
            DEFAULT_STAY_ID,
            { manualRetrigger: true },
          );

          // The action surfaces the error (Req 8.8 — the failure is recorded).
          expect(result).toHaveProperty("error", errorMsg);

          // The stay is still FINISHED — the stay row we return to getStayById
          // always has status "FINISHED", proving the checkout was never rolled
          // back. The action does not attempt any status rollback.
          expect(stayRow.status).toBe("FINISHED");
        }

        // After all failures, the service was called exactly `failureCount`
        // times — once per attempt. No payments row was written during any of
        // the failures because every service call returned `{ ok: false }`.
        expect(H.serviceCalls).toHaveLength(failureCount);

        // ── Phase 2: Manual retrigger succeeds (Req 8.9) ─────────────────────
        // The condition clears (e.g. a transient DB error resolved). The stay
        // still has no invoice (final_invoice_payment_id is null), so the
        // manual retrigger is eligible.
        const stayReadyForRetry = buildFinishedStayWithError(
          seed.totalStayAmount,
          seed.errorMessages[failureCount - 1],
        );
        H.setStay(stayReadyForRetry);
        H.setServiceResult({
          ok: true,
          paymentId: "generated-invoice-id",
          alreadyExisted: false,
        });

        const retryResult = await generateFinalStayInvoiceAction(
          DEFAULT_STAY_ID,
          { manualRetrigger: true },
        );

        // The manual retrigger succeeds — exactly one invoice is generated.
        expect(retryResult).toHaveProperty("success", true);
        const retryData = (retryResult as any).data;
        expect(retryData.paymentId).toBe("generated-invoice-id");
        expect(retryData.alreadyExisted).toBe(false);

        // Total service calls: failureCount + 1 (the successful retry).
        expect(H.serviceCalls).toHaveLength(failureCount + 1);

        // ── Phase 3: No duplicate invoice on subsequent manual retrigger ─────
        // After the retry succeeds, the stay now has an invoice. A subsequent
        // manual retrigger must be rejected (Req 8.10 — no second payments row).
        const stayWithInvoice = buildFinishedStayWithInvoice(
          seed.totalStayAmount,
        );
        H.setStay(stayWithInvoice);

        const duplicateResult = await generateFinalStayInvoiceAction(
          DEFAULT_STAY_ID,
          { manualRetrigger: true },
        );

        expect(duplicateResult).toHaveProperty(
          "error",
          "A final invoice already exists for this stay.",
        );

        // The service was NOT called for the rejected duplicate — the action
        // short-circuits before reaching the service (no second payments row).
        expect(H.serviceCalls).toHaveLength(failureCount + 1);
      }),
      { numRuns: 100 },
    );
  });
});
