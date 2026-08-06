// src/services/__tests__/AccommodationService.statusGate.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 19: Extension and Save Stay Details require an ACTIVE stay
//
// **Validates: Requirements 11.5, 12.14**
//
// For any Stay_Entry whose Stay_Status is not ACTIVE — including one already
// finished via a prior recalculation — both Stay_Extension (`extendStay`) and
// Save Stay Details (`saveStayDetails`) SHALL be rejected with a status-based
// error, and the stay's nights, Total_Stay_Amount, status, and ledger SHALL
// remain unchanged. Additionally, BOTH `stay_recalculation_history` AND
// `stay_extension_history` must gain no rows after a rejected call.
//
// `AccommodationService.extendStay` delegates the ACTIVE gate to
// `stayRepository.extendStay`, which fetches the current row and THROWS when
// `current.status !== 'ACTIVE'` (task 4.2's defensive check). This test mocks
// `stayRepository.extendStay` to faithfully replicate that real throw-on-
// non-ACTIVE behaviour, so the property exercises the SERVICE's behaviour of
// propagating (not swallowing) that rejection.
//
// `AccommodationService.saveStayDetails` fetches the stay via
// `stayRepository.getStayById` and itself returns `{ ok: false, error: "Only
// active stays can be recalculated." }` — a returned rejection, not a
// throw — when `stayRow.status !== "ACTIVE"` (Req 12.14).
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
    saveStayDetails: [] as any[],
    applyEarlyCheckout: [] as any[],
    finalizeCheckout: [] as string[],
    listTransactionsByStay: [] as string[],
    recordTransaction: [] as any[],
    insertAdvanceTransaction: [] as any[],
    recordExtension: [] as any[],
    listRecalculationsByStay: [] as string[],
  };

  function reset() {
    calls.getStayById = [];
    calls.extendStay = [];
    calls.saveStayDetails = [];
    calls.applyEarlyCheckout = [];
    calls.finalizeCheckout = [];
    calls.listTransactionsByStay = [];
    calls.recordTransaction = [];
    calls.insertAdvanceTransaction = [];
    calls.recordExtension = [];
    calls.listRecalculationsByStay = [];
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
    // Tracks calls to saveStayDetails. In rejection-path tests it should
    // never be reached (the service rejects before calling the repository).
    // In the positive control, it returns a successful result.
    saveStayDetails: vi.fn(async (input: any) => {
      calls.saveStayDetails.push(input);
      const current = (H as any).currentStayRow;
      return {
        ok: true,
        stay: {
          ...current,
          total_nights: input.recalculatedTotalNights,
          payment_amount: input.recalculatedStayAmount,
          base_amount: input.gst.baseAmount,
          tax_amount: input.gst.taxAmount,
          recalculation_applied: true,
        },
        historyRecorded: false,
      };
    }),
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
        "recordTransaction should not be called by extendStay/saveStayDetails"
      );
    }),
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      throw new Error(
        "insertAdvanceTransaction should not be called by extendStay/saveStayDetails"
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

// Recalculation history is written INSIDE the save_stay_details RPC — there is
// no Node-side write function. This mock ensures no unexpected read is reached
// during rejection paths.
vi.mock("@/repositories/stayRecalculationHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    listRecalculationsByStay: vi.fn(async (stayId: string) => {
      calls.listRecalculationsByStay.push(stayId);
      return [];
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { extendStay, saveStayDetails } from "@/services/AccommodationService";
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

/** Computes a plausible end date from a stay's start date and total nights. */
function computeEndDateFromStay(stay: StayEntry): string {
  const start = new Date(stay.startDate);
  const end = new Date(start.getTime() + (stay.totalNights - 1) * 86400000);
  return end.toISOString().slice(0, 10);
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbExtendRejectionSeed = fc.record({
  stay: arbNonActiveStayEntry,
  additionalNights: arbTotalNights, // [1, 365]
  additionalCostAmount: arbMoney,
});

const arbSaveStayDetailsRejectionSeed = fc.record({
  stay: arbNonActiveStayEntry,
  recalculatedStayAmount: arbMoney,
});

// ─── Property 19 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 19: Extension and Save Stay Details require an ACTIVE stay", () => {
  it("extendStay rejects any non-ACTIVE stay — including one already finished — with a status-based error and no mutation, and neither history table gains a row", async () => {
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

        // BOTH history tables remain unchanged: no extension history row
        // written, and no recalculation history row written.
        expect(calls.recordExtension).toHaveLength(0);
        expect(calls.saveStayDetails).toHaveLength(0);
        expect(calls.listRecalculationsByStay).toHaveLength(0);

        // The stay's nights, Total_Stay_Amount, and status remain unchanged.
        expect(row.total_nights).toBe(seed.stay.totalNights);
        expect(row.payment_amount).toBe(seed.stay.paymentAmount);
        expect(row.status).toBe(seed.stay.status);
      }),
      { numRuns: 100 }
    );
  });

  it('saveStayDetails rejects any non-ACTIVE stay with { ok: false, error: "Only active stays can be recalculated." } and no mutation, and neither history table gains a row', async () => {
    await fc.assert(
      fc.asyncProperty(arbSaveStayDetailsRejectionSeed, async (seed) => {
        H.reset();

        const row = rowFromDomainStay(seed.stay);
        (H as any).currentStayRow = row;
        (H as any).currentLedgerRows = [];

        // Compute a plausible recalculated end date (the start date itself —
        // the minimum allowed, giving 1-night stay).
        const recalculatedEndDate = seed.stay.startDate;

        const result = await saveStayDetails(
          seed.stay.id,
          recalculatedEndDate,
          seed.recalculatedStayAmount
        );

        // A returned rejection, not a throw (Req 12.14).
        expect(result).toHaveProperty("ok", false);
        if ("ok" in result && !result.ok) {
          expect(result.error).toBe(
            "Only active stays can be recalculated."
          );
        }

        // No mutation and no further processing — the math, the ledger read,
        // the repository's saveStayDetails call (which writes to
        // stay_recalculation_history inside its RPC), and any follow-up are
        // all skipped once the status gate rejects.
        expect(calls.saveStayDetails).toHaveLength(0);
        expect(calls.listTransactionsByStay).toHaveLength(0);
        expect(calls.finalizeCheckout).toHaveLength(0);
        expect(calls.recordTransaction).toHaveLength(0);
        expect(calls.insertAdvanceTransaction).toHaveLength(0);

        // BOTH history tables remain unchanged: no recalculation history row
        // (written inside saveStayDetails RPC, which was never called), and
        // no extension history row.
        expect(calls.recordExtension).toHaveLength(0);
        expect(calls.listRecalculationsByStay).toHaveLength(0);

        // The stay's nights, Total_Stay_Amount, and status remain unchanged.
        expect(row.total_nights).toBe(seed.stay.totalNights);
        expect(row.payment_amount).toBe(seed.stay.paymentAmount);
        expect(row.status).toBe(seed.stay.status);
      }),
      { numRuns: 100 }
    );
  });

  // Light positive control (not the main property): confirms the gate isn't
  // over-broad by checking an ACTIVE, billable stay does NOT hit the
  // rejection path in `saveStayDetails`. Downstream math and persistence are
  // covered by the recalculation history property test's own scope.
  it("does not reject an ACTIVE stay at the status gate (positive control for saveStayDetails)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ stay: arbActiveBillableStayEntry }),
        async (seed) => {
          H.reset();

          const row = rowFromDomainStay(seed.stay);
          (H as any).currentStayRow = row;
          // Empty ledger ⇒ totalPaid = 0 ⇒ remainingBalance =
          // recalculatedStayAmount > 0 ⇒ nextAction is always
          // COLLECT_BALANCE, keeping this control focused on the gate alone.
          (H as any).currentLedgerRows = [];

          // Use the stay's own end date as recalculatedEndDate (a no-op
          // submission) and the stay's current amount.
          const recalculatedEndDate = computeEndDateFromStay(seed.stay);
          const recalculatedStayAmount = seed.stay.paymentAmount ?? 1;

          const result = await saveStayDetails(
            seed.stay.id,
            recalculatedEndDate,
            recalculatedStayAmount
          );

          // Does NOT hit the "Only active stays..." rejection path.
          expect(result).not.toHaveProperty("ok", false);
          // Proceeds past the gate — the ledger was read and the repository's
          // saveStayDetails was called (proving the gate passed).
          expect(calls.listTransactionsByStay).toHaveLength(1);
          expect(calls.saveStayDetails).toHaveLength(1);
        }
      ),
      { numRuns: 50 }
    );
  });
});
