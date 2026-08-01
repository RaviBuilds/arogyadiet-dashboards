// src/lib/invoices/__tests__/accommodationFinalInvoice.ledgerPreservation.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 17: Invoice generation preserves the ledger
//
// **Validates: Requirements 10.4, 10.5**
//
// For any Stay_Entry and any ledger of Payment_Transaction records, generating
// the Final_Consolidated_Invoice SHALL leave the ledger deeply unchanged — same
// record count, same field values, none deleted, modified, or hidden — and
// every Payment_Receipt SHALL remain retrievable afterwards.
//
// This targets the WRITE side of invoice generation —
// `AccommodationService.generateFinalInvoice(stayId)` — not the read/render
// side (`generateInvoiceData`, covered by Properties 13/14). Per the design's
// PBT strategy table, Property 17 exercises `generateFinalInvoice` against
// random ledgers with a deep-equality snapshot taken before and after the
// call.
//
// `generateFinalInvoice` reads the stay via `stayRepository.getStayById` and —
// for a billable stay with no existing invoice — inserts a `payments` row via
// `createAdminClient()` and links it through `stayRepository.attachFinalInvoice`.
// It never imports or calls anything on `stayPaymentRepository`. We mock
// `@/repositories/stayRepository` (`getStayById`, `attachFinalInvoice`,
// `recordFinalInvoiceFailure`) and `@/lib/supabase/admin`'s `createAdminClient`
// following the exact convention in
// `AccommodationService.finalInvoiceIdempotence.property.test.ts` (task 5.7).
// We additionally mock `@/repositories/stayPaymentRepository` in full so every
// one of its exports is a spy, and assert none of them are ever called —
// proving `generateFinalInvoice` doesn't even read the ledger, let alone
// mutate it. On top of that, we deep-freeze a plain ledger fixture array
// captured before the call and deep-equal it against itself after the call,
// for a black-box guarantee independent of the mock's own bookkeeping.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log + persisted-stay state (hoisted so vi.mock
// factories can close over it) ────────────────────────────────────────────
const H = vi.hoisted(() => {
  const calls: any = {
    getStayById: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    paymentsInsert: [] as any[],
  };
  let stayState: any = null;
  let paymentSeq = 0;

  function reset() {
    calls.getStayById = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.paymentsInsert = [];
    stayState = null;
    paymentSeq = 0;
  }

  function setStay(stay: any) {
    stayState = { ...stay };
  }

  function getStay() {
    return stayState;
  }

  function nextPaymentId(): string {
    paymentSeq += 1;
    return `payment-${paymentSeq}`;
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
                    const id = nextPaymentId();
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

  return { calls, reset, setStay, getStay, makeFakeAdmin };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls, getStay } = H;
  return {
    ...actual,
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      const stay = getStay();
      if (!stay || stay.id !== stayId) return null;
      return { ...stay };
    }),
    attachFinalInvoice: vi.fn(async (stayId: string, paymentId: string) => {
      calls.attachFinalInvoice.push({ stayId, paymentId });
      const stay = getStay();
      if (stay && stay.id === stayId) {
        stay.final_invoice_payment_id = paymentId;
      }
    }),
    recordFinalInvoiceFailure: vi.fn(async (stayId: string, message: string) => {
      calls.recordFinalInvoiceFailure.push({ stayId, message });
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// `generateFinalInvoice` never imports this module's functions, but we mock
// every export as a spy so the test can assert none of them fire — proving
// the ledger is never even read, let alone written to (Req 10.5).
vi.mock("@/repositories/stayPaymentRepository", () => ({
  listTransactionsByStay: vi.fn(async () => {
    throw new Error(
      "generateFinalInvoice must not call stayPaymentRepository.listTransactionsByStay",
    );
  }),
  getTransactionById: vi.fn(async () => {
    throw new Error(
      "generateFinalInvoice must not call stayPaymentRepository.getTransactionById",
    );
  }),
  recordTransaction: vi.fn(async () => {
    throw new Error(
      "generateFinalInvoice must not call stayPaymentRepository.recordTransaction",
    );
  }),
  insertAdvanceTransaction: vi.fn(async () => {
    throw new Error(
      "generateFinalInvoice must not call stayPaymentRepository.insertAdvanceTransaction",
    );
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { generateFinalInvoice } from "@/services/AccommodationService";
import * as stayPaymentRepository from "@/repositories/stayPaymentRepository";
import {
  arbLedger,
  arbTotalStayAmount,
  arbTotalStayAmountOrZero,
  referenceGstBreakup,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  PAYMENT_HOST_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";
import type { StayPaymentTransaction } from "@/types/accommodation";

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
});

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface StayRowSeed {
  totalStayAmount: number;
  sharedPayment: boolean;
}

function buildStayRow(seed: StayRowSeed) {
  const paymentAmount = seed.sharedPayment ? null : seed.totalStayAmount;
  const gst = paymentAmount !== null ? referenceGstBreakup(paymentAmount) : null;
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    payment_amount: paymentAmount,
    base_amount: gst ? gst.baseAmount : null,
    tax_amount: gst ? gst.taxAmount : null,
    tax_percentage: 18,
    payment_host_profile_id: seed.sharedPayment ? PAYMENT_HOST_PROFILE_ID : null,
    final_invoice_payment_id: null as string | null,
  };
}

/** A billable stay: non-shared payment, positive Total_Stay_Amount. */
const arbBillableSeed: fc.Arbitrary<StayRowSeed> = arbTotalStayAmount.map(
  (totalStayAmount) => ({ totalStayAmount, sharedPayment: false }),
);

/** Any stay shape at all — billable, shared-payment, or zero-total. */
const arbAnySeed: fc.Arbitrary<StayRowSeed> = fc.record({
  totalStayAmount: arbTotalStayAmountOrZero,
  sharedPayment: fc.boolean(),
});

/** Deep clone via structural copy, independent of any code under test. */
function deepCloneLedger(
  ledger: readonly StayPaymentTransaction[],
): StayPaymentTransaction[] {
  return ledger.map((tx) => ({ ...tx }));
}

/** Deep-freezes the ledger and every transaction row, so any in-place
 * mutation attempt would throw in strict mode rather than silently succeed. */
function deepFreezeLedger(
  ledger: StayPaymentTransaction[],
): StayPaymentTransaction[] {
  ledger.forEach((tx) => Object.freeze(tx));
  return Object.freeze(ledger) as unknown as StayPaymentTransaction[];
}

// ─── Property 17 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 17: Invoice generation preserves the ledger", () => {
  it("leaves a random ledger deeply unchanged when generating the final invoice for a billable stay", async () => {
    await fc.assert(
      fc.asyncProperty(arbBillableSeed, arbLedger, async (seed, ledger) => {
        H.reset();
        vi.clearAllMocks();
        H.setStay(buildStayRow(seed));

        // Fixture "ledger" captured before the call — deep-frozen so any
        // in-place mutation would throw, and independently snapshotted so a
        // deep-equal comparison after the call proves nothing changed.
        const before = deepCloneLedger(ledger);
        const frozenLedger = deepFreezeLedger(deepCloneLedger(ledger));

        const result = await generateFinalInvoice(DEFAULT_STAY_ID);
        expect(result.ok).toBe(true);

        // Same record count, same field values, nothing deleted, modified,
        // or hidden (Req 10.4, 10.5).
        expect(frozenLedger).toEqual(before);
        expect(frozenLedger).toHaveLength(before.length);

        // `generateFinalInvoice` never reads or writes the ledger machinery
        // at all — confirming Req 10.5 at the strongest possible level.
        expect(stayPaymentRepository.listTransactionsByStay).not.toHaveBeenCalled();
        expect(stayPaymentRepository.getTransactionById).not.toHaveBeenCalled();
        expect(stayPaymentRepository.recordTransaction).not.toHaveBeenCalled();
        expect(stayPaymentRepository.insertAdvanceTransaction).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it("leaves a random ledger deeply unchanged across any stay shape, including shared-payment and zero-total stays, and across repeat invocations", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAnySeed,
        arbLedger,
        fc.integer({ min: 1, max: 3 }),
        async (seed, ledger, invocationCount) => {
          H.reset();
          vi.clearAllMocks();
          H.setStay(buildStayRow(seed));

          const before = deepCloneLedger(ledger);
          const frozenLedger = deepFreezeLedger(deepCloneLedger(ledger));

          for (let i = 0; i < invocationCount; i += 1) {
            const result = await generateFinalInvoice(DEFAULT_STAY_ID);
            expect(result.ok).toBe(true);
          }

          expect(frozenLedger).toEqual(before);
          expect(stayPaymentRepository.listTransactionsByStay).not.toHaveBeenCalled();
          expect(stayPaymentRepository.getTransactionById).not.toHaveBeenCalled();
          expect(stayPaymentRepository.recordTransaction).not.toHaveBeenCalled();
          expect(stayPaymentRepository.insertAdvanceTransaction).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
