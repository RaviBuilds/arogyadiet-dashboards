// src/services/__tests__/AccommodationService.nonInvoicedCheckout.test.ts
// Feature: accommodation-payment-lifecycle — Task 7.8
//
// Example-based unit tests (not property-based) for:
//   1. Zero Total_Stay_Amount and shared-payment stays reach FINISHED with
//      no invoice and `invoiceStatus: "NOT_APPLICABLE"`.
//   2. `VALID_TRANSITIONS` is unchanged — the FINISHED-at-creation branch for
//      a backdated stay is a creation-time status ASSIGNMENT
//      (`determineInitialStatus`), not a transition through
//      `transitionStatus` / `VALID_TRANSITIONS`.
//
// **Validates: Requirements 3.3, 4.7, 8.2**
//
// `checkoutStay` delegates the ACTIVE + zero-balance gate to
// `stayRepository.finalizeCheckout` and, once that gate passes, calls
// `generateFinalInvoice` — which reads the stay via `stayRepository.getStayById`
// and decides NOT_APPLICABLE for a shared-payment or zero/null-total stay
// before ever touching `createAdminClient()`'s `payments` table. Mocking
// follows the exact `vi.mock` / hoisted-state convention already established
// in `AccommodationService.checkout.property.test.ts` and
// `AccommodationService.finalInvoiceIdempotence.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const calls: any = {
    finalizeCheckout: [] as string[],
    getStayById: [] as string[],
    attachFinalInvoice: [] as any[],
    recordFinalInvoiceFailure: [] as any[],
    paymentsInsert: [] as any[],
  };

  function reset() {
    calls.finalizeCheckout = [];
    calls.getStayById = [];
    calls.attachFinalInvoice = [];
    calls.recordFinalInvoiceFailure = [];
    calls.paymentsInsert = [];
  }

  return { calls, reset };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    finalizeCheckout: vi.fn(async (stayId: string) => {
      calls.finalizeCheckout.push(stayId);
      return (H as any).finalizeCheckoutResult;
    }),
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      return (H as any).stayRowAfterFinalize;
    }),
    attachFinalInvoice: vi.fn(async (stayId: string, paymentId: string) => {
      calls.attachFinalInvoice.push({ stayId, paymentId });
    }),
    recordFinalInvoiceFailure: vi.fn(async (stayId: string, message: string) => {
      calls.recordFinalInvoiceFailure.push({ stayId, message });
    }),
  };
});

// Tripwire: if generateFinalInvoice ever reaches the `payments` insert for a
// non-billable stay, this mock records it so the assertion can catch it.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      insert: (row: any) => {
        H.calls.paymentsInsert.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "should-not-be-created" }, error: null }),
          }),
        };
      },
    }),
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import {
  checkoutStay,
  VALID_TRANSITIONS,
  transitionStatus,
  determineInitialStatus,
} from "@/services/AccommodationService";
import type { StayEntryRow } from "@/repositories/stayRepository";
import { fixtureUuid, DEFAULT_STAY_ID } from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CUSTOMER_PROFILE_ID = fixtureUuid(22, 1);
const PAYMENT_HOST_PROFILE_ID = fixtureUuid(22, 9);

function buildFinishedRow(overrides: Partial<StayEntryRow> = {}): StayEntryRow {
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: CUSTOMER_PROFILE_ID,
    start_date: "2025-01-01",
    total_nights: 5,
    stay_type: "AC Villa",
    occupancy_type: "Single",
    status: "FINISHED",
    payment_amount: null,
    base_amount: null,
    tax_amount: null,
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
    ...overrides,
  };
}

// ─── 1. Zero-total and shared-payment stays reach FINISHED with no invoice ──

