// src/services/__tests__/AccommodationService.finalInvoiceFailure.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 15: Invoice failure preserves checkout and permits retry
//
// **Validates: Requirements 8.7**
//
// For any fully-paid ACTIVE Stay_Entry whose Final_Consolidated_Invoice
// generation fails, the stay SHALL remain in Stay_Status FINISHED, the
// failure SHALL be recorded against the stay, no invoice SHALL exist, and a
// subsequent manual generation attempt SHALL succeed in producing exactly
// one Final_Consolidated_Invoice.
//
// `checkoutStay` calls `stayRepository.finalizeCheckout` FIRST — committing
// the FINISHED status transition — and only AFTER that commit calls
// `generateFinalInvoice`, which may fail on the `payments` insert. On insert
// failure, `generateFinalInvoice` calls
// `stayRepository.recordFinalInvoiceFailure(stayId, message)` and returns
// `{ ok: false, error }` without throwing and without touching the FINISHED
// status. `checkoutStay` maps that failure to `invoiceStatus: "PENDING_RETRY"`
// but still reports `{ ok: true, status: "FINISHED", ... }` (design decision
// 8) — checkout succeeds regardless of the invoice outcome.
//
// `@/repositories/stayRepository` (`finalizeCheckout`, `getStayById`,
// `attachFinalInvoice`, `recordFinalInvoiceFailure`) and
// `@/lib/supabase/admin`'s `createAdminClient` are MOCKED here (no live
// database connection) so the `payments` insert inside `generateFinalInvoice`
// can be made to fail or succeed on demand, mirroring the repository-mocking
// convention used in `AccommodationService.createStay.property.test.ts`
// (task 5.2) and the fake-admin-client convention used in
// `franchise-dietitian-cardinality.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log + fake admin client (hoisted so vi.mock
// factories can close over it) ────────────────────────────────────────────────
const H = vi.hoisted(() => {
  const calls: any = {
    finalizeCheckout: [] as string[],
    getStayById: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    paymentsInsert: [] as any[],
  };

  const state: {
    currentStayRow: any;
    shouldFail: boolean;
    injectedError: any;
    paymentSeq: number;
  } = {
    currentStayRow: null,
    shouldFail: false,
    injectedError: null,
    paymentSeq: 0,
  };

  function reset() {
    calls.finalizeCheckout = [];
    calls.getStayById = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.paymentsInsert = [];
    state.currentStayRow = null;
    state.shouldFail = false;
    state.injectedError = null;
    state.paymentSeq = 0;
  }

  /** A fake admin client whose ONLY modelled table is `payments`, since that
   * is the sole `createAdminClient()` call made by `generateFinalInvoice`. */
  function makeFakeAdmin() {
    return {
      from: (table: string) => {
        if (table !== "payments") {
          throw new Error(`Unexpected table access in test fake: ${table}`);
        }
        return {
          insert: (payload: any) => {
            calls.paymentsInsert.push(payload);
            return {
              select: (_cols?: string) => ({
                single: async () => {
                  if (state.shouldFail) {
                    return { data: null, error: state.injectedError };
                  }
                  state.paymentSeq += 1;
                  return {
                    data: { id: `payment-${state.paymentSeq}` },
                    error: null,
                  };
                },
              }),
            };
          },
        };
      },
    };
  }

  reset();
  return { calls, state, reset, makeFakeAdmin };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls, state } = H;
  return {
    ...actual,
    finalizeCheckout: vi.fn(async (stayId: string) => {
      calls.finalizeCheckout.push(stayId);
      // Simulates the row-locked RPC having already committed the
      // ACTIVE -> FINISHED transition for a fully-paid stay.
      return { ok: true, stay: state.currentStayRow };
    }),
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      return state.currentStayRow;
    }),
    attachFinalInvoice: vi.fn(async (stayId: string, paymentId: string) => {
      calls.attachFinalInvoice.push({ stayId, paymentId });
    }),
    recordFinalInvoiceFailure: vi.fn(
      async (stayId: string, message: string) => {
        calls.recordFinalInvoiceFailure.push({ stayId, message });
      }
    ),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { checkoutStay, generateFinalInvoice, gstFromTotal } from "@/services/AccommodationService";
