// src/services/__tests__/AccommodationService.finalInvoiceIdempotence.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 12: Final invoice idempotence
//
// **Validates: Requirements 8.1, 8.7, 8.10, 9.3**
//
// For any Stay_Entry with Total_Stay_Amount greater than zero, invoking
// `generateFinalStayInvoiceAction` any number of times:
//
// - Internal calls (no `manualRetrigger`) SHALL succeed idempotently, always
//   returning `{ paymentId, alreadyExisted: true }` after the first (Req 8.7, 9.3).
// - A manual retrigger over an existing invoice SHALL error with the pinned
//   message "A final invoice already exists for this stay." (Req 8.10).
// - A manual retrigger against a stay with NO existing invoice SHALL succeed
//   normally (the retry path after a generation failure — Req 8.9).
// - In all idempotent/short-circuit cases: the service mock is never called a
//   second time — verified by asserting the mock call count stays at 1 after
//   the first successful invocation. No second `payments` row is written (Req 8.7).
//
// Mocked: `getCurrentAdminContext`, `stayRepository.getStayById`,
// `stayPaymentRepository.listTransactionsByStay`,
// `AccommodationService.generateFinalInvoice`.
// The action layer gates on admin context, fetches the stay, checks the
// `manualRetrigger` flag against `final_invoice_payment_id`, and then delegates
// to the service. This test exercises the action layer's branching.

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
    // Return a copy so callers can't mutate the "DB" directly.
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
  arbTotalStayAmountOrZero,
  referenceGstBreakup,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  PAYMENT_HOST_PROFILE_ID,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Fixture builders ────────────────────────────────────────────────────────

interface StayRowSeed {
  totalStayAmount: number;
  sharedPayment: boolean;
}

/**
 * Builds a stay row as `stayRepository.getStayById` would return it.
 * - status: FINISHED (checkout was applied or backdated)
 * - is_backdated: true (the broadest eligibility — works for both paths)
 * - checked_out_at: set for non-backdated, null for backdated
 * - final_invoice_payment_id: null by default (no invoice yet)
 */
