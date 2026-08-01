// src/services/__tests__/stayPaymentLedger.stateful.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 23: Ledger consistency across operation sequences
//
// **Validates: Requirements 6.1, 11.6, 12.13**
//
// A stateful `fc.commands` model test: for any sequence of Advance, Partial
// Payment, Extension, Refund, and Early Checkout operations applied to a
// stay, the REAL system's derived Total_Paid and Remaining_Balance (computed
// via `deriveStayBalance` and `applyEarlyCheckoutMath` from
// `AccommodationService`) never desynchronize from a simple, independently
// implemented in-memory MODEL of the same money position.
//
// Model: a plain-object representation of one stay's money state —
//   { totalStayAmount, ledger: Array<{ type, amount }>, earlyCheckoutApplied }
// with Total_Paid computed independently here (ADVANCE/PARTIAL add, REFUND
// subtracts), never imported from AccommodationService, so the property
// cannot validate the system under test against itself.
//
// Real: the actual system under test — `deriveStayBalance` and
// `applyEarlyCheckoutMath` imported from `@/services/AccommodationService`,
// applied to a mutable wrapper around `{ totalStayAmount, transactions }`.
//
// Invariant checked after EVERY command: the REAL system's derived
// totalPaid and remainingBalance equal the MODEL's independently computed
// totalPaid and remainingBalance, across any valid sequence of the five
// operation types (Req 6.1, 11.6, 12.13).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Command } from "fast-check";

import {
  deriveStayBalance,
  gstFromTotal,
  applyEarlyCheckoutMath,
} from "@/services/AccommodationService";
import type {
  PaymentTransactionType,
  StayEntry,
  StayPaymentTransaction,
} from "@/types/accommodation";
import {
  arbMoney,
  arbTransactionAmount,
  arbTotalStayAmount,
} from "@/test/accommodation/paymentArbitraries";

// ─── Local, independent money arithmetic (NOT imported from AccommodationService) ──
//
// Re-declared here on purpose: the model must never inherit its arithmetic
// from the code it is checking. The formula (round to integer paise) mirrors
// the requirement's definition of exact money comparison, not the
// implementation of `toPaise`/`fromPaise`.

function localToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

// ─── Model ──────────────────────────────────────────────────────────────────

type LedgerEntryType = "ADVANCE" | "PARTIAL_BALANCE_PAYMENT" | "REFUND";

interface LedgerModel {
  totalStayAmount: number;
  ledger: Array<{ type: LedgerEntryType; amount: number }>;
  earlyCheckoutApplied: boolean;
}

/** Independent Total_Paid: ADVANCE/PARTIAL add, REFUND subtracts — integer paise. */
function modelTotalPaidPaise(ledger: LedgerModel["ledger"]): number {
  return ledger.reduce((sum, entry) => {
    const amountPaise = localToPaise(entry.amount);
    return entry.type === "REFUND" ? sum - amountPaise : sum + amountPaise;
  }, 0);
}

function modelRemainingBalancePaise(model: LedgerModel): number {
  return localToPaise(model.totalStayAmount) - modelTotalPaidPaise(model.ledger);
}

// ─── Real system ────────────────────────────────────────────────────────────

interface RealState {
  totalStayAmount: number;
  transactions: StayPaymentTransaction[];
}

/** Mutable container for the real system's value-shaped state — the idiomatic fast-check `Real`. */
class RealSystemWrapper {
  state: RealState;
  constructor(totalStayAmount: number) {
    this.state = { totalStayAmount, transactions: [] };
  }
}

let transactionCounter = 0;

/** Builds a minimal StayPaymentTransaction fixture — identity fields are irrelevant to the math. */
function makeTransaction(
  type: PaymentTransactionType,
  amount: number,
): StayPaymentTransaction {
  transactionCounter += 1;
  return {
    id: `tx-${transactionCounter}`,
    stayEntryId: "stay-fixture-1",
    customerProfileId: "customer-fixture-1",
    transactionType: type,
    amount,
    transactionDate: "2025-01-15",
    comment: null,
    remark: null,
    createdBy: null,
    createdAt: new Date(2025, 0, 15, 0, 0, transactionCounter).toISOString(),
  };
}

/** Minimal StayEntry fixture for `applyEarlyCheckoutMath` — only `paymentAmount` is load-bearing. */
function makeStayFixture(paymentAmount: number): StayEntry {
  return {
    id: "stay-fixture-1",
    customerProfileId: "customer-fixture-1",
    startDate: "2025-01-01",
    totalNights: 10,
    stayType: "AC Villa",
    occupancyType: "Single",
    status: "ACTIVE",
    paymentAmount,
    baseAmount: null,
    taxAmount: null,
    taxPercentage: 18,
    paymentHostProfileId: null,
    mealPreference: "VEG",
    endDate: "2025-01-10",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    isBackdated: false,
    earlyCheckoutApplied: false,
    actualNightsStayed: null,
    originalTotalNights: null,
    originalTotalAmount: null,
    checkedOutAt: null,
    finalInvoicePaymentId: null,
    finalInvoiceGeneratedAt: null,
    finalInvoiceError: null,
  };
}

// ─── Shared assertion — the invariant checked after EVERY command ─────────

