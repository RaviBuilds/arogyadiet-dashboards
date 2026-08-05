// src/services/__tests__/AccommodationService.statusGate.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 19: Extension and early checkout require an ACTIVE stay
//
// **Validates: Requirements 11.5, 12.14**
//
// For any Stay_Entry whose Stay_Status is not ACTIVE — including one already
// finished via Early_Checkout — both Stay_Extension (`extendStay`) and
// Early_Checkout (`earlyCheckout`) SHALL be rejected with a status-based
// error, and the stay's nights, Total_Stay_Amount, status, and ledger SHALL
// remain unchanged.
//
// `AccommodationService.extendStay` delegates the ACTIVE gate to
// `stayRepository.extendStay`, which fetches the current row and THROWS when
// `current.status !== 'ACTIVE'` (task 4.2's defensive check). This test mocks
// `stayRepository.extendStay` to faithfully replicate that real throw-on-
// non-ACTIVE behaviour, so the property exercises the SERVICE's behaviour of
// propagating (not swallowing) that rejection.
//
// `AccommodationService.earlyCheckout` fetches the stay via
// `stayRepository.getStayById` and itself returns `{ ok: false, error: "Only
// active stays can be checked out early." }` — a returned rejection, not a
// throw — when `stayRow.status !== "ACTIVE"` (task 5.5's implementation).
//
// Both repositories are mocked here (no live database connection), mirroring
// the mocking convention used in `AccommodationService.createStay.property.test.ts`
// and `AccommodationService.extendStay.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const calls: any = {
    getStayById: [] as string[],
    extendStay: [] as any[],
    applyEarlyCheckout: [] as any[],
    finalizeCheckout: [] as string[],
    listTransactionsByStay: [] as string[],
    recordTransaction: [] as any[],
    insertAdvanceTransaction: [] as any[],
    recordExtension: [] as any[],
  };

  function reset() {
    calls.getStayById = [];
    calls.extendStay = [];
    calls.applyEarlyCheckout = [];
    calls.finalizeCheckout = [];
    calls.listTransactionsByStay = [];
    calls.recordTransaction = [];
    calls.insertAdvanceTransaction = [];
    calls.recordExtension = [];
  }

  return { calls, reset };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      return (H as any).currentStayRow;
    }),
    // Faithfully replicates the real repository's throw-on-non-ACTIVE
    // defensive check (task 4.2), so the property exercises the SERVICE's
    // propagation of that rejection rather than re-deriving the repository's
    // own logic.
    extendStay: vi.fn(
      async (
        stayId: string,
        additionalNights: number,
        newTotalStayAmount: number,
        newBaseAmount: number,
        newTaxAmount: number
      ) => {
        calls.extendStay.push({
          stayId,
          additionalNights,
          newTotalStayAmount,
          newBaseAmount,
          newTaxAmount,
        });
        const current = (H as any).currentStayRow;
        if (current.status !== "ACTIVE") {
          throw new Error(
            `Cannot extend stay ${stayId}: only active stays can be extended (current status: ${current.status})`
          );
        }
        return {
          ...current,
          total_nights: current.total_nights + additionalNights,
          payment_amount: newTotalStayAmount,
          base_amount: newBaseAmount,
          tax_amount: newTaxAmount,
        };
      }
    ),
    applyEarlyCheckout: vi.fn(
      async (
        stayId: string,
        actualNightsStayed: number,
        recalculatedStayAmount: number,
        gst: { baseAmount: number; taxAmount: number }
      ) => {
        calls.applyEarlyCheckout.push({
          stayId,
          actualNightsStayed,
          recalculatedStayAmount,
          gst,
        });
        const current = (H as any).currentStayRow;
        return {
          ...current,
          total_nights: actualNightsStayed,
          payment_amount: recalculatedStayAmount,
          base_amount: gst.baseAmount,
          tax_amount: gst.taxAmount,
          actual_nights_stayed: actualNightsStayed,
          early_checkout_applied: true,
        };
      }
    ),
    // Reached only via checkoutStay when nextStep === "CHECKED_OUT" — never
    // exercised by this property (rejection paths never reach it, and the
    // positive control keeps remainingBalance > 0). Throws if reached
    // unexpectedly, catching a wiring mistake in the test setup itself.
    finalizeCheckout: vi.fn(async (stayId: string) => {
      calls.finalizeCheckout.push(stayId);
      throw new Error(
        "finalizeCheckout should not be reached by this property's scenarios"
      );
    }),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    listTransactionsByStay: vi.fn(async (stayId: string) => {
      calls.listTransactionsByStay.push(stayId);
      return (H as any).currentLedgerRows ?? [];
    }),
    recordTransaction: vi.fn(async (input: any) => {
      calls.recordTransaction.push(input);
      throw new Error(
        "recordTransaction should not be called by extendStay/earlyCheckout"
      );
    }),
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      throw new Error(
        "insertAdvanceTransaction should not be called by extendStay/earlyCheckout"
      );
    }),
  };
});