import type { StayEntryRow } from "@/repositories/stayRepository";
import {
  arbTotalStayAmount,
  arbSubmittedText,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  REFERENCE_TODAY_IST,
} from "@/test/accommodation/paymentArbitraries";

const { calls, state } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A fully-paid, non-shared, positive-total stay that has already committed
 * its ACTIVE -> FINISHED transition (as `finalizeCheckout` would have done)
 * but has no Final_Consolidated_Invoice yet — exactly the state
 * `generateFinalInvoice` observes when `checkoutStay` calls it right after
 * the status commit.
 */
function buildFinishedUninvoicedStayRow(totalStayAmount: number): StayEntryRow {
  const gst = gstFromTotal(totalStayAmount);
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    start_date: REFERENCE_TODAY_IST,
    total_nights: 5,
    stay_type: "AC Villa",
    occupancy_type: "Single",
    status: "FINISHED",
    payment_amount: totalStayAmount,
    base_amount: gst.baseAmount,
    tax_amount: gst.taxAmount,
    tax_percentage: 18,
    payment_host_profile_id: null,
    meal_preference: "VEG",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_backdated: false,
    early_checkout_applied: false,
    actual_nights_stayed: null,
    original_total_nights: null,
    original_total_amount: null,
    checked_out_at: new Date().toISOString(),
    final_invoice_payment_id: null,
    final_invoice_generated_at: null,
    final_invoice_error: null,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Any non-empty error message/shape the `payments` insert could reject with. */
const arbErrorMessage: fc.Arbitrary<string> = arbSubmittedText.filter(
  (s) => s.trim().length > 0
);

const arbScenario = fc.record({
  totalStayAmount: arbTotalStayAmount,
  errorMessage: arbErrorMessage,
});

// ─── Property 15 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 15: Invoice failure preserves checkout and permits retry", () => {
  it("preserves the FINISHED status, records the invoice failure, and permits a successful manual retry", async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (seed) => {
        H.reset();

        const stayRow = buildFinishedUninvoicedStayRow(seed.totalStayAmount);
        state.currentStayRow = stayRow;

        // ── 1 & 2: finalizeCheckout commits, the payments insert fails. ──────
        state.shouldFail = true;
        state.injectedError = { message: seed.errorMessage };

        const checkoutResult = await checkoutStay(DEFAULT_STAY_ID);

        // finalizeCheckout was invoked exactly once (the status transition
        // commits before invoice generation is attempted).
        expect(calls.finalizeCheckout).toEqual([DEFAULT_STAY_ID]);

        // 3. recordFinalInvoiceFailure called exactly once with the stay id
        // and a non-empty error message.
        expect(calls.recordFinalInvoiceFailure).toHaveLength(1);
        expect(calls.recordFinalInvoiceFailure[0].stayId).toBe(
          DEFAULT_STAY_ID
        );
        expect(calls.recordFinalInvoiceFailure[0].message.length).toBeGreaterThan(
          0
        );
        expect(calls.recordFinalInvoiceFailure[0].message).toBe(
          seed.errorMessage
        );

        // 4. checkoutStay reports success — FINISHED, invoice pending retry —
        // regardless of the invoice failure (design decision 8).
        expect(checkoutResult).toEqual({
          ok: true,
          status: "FINISHED",
          invoiceStatus: "PENDING_RETRY",
        });

        // 5. attachFinalInvoice was never called — no invoice was linked.
        expect(calls.attachFinalInvoice).toHaveLength(0);

        // ── 6. Manual retry: the payments insert now succeeds. ──────────────
        state.shouldFail = false;

        const retryResult = await generateFinalInvoice(DEFAULT_STAY_ID);

        expect(retryResult.ok).toBe(true);
        if (retryResult.ok && "paymentId" in retryResult) {
          expect(retryResult.paymentId).toBeTruthy();
          expect(retryResult.alreadyExisted).toBe(false);
          expect(calls.attachFinalInvoice).toHaveLength(1);
          expect(calls.attachFinalInvoice[0].stayId).toBe(DEFAULT_STAY_ID);
          expect(calls.attachFinalInvoice[0].paymentId).toBe(
            retryResult.paymentId
          );
        } else {
          throw new Error(
            "Expected the retried generateFinalInvoice call to succeed with a paymentId"
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