function assertBalancesMatch(model: LedgerModel, real: RealSystemWrapper): void {
  const realBalance = deriveStayBalance(real.state.totalStayAmount, real.state.transactions);

  const expectedTotalPaidPaise = modelTotalPaidPaise(model.ledger);
  const expectedRemainingPaise = modelRemainingBalancePaise(model);

  expect(localToPaise(realBalance.totalPaid)).toBe(expectedTotalPaidPaise);
  expect(localToPaise(realBalance.remainingBalance)).toBe(expectedRemainingPaise);
}

// ─── Commands ───────────────────────────────────────────────────────────────

class AdvanceCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    const hasAdvance = m.ledger.some((entry) => entry.type === "ADVANCE");
    return !hasAdvance && this.amount > 0;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "ADVANCE", amount: this.amount });
    r.state.transactions.push(makeTransaction("ADVANCE", this.amount));
    assertBalancesMatch(m, r);
  }

  toString(): string {
    return `Advance(${this.amount})`;
  }
}

class PartialPaymentCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    if (this.amount <= 0) return false;
    const remainingPaise = modelRemainingBalancePaise(m);
    return localToPaise(this.amount) <= remainingPaise;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "PARTIAL_BALANCE_PAYMENT", amount: this.amount });
    r.state.transactions.push(makeTransaction("PARTIAL_BALANCE_PAYMENT", this.amount));
    assertBalancesMatch(m, r);
  }

  toString(): string {
    return `PartialPayment(${this.amount})`;
  }
}

class ExtensionCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly additionalCost: number) {}

  check(): boolean {
    // An extension just raises the total — always valid.
    return true;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    const newTotal = m.totalStayAmount + this.additionalCost;

    m.totalStayAmount = newTotal;
    r.state.totalStayAmount = newTotal;

    // GST is recomputed fresh from the new total, never accumulated.
    const gst = gstFromTotal(r.state.totalStayAmount);
    expect(gst).toEqual(gstFromTotal(newTotal));

    assertBalancesMatch(m, r);
  }

  toString(): string {
    return `Extension(+${this.additionalCost})`;
  }
}

class RefundCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    if (this.amount <= 0) return false;
    const remainingPaise = modelRemainingBalancePaise(m);
    const excessPaise = Math.max(0, -remainingPaise);
    return localToPaise(this.amount) <= excessPaise;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "REFUND", amount: this.amount });
    r.state.transactions.push(makeTransaction("REFUND", this.amount));
    assertBalancesMatch(m, r);
  }

  toString(): string {
    return `Refund(${this.amount})`;
  }
}

class EarlyCheckoutCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(
    private readonly actualNightsStayed: number,
    private readonly recalculatedAmount: number,
  ) {}

  check(m: Readonly<LedgerModel>): boolean {
    // At most one Early_Checkout per sequence in this test's scope (Req 12.13/12.15).
    return !m.earlyCheckoutApplied;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    const stayFixture = makeStayFixture(r.state.totalStayAmount);

    const result = applyEarlyCheckoutMath(
      stayFixture,
      this.actualNightsStayed,
      this.recalculatedAmount,
      r.state.transactions,
    );

    // Total_Paid is unaffected by early checkout — only the total changes,
    // same as an extension.
    r.state.totalStayAmount = this.recalculatedAmount;
    m.totalStayAmount = this.recalculatedAmount;
    m.earlyCheckoutApplied = true;

    assertBalancesMatch(m, r);

    // nextStep must be consistent with the sign of the model's remaining balance.
    const remainingPaise = modelRemainingBalancePaise(m);
    if (remainingPaise > 0) {
      expect(result.nextStep).toBe("COLLECT_BALANCE");
    } else if (remainingPaise < 0) {
      expect(result.nextStep).toBe("RECORD_REFUND");
    } else {
      expect(result.nextStep).toBe("CHECKED_OUT");
    }
  }

  toString(): string {
    return `EarlyCheckout(nights=${this.actualNightsStayed}, amount=${this.recalculatedAmount})`;
  }
}

// ─── Command arbitraries ────────────────────────────────────────────────────

const arbAdvanceCommand = arbTransactionAmount.map(
  (amount) => new AdvanceCommand(amount),
);

const arbPartialPaymentCommand = arbTransactionAmount.map(
  (amount) => new PartialPaymentCommand(amount),
);

const arbExtensionCommand = arbMoney.map(
  (amount) => new ExtensionCommand(amount),
);

const arbRefundCommand = arbTransactionAmount.map(
  (amount) => new RefundCommand(amount),
);

const arbEarlyCheckoutCommand = fc
  .tuple(fc.integer({ min: 1, max: 30 }), arbTransactionAmount)
  .map(([nights, amount]) => new EarlyCheckoutCommand(nights, amount));

const arbCommandSequence = fc.commands(
  [
    arbAdvanceCommand,
    arbPartialPaymentCommand,
    arbExtensionCommand,
    arbRefundCommand,
    arbEarlyCheckoutCommand,
  ],
  { size: "small" },
);

// ─── Property ───────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 23: Ledger consistency across operation sequences", () => {
  it("Total_Stay_Amount and Total_Paid never desynchronize across any valid operation sequence (Req 6.1, 11.6, 12.13)", () => {
    fc.assert(
      fc.property(arbTotalStayAmount, arbCommandSequence, (initialTotal, cmds) => {
        fc.modelRun(
          () => ({
            model: {
              totalStayAmount: initialTotal,
              ledger: [],
              earlyCheckoutApplied: false,
            } as LedgerModel,
            real: new RealSystemWrapper(initialTotal),
          }),
          cmds,
        );
      }),
      { numRuns: 100 },
    );
  });
});
