// src/actions/__tests__/stayInvoiceActions.manualRetrigger.test.ts
// Feature: accommodation-payment-lifecycle — `manualRetrigger` refinement
//
// Covers Requirements 8.7, 8.9, 8.10:
//   - internal invocation over an existing invoice → idempotent success
//   - explicit manual retrigger over an existing invoice → rejection, and the
//     service (the only writer of a `payments` row) is never reached
//   - manual retrigger with no invoice yet (retry after a recorded failure) →
//     succeeds
//
// `generateFinalStayInvoiceAction` reads the session via
// `getCurrentAdminContext()`, the stay via `stayRepository.getStayById`, and
// delegates to `AccommodationService.generateFinalInvoice`. All three are
// mocked here (no live database or session).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

const STAY_ID = "stay-1";
const EXISTING_INVOICE_ID = "payment-existing";

// ─── Hoisted controllable state (closed over by the vi.mock factories) ──────
const H = vi.hoisted(() => {
  let context: { userId: string | null; roleCode: string | null } = {
    userId: "admin-1",
    roleCode: "ADMIN",
  };
  let stayRow: any = null;
  const generateFinalInvoiceCalls: string[] = [];

  return {
    setContext: (next: typeof context) => {
      context = next;
    },
    getContext: () => context,
    setStayRow: (next: any) => {
      stayRow = next;
    },
    getStayRow: () => stayRow,
    generateFinalInvoiceCalls,
    reset: () => {
      context = { userId: "admin-1", roleCode: "ADMIN" };
      stayRow = null;
      generateFinalInvoiceCalls.length = 0;
    },
  };
});

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: vi.fn(async () => H.getContext()),
}));

vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getStayById: vi.fn(async (stayId: string) => {
      const stay = H.getStayRow();
      if (!stay || stay.id !== stayId) return null;
      return { ...stay };
    }),
  };
});

vi.mock("@/services/AccommodationService", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    generateFinalInvoice: vi.fn(async (stayId: string) => {
      H.generateFinalInvoiceCalls.push(stayId);
      const stay = H.getStayRow();
      if (stay?.final_invoice_payment_id) {
        return {
          ok: true,
          paymentId: stay.final_invoice_payment_id,
          alreadyExisted: true,
        };
      }
      return { ok: true, paymentId: "payment-new", alreadyExisted: false };
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { generateFinalStayInvoiceAction } from "@/actions/stayInvoiceActions";

beforeEach(() => {
  H.reset();
});

/** A checked-out, finished stay with a positive total. */
function buildCheckedOutStay(finalInvoicePaymentId: string | null) {
  return {
    id: STAY_ID,
    status: "FINISHED",
    is_backdated: false,
    checked_out_at: "2025-01-10T06:00:00.000Z",
    payment_amount: 10000,
    final_invoice_payment_id: finalInvoicePaymentId,
  };
}

describe("generateFinalStayInvoiceAction — manualRetrigger refinement", () => {
  it("stays idempotent for an internal invocation when an invoice already exists (Req 8.7)", async () => {
    H.setStayRow(buildCheckedOutStay(EXISTING_INVOICE_ID));

    const result = await generateFinalStayInvoiceAction(STAY_ID);

    expect(result).toEqual({
      success: true,
      data: { paymentId: EXISTING_INVOICE_ID, alreadyExisted: true },
    });
  });

  it("treats an omitted manualRetrigger flag as an internal invocation (Req 8.7)", async () => {
    H.setStayRow(buildCheckedOutStay(EXISTING_INVOICE_ID));

    const result = await generateFinalStayInvoiceAction(STAY_ID, {});

    expect(result).toEqual({
      success: true,
      data: { paymentId: EXISTING_INVOICE_ID, alreadyExisted: true },
    });
  });

  it("rejects an explicit manual retrigger over an existing invoice without reaching the writer (Req 8.10)", async () => {
    H.setStayRow(buildCheckedOutStay(EXISTING_INVOICE_ID));

    const result = await generateFinalStayInvoiceAction(STAY_ID, {
      manualRetrigger: true,
    });

    expect(result).toEqual({
      error: "A final invoice already exists for this stay.",
    });
    // The service is the only code path that inserts a `payments` row.
    expect(H.generateFinalInvoiceCalls).toHaveLength(0);
  });

  it("lets a manual retrigger succeed when no invoice exists yet (Req 8.9)", async () => {
    H.setStayRow(buildCheckedOutStay(null));

    const result = await generateFinalStayInvoiceAction(STAY_ID, {
      manualRetrigger: true,
    });

    expect(result).toEqual({
      success: true,
      data: { paymentId: "payment-new", alreadyExisted: false },
    });
    expect(H.generateFinalInvoiceCalls).toEqual([STAY_ID]);
  });
});
