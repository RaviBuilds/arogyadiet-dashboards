// src/services/__tests__/AccommodationService.recalculationE2E.integration.test.ts
// Feature: accommodation-payment-lifecycle — end-to-end integration test for
// the recalculation flow (Task 23.8).
//
// **Validates: Requirements 12.9, 12.13, 13.1, 14.7, 14.10**
//
// This is a SERVICE-LEVEL integration test: it exercises the real
// `AccommodationService` functions (`createStay`, `saveStayDetails`,
// `recordRefundWithInvoice`, `deriveStayBalance`, `deriveStayActionVisibility`,
// `checkoutStay`) end-to-end against an IN-MEMORY FAKE of `stayRepository` /
// `stayPaymentRepository` (and a fake `createAdminClient` for the `payments`
// inserts). No live database connection is made.
//
// The flow:
// 1. Create an ACTIVE stay, overpay it (Total_Paid > Total_Stay_Amount)
// 2. `saveStayDetails` → shorten the stay → stay is still ACTIVE, no invoice
// 3. `recordRefundWithInvoice` → records the excess as REFUND + Refund_Invoice
// 4. Balance is now exactly zero
// 5. `deriveStayActionVisibility` → Mark as Checked Out enabled only when
//    todayIST >= the recalculated end date
// 6. `checkoutStay` → FINISHED + Final_Consolidated_Invoice
// 7. Assert exactly one Final_Consolidated_Invoice and one Refund_Invoice exist

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Shared in-memory store + call log (hoisted so vi.mock factories can
// close over it) ─────────────────────────────────────────────────────────
const H = vi.hoisted(() => {
  const stayStore = new Map<string, any>();
  const ledgerStore = new Map<string, any[]>();

  const calls: any = {
    createStayEntry: [] as any[],
    deleteStayEntry: [] as string[],
    getStayById: [] as string[],
    saveStayDetails: [] as any[],
    finalizeCheckout: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    insertAdvanceTransaction: [] as any[],
    listTransactionsByStay: [] as string[],
    recordTransaction: [] as any[],
    recordRefundWithInvoice: [] as any[],
    paymentsInsert: [] as any[],
  };

  let seq = 0;
  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}-${seq}`;
  }

  function reset() {
    stayStore.clear();
    ledgerStore.clear();
    calls.createStayEntry = [];
    calls.deleteStayEntry = [];
    calls.getStayById = [];
    calls.saveStayDetails = [];
    calls.finalizeCheckout = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.insertAdvanceTransaction = [];
    calls.listTransactionsByStay = [];
    calls.recordTransaction = [];
    calls.recordRefundWithInvoice = [];
    calls.paymentsInsert = [];
    seq = 0;
  }

  function ledgerOf(stayId: string): any[] {
    return ledgerStore.get(stayId) ?? [];
  }

  /** Total_Paid — ADVANCE/PARTIAL add, REFUND subtracts (mirrors the RPC). */
  function totalPaidOf(stayId: string): number {
    return ledgerOf(stayId).reduce(
      (sum, tx) =>
        tx.transaction_type === "REFUND" ? sum - tx.amount : sum + tx.amount,
      0,
    );
  }

  function makeFakeAdmin() {
    return {
      from(table: string) {
        if (table !== "payments") {
          throw new Error(`Unexpected table in fake admin client: ${table}`);
        }
        return {
          insert(row: Record<string, unknown>) {
            calls.paymentsInsert.push(row);
            return {
              select(_columns: string) {
                return {
                  async single() {
                    const id = nextId("payment");
                    return { data: { id }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  return {
    stayStore,
    ledgerStore,
    calls,
    reset,
    nextId,
    ledgerOf,
    totalPaidOf,
    makeFakeAdmin,
  };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { stayStore, calls, nextId } = H;
  return {
    ...actual,
    createStayEntry: vi.fn(async (input: any) => {
      calls.createStayEntry.push(input);
      const id = nextId("stay");
      const row = {
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
        recalculation_applied: false,
        checked_out_at: null,
        final_invoice_payment_id: null,
        final_invoice_generated_at: null,
        final_invoice_error: null,
      };
      stayStore.set(id, row);
      return { ...row };
    }),
    deleteStayEntry: vi.fn(async (stayId: string) => {
      calls.deleteStayEntry.push(stayId);
      stayStore.delete(stayId);
    }),
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      const row = stayStore.get(stayId);
      return row ? { ...row } : null;
    }),
    saveStayDetails: vi.fn(async (input: any) => {
      calls.saveStayDetails.push(input);
      const current = stayStore.get(input.stayId);
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
      stayStore.set(input.stayId, updated);
      return {
        ok: true as const,
        stay: { ...updated },
        historyRecorded: changed,
      };
    }),
    finalizeCheckout: vi.fn(async (stayId: string) => {
      calls.finalizeCheckout.push(stayId);
      const current = stayStore.get(stayId);
      if (!current) {
        return { ok: false, reason: "NOT_FOUND" as const };
      }
      if (current.status !== "ACTIVE") {
        return {
          ok: false,
          reason: "NOT_ACTIVE" as const,
          status: current.status,
        };
      }
      const totalPaid = H.totalPaidOf(stayId);
      const remaining = (current.payment_amount ?? 0) - totalPaid;
      if (remaining !== 0) {
        return {
          ok: false,
          reason: "BALANCE_OUTSTANDING" as const,
          remainingBalance: remaining,
        };
      }
      const updated = {
        ...current,
        status: "FINISHED",
        checked_out_at: new Date().toISOString(),
      };
      stayStore.set(stayId, updated);
      return { ok: true as const, stay: { ...updated } };
    }),
    attachFinalInvoice: vi.fn(async (stayId: string, paymentId: string) => {
      calls.attachFinalInvoice.push({ stayId, paymentId });
      const current = stayStore.get(stayId);
      const updated = {
        ...current,
        final_invoice_payment_id: paymentId,
        final_invoice_generated_at: new Date().toISOString(),
        final_invoice_error: null,
      };
      stayStore.set(stayId, updated);
    }),
    recordFinalInvoiceFailure: vi.fn(
      async (stayId: string, message: string) => {
        calls.recordFinalInvoiceFailure.push({ stayId, message });
      },
    ),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { stayStore, ledgerStore, calls, nextId, ledgerOf, totalPaidOf } = H;
  return {
    ...actual,
    insertAdvanceTransaction: vi.fn(async (input: any) => {
      calls.insertAdvanceTransaction.push(input);
      const id = nextId("tx");
      const row = {
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
      const ledger = ledgerOf(input.stayEntryId);
      ledger.push(row);
      ledgerStore.set(input.stayEntryId, ledger);
      return { ...row };
    }),
    listTransactionsByStay: vi.fn(async (stayId: string) => {
      calls.listTransactionsByStay.push(stayId);
      return ledgerOf(stayId).map((row) => ({ ...row }));
    }),
    getTransactionById: vi.fn(async (transactionId: string) => {
      for (const ledger of ledgerStore.values()) {
        const found = ledger.find((row) => row.id === transactionId);
        if (found) return { ...found };
      }
      return null;
    }),
    recordTransaction: vi.fn(async (input: any) => {
      calls.recordTransaction.push(input);
      const stay = stayStore.get(input.stayEntryId);
      if (!stay) {
        return { ok: false as const, reason: "NOT_FOUND" as const };
      }
      if (stay.payment_host_profile_id !== null) {
        return { ok: false as const, reason: "SHARED_PAYMENT" as const };
      }
      if (input.amount <= 0) {
        return {
          ok: false as const,
          reason: "AMOUNT_NOT_POSITIVE" as const,
        };
      }

      const totalPaidBefore = totalPaidOf(input.stayEntryId);
      const remainingBefore = (stay.payment_amount ?? 0) - totalPaidBefore;

      if (input.transactionType === "REFUND") {
        const excess = Math.max(-remainingBefore, 0);
        if (input.amount > excess) {
          return {
            ok: false as const,
            reason: "REFUND_EXCEEDS_EXCESS" as const,
            excess,
          };
        }
      } else if (input.amount > remainingBefore) {
        return {
          ok: false as const,
          reason: "AMOUNT_EXCEEDS_BALANCE" as const,
          remainingBalance: remainingBefore,
        };
      }

      const id = nextId("tx");
      const row = {
        id,
        stay_entry_id: input.stayEntryId,
        customer_profile_id: stay.customer_profile_id,
        transaction_type: input.transactionType,
        amount: input.amount,
        transaction_date: input.transactionDate,
        comment: input.comment ?? null,
        remark: input.remark ?? null,
        created_by: input.createdBy ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const ledger = ledgerOf(input.stayEntryId);
      ledger.push(row);
      ledgerStore.set(input.stayEntryId, ledger);

      const totalPaidAfter =
        input.transactionType === "REFUND"
          ? totalPaidBefore - input.amount
          : totalPaidBefore + input.amount;
      const remainingAfter = (stay.payment_amount ?? 0) - totalPaidAfter;

      return {
        ok: true as const,
        transaction: { ...row },
        totalPaid: totalPaidAfter,
        remainingBalance: remainingAfter,
      };
    }),
    recordRefundWithInvoice: vi.fn(async (input: any) => {
      calls.recordRefundWithInvoice.push(input);
      const stay = stayStore.get(input.stayEntryId);
      if (!stay) {
        return { ok: false as const, reason: "NOT_FOUND" as const };
      }
      if (stay.payment_host_profile_id !== null) {
        return { ok: false as const, reason: "SHARED_PAYMENT" as const };
      }
      if (stay.status !== "ACTIVE") {
        return { ok: false as const, reason: "NOT_ACTIVE" as const };
      }
      if (input.amount <= 0) {
        return { ok: false as const, reason: "AMOUNT_NOT_POSITIVE" as const };
      }
      if (!input.remark || input.remark.trim().length === 0) {
        return { ok: false as const, reason: "REMARK_INVALID" as const };
      }

      const totalPaidBefore = totalPaidOf(input.stayEntryId);
      const excess = Math.max(
        totalPaidBefore - (stay.payment_amount ?? 0),
        0,
      );
      if (excess <= 0) {
        return { ok: false as const, reason: "NO_EXCESS_TO_REFUND" as const };
      }
      if (input.amount > excess) {
        return {
          ok: false as const,
          reason: "REFUND_EXCEEDS_EXCESS" as const,
          excess,
        };
      }

      const id = nextId("tx");
      const row = {
        id,
        stay_entry_id: input.stayEntryId,
        customer_profile_id: stay.customer_profile_id,
        transaction_type: "REFUND",
        amount: input.amount,
        transaction_date: input.transactionDate,
        comment: input.comment ?? null,
        remark: input.remark,
        created_by: input.createdBy ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const ledger = ledgerOf(input.stayEntryId);
      ledger.push(row);
      ledgerStore.set(input.stayEntryId, ledger);

      const refundInvoicePaymentId = nextId("payment");
      calls.paymentsInsert.push({
        invoice_type: "ACCOMMODATION_REFUND_INVOICE",
        amount: input.amount,
      });

      const totalPaidAfter = totalPaidBefore - input.amount;
      const remainingAfter = (stay.payment_amount ?? 0) - totalPaidAfter;

      return {
        ok: true as const,
        transaction: { ...row },
        refundInvoicePaymentId,
        totalPaid: totalPaidAfter,
        remainingBalance: remainingAfter,
      };
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import {
  createStay,
  checkoutStay,
  saveStayDetails,
  recordRefundWithInvoice,
  deriveStayBalance,
  deriveStayActionVisibility,
} from "@/services/AccommodationService";
import type { StayEntry, StayPaymentTransaction } from "@/types/accommodation";
import { getISTDateString, addDaysToISODate } from "@/lib/dates/ist";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

const TODAY_IST = getISTDateString(0);

// ─── Local row → domain mapping ────────────────────────────────────────────

function mapStayRowToDomain(row: any): StayEntry {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    startDate: row.start_date,
    totalNights: row.total_nights,
    stayType: row.stay_type,
    occupancyType: row.occupancy_type,
    status: row.status,
    paymentAmount: row.payment_amount,
    baseAmount: row.base_amount,
    taxAmount: row.tax_amount,
    taxPercentage: row.tax_percentage,
    paymentHostProfileId: row.payment_host_profile_id,
    mealPreference: row.meal_preference,
    endDate: addDaysToISODate(row.start_date, row.total_nights - 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isBackdated: row.is_backdated,
    earlyCheckoutApplied: row.early_checkout_applied,
    actualNightsStayed: row.actual_nights_stayed,
    originalTotalNights: row.original_total_nights,
    originalTotalAmount: row.original_total_amount,
    recalculationApplied: row.recalculation_applied,
    checkedOutAt: row.checked_out_at,
    finalInvoicePaymentId: row.final_invoice_payment_id,
    finalInvoiceGeneratedAt: row.final_invoice_generated_at,
    finalInvoiceError: row.final_invoice_error,
  };
}

function mapTransactionRowToDomain(row: any): StayPaymentTransaction {
  return {
    id: row.id,
    stayEntryId: row.stay_entry_id,
    customerProfileId: row.customer_profile_id,
    transactionType: row.transaction_type,
    amount: row.amount,
    transactionDate: row.transaction_date,
    comment: row.comment,
    remark: row.remark,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const CUSTOMER_PROFILE_ID = "customer-profile-1";

describe("Feature: accommodation-payment-lifecycle — recalculation E2E flow", () => {
  it("overpaid ACTIVE stay → recalculate to earlier end date → refund → checkout only after end date → FINISHED with Final + Refund invoices", async () => {
    // ─── Step 1: Create an ACTIVE stay and overpay it ───────────────────
    // Start date is today so the stay is ACTIVE (end date is in the future).
    // Stay: 10 nights, total 80,000. Advance 50,000 + partial 30,000 = 80,000 paid.
    const startDate = TODAY_IST;
    const stay = await createStay({
      customerProfileId: CUSTOMER_PROFILE_ID,
      startDate,
      totalNights: 10,
      stayType: "AC Villa",
      occupancyType: "Double",
      mealPreference: "VEG",
      paymentAmount: null,
      paymentHostProfileId: null,
      totalStayAmount: 80000,
      advanceAmountPaid: 50000,
      backdatedStayEnabled: false,
    });
    expect(stay.status).toBe("ACTIVE");

    // Record a partial payment to make Total_Paid = 80,000 (fully paid).
    const { recordTransaction } = await import(
      "@/repositories/stayPaymentRepository"
    );
    const partialResult = await recordTransaction({
      stayEntryId: stay.id,
      transactionType: "PARTIAL_BALANCE_PAYMENT",
      amount: 30000,
      transactionDate: startDate,
      comment: "Second installment",
      remark: null,
      createdBy: null,
    });
    expect(partialResult.ok).toBe(true);
    expect(H.totalPaidOf(stay.id)).toBe(80000);

    // ─── Step 2: saveStayDetails → shorten stay to 5 nights, amount 60,000 ──
    // The stay is now overpaid: Total_Paid (80,000) > new total (60,000).
    // Recalculated end date: start + 4 days = 5 nights inclusive.
    const recalculatedEndDate = addDaysToISODate(startDate, 4);
    const outcome = await saveStayDetails(stay.id, recalculatedEndDate, 60000);
    if ("error" in outcome) {
      throw new Error(`Expected success, got ${outcome.error}`);
    }

    // Assertions for Req 12.9: stay is still ACTIVE, no invoice generated.
    expect(outcome.status).toBe("ACTIVE");
    expect(outcome.nextAction).toBe("RECORD_REFUND");
    expect(outcome.refundDue).toBe(20000); // 80,000 paid − 60,000 new total
    expect(outcome.totalNights).toBe(5);
    expect(outcome.recalculatedEndDate).toBe(recalculatedEndDate);

    // The stay row reflects recalculation but stays ACTIVE (Req 12.9, 12.13).
    const stayAfterRecalc = H.stayStore.get(stay.id);
    expect(stayAfterRecalc.status).toBe("ACTIVE");
    expect(stayAfterRecalc.total_nights).toBe(5);
    expect(stayAfterRecalc.payment_amount).toBe(60000);
    expect(stayAfterRecalc.recalculation_applied).toBe(true);
    expect(stayAfterRecalc.checked_out_at).toBeNull();

    // No Final_Consolidated_Invoice exists yet.
    expect(stayAfterRecalc.final_invoice_payment_id).toBeNull();
    expect(calls.paymentsInsert).toHaveLength(0);

    // Recalculation history was recorded (Req 13.1).
    expect(outcome.historyRecorded).toBe(true);

    // ─── Step 3: recordRefundWithInvoice → REFUND + Refund_Invoice ──────
    // Mark as refunded for the excess of 20,000.
    const refundResult = await recordRefundWithInvoice({
      stayId: stay.id,
      amount: 20000,
      remark: "Early departure — refunded via bank transfer",
      createdBy: null,
    });
    if (!refundResult.ok) {
      throw new Error(
        `Expected successful refund, got ${refundResult.reason}`,
      );
    }

    // Refund_Invoice generated atomically with the REFUND row (Req 14.7).
    expect(typeof refundResult.refundInvoicePaymentId).toBe("string");
    expect(calls.paymentsInsert).toHaveLength(1);
    expect(calls.paymentsInsert[0]).toMatchObject({
      invoice_type: "ACCOMMODATION_REFUND_INVOICE",
      amount: 20000,
    });

    // The stay is STILL ACTIVE — refund never transitions status (Req 14.10).
    expect(H.stayStore.get(stay.id).status).toBe("ACTIVE");
    expect(H.stayStore.get(stay.id).checked_out_at).toBeNull();

    // ─── Step 4: Balance is exactly zero ────────────────────────────────
    const ledgerAfterRefund = H.ledgerOf(stay.id);
    expect(ledgerAfterRefund).toHaveLength(3); // ADVANCE + PARTIAL + REFUND

    const balance = deriveStayBalance(
      60000, // recalculated total
      ledgerAfterRefund.map(mapTransactionRowToDomain),
    );
    expect(balance.totalPaid).toBe(60000); // 50k + 30k − 20k
    expect(balance.remainingBalance).toBe(0);
    expect(balance.isFullyPaid).toBe(true);

    // ─── Step 5: Mark as Checked Out visibility gated on the end date ───
    const domainStayRecalculated = mapStayRowToDomain(
      H.stayStore.get(stay.id),
    );

    // The recalculated end date is `startDate + 4` (5 nights inclusive).
    // Before it: checkout button is visible but DISABLED.
    const dayBeforeEnd = addDaysToISODate(startDate, 3); // one day before recalculated end
    const visibilityBefore = deriveStayActionVisibility(
      domainStayRecalculated,
      balance,
      false,
      dayBeforeEnd,
    );
    expect(visibilityBefore.showMarkCheckedOut).toBe(true);
    expect(visibilityBefore.markCheckedOutEnabled).toBe(false);
    expect(visibilityBefore.markCheckedOutBlockedReason).toBe(
      "BEFORE_END_DATE",
    );

    // On the recalculated end date: ENABLED.
    const visibilityOn = deriveStayActionVisibility(
      domainStayRecalculated,
      balance,
      false,
      recalculatedEndDate, // the recalculated end date itself
    );
    expect(visibilityOn.showMarkCheckedOut).toBe(true);
    expect(visibilityOn.markCheckedOutEnabled).toBe(true);
    expect(visibilityOn.markCheckedOutBlockedReason).toBeNull();

    // After the recalculated end date: still enabled.
    const dayAfterEnd = addDaysToISODate(startDate, 5);
    const visibilityAfter = deriveStayActionVisibility(
      domainStayRecalculated,
      balance,
      false,
      dayAfterEnd,
    );
    expect(visibilityAfter.markCheckedOutEnabled).toBe(true);

    // ─── Step 6: checkoutStay → FINISHED + Final_Consolidated_Invoice ───
    const checkoutResult = await checkoutStay(stay.id);
    expect(checkoutResult).toMatchObject({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "GENERATED",
    });

    // ─── Step 7: Exactly one Final_Consolidated_Invoice and one
    // Refund_Invoice exist ────────────────────────────────────────────────
    // The Refund_Invoice was inserted during step 3, the Final during step 6.
    expect(calls.paymentsInsert).toHaveLength(2);
    expect(calls.paymentsInsert[0]).toMatchObject({
      invoice_type: "ACCOMMODATION_REFUND_INVOICE",
      amount: 20000,
    });
    expect(calls.paymentsInsert[1]).toMatchObject({
      invoice_type: "ACCOMMODATION_FINAL_INVOICE",
      amount: 60000, // the recalculated total, not the original 80,000
    });

    // Final invoice attached exactly once.
    expect(calls.attachFinalInvoice).toHaveLength(1);

    // The stay row is FINISHED with the recalculated nights and total.
    const finalStayRow = H.stayStore.get(stay.id);
    expect(finalStayRow.status).toBe("FINISHED");
    expect(finalStayRow.total_nights).toBe(5);
    expect(finalStayRow.payment_amount).toBe(60000);
    expect(finalStayRow.final_invoice_payment_id).not.toBeNull();
  });
});
