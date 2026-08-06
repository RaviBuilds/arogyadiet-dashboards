// src/services/__tests__/AccommodationService.extendStay.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 18: Stay extension folds into the running balance
//
// **Validates: Requirements 11.1, 11.2, 11.3**
//
// For any ACTIVE Stay_Entry and any additional nights in [1, 365] with an
// additional cost amount, applying a Stay_Extension SHALL:
//   1. increase total nights by the additional nights,
//   2. increase Total_Stay_Amount by the additional cost and recompute the
//      GST_Breakup from that updated total (recomputed fresh via
//      `gstFromTotal`, not accumulated from the old base/tax plus a delta),
//   3. recompute Remaining_Balance as the updated Total_Stay_Amount minus
//      the UNCHANGED Total_Paid (the existing ledger is untouched), and
//   4. create no Payment_Transaction and no `payments` row for the
//      extension cost.
//
// `AccommodationService.extendStay` performs real DB reads/writes via
// `stayRepository.getStayById` / `stayRepository.extendStay` and
// `stayPaymentRepository.listTransactionsByStay`, all going through
// `createAdminClient()`. Both repositories are mocked here (no live database
// connection), mirroring the mocking convention used in
// `AccommodationService.createStay.property.test.ts` (task 5.2).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const calls: any = {
    getStayById: [] as any[],
    extendStay: [] as any[],
    listTransactionsByStay: [] as any[],
    recordTransaction: [] as any[],
    insertAdvanceTransaction: [] as any[],
    recordExtension: [] as any[],
  };

  function reset() {
    calls.getStayById = [];
    calls.extendStay = [];
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
        return {
          ...current,
          total_nights: current.total_nights + additionalNights,
          payment_amount: newTotalStayAmount,
          base_amount: newBaseAmount,
          tax_amount: newTaxAmount,
        };
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
      return (H as any).currentLedgerRows;
    }),
    recordTransaction: vi.fn(async (input: any) => {
      calls.recordTransaction.push(input);
      throw new Error("recordTransaction should not be called by extendStay");
    }),
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      throw new Error(
        "insertAdvanceTransaction should not be called by extendStay"
      );
    }),
  };
});

