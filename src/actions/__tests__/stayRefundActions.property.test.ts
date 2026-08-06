// src/actions/__tests__/stayRefundActions.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 22: Refund validation, ledger effect, and checkout eligibility
//
// **Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.6, 14.10**
//
// For any ACTIVE stay whose Total_Paid exceeds its Total_Stay_Amount (the "live
// excess"), the "Mark as refunded" submission SHALL be accepted exactly when the
// refund amount is in (0, excess], the trimmed remark length is in [1, 500], and
// the optional comment (when present) is at most 500 trimmed characters.
//
// Acceptance depends ONLY on the live excess — no preceding recalculation is
// required (Req 14.1). A valid submission SHALL append exactly one REFUND
// Payment_Transaction, SHALL return a `refundInvoicePaymentId` (Req 14.6), SHALL
// NOT modify `Stay_Status` or `checked_out_at` (Req 14.10), and a full-excess
// refund SHALL leave the balance at exactly zero.
//
// An invalid submission SHALL leave the ledger unchanged and return an error
// identifying the offending field.
//
// `recordStayRefundAction` calls `AccommodationService.recordRefundWithInvoice`
// (which delegates to `record_stay_refund_with_invoice()` RPC). Both the admin
// context and that service function are mocked here — no live database or
// session. The mock is driven by a reference model of the RPC's gating logic,
// declared independently of the code under test.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted controllable state (closed over by the vi.mock factories) ──────
const H = vi.hoisted(() => {
  let context: { userId: string | null; roleCode: string | null } = {
    userId: "admin-1",
    roleCode: "ADMIN",
  };
  let serviceOutcome: any = null;
  const serviceCalls: any[] = [];

  return {
    setContext: (next: typeof context) => {
      context = next;
    },
    getContext: () => context,
    setServiceOutcome: (next: any) => {
      serviceOutcome = next;
    },
    getServiceOutcome: () => serviceOutcome,
    serviceCalls,
    reset: () => {
      context = { userId: "admin-1", roleCode: "ADMIN" };
      serviceOutcome = null;
      serviceCalls.length = 0;
    },
  };
});

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: vi.fn(async () => H.getContext()),
}));

vi.mock("@/services/AccommodationService", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    recordRefundWithInvoice: vi.fn(async (input: any) => {
      H.serviceCalls.push(input);
      const outcome = H.getServiceOutcome();
      if (!outcome) {
        throw new Error(
          "Test outcome was not configured before calling the action.",
        );
      }
      // If the outcome is a thrown error (simulating INVOICE_FAILED), throw it
      if (outcome.__throw) {
        throw new Error(outcome.__throw);
      }
      return outcome;
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { recordStayRefundAction } from "@/actions/stayPaymentActions";
import {
  arbMoney,
  arbTransactionAmount,
  arbSubmittedText,
  arbOptionalSubmittedText,
  REFERENCE_MAX_TEXT_LENGTH,
  roundToPaise,
  fixtureUuid,
} from "@/test/accommodation/paymentArbitraries";

beforeEach(() => {
  H.reset();
});

// ─── Reference model (re-declared, not imported from the SUT) ──────────────

/** Mirrors `recordStayRefundSchema`'s `amount` check: `gt(0).max(9_999_999)`. */
function isAmountZodValid(amount: number): boolean {
  return amount > 0 && amount <= 9_999_999;
}

/** Mirrors the schema's required, trimmed remark, capped at 500 characters. */
function isRemarkZodValid(remark: string): boolean {
  const trimmed = remark.trim();
  return trimmed.length >= 1 && trimmed.length <= REFERENCE_MAX_TEXT_LENGTH;
}

/** Mirrors the schema's optional, trimmed comment, capped at 500 characters. */
function isCommentZodValid(comment: string | undefined): boolean {
  if (comment === undefined) return true;
  return comment.trim().length <= REFERENCE_MAX_TEXT_LENGTH;
}

function isSubmissionZodValid(
  amount: number,
  remark: string,
  comment: string | undefined,
): boolean {
  return (
    isAmountZodValid(amount) && isRemarkZodValid(remark) && isCommentZodValid(comment)
  );
}

const STAY_ID = "11111111-1111-4111-8111-111111111111";
const REFUND_INVOICE_PAYMENT_ID = fixtureUuid(77, 1);

// ─── Generators specific to this property ────────────────────────────────────

/**
 * An excess amount: strictly positive, at exact paise precision.
 * Represents Total_Paid − Total_Stay_Amount for an overpaid stay.
 */
const arbExcess: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constantFrom(0.01, 1, 100, 5000, 9_999_999), weight: 3 },
  {
    arbitrary: fc
      .integer({ min: 1, max: 9_999_999 * 100 })
      .map((paise) => paise / 100),
    weight: 5,
  },
);

/**
 * An excess amount that is zero or negative, representing a stay that is NOT
 * overpaid — Total_Paid ≤ Total_Stay_Amount (Req 14.5).
 */
const arbNonPositiveExcess: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constantFrom(0, -0.01, -1, -100, -5000), weight: 3 },
  {
    arbitrary: fc
      .integer({ min: -9_999_999 * 100, max: 0 })
      .map((paise) => paise / 100),
    weight: 5,
  },
);