describe("Task 7.8: non-invoiced checkout paths (Req 3.3, 4.7, 8.2)", () => {
  it("a zero Total_Stay_Amount stay (payment_amount = 0) reaches FINISHED with invoiceStatus NOT_APPLICABLE and creates no invoice", async () => {
    const row = buildFinishedRow({ payment_amount: 0, base_amount: 0, tax_amount: 0 });
    (H as any).finalizeCheckoutResult = { ok: true, stay: row };
    (H as any).stayRowAfterFinalize = row;

    const result = await checkoutStay(DEFAULT_STAY_ID);

    expect(result).toEqual({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "NOT_APPLICABLE",
    });

    // No invoice-related activity — NOT_APPLICABLE is decided before any
    // `payments` insert is attempted.
    expect(calls.paymentsInsert).toHaveLength(0);
    expect(calls.attachFinalInvoice).toHaveLength(0);
    expect(calls.recordFinalInvoiceFailure).toHaveLength(0);
  });

  it("a null Total_Stay_Amount stay (payment_amount = null) reaches FINISHED with invoiceStatus NOT_APPLICABLE and creates no invoice", async () => {
    const row = buildFinishedRow({ payment_amount: null, base_amount: null, tax_amount: null });
    (H as any).finalizeCheckoutResult = { ok: true, stay: row };
    (H as any).stayRowAfterFinalize = row;

    const result = await checkoutStay(DEFAULT_STAY_ID);

    expect(result).toEqual({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "NOT_APPLICABLE",
    });

    expect(calls.paymentsInsert).toHaveLength(0);
    expect(calls.attachFinalInvoice).toHaveLength(0);
    expect(calls.recordFinalInvoiceFailure).toHaveLength(0);
  });

  it("a shared-payment stay (payment_host_profile_id set, positive total) reaches FINISHED with invoiceStatus NOT_APPLICABLE and creates no invoice", async () => {
    const row = buildFinishedRow({
      payment_amount: 50000,
      base_amount: 42372.88,
      tax_amount: 7627.12,
      payment_host_profile_id: PAYMENT_HOST_PROFILE_ID,
    });
    (H as any).finalizeCheckoutResult = { ok: true, stay: row };
    (H as any).stayRowAfterFinalize = row;

    const result = await checkoutStay(DEFAULT_STAY_ID);

    expect(result).toEqual({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "NOT_APPLICABLE",
    });

    expect(calls.paymentsInsert).toHaveLength(0);
    expect(calls.attachFinalInvoice).toHaveLength(0);
    expect(calls.recordFinalInvoiceFailure).toHaveLength(0);
  });

  it("a shared-payment stay with a null total also reaches FINISHED with invoiceStatus NOT_APPLICABLE and creates no invoice", async () => {
    const row = buildFinishedRow({
      payment_amount: null,
      base_amount: null,
      tax_amount: null,
      payment_host_profile_id: PAYMENT_HOST_PROFILE_ID,
    });
    (H as any).finalizeCheckoutResult = { ok: true, stay: row };
    (H as any).stayRowAfterFinalize = row;

    const result = await checkoutStay(DEFAULT_STAY_ID);

    expect(result).toEqual({
      ok: true,
      status: "FINISHED",
      invoiceStatus: "NOT_APPLICABLE",
    });

    expect(calls.paymentsInsert).toHaveLength(0);
    expect(calls.attachFinalInvoice).toHaveLength(0);
    expect(calls.recordFinalInvoiceFailure).toHaveLength(0);
  });
});

// ─── 2. VALID_TRANSITIONS unchanged; FINISHED-at-creation is not a transition ─

describe("Task 7.8: VALID_TRANSITIONS is unchanged by the backdated FINISHED-at-creation branch (Req 3.3)", () => {
  it("VALID_TRANSITIONS deep-equals the original transition table exactly, with no new entries for FINISHED-at-creation", () => {
    expect(VALID_TRANSITIONS).toEqual({
      PENDING: ["ACTIVE", "EXPIRED"],
      ACTIVE: ["FINISHED"],
      FINISHED: [],
      EXPIRED: [],
    });

    // Explicitly guard against a PENDING → FINISHED entry sneaking in to
    // "support" the backdated case — it must not be there.
    expect(VALID_TRANSITIONS.PENDING).not.toContain("FINISHED");
  });

  it("determineInitialStatus assigns FINISHED directly for a backdated stay whose computed end date has already passed", () => {
    const todayIST = "2025-01-15";
    // Start date 10 days ago, only 3 nights booked → end date is 7 days in
    // the past, i.e. already before todayIST.
    const startDate = "2025-01-05";
    const totalNights = 3;

    const status = determineInitialStatus(startDate, totalNights, todayIST);

    expect(status).toBe("FINISHED");
  });

  it("transitionStatus(PENDING, FINISHED) is rejected by the transition table, proving FINISHED-at-creation bypasses it entirely", () => {
    const result = transitionStatus("PENDING", "FINISHED");

    expect(result).not.toEqual({ success: true });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Invalid transition from PENDING to FINISHED/);
    }
  });

  it("transitionStatus(ACTIVE, FINISHED) remains a valid transition (unaffected by the backdated branch)", () => {
    const result = transitionStatus("ACTIVE", "FINISHED");
    expect(result).toEqual({ success: true });
  });
});
