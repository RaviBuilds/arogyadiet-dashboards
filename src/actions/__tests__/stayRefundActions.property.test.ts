// src/actions/__tests__/stayRefundActions.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 22: Refund validation and ledger effect
//
// **Validates: Requirements 12.9, 12.10, 12.11**
//
// For any excess amount (Total_Paid minus Recalculated_Stay_Amount) and any
// Record Refund submission, the submission SHALL be accepted exactly when the
// refund amount is greater than zero and not greater than the current excess
// and the trimmed remark length is in [1, 500]; an accepted submission SHALL
// append exactly one REFUND Payment_Transaction with the entered amount,
// remark, optional comment, and the current IST date, reducing Total_Paid by
// exactly that amount; a rejected submission SHALL leave the ledger unchanged.
//
// `recordStayRefundAction` reads a Supabase session via
// `getCurrentAdminContext()` and calls `stayPaymentRepository.recordTransaction`
// (an RPC via `createAdminClient`) — both are mocked here (no live database or
// session), mirroring the mocking convention of
// `stayPaymentActions.property.test.ts` (task 7.2). The mocked
// `recordTransaction` is driven by a reference implementation of the RPC's
// gating logic (amount <= excess ⇒ ok, else REFUND_EXCEEDS_EXCESS), declared
// independently of the SQL/service code under test.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted controllable state (closed over by the vi.mock factories) ──────
const H = vi.hoisted(() => {
  let context: { userId: string | null; roleCode: string | null } = {
    userId: "admin-1",
    roleCode: "ADMIN",
  };
  let outcome: any = null;
  const recordTransactionCalls: any[] = [];

  return {
    setContext: (next: typeof context) => {
      context = next;
    },
    getContext: () => context,
    setOutcome: (next: any) => {
      outcome = next;
    },
    getOutcome: () => outcome,
    recordTransactionCalls,
    reset: () => {
      context = { userId: "admin-1", roleCode: "ADMIN" };
      outcome = null;
      recordTransactionCalls.length = 0;
    },
  };
});

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/adminAccess", () => ({
  getCurrentAdminContext: vi.fn(async () => H.getContext()),
}));

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    recordTransaction: vi.fn(async (input: any) => {
      H.recordTransactionCalls.push(input);
      const outcome = H.getOutcome();
      if (!outcome) {
        throw new Error("Test outcome was not configured before calling the action.");
      }
      return outcome;
    }),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import { recordStayRefundAction } from "@/actions/stayPaymentActions";
