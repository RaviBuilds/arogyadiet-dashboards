// src/services/__tests__/AccommodationService.createStay.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 6: Onboarding creates the advance transaction exactly when due
//
// **Validates: Requirements 4.5, 4.6, 4.7, 6.1**
//
// For any accommodation onboarding input, creating the Stay_Entry SHALL set
// Total_Stay_Amount to the entered total stay amount and create exactly one
// ADVANCE Payment_Transaction — with the entered advance amount and the
// current IST date — if and only if shared payment is disabled and the
// advance amount is greater than zero. When the advance is zero, no
// Payment_Transaction SHALL exist. When shared payment is enabled, neither a
// Total_Stay_Amount nor any Payment_Transaction SHALL be created.
//
// `AccommodationService.createStay` performs real DB writes via
// `stayRepository.createStayEntry` and `stayPaymentRepository.insertAdvanceTransaction`,
// both of which call `createAdminClient()`. Both repositories are mocked here
// (no live database connection) so the property is checked purely against the
// captured call arguments, mirroring the repository-mocking convention used in
// `creation-atomicity.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const calls: any = {
    createStayEntry: [] as any[],
    deleteStayEntry: [] as string[],
    insertAdvanceTransaction: [] as any[],
  };
  let seq = 0;

  function reset() {
    calls.createStayEntry = [];
    calls.deleteStayEntry = [];
    calls.insertAdvanceTransaction = [];
    seq = 0;
  }

  function nextId(prefix: string) {
    seq += 1;
    return `${prefix}-${seq}`;
  }

  return { calls, reset, nextId };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls, nextId } = H;
  return {
    ...actual,
    createStayEntry: vi.fn(async (input: any) => {
      calls.createStayEntry.push(input);
      const id = nextId("stay");
      return {
        id,
        customer_profile_id: input.customer_profile_id,
        start_date: input.start_date,
        total_nights: input.total_nights,
        stay_type: input.stay_type,
        occupancy_type: input.occupancy_type,
        status: input.status,
        payment_amount: input.payment_amount ?? null,
        base_amount: input.base_amount ?? null,
        tax_amount: input.tax_amount ?? null,
        tax_percentage: input.tax_percentage ?? 18,
        payment_host_profile_id: input.payment_host_profile_id ?? null,
        meal_preference: input.meal_preference,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_backdated: input.is_backdated ?? false,
        early_checkout_applied: false,
        actual_nights_stayed: null,
        original_total_nights: null,
        original_total_amount: null,
        checked_out_at: null,
        final_invoice_payment_id: null,
        final_invoice_generated_at: null,
        final_invoice_error: null,
      };
    }),
    deleteStayEntry: vi.fn(async (stayId: string) => {
      calls.deleteStayEntry.push(stayId);
    }),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls, nextId } = H;
  return {
    ...actual,
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      const id = nextId("tx");
      return {
        id,
        stay_entry_id: input.stayEntryId,
        customer_profile_id: input.customerProfileId,
        transaction_type: "ADVANCE",
        amount: input.amount,
        transaction_date: input.transactionDate,
        comment: null,
        remark: null,
        created_by: input.createdBy ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }),
    listTransactionsByStay: vi.fn(async () => []),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { createStay, gstFromTotal } from "@/services/AccommodationService";
import { getISTDateString } from "@/lib/dates/ist";
import {
  arbTotalStayAmount,
  arbMoney,
  arbStartDateAround,
  arbTotalNights,
  REFERENCE_TODAY_IST,
  PAYMENT_HOST_PROFILE_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/** Advance amount: zero (the "no advance" branch) or any money value. */
const arbAdvanceAmount = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: arbMoney, weight: 3 },
);

const arbCreateStaySeed = fc.record({
  sharedPayment: fc.boolean(),
  totalStayAmount: arbTotalStayAmount,
  advanceAmountPaid: arbAdvanceAmount,
  startDate: arbStartDateAround(REFERENCE_TODAY_IST),
  totalNights: arbTotalNights,
});

// ─── Property 6 ──────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 6: Onboarding creates the advance transaction exactly when due", () => {
  it("sets Total_Stay_Amount and creates exactly one ADVANCE transaction iff shared payment is off and advance > 0", async () => {
    await fc.assert(
      fc.asyncProperty(arbCreateStaySeed, async (seed) => {
        H.reset();

        const paymentHostProfileId = seed.sharedPayment
          ? PAYMENT_HOST_PROFILE_ID
          : null;

        const stay = await createStay({
          customerProfileId: DEFAULT_CUSTOMER_PROFILE_ID,
          startDate: seed.startDate,
          totalNights: seed.totalNights,
          stayType: "AC Villa",
          occupancyType: "Single",
          mealPreference: "VEG",
          paymentAmount: null,
          paymentHostProfileId,
          totalStayAmount: seed.totalStayAmount,
          advanceAmountPaid: seed.advanceAmountPaid,
        });

        // The stay row is always created exactly once.
        expect(calls.createStayEntry).toHaveLength(1);
        const createdInput = calls.createStayEntry[0];

        if (seed.sharedPayment) {
          // Shared payment: neither a Total_Stay_Amount nor any
          // Payment_Transaction is created, regardless of the advance amount
          // (Req 4.7).
          expect(createdInput.payment_amount).toBeNull();
          expect(createdInput.base_amount).toBeNull();
          expect(createdInput.tax_amount).toBeNull();
          expect(stay.payment_amount).toBeNull();
          expect(calls.insertAdvanceTransaction).toHaveLength(0);
          return;
        }

        // Not shared payment: Total_Stay_Amount is always set to the entered
        // total (Req 4.5, 4.6), with its GST breakup derived via the single
        // canonical `gstFromTotal` path (Req 4.8).
        expect(createdInput.payment_amount).toBe(seed.totalStayAmount);
        expect(stay.payment_amount).toBe(seed.totalStayAmount);
        const expectedGst = gstFromTotal(seed.totalStayAmount);
        expect(createdInput.base_amount).toBe(expectedGst.baseAmount);
        expect(createdInput.tax_amount).toBe(expectedGst.taxAmount);

        if (seed.advanceAmountPaid > 0) {
          // Advance > 0 and shared payment off ⇒ exactly one ADVANCE row,
          // with the entered advance amount and the current IST date
          // (Req 4.5, 6.1).
          expect(calls.insertAdvanceTransaction).toHaveLength(1);
          const advanceCall = calls.insertAdvanceTransaction[0];
          expect(advanceCall.amount).toBe(seed.advanceAmountPaid);
          expect(advanceCall.stayEntryId).toBe(stay.id);
          expect(advanceCall.customerProfileId).toBe(DEFAULT_CUSTOMER_PROFILE_ID);
          expect(advanceCall.transactionDate).toBe(getISTDateString(0));
        } else {
          // Advance is zero ⇒ no Payment_Transaction exists (Req 4.6).
          expect(calls.insertAdvanceTransaction).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