// extendStay's rejection path never reaches the extension-history write —
// mocked so a wiring mistake that DID reach it would fail loudly.
vi.mock("@/repositories/stayExtensionHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    recordExtension: vi.fn(async (input: any) => {
      calls.recordExtension.push(input);
      throw new Error(
        "recordExtension should not be called when extendStay is rejected at the status gate"
      );
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { extendStay, earlyCheckout } from "@/services/AccommodationService";
import type { StayEntryRow } from "@/repositories/stayRepository";
import type { StayEntry } from "@/types/accommodation";
import {
  arbNonActiveStayEntry,
  arbActiveBillableStayEntry,
  arbMoney,
  arbTotalNights,
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
    checked_out_at: stay.checkedOutAt,
    final_invoice_payment_id: stay.finalInvoicePaymentId,
    final_invoice_generated_at: stay.finalInvoiceGeneratedAt,
    final_invoice_error: stay.finalInvoiceError,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbExtendRejectionSeed = fc.record({
  stay: arbNonActiveStayEntry,
  additionalNights: arbTotalNights, // [1, 365]
  additionalCostAmount: arbMoney,
});

const arbEarlyCheckoutRejectionSeed = fc.record({
  stay: arbNonActiveStayEntry,
  actualNightsStayed: fc.integer({ min: 1, max: 365 }),
  recalculatedStayAmount: arbMoney,
});

// ─── Property 19 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 19: Extension and early checkout require an ACTIVE stay", () => {
  it("extendStay rejects any non-ACTIVE stay — including one already finished via Early_Checkout — with a status-based error and no mutation", async () => {
    await fc.assert(
      fc.asyncProperty(arbExtendRejectionSeed, async (seed) => {
        H.reset();

        const row = rowFromDomainStay(seed.stay);
        (H as any).currentStayRow = row;
        (H as any).currentLedgerRows = [];

        await expect(
          extendStay(seed.stay.id, seed.additionalNights, seed.additionalCostAmount)
        ).rejects.toThrow(
          `Cannot extend stay ${seed.stay.id}: only active stays can be extended (current status: ${seed.stay.status})`
        );

        // The rejection propagates from the repository unchanged — the
        // service never reaches the ledger read or any Payment_Transaction
        // write that would follow a successful extension.
        expect(calls.listTransactionsByStay).toHaveLength(0);
        expect(calls.recordTransaction).toHaveLength(0);
        expect(calls.insertAdvanceTransaction).toHaveLength(0);
        expect(calls.applyEarlyCheckout).toHaveLength(0);
        expect(calls.finalizeCheckout).toHaveLength(0);
        expect(calls.recordExtension).toHaveLength(0);

        // The stay's nights, Total_Stay_Amount, and status remain unchanged.
        expect(row.total_nights).toBe(seed.stay.totalNights);
        expect(row.payment_amount).toBe(seed.stay.paymentAmount);
        expect(row.status).toBe(seed.stay.status);
      }),
      { numRuns: 100 }
    );
  });

  it('earlyCheckout rejects any non-ACTIVE stay — including one already finished via Early_Checkout — returning { ok: false, error: "Only active stays can be checked out early." } with no mutation', async () => {
    await fc.assert(
      fc.asyncProperty(arbEarlyCheckoutRejectionSeed, async (seed) => {
        H.reset();

        const row = rowFromDomainStay(seed.stay);
        (H as any).currentStayRow = row;
        (H as any).currentLedgerRows = [];

        const result = await earlyCheckout(
          seed.stay.id,
          seed.actualNightsStayed,
          seed.recalculatedStayAmount
        );

        // A returned rejection, not a throw.
        expect("error" in result).toBe(true);
        if ("error" in result) {
          expect(result.error).toBe(
            "Only active stays can be checked out early."
          );
        }

        // No mutation and no further processing — the math, the ledger read,
        // the persistence call, and any checkout/invoice follow-up are all
        // skipped once the status gate rejects.
        expect(calls.applyEarlyCheckout).toHaveLength(0);
        expect(calls.listTransactionsByStay).toHaveLength(0);
        expect(calls.finalizeCheckout).toHaveLength(0);
        expect(calls.recordTransaction).toHaveLength(0);
        expect(calls.insertAdvanceTransaction).toHaveLength(0);

        expect(row.total_nights).toBe(seed.stay.totalNights);
        expect(row.payment_amount).toBe(seed.stay.paymentAmount);
        expect(row.status).toBe(seed.stay.status);
      }),
      { numRuns: 100 }
    );
  });

  // Light positive control (not the main property): confirms the gate isn't
  // over-broad by checking an ACTIVE, not-yet-early-checked-out stay does
  // NOT hit the rejection path in `earlyCheckout`. Downstream math and
  // persistence are covered by Property 21's own test.
  it("does not reject an ACTIVE, not-yet-early-checked-out stay at the status gate (positive control)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ stay: arbActiveBillableStayEntry }),
        async (seed) => {
          H.reset();

          const row = rowFromDomainStay(seed.stay);
          (H as any).currentStayRow = row;
          // Empty ledger ⇒ totalPaid = 0 ⇒ remainingBalance =
          // recalculatedStayAmount > 0 ⇒ nextStep is always COLLECT_BALANCE,
          // never CHECKED_OUT — keeping this control focused on the gate
          // alone without needing to stand in for the invoice pipeline.
          (H as any).currentLedgerRows = [];

          const actualNightsStayed = Math.max(1, seed.stay.totalNights - 1);
          const recalculatedStayAmount = seed.stay.paymentAmount ?? 1;

          const result = await earlyCheckout(
            seed.stay.id,
            actualNightsStayed,
            recalculatedStayAmount
          );

          // Does NOT hit the "Only active stays..." rejection path.
          expect("error" in result).toBe(false);
          // Proceeds to the math/persistence — proven by the mocked
          // repository call, without asserting deeply on its result (that's
          // Property 21's scope).
          expect(calls.applyEarlyCheckout).toHaveLength(1);
        }
      ),
      { numRuns: 50 }
    );
  });
});
