// src/services/__tests__/AccommodationService.headlineFlows.integration.test.ts
// Feature: accommodation-payment-lifecycle — end-to-end integration tests for
// the two headline flows (Task 11.9).
//
// **Validates: Requirements 3.1, 4.5, 9.1, 9.2, 12.11, 12.13**
//
// These are SERVICE-LEVEL integration tests, not browser E2E: they exercise
// the real `AccommodationService` functions (`createStay`, `checkoutStay`,
// `generateFinalInvoice`, `earlyCheckout`, `deriveStayBalance`,
// `deriveStayActionVisibility`) end-to-end against an IN-MEMORY FAKE of
// `stayRepository` / `stayPaymentRepository` (and a fake `createAdminClient`
// for the `payments` insert `generateFinalInvoice` performs directly). No
// live database connection is made. The fake mirrors the real row-locking
// RPCs' accept/reject rules (`record_stay_payment_transaction`,
// `finalize_stay_checkout`) closely enough that these flows behave the same
// way the real Postgres functions would, following the
// `vi.mock` + `vi.hoisted` call-log/fake-state convention already used by
// `AccommodationService.createStay.property.test.ts` and
// `AccommodationService.statusGate.property.test.ts`.

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
    applyEarlyCheckout: [] as any[],
    finalizeCheckout: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    insertAdvanceTransaction: [] as any[],
    listTransactionsByStay: [] as string[],
    recordTransaction: [] as any[],
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
    calls.applyEarlyCheckout = [];
    calls.finalizeCheckout = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.insertAdvanceTransaction = [];
    calls.listTransactionsByStay = [];
    calls.recordTransaction = [];
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
    applyEarlyCheckout: vi.fn(
      async (
        stayId: string,
        actualNightsStayed: number,
        recalculatedStayAmount: number,
        gst: { baseAmount: number; taxAmount: number },
      ) => {
        calls.applyEarlyCheckout.push({
          stayId,
          actualNightsStayed,
          recalculatedStayAmount,
          gst,
        });
        const current = stayStore.get(stayId);
        const isFirstApplication = !current.early_checkout_applied;
        const updated = {
          ...current,
          total_nights: actualNightsStayed,
          payment_amount: recalculatedStayAmount,
          base_amount: gst.baseAmount,
          tax_amount: gst.taxAmount,
          actual_nights_stayed: actualNightsStayed,
          early_checkout_applied: true,
        };
        if (isFirstApplication) {
          updated.original_total_nights = current.total_nights;
          updated.original_total_amount = current.payment_amount;
        }
        stayStore.set(stayId, updated);
        return { ...updated };
      },
    ),
    // Mirrors the row-locked `finalize_stay_checkout` RPC: re-checks ACTIVE
    // and an exactly-zero ledger-derived balance before transitioning.
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
    // Mirrors the row-locked `record_stay_payment_transaction` RPC: derives
    // Total_Paid from the ledger, validates the amount against the
    // authoritative remaining balance, then appends.
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
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import {
  createStay,
  checkoutStay,
  generateFinalInvoice,
  earlyCheckout,
  deriveStayBalance,
  deriveStayActionVisibility,
} from "@/services/AccommodationService";
import type { StayEntry, StayPaymentTransaction } from "@/types/accommodation";
import { getISTDateString, addDaysToISODate } from "@/lib/dates/ist";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Local row → domain mapping (mirrors the private helpers in
// AccommodationService so this test can call the pure decision functions
// directly, exactly the way the real orchestration code does). ────────────

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
const TODAY_IST = getISTDateString(0);

describe("Feature: accommodation-payment-lifecycle — headline flow: backdated onboarding with a partial advance", () => {
  it("goes FINISHED at creation, tracks a single ADVANCE row, then reaches Generate Final Invoice only once fully paid", async () => {
    // 1. Backdated onboarding: start date far enough in the past that the
    // computed end date has already passed (Req 3.1), total 50,000 with a
    // partial advance of 20,000 (Req 4.5).
    const startDate = addDaysToISODate(TODAY_IST, -60);
    const stay = await createStay({
      customerProfileId: CUSTOMER_PROFILE_ID,
      startDate,
      totalNights: 5,
      stayType: "AC Villa",
      occupancyType: "Single",
      mealPreference: "VEG",
      paymentAmount: null,
      paymentHostProfileId: null,
      totalStayAmount: 50000,
      advanceAmountPaid: 20000,
      backdatedStayEnabled: true,
    });

    // 2. Backdated + FINISHED immediately (Req 3.1).
    expect(stay.is_backdated).toBe(true);
    expect(stay.status).toBe("FINISHED");

    // 3. The ledger holds exactly one ADVANCE row of 20,000 (Req 4.5, 12.11).
    expect(calls.insertAdvanceTransaction).toHaveLength(1);
    const ledgerAfterOnboarding = H.ledgerOf(stay.id);
    expect(ledgerAfterOnboarding).toHaveLength(1);
    expect(ledgerAfterOnboarding[0].transaction_type).toBe("ADVANCE");
    expect(ledgerAfterOnboarding[0].amount).toBe(20000);

    // 4. Balance after the advance: 30,000 remaining, not fully paid.
    const balanceAfterAdvance = deriveStayBalance(
      stay.payment_amount,
      ledgerAfterOnboarding.map(mapTransactionRowToDomain),
    );
    expect(balanceAfterAdvance.remainingBalance).toBe(30000);
    expect(balanceAfterAdvance.isFullyPaid).toBe(false);

    // 5. Record Payment available, Generate Final Invoice not yet.
    const domainStay = mapStayRowToDomain(stay);
    const visibilityAfterAdvance = deriveStayActionVisibility(
      domainStay,
      balanceAfterAdvance,
      false,
      TODAY_IST,
    );
    expect(visibilityAfterAdvance.showRecordPayment).toBe(true);
    expect(visibilityAfterAdvance.showGenerateFinalInvoice).toBe(false);

    // 6. Record the remaining balance (30,000) as a PARTIAL_BALANCE_PAYMENT.
    const { recordTransaction } = await import(
      "@/repositories/stayPaymentRepository"
    );
    const recordResult = await recordTransaction({
      stayEntryId: stay.id,
      transactionType: "PARTIAL_BALANCE_PAYMENT",
      amount: 30000,
      transactionDate: TODAY_IST,
      comment: "Balance settled",
      remark: null,
      createdBy: null,
    });
    expect(recordResult.ok).toBe(true);

    // No extraneous ledger rows: exactly two rows now exist (Req 12.11).
    const ledgerAfterBalance = H.ledgerOf(stay.id);
    expect(ledgerAfterBalance).toHaveLength(2);

    // 7. Balance is now fully paid.
    const balanceAfterBalance = deriveStayBalance(
      stay.payment_amount,
      ledgerAfterBalance.map(mapTransactionRowToDomain),
    );
    expect(balanceAfterBalance.remainingBalance).toBe(0);
    expect(balanceAfterBalance.isFullyPaid).toBe(true);

    // 8. Generate Final Invoice now shown, Record Payment hidden (Req 9.1, 9.2).
    const visibilityAfterBalance = deriveStayActionVisibility(
      domainStay,
      balanceAfterBalance,
      false,
      TODAY_IST,
    );
    expect(visibilityAfterBalance.showGenerateFinalInvoice).toBe(true);
    expect(visibilityAfterBalance.showRecordPayment).toBe(false);

    // 9. Generate the final invoice.
    const invoiceResult = await generateFinalInvoice(stay.id);
    expect(invoiceResult).toMatchObject({ ok: true, alreadyExisted: false });
    if (invoiceResult.ok && "paymentId" in invoiceResult) {
      expect(typeof invoiceResult.paymentId).toBe("string");
    } else {
      throw new Error(
        `expected an inserted invoice, got ${JSON.stringify(invoiceResult)}`,
      );
    }
    expect(calls.attachFinalInvoice).toHaveLength(1);
    expect(calls.paymentsInsert).toHaveLength(1);
  });
});

describe("Feature: accommodation-payment-lifecycle — headline flow: early checkout with a refund", () => {
  it("records the refund, finishes the stay, and produces exactly one invoice with the recalculated amount and actual nights", async () => {
    // 1. An ACTIVE, non-shared, non-backdated stay: total 70,000, paid in
    // full via an ADVANCE (50,000) plus a PARTIAL_BALANCE_PAYMENT (20,000).
    const stay = await createStay({
      customerProfileId: CUSTOMER_PROFILE_ID,
      startDate: TODAY_IST,
      totalNights: 10,
      stayType: "AC Villa",
      occupancyType: "Double",
      mealPreference: "VEG",
      paymentAmount: null,
      paymentHostProfileId: null,
      totalStayAmount: 70000,
      advanceAmountPaid: 50000,
      backdatedStayEnabled: false,
    });
    expect(stay.status).toBe("ACTIVE");
    expect(stay.is_backdated).toBe(false);

    const { recordTransaction } = await import(
      "@/repositories/stayPaymentRepository"
    );
    const firstBalancePayment = await recordTransaction({
      stayEntryId: stay.id,
      transactionType: "PARTIAL_BALANCE_PAYMENT",
      amount: 20000,
      transactionDate: TODAY_IST,
      comment: "Second installment",
      remark: null,
      createdBy: null,
    });
    expect(firstBalancePayment.ok).toBe(true);
    expect(H.totalPaidOf(stay.id)).toBe(70000);

    // 2. Early checkout: actual nights 4, recalculated amount 55,000 — Total_Paid
    // (70,000) now exceeds the new total, producing a refund-due situation.
    const outcome = await earlyCheckout(stay.id, 4, 55000);
    if ("error" in outcome) {
      throw new Error(`expected a successful outcome, got ${outcome.error}`);
    }

    // 3. Refund branch, excess of 15,000 (Req 12.13).
    expect(outcome.nextStep).toBe("RECORD_REFUND");
    expect(outcome.refundDue).toBe(15000);

    // 4. The stay row reflects the recalculated nights/amount and is flagged
    // as early-checked-out; status remains ACTIVE until the refund clears
    // the balance.
    expect(calls.applyEarlyCheckout).toHaveLength(1);
    const stayAfterEarlyCheckout = H.stayStore.get(stay.id);
    expect(stayAfterEarlyCheckout.total_nights).toBe(4);
    expect(stayAfterEarlyCheckout.payment_amount).toBe(55000);
    expect(stayAfterEarlyCheckout.early_checkout_applied).toBe(true);
    expect(stayAfterEarlyCheckout.status).toBe("ACTIVE");

    // 5. Record the refund (15,000 — exactly the excess).
    const refundResult = await recordTransaction({
      stayEntryId: stay.id,
      transactionType: "REFUND",
      amount: 15000,
      transactionDate: TODAY_IST,
      comment: null,
      remark: "Refunded via UPI to source account",
      createdBy: null,
    });
    expect(refundResult.ok).toBe(true);

    // No extraneous ledger rows: exactly three rows total (Req 12.11).
    const ledgerAfterRefund = H.ledgerOf(stay.id);
    expect(ledgerAfterRefund).toHaveLength(3);

    // 6. Balance is now exactly zero.
    const balanceAfterRefund = deriveStayBalance(
      55000,
      ledgerAfterRefund.map(mapTransactionRowToDomain),
    );
    expect(balanceAfterRefund.remainingBalance).toBe(0);
    expect(balanceAfterRefund.isFullyPaid).toBe(true);

    // 7. Checkout now succeeds and finishes the stay with an invoice
    // (Req 12.13).
    const checkoutResult = await checkoutStay(stay.id);
    expect(checkoutResult).toMatchObject({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "GENERATED",
    });

    // 8. Exactly one invoice row, reflecting the recalculated total; the
    // stay's invoice linkage was set exactly once (Req 9.2, 8.6).
    expect(calls.paymentsInsert).toHaveLength(1);
    expect(calls.paymentsInsert[0]).toMatchObject({
      invoice_type: "ACCOMMODATION_FINAL_INVOICE",
      amount: 55000,
    });
    expect(calls.attachFinalInvoice).toHaveLength(1);

    // 9. The stay row itself carries the recalculated actual nights, which
    // the invoice branch (task 8.1) reads from the stay row.
    const finalStayRow = H.stayStore.get(stay.id);
    expect(finalStayRow.actual_nights_stayed).toBe(4);
    expect(finalStayRow.status).toBe("FINISHED");
  });
});