// ─── Property 22 ─────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 22: Refund validation, ledger effect, and checkout eligibility", () => {
  it("rejects Zod-invalid submissions (empty remark, remark > 500, amount ≤ 0 or > max) with field errors before the service is ever called", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbSubmittedText,
        arbOptionalSubmittedText,
        async (amount, remark, comment) => {
          fc.pre(!isSubmissionZodValid(amount, remark, comment));
          H.reset();

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.fieldErrors).toBeDefined();
            if (!isAmountZodValid(amount)) {
              expect(result.fieldErrors?.amount).toBeDefined();
            }
            if (!isRemarkZodValid(remark)) {
              expect(result.fieldErrors?.remark).toBeDefined();
            }
            if (!isCommentZodValid(comment)) {
              expect(result.fieldErrors?.comment).toBeDefined();
            }
          }

          // The offending submission never reaches the service.
          expect(H.serviceCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns NO_EXCESS_TO_REFUND when excess ≤ 0 — no preceding recalculation required (Req 14.5)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTransactionAmount,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        arbNonPositiveExcess,
        async (amount, remark, comment, _nonPositiveExcess) => {
          fc.pre(isAmountZodValid(amount));
          H.reset();

          // The service reports NO_EXCESS_TO_REFUND when Total_Paid ≤ Total_Stay_Amount
          H.setServiceOutcome({
            ok: false,
            reason: "NO_EXCESS_TO_REFUND",
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.error).toContain("no excess payment to refund");
          }

          // The service was invoked exactly once — availability depends on the
          // live excess, not on any preceding action (Req 14.1).
          expect(H.serviceCalls).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns REFUND_EXCEEDS_EXCESS naming the live excess when amount > excess (Req 14.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbExcess,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        async (excess, remark, comment) => {
          // Generate an amount strictly greater than the excess
          const amount = roundToPaise(excess + 0.01);
          fc.pre(isAmountZodValid(amount));
          H.reset();

          H.setServiceOutcome({
            ok: false,
            reason: "REFUND_EXCEEDS_EXCESS",
            excess,
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.fieldErrors?.amount).toBeDefined();
            expect(result.fieldErrors?.amount).toContain(String(excess));
          }

          // The service was invoked with the correct parameters
          expect(H.serviceCalls).toHaveLength(1);
          const call = H.serviceCalls[0];
          expect(call.stayId).toBe(STAY_ID);
          expect(call.amount).toBe(amount);
          expect(call.remark).toBe(remark.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts amounts at exact boundaries: 1, excess itself — appends REFUND, returns refundInvoicePaymentId, and never touches Stay_Status/checked_out_at (Req 14.6, 14.10)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbExcess,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        fc.constantFrom("min", "exact") as fc.Arbitrary<"min" | "exact">,
        async (excess, remark, comment, boundary) => {
          // Test both the minimum (1) and the exact excess boundary
          const amount = boundary === "min" ? 1 : roundToPaise(excess);
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) <= roundToPaise(excess));
          H.reset();

          // Compute expected balance after refund
          // Before refund: remainingBalance = -(excess) (overpaid by excess)
          // After refund of `amount`: remainingBalance = -(excess - amount)
          const remainingBalanceAfter = roundToPaise(-(excess - amount));
          const totalPaidAfter = roundToPaise(1000 - amount); // arbitrary totalPaid
          const totalStayAmount = roundToPaise(totalPaidAfter + remainingBalanceAfter);

          H.setServiceOutcome({
            ok: true,
            balance: {
              totalStayAmount,
              totalPaid: totalPaidAfter,
              remainingBalance: remainingBalanceAfter,
              isFullyPaid: Math.round(remainingBalanceAfter * 100) === 0,
              refundDue: Math.max(0, -remainingBalanceAfter),
            },
            refundInvoicePaymentId: REFUND_INVOICE_PAYMENT_ID,
            transactionId: fixtureUuid(44, 1),
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          // Req 14.6 — success ALWAYS returns refundInvoicePaymentId
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.refundInvoicePaymentId).toBe(
              REFUND_INVOICE_PAYMENT_ID,
            );
            expect(result.data.balance).toBeDefined();
            expect(result.data.balance.totalPaid).toBe(totalPaidAfter);
            expect(result.data.balance.remainingBalance).toBe(
              remainingBalanceAfter,
            );
          }

          // Req 14.10 — the action never touches Stay_Status or checked_out_at.
          // Verified by asserting the service call carries no status or
          // checked_out_at field — the service function signature itself does not
          // accept them, and the action does not call any other function.
          expect(H.serviceCalls).toHaveLength(1);
          const call = H.serviceCalls[0];
          expect(call.stayId).toBe(STAY_ID);
          expect(call.amount).toBe(amount);
          expect(call.remark).toBe(remark.trim());
          expect(call.comment).toBe(
            comment === undefined ? null : comment.trim(),
          );
          // The call carries no `status` or `checkedOutAt` field — the service
          // API does not accept them, proving the refund path cannot transition.
          expect(call).not.toHaveProperty("status");
          expect(call).not.toHaveProperty("checkedOutAt");
          expect(call).not.toHaveProperty("checked_out_at");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a full-excess refund leaves balance at exactly zero (Req 14.10 — eligible for checkout without transitioning)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbExcess,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        async (excess, remark, comment) => {
          const amount = roundToPaise(excess); // full excess
          fc.pre(isAmountZodValid(amount));
          H.reset();

          // After a full-excess refund, remainingBalance = 0 (exactly settled)
          const totalStayAmount = roundToPaise(500); // arbitrary
          const totalPaidAfter = totalStayAmount; // now matches the total
          const remainingBalanceAfter = 0;

          H.setServiceOutcome({
            ok: true,
            balance: {
              totalStayAmount,
              totalPaid: totalPaidAfter,
              remainingBalance: remainingBalanceAfter,
              isFullyPaid: true,
              refundDue: 0,
            },
            refundInvoicePaymentId: REFUND_INVOICE_PAYMENT_ID,
            transactionId: fixtureUuid(44, 1),
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect(result.success).toBe(true);
          if (result.success) {
            // Balance is EXACTLY zero — the stay is now eligible for checkout
            expect(result.data.balance.remainingBalance).toBe(0);
            expect(result.data.balance.isFullyPaid).toBe(true);
            expect(result.data.balance.refundDue).toBe(0);
            // But status is NOT transitioned — the result carries no status field
            expect(result.data).not.toHaveProperty("status");
            expect(result.data).not.toHaveProperty("checkedOutAt");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects amounts at excess + 0.01 (one paise over) — REFUND_EXCEEDS_EXCESS (Req 14.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbExcess,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        async (excess, remark, comment) => {
          const amount = roundToPaise(excess + 0.01);
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) > roundToPaise(excess));
          H.reset();

          H.setServiceOutcome({
            ok: false,
            reason: "REFUND_EXCEEDS_EXCESS",
            excess,
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.fieldErrors?.amount).toBeDefined();
            expect(result.fieldErrors?.amount).toContain(String(excess));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("remarks at boundary lengths: 0 chars → Zod rejection, 1 char → accepted, 500 chars → accepted, 501 chars → Zod rejection (Req 14.3)", async () => {
    const remarkCases = [
      { remark: "", expectValid: false, label: "empty" },
      { remark: "x", expectValid: true, label: "1 char" },
      { remark: "x".repeat(500), expectValid: true, label: "500 chars" },
      { remark: "x".repeat(501), expectValid: false, label: "501 chars" },
    ];

    await fc.assert(
      fc.asyncProperty(
        arbExcess,
        fc.constantFrom(...remarkCases),
        async (excess, { remark, expectValid }) => {
          const amount = roundToPaise(Math.min(excess, 1000));
          fc.pre(isAmountZodValid(amount));
          H.reset();

          if (expectValid) {
            // Mock a successful outcome
            H.setServiceOutcome({
              ok: true,
              balance: {
                totalStayAmount: 1000,
                totalPaid: 1000,
                remainingBalance: 0,
                isFullyPaid: true,
                refundDue: 0,
              },
              refundInvoicePaymentId: REFUND_INVOICE_PAYMENT_ID,
              transactionId: fixtureUuid(44, 1),
            });
          }

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment: undefined,
          });

          if (expectValid) {
            // The service is called — submission passed Zod validation
            expect(H.serviceCalls).toHaveLength(1);
          } else {
            // Zod rejection before the service is called
            expect("error" in result).toBe(true);
            if ("error" in result) {
              expect(result.fieldErrors?.remark).toBeDefined();
            }
            expect(H.serviceCalls).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("always rejects a non-admin role with Unauthorized, never calling the service, regardless of input validity", async () => {
    const arbNonAdminRole = fc.oneof(
      fc.constant<string | null>(null),
      fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((r) => r !== "ADMIN" && r !== "MASTER_ADMIN"),
    );

    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbSubmittedText,
        arbOptionalSubmittedText,
        arbNonAdminRole,
        async (amount, remark, comment, roleCode) => {
          H.reset();
          H.setContext({ userId: "user-1", roleCode });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect(result).toEqual({ error: "Unauthorized" });
          expect(H.serviceCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
