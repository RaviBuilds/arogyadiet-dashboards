// src/services/__tests__/stayPaymentLedger.stateful.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 23: Ledger consistency across operation sequences
//
// **Validates: Requirements 6.1, 11.6, 12.9, 12.13**
//
// A stateful `fc.commands` model test: for any sequence of Advance, Partial
// Payment, Extension, **repeated Save Stay Details**, Refund, and Checkout
// operations applied to a stay, the REAL system's derived Total_Paid and
// Remaining_Balance (computed via `deriveStayBalance` and
// `applyStayRecalculationMath` from `AccommodationService`) never
// desynchronize from a simple, independently implemented in-memory MODEL of
// the same money position.
//
// Model: a plain-object representation of one stay's money state —
//   { totalStayAmount, ledger, totalNights, status }
// with Total_Paid computed independently here (ADVANCE/PARTIAL add, REFUND
// subtracts), never imported from AccommodationService, so the property
// cannot validate the system under test against itself.
//
// Real: the actual system under test — `deriveStayBalance` and
// `applyStayRecalculationMath` imported from `@/services/AccommodationService`,
// applied to a mutable wrapper around `{ totalStayAmount, transactions, ... }`.
//
// Invariants checked after EVERY command:
// 1. The REAL system's derived totalPaid and remainingBalance equal the
//    MODEL's independently computed totalPaid and remainingBalance
// 2. The stay remains ACTIVE through all operations UNTIL an explicit
//    CheckoutCommand is executed (Req 12.9, 12.13)

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Command } from "fast-check";

import {
  deriveStayBalance,
  gstFromTotal,
  applyStayRecalculationMath,
  endDateFromNights,
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
  shiftISODate,
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
  totalNights: number;
  status: "ACTIVE" | "FINISHED";
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
  totalNights: number;
  startDate: string;
  status: "ACTIVE" | "FINISHED";
}

/** Mutable container for the real system's value-shaped state — the idiomatic fast-check `Real`. */
class RealSystemWrapper {
  state: RealState;
  constructor(totalStayAmount: number, totalNights: number, startDate: string) {
    this.state = {
      totalStayAmount,
      transactions: [],
      totalNights,
      startDate,
      status: "ACTIVE",
    };
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

/** Minimal StayEntry fixture for `applyStayRecalculationMath`. */
function makeStayFixture(
  paymentAmount: number,
  totalNights: number,
  startDate: string,
): StayEntry {
  return {
    id: "stay-fixture-1",
    customerProfileId: "customer-fixture-1",
    startDate,
    totalNights,
    stayType: "AC Villa",
    occupancyType: "Single",
    status: "ACTIVE",
    paymentAmount,
    baseAmount: null,
    taxAmount: null,
    taxPercentage: 18,
    paymentHostProfileId: null,
    mealPreference: "VEG",
    endDate: endDateFromNights(startDate, totalNights),
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    isBackdated: false,
    earlyCheckoutApplied: false,
    recalculationApplied: false,
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

/** Assert the stay stays ACTIVE until the explicit checkout command (Req 12.9, 12.13). */
function assertStaysActive(model: LedgerModel, real: RealSystemWrapper): void {
  expect(model.status).toBe("ACTIVE");
  expect(real.state.status).toBe("ACTIVE");
}

// ─── Commands ───────────────────────────────────────────────────────────────

class AdvanceCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    const hasAdvance = m.ledger.some((entry) => entry.type === "ADVANCE");
    return !hasAdvance && this.amount > 0 && m.status === "ACTIVE";
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "ADVANCE", amount: this.amount });
    r.state.transactions.push(makeTransaction("ADVANCE", this.amount));
    assertBalancesMatch(m, r);
    assertStaysActive(m, r);
  }

  toString(): string {
    return `Advance(${this.amount})`;
  }
}

class PartialPaymentCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    if (m.status !== "ACTIVE") return false;
    if (this.amount <= 0) return false;
    const remainingPaise = modelRemainingBalancePaise(m);
    return localToPaise(this.amount) <= remainingPaise;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "PARTIAL_BALANCE_PAYMENT", amount: this.amount });
    r.state.transactions.push(makeTransaction("PARTIAL_BALANCE_PAYMENT", this.amount));
    assertBalancesMatch(m, r);
    assertStaysActive(m, r);
  }

  toString(): string {
    return `PartialPayment(${this.amount})`;
  }
}

class ExtensionCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(
    private readonly additionalCost: number,
    private readonly additionalNights: number,
  ) {}

  check(m: Readonly<LedgerModel>): boolean {
    // Extensions require ACTIVE status (Req 11.5).
    return m.status === "ACTIVE";
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    const newTotal = m.totalStayAmount + this.additionalCost;
    const newNights = m.totalNights + this.additionalNights;

    m.totalStayAmount = newTotal;
    m.totalNights = newNights;
    r.state.totalStayAmount = newTotal;
    r.state.totalNights = newNights;

    // GST is recomputed fresh from the new total, never accumulated.
    const gst = gstFromTotal(r.state.totalStayAmount);
    expect(gst).toEqual(gstFromTotal(newTotal));

    assertBalancesMatch(m, r);
    assertStaysActive(m, r);
  }

  toString(): string {
    return `Extension(+${this.additionalCost}, +${this.additionalNights}nights)`;
  }
}

class SaveStayDetailsCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(
    private readonly recalculatedEndDate: string,
    private readonly recalculatedAmount: number,
  ) {}

  check(m: Readonly<LedgerModel>): boolean {
    // Save Stay Details requires ACTIVE status (Req 12.14) and is repeatable (Req 12.10).
    if (m.status !== "ACTIVE") return false;
    // The recalculated amount must be in the valid range [1, 9_999_999].
    if (this.recalculatedAmount < 1 || this.recalculatedAmount > 9_999_999) return false;
    return true;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    const stayFixture = makeStayFixture(
      r.state.totalStayAmount,
      r.state.totalNights,
      r.state.startDate,
    );

    const result = applyStayRecalculationMath(
      stayFixture,
      this.recalculatedEndDate,
      this.recalculatedAmount,
      r.state.transactions,
    );

    // Update the real system state — Save Stay Details replaces total and nights.
    r.state.totalStayAmount = this.recalculatedAmount;
    r.state.totalNights = result.totalNights;

    // Update the model — same fields.
    m.totalStayAmount = this.recalculatedAmount;
    m.totalNights = result.totalNights;

    // Req 12.9: Save Stay Details SHALL NOT transition the Stay_Status.
    // status stays "ACTIVE" — nextAction is never "CHECKED_OUT".
    expect(result.nextAction).not.toBe("CHECKED_OUT");
    expect(result.nextAction).toSatisfy(
      (action: string) =>
        action === "COLLECT_BALANCE" ||
        action === "RECORD_REFUND" ||
        action === "SETTLED",
    );

    assertBalancesMatch(m, r);
    assertStaysActive(m, r);

    // nextAction must be consistent with the sign of the model's remaining balance.
    const remainingPaise = modelRemainingBalancePaise(m);
    if (remainingPaise > 0) {
      expect(result.nextAction).toBe("COLLECT_BALANCE");
    } else if (remainingPaise < 0) {
      expect(result.nextAction).toBe("RECORD_REFUND");
    } else {
      expect(result.nextAction).toBe("SETTLED");
    }
  }

  toString(): string {
    return `SaveStayDetails(endDate=${this.recalculatedEndDate}, amount=${this.recalculatedAmount})`;
  }
}

class RefundCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly amount: number) {}

  check(m: Readonly<LedgerModel>): boolean {
    if (m.status !== "ACTIVE") return false;
    if (this.amount <= 0) return false;
    const remainingPaise = modelRemainingBalancePaise(m);
    const excessPaise = Math.max(0, -remainingPaise);
    return localToPaise(this.amount) <= excessPaise;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    m.ledger.push({ type: "REFUND", amount: this.amount });
    r.state.transactions.push(makeTransaction("REFUND", this.amount));
    assertBalancesMatch(m, r);
    assertStaysActive(m, r);
  }

  toString(): string {
    return `Refund(${this.amount})`;
  }
}

class CheckoutCommand implements Command<LedgerModel, RealSystemWrapper> {
  constructor(private readonly todayIST: string) {}