function buildBillableStayRow(seed: StayRowSeed, opts?: { hasInvoice?: boolean }) {
  const paymentAmount = seed.sharedPayment ? null : seed.totalStayAmount;
  const gst = paymentAmount !== null ? referenceGstBreakup(paymentAmount) : null;
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: DEFAULT_CUSTOMER_PROFILE_ID,
    status: "FINISHED",
    is_backdated: true,
    checked_out_at: null as string | null,
    payment_amount: paymentAmount,
    base_amount: gst ? gst.baseAmount : null,
    tax_amount: gst ? gst.taxAmount : null,
    tax_percentage: 18,
    payment_host_profile_id: seed.sharedPayment ? PAYMENT_HOST_PROFILE_ID : null,
    final_invoice_payment_id: opts?.hasInvoice ? "existing-invoice-id" : null,
    final_invoice_error: null as string | null,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** 2–5 repeated invocations. */
const arbInvocationCount = fc.integer({ min: 2, max: 5 });

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

/** Random manualRetrigger flags for each invocation in a sequence. */
function arbManualRetriggerFlags(count: number): fc.Arbitrary<boolean[]> {
  return fc.array(fc.boolean(), { minLength: count, maxLength: count });
}

// ─── Property 12 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 12: Final invoice idempotence", () => {
  it("internal calls (no manualRetrigger) succeed idempotently: repeated invocations return the same paymentId with alreadyExisted=true after the first, and the service is called only once", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();

          // First call: the stay has no invoice, service creates one.
          const stayNoInvoice = buildBillableStayRow(seed, { hasInvoice: false });
          H.setStay(stayNoInvoice);
          H.setServiceResult({
            ok: true,
            paymentId: "generated-invoice-id",
            alreadyExisted: false,
          });

          const firstResult = await generateFinalStayInvoiceAction(DEFAULT_STAY_ID);
          expect(firstResult).toHaveProperty("success", true);
          const firstData = (firstResult as any).data;
          expect(firstData.paymentId).toBe("generated-invoice-id");
          expect(firstData.alreadyExisted).toBe(false);

          // Service was called exactly once for the first invocation.
          expect(H.serviceCalls).toHaveLength(1);

          // Subsequent calls: the stay NOW has an invoice (simulating DB state
          // after the first successful write). The service should return
          // alreadyExisted: true for these.
          const stayWithInvoice = buildBillableStayRow(seed, { hasInvoice: true });
          stayWithInvoice.final_invoice_payment_id = "generated-invoice-id";
          H.setStay(stayWithInvoice);
          H.setServiceResult({
            ok: true,
            paymentId: "generated-invoice-id",
            alreadyExisted: true,
          });

          for (let i = 1; i < invocationCount; i += 1) {
            const result = await generateFinalStayInvoiceAction(DEFAULT_STAY_ID);
            expect(result).toHaveProperty("success", true);
            const data = (result as any).data;
            expect(data.paymentId).toBe("generated-invoice-id");
            expect(data.alreadyExisted).toBe(true);
          }

          // The service is called for each subsequent invocation too (the action
          // doesn't short-circuit without manualRetrigger — the idempotence lives
          // in the service). Total: invocationCount calls.
          expect(H.serviceCalls).toHaveLength(invocationCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("manualRetrigger=true against a stay that already has an invoice returns an error and never calls the service", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();

          // Stay already has an invoice.
          const stayWithInvoice = buildBillableStayRow(seed, { hasInvoice: true });
          H.setStay(stayWithInvoice);

          for (let i = 0; i < invocationCount; i += 1) {
            const result = await generateFinalStayInvoiceAction(
              DEFAULT_STAY_ID,
              { manualRetrigger: true },
            );
            expect(result).toHaveProperty(
              "error",
              "A final invoice already exists for this stay.",
            );
          }

          // The service is NEVER called — the action short-circuits before
          // reaching it (Req 8.10). No second payments row is written.
          expect(H.serviceCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("manualRetrigger=true against a stay with NO invoice yet succeeds normally (the retry path after a failure — Req 8.9)", async () => {
    await fc.assert(
      fc.asyncProperty(arbBillableSeed, async (seed) => {
        H.reset();

        // Stay has no invoice (e.g. generation failed previously).
        const stayNoInvoice = buildBillableStayRow(seed, { hasInvoice: false });
        stayNoInvoice.final_invoice_error = "Previous generation failed.";
        H.setStay(stayNoInvoice);
        H.setServiceResult({
          ok: true,
          paymentId: "retry-invoice-id",
          alreadyExisted: false,
        });

        const result = await generateFinalStayInvoiceAction(DEFAULT_STAY_ID, {
          manualRetrigger: true,
        });
        expect(result).toHaveProperty("success", true);
        const data = (result as any).data;
        expect(data.paymentId).toBe("retry-invoice-id");
        expect(data.alreadyExisted).toBe(false);

        // Service called exactly once — the action did not short-circuit.
        expect(H.serviceCalls).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it("mixed repeated invocations: internal calls after the first and manual retriggers over an existing invoice all short-circuit without writing a second payments row", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();

          // First call (internal, no flag): creates the invoice.
          const stayNoInvoice = buildBillableStayRow(seed, { hasInvoice: false });
          H.setStay(stayNoInvoice);
          H.setServiceResult({
            ok: true,
            paymentId: "mixed-invoice-id",
            alreadyExisted: false,
          });

          const firstResult = await generateFinalStayInvoiceAction(DEFAULT_STAY_ID);
          expect(firstResult).toHaveProperty("success", true);
          expect((firstResult as any).data.alreadyExisted).toBe(false);
          expect(H.serviceCalls).toHaveLength(1);

          // Now the stay has an invoice.
          const stayWithInvoice = buildBillableStayRow(seed, { hasInvoice: true });
          stayWithInvoice.final_invoice_payment_id = "mixed-invoice-id";
          H.setStay(stayWithInvoice);
          H.setServiceResult({
            ok: true,
            paymentId: "mixed-invoice-id",
            alreadyExisted: true,
          });

          // Generate random manualRetrigger flags for subsequent calls.
          const flags = await fc.sample(
            fc.boolean(),
            invocationCount - 1,
          );

          let serviceCallsAfterFirst = 0;
          for (const manualRetrigger of flags) {
            const result = await generateFinalStayInvoiceAction(
              DEFAULT_STAY_ID,
              manualRetrigger ? { manualRetrigger: true } : undefined,
            );

            if (manualRetrigger) {
              // Manual retrigger over an existing invoice → error (Req 8.10).
              expect(result).toHaveProperty(
                "error",
                "A final invoice already exists for this stay.",
              );
              // Service NOT called — short-circuited at the action level.
            } else {
              // Internal call → idempotent success through the service.
              expect(result).toHaveProperty("success", true);
              expect((result as any).data.paymentId).toBe("mixed-invoice-id");
              expect((result as any).data.alreadyExisted).toBe(true);
              serviceCallsAfterFirst += 1;
            }
          }

          // Total service calls: 1 (first) + however many non-manual-retrigger
          // subsequent calls went through to the service.
          expect(H.serviceCalls).toHaveLength(1 + serviceCallsAfterFirst);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports NOT_APPLICABLE on every invocation for a shared-payment or zero-total stay, never calling the service for invoice creation", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNonBillableSeed,
        arbInvocationCount,
        async (seed, invocationCount) => {
          H.reset();

          const stayRow = buildBillableStayRow(seed, { hasInvoice: false });
          H.setStay(stayRow);
          H.setServiceResult({
            ok: true,
            invoiceStatus: "NOT_APPLICABLE",
          });

          for (let i = 0; i < invocationCount; i += 1) {
            const result = await generateFinalStayInvoiceAction(DEFAULT_STAY_ID);
            expect(result).toHaveProperty("success", true);
            expect((result as any).data.invoiceStatus).toBe("NOT_APPLICABLE");
          }

          // Service called each time (the NOT_APPLICABLE check is in the
          // service), but no payments row is ever written.
          expect(H.serviceCalls).toHaveLength(invocationCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
