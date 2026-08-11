// src/services/__tests__/subscriptionPaymentService.test.ts
//
// Unit tests for the paise-based balance derivation and the invoice payment
// state resolver.
//
// Feature: meal-subscription-partial-payment (Phase 7.2)
//
// These tests pin the EXACT arithmetic the system uses to decide "is this
// subscription fully paid?". The answer is never derived from float comparison;
// it is integer paise, and any test that passes with float-equality semantics
// but fails under strict integer identity would surface a real production bug
// (see the project's design decision to compare in paise).

import { describe, it, expect } from "vitest";
import {
  deriveSubscriptionBalance,
  type BalanceLedgerEntry,
} from "@/services/SubscriptionPaymentService";
import { resolveInvoicePaymentState } from "@/types/subscriptionPayment";

// ---------------------------------------------------------------------------
// deriveSubscriptionBalance
// ---------------------------------------------------------------------------

describe("deriveSubscriptionBalance", () => {
  const SUB_ID = "sub-001";

  it("returns isFullyPaid = true and zero balance for an empty ledger with totalPayable = 0", () => {
    // A legacy subscription whose total_payable was never populated. The view
    // would INNER JOIN it away, but the pure function must still answer sanely.
    const snap = deriveSubscriptionBalance(SUB_ID, 0, []);
    expect(snap.totalPayable).toBe(0);
    expect(snap.totalPaid).toBe(0);
    expect(snap.remainingBalance).toBe(0);
    expect(snap.isFullyPaid).toBe(true);
    expect(snap.hasOutstanding).toBe(false);
  });

  it("reports the full balance as outstanding when no payments exist", () => {
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, []);
    expect(snap.totalPayable).toBe(18583);
    expect(snap.totalPaid).toBe(0);
    expect(snap.remainingBalance).toBe(18583);
    expect(snap.isFullyPaid).toBe(false);
    expect(snap.hasOutstanding).toBe(true);
  });

  it("subtracts ADVANCE and PARTIAL_BALANCE_PAYMENT from the total", () => {
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 5000 },
      { transactionType: "PARTIAL_BALANCE_PAYMENT", amount: 2000 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, entries);
    expect(snap.totalPaid).toBe(7000);
    expect(snap.remainingBalance).toBe(11583);
    expect(snap.isFullyPaid).toBe(false);
    expect(snap.hasOutstanding).toBe(true);
  });

  it("subtracts a REFUND from totalPaid (direction is negative)", () => {
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 10000 },
      { transactionType: "REFUND", amount: 3000 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, entries);
    expect(snap.totalPaid).toBe(7000);
    expect(snap.remainingBalance).toBe(11583);
  });

  it("reports isFullyPaid = true when payments exactly cover the total", () => {
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 5000 },
      { transactionType: "PARTIAL_BALANCE_PAYMENT", amount: 13583 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, entries);
    expect(snap.totalPaid).toBe(18583);
    expect(snap.remainingBalance).toBe(0);
    expect(snap.isFullyPaid).toBe(true);
    expect(snap.hasOutstanding).toBe(false);
  });

  it("reports a negative remainingBalance when over-collected (refund due)", () => {
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 20000 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, entries);
    expect(snap.totalPaid).toBe(20000);
    expect(snap.remainingBalance).toBe(-1417);
    expect(snap.isFullyPaid).toBe(false); // not zero, so not "fully paid"
    expect(snap.hasOutstanding).toBe(false); // negative is NOT outstanding
  });

  it("handles string amounts from the database driver (NUMERIC → string)", () => {
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: "5000.00" as unknown as number },
      { transactionType: "PARTIAL_BALANCE_PAYMENT", amount: "13583.00" as unknown as number },
    ];
    const snap = deriveSubscriptionBalance(
      SUB_ID,
      "18583.00" as unknown as number,
      entries,
    );
    expect(snap.isFullyPaid).toBe(true);
    expect(snap.remainingBalance).toBe(0);
  });

  it("avoids float drift: 14333 + 3500 + 750 paid in full does not leave a residual", () => {
    // This is the real-world total from the user's QUICK BITE test.
    // 14333 + 3500 + 750 = 18583, paid via two instalments.
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 5000 },
      { transactionType: "PARTIAL_BALANCE_PAYMENT", amount: 2000 },
      { transactionType: "PARTIAL_BALANCE_PAYMENT", amount: 11583 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 18583, entries);
    expect(snap.isFullyPaid).toBe(true);
    expect(snap.remainingBalance).toBe(0);
  });

  it("avoids float drift on a fractional total: 17054.45 paid in one advance", () => {
    // 17054.45 * 100 = 1705445 in paise; a single advance of the same amount
    // must be reported as fully paid rather than leaving 1e-13 behind.
    const entries: BalanceLedgerEntry[] = [
      { transactionType: "ADVANCE", amount: 17054.45 },
    ];
    const snap = deriveSubscriptionBalance(SUB_ID, 17054.45, entries);
    expect(snap.isFullyPaid).toBe(true);
    expect(snap.remainingBalance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveInvoicePaymentState
// ---------------------------------------------------------------------------

describe("resolveInvoicePaymentState", () => {
  it("returns PAID for a settled status", () => {
    expect(resolveInvoicePaymentState("PAID", 0)).toBe("PAID");
    expect(resolveInvoicePaymentState("SUCCESS", 0)).toBe("PAID");
    expect(resolveInvoicePaymentState("CAPTURED", 0)).toBe("PAID");
  });

  it("returns PARTIALLY_PAID for the explicit status", () => {
    expect(resolveInvoicePaymentState("PARTIALLY_PAID", 13583)).toBe("PARTIALLY_PAID");
  });

  it("returns PENDING for an unpaid status", () => {
    expect(resolveInvoicePaymentState("PENDING", 0)).toBe("PENDING");
  });

  it("trusts balance_due as a tiebreak when status says PAID but balance > 0", () => {
    // A settled row that somehow still carries a balance = a projection that was
    // not synced. Trust the money, not the stale status.
    expect(resolveInvoicePaymentState("PAID", 5000)).toBe("PARTIALLY_PAID");
  });

  it("returns PENDING for null/undefined status", () => {
    expect(resolveInvoicePaymentState(null, 0)).toBe("PENDING");
    expect(resolveInvoicePaymentState(undefined, 0)).toBe("PENDING");
  });

  it("is case-insensitive", () => {
    expect(resolveInvoicePaymentState("paid", 0)).toBe("PAID");
    expect(resolveInvoicePaymentState("partially_paid", 1000)).toBe("PARTIALLY_PAID");
  });
});