// extendStay also records an informational history row (Req: extend-stay-history)
// via this repository — mocked so the property doesn't hit a real database, and
// so the call can be asserted on below.
vi.mock("@/repositories/stayExtensionHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    recordExtension: vi.fn(async (input: any) => {
      calls.recordExtension.push(input);
      return { id: "history-row", ...input };
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { extendStay, gstFromTotal } from "@/services/AccommodationService";
import type { StayEntryRow } from "@/repositories/stayRepository";
import type { StayPaymentTransactionRow } from "@/repositories/stayPaymentRepository";
import type { StayPaymentTransaction } from "@/types/accommodation";
import {
  arbTotalStayAmount,
  arbMoney,
  arbLedger,
  arbTotalNights,
  arbStartDateAround,
  referenceTotalPaid,
  roundToPaise,
  REFERENCE_TODAY_IST,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCurrentStayRow(seed: {
  startDate: string;
  totalNights: number;
  currentTotalStayAmount: number;
}): StayEntryRow {
  const gst = gstFromTotal(seed.currentTotalStayAmount);
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    start_date: seed.startDate,
    total_nights: seed.totalNights,
    stay_type: "AC Villa",
    occupancy_type: "Single",
    status: "ACTIVE",
    payment_amount: seed.currentTotalStayAmount,
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
    recalculation_applied: false,
    checked_out_at: null,
    final_invoice_payment_id: null,
    final_invoice_generated_at: null,
    final_invoice_error: null,
  };
}

/** Converts a domain Payment_Transaction back to the snake_case row shape
 * `listTransactionsByStay` returns, so the service's own
 * `mapTransactionRowToDomain` reconstructs an equivalent domain transaction. */
function rowFromDomainTransaction(
  tx: StayPaymentTransaction
): StayPaymentTransactionRow {
  return {
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
    refund_invoice_payment_id: null,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbAdditionalNights: fc.Arbitrary<number> = arbTotalNights; // [1, 365]

const arbExtendStaySeed = fc.record({
  startDate: arbStartDateAround(REFERENCE_TODAY_IST),
  currentTotalNights: arbTotalNights,
  currentTotalStayAmount: arbTotalStayAmount,
  additionalNights: arbAdditionalNights,
  additionalCostAmount: arbMoney,
  ledger: arbLedger,
});

// ─── Property 18 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 18: Stay extension folds into the running balance", () => {
  it("increases total nights and Total_Stay_Amount, recomputes GST from the new total, and recomputes Remaining_Balance against the unchanged ledger without writing a Payment_Transaction", async () => {
    await fc.assert(
      fc.asyncProperty(arbExtendStaySeed, async (seed) => {
        H.reset();

        const currentStayRow = buildCurrentStayRow({
          startDate: seed.startDate,
          totalNights: seed.currentTotalNights,
          currentTotalStayAmount: seed.currentTotalStayAmount,
        });
        (H as any).currentStayRow = currentStayRow;
        (H as any).currentLedgerRows = seed.ledger.map(
          rowFromDomainTransaction
        );

        const result = await extendStay(
          DEFAULT_STAY_ID,
          seed.additionalNights,
          seed.additionalCostAmount
        );

        // 1. total_nights increases by exactly additionalNights.
        expect(result.updatedStay.total_nights).toBe(
          seed.currentTotalNights + seed.additionalNights
        );
        expect(calls.extendStay).toHaveLength(1);
        expect(calls.extendStay[0].additionalNights).toBe(
          seed.additionalNights
        );

        // 2. Total_Stay_Amount becomes current + additionalCostAmount, with
        // its GST breakup exactly gstFromTotal(newTotal) — recomputed fresh,
        // not accumulated from the old base/tax plus a delta.
        const expectedNewTotal = roundToPaise(
          seed.currentTotalStayAmount + seed.additionalCostAmount
        );
        const expectedGst = gstFromTotal(expectedNewTotal);
        expect(calls.extendStay[0].newTotalStayAmount).toBeCloseTo(
          seed.currentTotalStayAmount + seed.additionalCostAmount,
          6
        );
        expect(calls.extendStay[0].newBaseAmount).toBeCloseTo(
          expectedGst.baseAmount,
          6
        );
        expect(calls.extendStay[0].newTaxAmount).toBeCloseTo(
          expectedGst.taxAmount,
          6
        );
        expect(result.updatedStay.payment_amount).toBeCloseTo(
          seed.currentTotalStayAmount + seed.additionalCostAmount,
          6
        );
        expect(result.updatedStay.base_amount).toBeCloseTo(
          expectedGst.baseAmount,
          6
        );
        expect(result.updatedStay.tax_amount).toBeCloseTo(
          expectedGst.taxAmount,
          6
        );

        // 3. balance.totalPaid equals the reference Total_Paid from the SAME
        // existing ledger — unchanged, since extension writes no ledger row.
        const expectedTotalPaid = referenceTotalPaid(seed.ledger);
        expect(result.balance.totalPaid).toBeCloseTo(expectedTotalPaid, 6);

        // 4. balance.remainingBalance equals newTotalStayAmount - totalPaid
        // (may be negative if the stay was already overpaid).
        const expectedRemaining = roundToPaise(
          result.updatedStay.payment_amount! - expectedTotalPaid
        );
        expect(result.balance.remainingBalance).toBeCloseTo(
          expectedRemaining,
          6
        );

        // 5. No `payments` row insert and no `stay_payment_transactions`
        // insert occurs for the extension.
        expect(calls.recordTransaction).toHaveLength(0);
        expect(calls.insertAdvanceTransaction).toHaveLength(0);

        // 6. Exactly one informational extension-history row is recorded,
        // capturing the nights/total immediately before and after (Req:
        // extend-stay-history). This is a SEPARATE table from
        // stay_payment_transactions — it does not affect Total_Paid.
        expect(calls.recordExtension).toHaveLength(1);
        expect(calls.recordExtension[0].additionalNights).toBe(
          seed.additionalNights
        );
        expect(calls.recordExtension[0].nightsBefore).toBe(
          seed.currentTotalNights
        );
        expect(calls.recordExtension[0].nightsAfter).toBe(
          seed.currentTotalNights + seed.additionalNights
        );
        expect(calls.recordExtension[0].totalAmountBefore).toBeCloseTo(
          seed.currentTotalStayAmount,
          6
        );
        expect(calls.recordExtension[0].totalAmountAfter).toBeCloseTo(
          seed.currentTotalStayAmount + seed.additionalCostAmount,
          6
        );
      }),
      { numRuns: 100 }
    );
  });
});
