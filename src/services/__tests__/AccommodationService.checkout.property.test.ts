// src/services/__tests__/AccommodationService.checkout.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 11: Checkout gate
//
// **Validates: Requirements 7.3, 7.4, 7.5**
//
// For any Stay_Entry and any ledger, invoking Mark as Checked Out
// (`AccommodationService.checkoutStay`) SHALL transition the stay from
// ACTIVE to FINISHED if and only if its status is ACTIVE and its
// Remaining_Balance is exactly zero; in every other case the server SHALL
// return an error — naming the outstanding balance when the balance is
// non-zero and stating that checkout applies only to active stays when the
// status is not ACTIVE — and SHALL leave the stay's status and ledger
// unchanged.
//
// `checkoutStay` delegates the ACTIVE + zero-balance gate entirely to
// `stayRepository.finalizeCheckout` (the row-locking `finalize_stay_checkout`
// RPC) and only proceeds to invoice generation once that gate has already
// passed. This test mocks `finalizeCheckout` to faithfully reproduce the
// RPC's own documented gating logic (design.md, `finalize_stay_checkout`) —
// the RPC's own arithmetic is covered by task 4.3's DB-backed integration
// tests — so this property exercises `checkoutStay`'s COMPOSITION of that
// response: rejections are returned unchanged and never reach invoice
// generation, and only a successful gate proceeds to it.
//
// The invoice-generation path (`generateFinalInvoice`, reached only on a
// passing gate) is stood in by a minimal `@/lib/supabase/admin` mock so the
// success branch never touches a real network call; its own correctness
// (idempotence, figures, failure handling) is covered by Properties 12/13/15
// and is out of scope here.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

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

// Minimal stand-in for the invoice insert reached only on a passing gate —
// the invoice pipeline's own correctness is Properties 12/13/15's scope.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      insert: (row: any) => {
        H.calls.paymentsInsert.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "final-invoice-id" }, error: null }),
          }),
        };
      },
    }),
  }),
}));

// ─── System under test (imported after the mocks are registered) ───────────
import { checkoutStay } from "@/services/AccommodationService";
import type { StayStatus } from "@/types/accommodation";
import type { StayEntryRow } from "@/repositories/stayRepository";
import {
  fixtureUuid,
  DEFAULT_STAY_ID,
  UNKNOWN_UUID,
  arbMoney,
} from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFinishedRow(): StayEntryRow {
  return {
    id: DEFAULT_STAY_ID,
    customer_profile_id: fixtureUuid(22, 1),
    start_date: "2025-01-01",
    total_nights: 5,
    stay_type: "AC Villa",
    occupancy_type: "Single",
    status: "FINISHED",
    payment_amount: 0,
    base_amount: 0,
    tax_amount: 0,
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
  };
}

/**
 * Faithfully reproduces `finalize_stay_checkout`'s own documented gating
 * logic (design.md): NOT_ACTIVE when status isn't ACTIVE, BALANCE_OUTSTANDING
 * when the balance is non-zero, otherwise ok with the FINISHED row. This is
 * the reference the property checks `checkoutStay`'s composition against —
 * the RPC's own arithmetic is validated independently by task 4.3.
 */
function referenceFinalizeCheckout(
  status: StayStatus,
  remainingBalance: number
): any {
  if (status !== "ACTIVE") {
    return { ok: false, reason: "NOT_ACTIVE", status };
  }
  if (remainingBalance !== 0) {
    return { ok: false, reason: "BALANCE_OUTSTANDING", remainingBalance };
  }
  return { ok: true, stay: buildFinishedRow() };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const STAY_STATUSES: StayStatus[] = ["PENDING", "ACTIVE", "FINISHED", "EXPIRED"];

/**
 * A remaining balance carrying the boundary the gate turns on: exactly zero
 * (passes), ±0.01 either side (rejected — mirroring the RPC's own exact
 * paise-level check, not re-deriving it), and a broader spread of values
 * drawn from `arbMoney`, both positive (outstanding) and negative
 * (overpaid/refund-due).
 */
const arbRemainingBalance: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constant(0), weight: 4 },
  { arbitrary: fc.constantFrom(0.01, -0.01), weight: 3 },
  {
    arbitrary: arbMoney.chain((amount) =>
      fc.constantFrom(amount, -amount)
    ),
    weight: 3,
  },
);

const arbCheckoutScenario = fc.record({
  status: fc.constantFrom(...STAY_STATUSES),
  remainingBalance: arbRemainingBalance,
});

// ─── Property 11 ─────────────────────────────────────────────────────────────
describe("Feature: accommodation-payment-lifecycle, Property 11: Checkout gate", () => {
  it("transitions ACTIVE + zero-balance stays to FINISHED and rejects every other combination unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbCheckoutScenario, async (scenario) => {
        H.reset();

        (H as any).finalizeCheckoutResult = referenceFinalizeCheckout(
          scenario.status,
          scenario.remainingBalance
        );
        // Only reached on a passing gate — a zero/null total keeps the
        // invoice path at NOT_APPLICABLE without touching the admin mock.
        (H as any).stayRowAfterFinalize = buildFinishedRow();

        const isGatePass =
          scenario.status === "ACTIVE" && scenario.remainingBalance === 0;

        const result = await checkoutStay(DEFAULT_STAY_ID);

        // finalizeCheckout is always consulted exactly once.
        expect(calls.finalizeCheckout).toEqual([DEFAULT_STAY_ID]);

        if (isGatePass) {
          // Status ACTIVE + Remaining_Balance exactly zero ⇒ transitions to
          // FINISHED (Req 7.3).
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.status).toBe("FINISHED");
          }
        } else {
          // Every other combination ⇒ rejected, unchanged.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            if (scenario.status !== "ACTIVE") {
              // Not ACTIVE ⇒ "checkout applies only to active stays" (Req 7.5).
              expect(result.reason).toBe("NOT_ACTIVE");
            } else {
              // ACTIVE but a non-zero balance ⇒ BALANCE_OUTSTANDING, naming
              // the outstanding amount (Req 7.4).
              expect(result.reason).toBe("BALANCE_OUTSTANDING");
              expect(result.remainingBalance).toBe(scenario.remainingBalance);
            }
          }

          // Rejection is returned unchanged — invoice generation (and thus
          // any further status/ledger mutation) is never attempted.
          expect(calls.getStayById).toHaveLength(0);
          expect(calls.attachFinalInvoice).toHaveLength(0);
          expect(calls.recordFinalInvoiceFailure).toHaveLength(0);
          expect(calls.paymentsInsert).toHaveLength(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("never reaches the checkout gate for an unknown stay id without asserting a fabricated success", async () => {
    // Sanity check that the mock/reference wiring itself distinguishes a
    // rejection (e.g. NOT_FOUND, as the real RPC would report) from success —
    // guards against the test doubles silently always answering "ok".
    H.reset();
    (H as any).finalizeCheckoutResult = { ok: false, reason: "NOT_FOUND" };
    (H as any).stayRowAfterFinalize = null;

    const result = await checkoutStay(UNKNOWN_UUID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_FOUND");
    }
    expect(calls.getStayById).toHaveLength(0);
    expect(calls.attachFinalInvoice).toHaveLength(0);
  });
});
