// src/services/__tests__/AccommodationService.finalInvoiceIdempotence.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 12: Final invoice idempotence
//
// **Validates: Requirements 8.1, 8.6, 9.3**
//
// For any Stay_Entry with Total_Stay_Amount greater than zero, invoking final
// invoice generation any number of times — through checkout, through the
// Backdated_Stay "Generate Final Invoice" action, or through the manual retry
// path — SHALL result in exactly one Final_Consolidated_Invoice for that
// Stay_Entry, and every invocation SHALL return the same invoice identifier.
// A shared-payment or zero-total stay SHALL report NOT_APPLICABLE on every
// invocation and never receive an invoice.
//
// `AccommodationService.generateFinalInvoice` reads the stay via
// `stayRepository.getStayById`, and — for a billable stay with no existing
// invoice — inserts a `payments` row via `createAdminClient()` and links it
// through `stayRepository.attachFinalInvoice`. We MOCK
// `@/repositories/stayRepository` (`getStayById`, `attachFinalInvoice`,
// `recordFinalInvoiceFailure`) with an in-memory "persisted stay" that
// `attachFinalInvoice` mutates in place — so a second invocation's
// `getStayById` call sees the same `final_invoice_payment_id` the first call
// would have written, mirroring what re-reading the row after a real insert
// would return. `@/lib/supabase/admin`'s `createAdminClient` is mocked with a
// fake `payments` table supporting the exact
// `.from("payments").insert(...).select("id").single()` chain the service
// uses, following the query-builder convention in
// `billingService.property.test.ts`.

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

  /** Seeds the "persisted" stay row that `getStayById` reads from. */
  function setStay(stay: any) {
    stayState = { ...stay };
  }

  /** The live, mutable persisted-stay object (attachFinalInvoice mutates it). */
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
      // Return a copy — callers must not be able to mutate the "DB" directly.
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

// ─── System under test (imported after the mocks are registered) ───────────
import {
  generateFinalInvoice,
  type GenerateInvoiceResult,
} from "@/services/AccommodationService";
import {
  arbTotalStayAmount,
  arbTotalStayAmountOrZero,
  referenceGstBreakup,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  PAYMENT_HOST_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface StayRowSeed {
  totalStayAmount: number;
  sharedPayment: boolean;
}

/** Builds a fresh "persisted" stay_entries row with no invoice yet. */
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

function isCreatedInvoiceResult(
  result: GenerateInvoiceResult,
): result is { ok: true; paymentId: string; alreadyExisted: boolean } {
  return result.ok === true && "paymentId" in result;
}

function isNotApplicableResult(
  result: GenerateInvoiceResult,
): result is { ok: true; invoiceStatus: "NOT_APPLICABLE" } {
  return result.ok === true && "invoiceStatus" in result;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** 1–5 invocations, per design.md's PBT strategy table for Property 12. */
const arbInvocationCount = fc.integer({ min: 1, max: 5 });

/** A billable stay: non-shared payment, positive Total_Stay_Amount. */
const arbBillableSeed: fc.Arbitrary<StayRowSeed> = arbTotalStayAmount.map(
  (totalStayAmount) => ({ totalStayAmount, sharedPayment: false }),
);

/** A non-billable stay: shared payment (any total) or a zero total. */
const arbNonBillableSeed: fc.Arbitrary<StayRowSeed> = fc.oneof(
  fc.record({
    sharedPayment: fc.constant(true),
    totalStayAmount: arbTotalStayAmountOrZero,
  }),
  fc.record({
    sharedPayment: fc.constant(false),
    totalStayAmount: fc.constant(0),
  }),
);

// ─── Property 12 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 12: Final invoice idempotence", () => {
  it("creates exactly one Final_Consolidated_Invoice across 1-5 invocations for a billable stay, every call returning the same invoice id", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();
          H.setStay(buildStayRow(seed));

          const results: GenerateInvoiceResult[] = [];
          for (let i = 0; i < invocationCount; i += 1) {
            results.push(await generateFinalInvoice(DEFAULT_STAY_ID));
          }

          // Exactly one insert and exactly one link, regardless of N (Req 8.6).
          expect(H.calls.paymentsInsert).toHaveLength(1);
          expect(H.calls.attachFinalInvoice).toHaveLength(1);

          // First call created the invoice (Req 8.1).
          const first = results[0];
          expect(first.ok).toBe(true);
          if (!isCreatedInvoiceResult(first)) {
            throw new Error(
              `expected the first call to create an invoice, got ${JSON.stringify(first)}`,
            );
          }
          expect(first.alreadyExisted).toBe(false);
          const invoiceId = first.paymentId;
          expect(typeof invoiceId).toBe("string");

          // Every subsequent call is idempotent: same id, alreadyExisted true,
          // no additional insert or link (Req 8.6, 9.3, Property 12).
          for (let i = 1; i < invocationCount; i += 1) {
            const subsequent = results[i];
            expect(subsequent.ok).toBe(true);
            if (!isCreatedInvoiceResult(subsequent)) {
              throw new Error(
                `expected call ${i} to report the existing invoice, got ${JSON.stringify(subsequent)}`,
              );
            }
            expect(subsequent.alreadyExisted).toBe(true);
            expect(subsequent.paymentId).toBe(invoiceId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports NOT_APPLICABLE on every invocation for a shared-payment or zero-total stay, never inserting an invoice", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNonBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();
          H.setStay(buildStayRow(seed));

          for (let i = 0; i < invocationCount; i += 1) {
            const result = await generateFinalInvoice(DEFAULT_STAY_ID);
            expect(result.ok).toBe(true);
            if (!isNotApplicableResult(result)) {
              throw new Error(
                `expected NOT_APPLICABLE, got ${JSON.stringify(result)}`,
              );
            }
            expect(result.invoiceStatus).toBe("NOT_APPLICABLE");
          }

          expect(H.calls.paymentsInsert).toHaveLength(0);
          expect(H.calls.attachFinalInvoice).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