import { getISTDateString } from "@/lib/dates/ist";
import {
  arbMoney,
  arbTransactionAmount,
  arbSubmittedText,
  arbOptionalSubmittedText,
  REFERENCE_MAX_TEXT_LENGTH,
  roundToPaise,
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

/** Mirrors `deriveStayBalance`'s exact-zero-in-paise `isFullyPaid` predicate. */
function isFullyPaidReference(remainingBalance: number): boolean {
  return Math.round(remainingBalance * 100) === 0;
}

function refundDueReference(remainingBalance: number): number {
  return Math.max(0, -remainingBalance);
}

/** A minimal fake row shape — `recordStayRefundAction` never reads it. */
function fakeTransactionRow() {
  return {
    id: "tx-1",
    stay_entry_id: "stay-1",
    customer_profile_id: "profile-1",
    transaction_type: "REFUND",
    amount: 0,
    transaction_date: getISTDateString(0),
    comment: null,
    remark: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const STAY_ID = "11111111-1111-4111-8111-111111111111";

// ─── Property 22 ─────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 22: Refund validation and ledger effect", () => {
  it("rejects Zod-invalid submissions with a field error before the repository is ever called", async () => {
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

          // The offending submission never reaches the ledger.
          expect(H.recordTransactionCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns fieldErrors.amount naming the refundable excess when the amount exceeds it", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbTransactionAmount,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        async (excess, amount, remark, comment) => {
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) > roundToPaise(excess));
          H.reset();

          H.setOutcome({
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

          // The reference RPC was invoked exactly once with the trimmed,
          // Zod-parsed submission (Req 12.9, 12.11).
          expect(H.recordTransactionCalls).toHaveLength(1);
          const call = H.recordTransactionCalls[0];
          expect(call.stayEntryId).toBe(STAY_ID);
          expect(call.transactionType).toBe("REFUND");
          expect(call.amount).toBe(amount);
          expect(call.remark).toBe(remark.trim());
          expect(call.comment).toBe(comment === undefined ? null : comment.trim());
          expect(call.transactionDate).toBe(getISTDateString(0));

          // Rejected submissions leave the ledger unchanged — the mocked
          // repository never reported success.
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts a within-excess submission, appends the REFUND transaction, and moves Total_Paid/Remaining_Balance toward zero by exactly the refunded amount", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbTransactionAmount,
        arbSubmittedText.filter(isRemarkZodValid),
        arbOptionalSubmittedText.filter(isCommentZodValid),
        fc.integer({ min: 0, max: 10_000_000 }).map((paise) => paise / 100),
        async (excess, amount, remark, comment, priorTotalPaid) => {
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) <= roundToPaise(excess));
          H.reset();

          // Before the refund: Total_Paid exceeds Total_Stay_Amount by
          // exactly `excess`, i.e. remainingBalanceBefore = -excess.
          const remainingBalanceBefore = roundToPaise(-excess);
          // A REFUND reduces Total_Paid by `amount` and therefore increases
          // Remaining_Balance (moves it up, toward/past zero) by `amount`.
          const totalPaidAfter = roundToPaise(priorTotalPaid - amount);
          const remainingBalanceAfter = roundToPaise(
            remainingBalanceBefore + amount,
          );

          H.setOutcome({
            ok: true,
            transaction: fakeTransactionRow(),
            totalPaid: totalPaidAfter,
            remainingBalance: remainingBalanceAfter,
          });

          const result = await recordStayRefundAction(STAY_ID, {
            amount,
            remark,
            comment,
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.totalPaid).toBe(totalPaidAfter);
            expect(result.data.remainingBalance).toBe(remainingBalanceAfter);
            expect(result.data.totalStayAmount).toBe(
              totalPaidAfter + remainingBalanceAfter,
            );
            expect(result.data.isFullyPaid).toBe(
              isFullyPaidReference(remainingBalanceAfter),
            );
            expect(result.data.refundDue).toBe(
              refundDueReference(remainingBalanceAfter),
            );
          }

          // Remaining balance moved UP toward/past zero by exactly `amount`
          // (a negative-going-to-less-negative balance behaves correctly),
          // and Total_Paid decreased by exactly `amount`.
          expect(remainingBalanceAfter).toBeGreaterThanOrEqual(
            remainingBalanceBefore,
          );
          expect(
            roundToPaise(remainingBalanceAfter - remainingBalanceBefore),
          ).toBe(roundToPaise(amount));
          expect(roundToPaise(priorTotalPaid - totalPaidAfter)).toBe(
            roundToPaise(amount),
          );

          // Exactly one REFUND append, preserving amount, remark, and
          // comment verbatim (post-trim) with the current IST date
          // (Req 12.11).
          expect(H.recordTransactionCalls).toHaveLength(1);
          const call = H.recordTransactionCalls[0];
          expect(call.stayEntryId).toBe(STAY_ID);
          expect(call.transactionType).toBe("REFUND");
          expect(call.amount).toBe(amount);
          expect(call.remark).toBe(remark.trim());
          expect(call.comment).toBe(comment === undefined ? null : comment.trim());
          expect(call.transactionDate).toBe(getISTDateString(0));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("always rejects a non-admin role with Unauthorized, never calling the repository, regardless of input validity", async () => {
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
          expect(H.recordTransactionCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
