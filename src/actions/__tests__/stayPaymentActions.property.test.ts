// src/actions/__tests__/stayPaymentActions.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 8: Record Payment validation and ledger append
//
// **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2**
//
// For any Stay_Entry with a Remaining_Balance and any Record Payment
// submission, the submission SHALL be accepted exactly when the amount is
// greater than zero and not greater than the current Remaining_Balance, the
// trimmed comment length is in [1, 500], and the remark is absent or has
// trimmed length at most 500. An accepted submission SHALL append exactly one
// PARTIAL_BALANCE_PAYMENT Payment_Transaction preserving the amount, comment,
// and remark verbatim with the current IST date; a rejected submission SHALL
// leave the ledger unchanged and return an error identifying the offending
// field, and this SHALL hold at the server action level regardless of
// client-side state.
//
// `recordStayPaymentAction` reads a Supabase session via
// `getCurrentAdminContext()` and calls `stayPaymentRepository.recordTransaction`
// (an RPC via `createAdminClient`) — both are mocked here (no live database
// or session). The mocked `recordTransaction` is driven by a reference
// implementation of the RPC's gating logic (amount <= remaining balance ⇒ ok,
// else AMOUNT_EXCEEDS_BALANCE), declared independently of the SQL/service
// code under test, mirroring the arbitraries' own re-declaration convention.

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
import { recordStayPaymentAction } from "@/actions/stayPaymentActions";
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

/** Mirrors `recordStayPaymentSchema`'s `amount` check: `gt(0).max(9_999_999)`. */
function isAmountZodValid(amount: number): boolean {
  return amount > 0 && amount <= 9_999_999;
}

/** Mirrors the schema's required, trimmed comment, capped at 500 characters. */
function isCommentZodValid(comment: string): boolean {
  const trimmed = comment.trim();
  return trimmed.length >= 1 && trimmed.length <= REFERENCE_MAX_TEXT_LENGTH;
}

/** Mirrors the schema's optional, trimmed remark, capped at 500 characters. */
function isRemarkZodValid(remark: string | undefined): boolean {
  if (remark === undefined) return true;
  return remark.trim().length <= REFERENCE_MAX_TEXT_LENGTH;
}

function isSubmissionZodValid(
  amount: number,
  comment: string,
  remark: string | undefined,
): boolean {
  return (
    isAmountZodValid(amount) && isCommentZodValid(comment) && isRemarkZodValid(remark)
  );
}

/** Mirrors `deriveStayBalance`'s exact-zero-in-paise `isFullyPaid` predicate. */
function isFullyPaidReference(remainingBalance: number): boolean {
  return Math.round(remainingBalance * 100) === 0;
}

function refundDueReference(remainingBalance: number): number {
  return Math.max(0, -remainingBalance);
}

/** A minimal fake row shape — `recordStayPaymentAction` never reads it. */
function fakeTransactionRow() {
  return {
    id: "tx-1",
    stay_entry_id: "stay-1",
    customer_profile_id: "profile-1",
    transaction_type: "PARTIAL_BALANCE_PAYMENT",
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

// ─── Property 8 ──────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 8: Record Payment validation and ledger append", () => {
  it("rejects Zod-invalid submissions with a field error before the repository is ever called", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbSubmittedText,
        arbOptionalSubmittedText,
        async (amount, comment, remark) => {
          fc.pre(!isSubmissionZodValid(amount, comment, remark));
          H.reset();

          const result = await recordStayPaymentAction(STAY_ID, {
            amount,
            comment,
            remark,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.fieldErrors).toBeDefined();
            if (!isAmountZodValid(amount)) {
              expect(result.fieldErrors?.amount).toBeDefined();
            }
            if (!isCommentZodValid(comment)) {
              expect(result.fieldErrors?.comment).toBeDefined();
            }
            if (!isRemarkZodValid(remark)) {
              expect(result.fieldErrors?.remark).toBeDefined();
            }
          }

          // The offending submission never reaches the ledger.
          expect(H.recordTransactionCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns fieldErrors.amount naming the remaining balance when the amount exceeds it", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbTransactionAmount,
        arbSubmittedText.filter(isCommentZodValid),
        arbOptionalSubmittedText.filter(isRemarkZodValid),
        async (remainingBalance, amount, comment, remark) => {
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) > roundToPaise(remainingBalance));
          H.reset();

          H.setOutcome({
            ok: false,
            reason: "AMOUNT_EXCEEDS_BALANCE",
            remainingBalance,
          });

          const result = await recordStayPaymentAction(STAY_ID, {
            amount,
            comment,
            remark,
          });

          expect("error" in result).toBe(true);
          if ("error" in result) {
            expect(result.fieldErrors?.amount).toBeDefined();
            expect(result.fieldErrors?.amount).toContain(String(remainingBalance));
          }

          // The reference RPC was invoked exactly once with the trimmed,
          // Zod-parsed submission (Req 6.2).
          expect(H.recordTransactionCalls).toHaveLength(1);
          const call = H.recordTransactionCalls[0];
          expect(call.stayEntryId).toBe(STAY_ID);
          expect(call.transactionType).toBe("PARTIAL_BALANCE_PAYMENT");
          expect(call.amount).toBe(amount);
          expect(call.comment).toBe(comment.trim());
          expect(call.remark).toBe(remark === undefined ? null : remark.trim());
          expect(call.transactionDate).toBe(getISTDateString(0));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts a within-balance submission, appends the transaction, and returns a matching balance snapshot", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMoney,
        arbTransactionAmount,
        arbSubmittedText.filter(isCommentZodValid),
        arbOptionalSubmittedText.filter(isRemarkZodValid),
        fc.integer({ min: 0, max: 10_000_000 }).map((paise) => paise / 100),
        async (remainingBalance, amount, comment, remark, priorTotalPaid) => {
          fc.pre(isAmountZodValid(amount));
          fc.pre(roundToPaise(amount) <= roundToPaise(remainingBalance));
          H.reset();

          const totalPaidAfter = roundToPaise(priorTotalPaid + amount);
          const remainingBalanceAfter = roundToPaise(remainingBalance - amount);

          H.setOutcome({
            ok: true,
            transaction: fakeTransactionRow(),
            totalPaid: totalPaidAfter,
            remainingBalance: remainingBalanceAfter,
          });

          const result = await recordStayPaymentAction(STAY_ID, {
            amount,
            comment,
            remark,
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.totalPaid).toBe(totalPaidAfter);
            expect(result.data.remainingBalance).toBe(remainingBalanceAfter);
            // The action derives totalStayAmount as a raw sum of the mocked
            // repository's totalPaid + remainingBalance (no additional
            // rounding), so the comparison must mirror that exactly.
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

          // Exactly one PARTIAL_BALANCE_PAYMENT append, preserving amount,
          // comment, and remark verbatim (post-trim) with the current IST
          // date (Req 5.8, 6.2).
          expect(H.recordTransactionCalls).toHaveLength(1);
          const call = H.recordTransactionCalls[0];
          expect(call.stayEntryId).toBe(STAY_ID);
          expect(call.transactionType).toBe("PARTIAL_BALANCE_PAYMENT");
          expect(call.amount).toBe(amount);
          expect(call.comment).toBe(comment.trim());
          expect(call.remark).toBe(remark === undefined ? null : remark.trim());
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
        async (amount, comment, remark, roleCode) => {
          H.reset();
          H.setContext({ userId: "user-1", roleCode });

          const result = await recordStayPaymentAction(STAY_ID, {
            amount,
            comment,
            remark,
          });

          expect(result).toEqual({ error: "Unauthorized" });
          expect(H.recordTransactionCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