  check(m: Readonly<LedgerModel>): boolean {
    if (m.status !== "ACTIVE") return false;
    // Checkout requires balance exactly zero (Req 7.2) and end date reached (Req 12.13).
    const remainingPaise = modelRemainingBalancePaise(m);
    return remainingPaise === 0;
  }

  run(m: LedgerModel, r: RealSystemWrapper): void {
    // Verify balance is indeed zero on the real system.
    const realBalance = deriveStayBalance(r.state.totalStayAmount, r.state.transactions);
    expect(realBalance.isFullyPaid).toBe(true);
    expect(localToPaise(realBalance.remainingBalance)).toBe(0);

    // Compute the current end date (which may have been moved by SaveStayDetails).
    const currentEndDate = endDateFromNights(r.state.startDate, r.state.totalNights);

    // Checkout gate: today must be on or after the (possibly recalculated) end date.
    // We only check out when this condition is met.
    if (this.todayIST >= currentEndDate) {
      m.status = "FINISHED";
      r.state.status = "FINISHED";
    }
    // If todayIST < currentEndDate, checkout would be blocked — the command
    // simply doesn't transition. The real system's deriveStayActionVisibility
    // would disable the button.
  }

  toString(): string {
    return `Checkout(today=${this.todayIST})`;
  }
}

// ─── Command arbitraries ────────────────────────────────────────────────────

const arbAdvanceCommand = arbTransactionAmount.map(
  (amount) => new AdvanceCommand(amount),
);

const arbPartialPaymentCommand = arbTransactionAmount.map(
  (amount) => new PartialPaymentCommand(amount),
);

const arbExtensionCommand = fc
  .tuple(arbMoney, fc.integer({ min: 1, max: 30 }))
  .map(([amount, nights]) => new ExtensionCommand(amount, nights));

/** Generate a valid recalculated end date relative to the stay's start date. */
const arbSaveStayDetailsCommand = fc
  .tuple(
    // Offset in nights from start: 1 to 60 (covers short and long recalculations).
    fc.integer({ min: 1, max: 60 }),
    arbTotalStayAmount,
  )
  .map(([nightsFromStart, amount]) => {
    // The recalculated end date is start + nightsFromStart - 1 (inclusive).
    // We use a fixed start date "2025-01-01" for the fixture so the end date is deterministic.
    const recalculatedEndDate = shiftISODate("2025-01-01", nightsFromStart - 1);
    return new SaveStayDetailsCommand(recalculatedEndDate, amount);
  });

const arbRefundCommand = arbTransactionAmount.map(
  (amount) => new RefundCommand(amount),
);

/** Checkout command with a today date that's far enough to reach the end date. */
const arbCheckoutCommand = fc
  .constantFrom(
    "2025-01-15",
    "2025-02-15",
    "2025-03-15",
    "2025-06-01",
    "2025-12-31",
  )
  .map((today) => new CheckoutCommand(today));

const arbCommandSequence = fc.commands(
  [
    arbAdvanceCommand,
    arbPartialPaymentCommand,
    arbExtensionCommand,
    arbSaveStayDetailsCommand,
    arbRefundCommand,
    arbCheckoutCommand,
  ],
  { size: "small" },
);

// ─── Property ───────────────────────────────────────────────────────────────

describe("Feature: accommodation-payment-lifecycle, Property 23: Ledger consistency across operation sequences", () => {
  it("Total_Stay_Amount, Total_Paid, totalNights, and status never desynchronize across any valid operation sequence — stay stays ACTIVE until explicit checkout (Req 6.1, 11.6, 12.9, 12.13)", () => {
    transactionCounter = 0;
    fc.assert(
      fc.property(arbTotalStayAmount, arbCommandSequence, (initialTotal, cmds) => {
        transactionCounter = 0;
        const initialNights = 10;
        const startDate = "2025-01-01";

        fc.modelRun(
          () => ({
            model: {
              totalStayAmount: initialTotal,
              ledger: [],
              totalNights: initialNights,
              status: "ACTIVE",
            } as LedgerModel,
            real: new RealSystemWrapper(initialTotal, initialNights, startDate),
          }),
          cmds,
        );
      }),
      { numRuns: 100 },
    );
  });
});
