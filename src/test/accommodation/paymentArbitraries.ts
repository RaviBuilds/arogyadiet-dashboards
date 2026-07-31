// src/test/accommodation/paymentArbitraries.ts
// Feature: accommodation-payment-lifecycle — shared property-test arbitraries
// (Task 1.4).
//
// Every property test for this feature draws its inputs from this module, so the
// input space is described once and the edge cases the requirements single out
// are folded into the generators rather than written as separate tests:
// amounts of exactly 0, 1, 9,999,999 and 10,000,000; amounts carrying paise;
// empty ledgers; refund-heavy ledgers; start dates spanning ±400 days around
// "today"; stays across every status × Backdated_Stay × Early_Checkout ×
// shared-payment combination; and Early_Checkout submissions that are valid,
// out of range, fractional, or not numeric at all.
//
// The generators are deliberately *reference-side*: the money bounds, the
// backdated / forward date windows, the GST formula and the Total_Paid formula
// are re-declared here from the requirements and the design document rather than
// imported from the modules under test, so a generator can never inherit a bug
// from the code it exercises. Type-only imports from `@/types/accommodation` are
// fine — they carry no behaviour.
//
// Nothing here reads a clock or a random source outside fast-check: dates are
// offsets from a fixed anchor and timestamps are offsets from a fixed instant,
// so every counterexample replays exactly.
//
// _Requirements: 6.3, 10.2, 12.8_

import * as fc from "fast-check";

import type {
  MealPreference,
  OccupancyType,
  PaymentTransactionType,
  StayEntry,
  StayPaymentTransaction,
  StayStatus,
  StayType,
} from "@/types/accommodation";

// ─── 1. Reference bounds and formulas ────────────────────────────────────────

/** Highest rupee amount any accommodation money field accepts (Req 4.2, 12.4). */
export const REFERENCE_MAX_STAY_AMOUNT = 9_999_999;

/** Lowest accepted Total_Stay_Amount / Recalculated_Stay_Amount (Req 4.2, 12.4). */
export const REFERENCE_MIN_STAY_AMOUNT = 1;

/** First rupee amount *above* the accepted range — the rejection boundary. */
export const REFERENCE_ABOVE_MAX_STAY_AMOUNT = REFERENCE_MAX_STAY_AMOUNT + 1; // 10,000,000

/** Backdating window: a Past_Stay_Start may be at most 30 days old (Req 1.3, 3.5). */
export const REFERENCE_MAX_BACKDATED_DAYS = 30;

/** Forward window: a stay may start at most 365 days ahead (Req 1.2). */
export const REFERENCE_MAX_FORWARD_START_DAYS = 365;

/** Highest booked total nights accepted at onboarding. */
export const REFERENCE_MAX_TOTAL_NIGHTS = 365;

/** GST rate applied to every Total_Stay_Amount (Req 4.8). */
export const REFERENCE_TAX_PERCENTAGE = 18;

/** Longest accepted comment / remark; 501 is the rejection boundary (Req 5.3, 5.4). */
export const REFERENCE_MAX_TEXT_LENGTH = 500;

/** The three Payment_Transaction_Type members (Req 6.2). */
export const PAYMENT_TRANSACTION_TYPES = [
  "ADVANCE",
  "PARTIAL_BALANCE_PAYMENT",
  "REFUND",
] as const satisfies readonly PaymentTransactionType[];

/** The four Stay_Status members. */
export const STAY_STATUSES = [
  "PENDING",
  "ACTIVE",
  "FINISHED",
  "EXPIRED",
] as const satisfies readonly StayStatus[];

/** Rounds a rupee figure to exact paise, the precision the ledger stores. */
export function roundToPaise(rupees: number): number {
  return Math.round(rupees * 100) / 100;
}

/**
 * Reference GST_Breakup — re-declared from Requirement 4.8 so generated stays
 * carry a `baseAmount` / `taxAmount` pair coherent with their Total_Stay_Amount
 * without importing the implementation.
 */
export function referenceGstBreakup(total: number): {
  baseAmount: number;
  taxAmount: number;
} {
  const baseAmount = roundToPaise(total / 1.18);
  return { baseAmount, taxAmount: roundToPaise(total - baseAmount) };
}

/**
 * Reference Total_Paid — ADVANCE and PARTIAL_BALANCE_PAYMENT amounts less
 * REFUND amounts, summed in integer paise (Req 6.3). Re-declared so ledger
 * shapes (notably "refund-heavy") can be described and asserted independently
 * of `deriveStayBalance`.
 */
export function referenceTotalPaid(
  transactions: readonly StayPaymentTransaction[],
): number {
  const paise = transactions.reduce(
    (sum, tx) =>
      sum +
      (tx.transactionType === "REFUND"
        ? -Math.round(tx.amount * 100)
        : Math.round(tx.amount * 100)),
    0,
  );
  return paise / 100;
}

// ─── 2. Pure date helpers ────────────────────────────────────────────────────

/** A fixed IST "today" so no generator reads a clock. */
export const REFERENCE_TODAY_IST = "2025-01-15";

/** A fixed instant backing every generated timestamp. */
export const ANCHOR_TIMESTAMP_MS = Date.UTC(2025, 0, 15, 6, 0, 0);

function pad2(value: number): string {
  return `${value}`.padStart(2, "0");
}

/**
 * Adds whole calendar days to a YYYY-MM-DD string via UTC arithmetic. Pure and
 * self-contained — deliberately not the `addDaysToISODate` the implementation
 * uses, so date fixtures cannot inherit a bug from it.
 */
export function shiftISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
    dt.getUTCDate(),
  )}`;
}

/** Computed_End_Date — start date + nights − 1, dates inclusive. */
export function computeReferenceEndDate(
  startDate: string,
  totalNights: number,
): string {
  return shiftISODate(startDate, totalNights - 1);
}

/** An ISO-8601 UTC timestamp at `offsetSeconds` from the anchor instant. */
export function fixtureTimestamp(offsetSeconds: number): string {
  return new Date(ANCHOR_TIMESTAMP_MS + offsetSeconds * 1_000).toISOString();
}

// ─── 3. Deterministic fixture identifiers ────────────────────────────────────

/**
 * Deterministic, well-formed v4-shaped UUIDs, so fixtures satisfy the
 * `z.string().uuid()` schemas in the validation layer while staying readable in
 * a shrunk counterexample.
 */
export function fixtureUuid(group: number, index: number): string {
  const tail = `${group}`.padStart(4, "0") + `${index}`.padStart(8, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

/** The Stay_Entry every generated ledger belongs to, unless overridden. */
export const DEFAULT_STAY_ID = fixtureUuid(11, 1);

/** The Customer_Record owning `DEFAULT_STAY_ID`. */
export const DEFAULT_CUSTOMER_PROFILE_ID = fixtureUuid(22, 1);

/** A second stay, for tests that must prove per-stay isolation of the ledger. */
export const OTHER_STAY_ID = fixtureUuid(11, 2);

/** The profile whose stay hosts a shared payment (`paymentHostProfileId`). */
export const PAYMENT_HOST_PROFILE_ID = fixtureUuid(22, 9);

/** Admins recorded as `created_by` on a ledger row. */
export const ACTOR_USER_IDS = [fixtureUuid(33, 1), fixtureUuid(33, 2)] as const;

/** A uuid present in no fixture set — the "reference not found" case. */
export const UNKNOWN_UUID = fixtureUuid(99, 99);

export const arbActorUserId: fc.Arbitrary<string> = fc.constantFrom(
  ...ACTOR_USER_IDS,
);

// ─── 4. Money ────────────────────────────────────────────────────────────────

/**
 * Any rupee figure a money field could carry, at exact paise precision.
 *
 * Biased towards the four values every bound check turns on — 0 (a non-billable
 * stay), 1 (the minimum accepted amount), 9,999,999 (the cap) and 10,000,000
 * (one paise-free step past it) — and towards paise-bearing values, because
 * float summation is exactly where a derived balance can drift off an exact
 * zero. (Req 4.2, 4.3, 6.3, 7.2, 12.4)
 */
export const arbMoney: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      0,
      REFERENCE_MIN_STAY_AMOUNT,
      REFERENCE_MAX_STAY_AMOUNT,
      REFERENCE_ABOVE_MAX_STAY_AMOUNT,
    ),
    weight: 4,
  },
  {
    // Paise-bearing values, including the classic 0.1 + 0.2 trio and figures
    // one paise either side of a bound.
    arbitrary: fc.constantFrom(
      0.01,
      0.1,
      0.2,
      0.3,
      0.99,
      1.01,
      99.99,
      1_234.56,
      33_333.33,
      REFERENCE_MAX_STAY_AMOUNT - 0.01,
      REFERENCE_MAX_STAY_AMOUNT + 0.01,
    ),
    weight: 3,
  },
  {
    arbitrary: fc
      .integer({ min: 0, max: REFERENCE_MAX_STAY_AMOUNT * 100 })
      .map((paise) => paise / 100),
    weight: 3,
  },
  { arbitrary: fc.integer({ min: 0, max: 100_000 }), weight: 2 },
);

/**
 * A Total_Stay_Amount inside the accepted range `[1, 9,999,999]` — used wherever
 * a stay must be billable for the property under test to say anything.
 */
export const arbTotalStayAmount: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      REFERENCE_MIN_STAY_AMOUNT,
      2,
      1_000,
      REFERENCE_MAX_STAY_AMOUNT - 1,
      REFERENCE_MAX_STAY_AMOUNT,
    ),
    weight: 3,
  },
  {
    arbitrary: fc.constantFrom(1.01, 118, 1_180.5, 49_999.99, 333_333.33),
    weight: 2,
  },
  {
    arbitrary: fc
      .integer({
        min: REFERENCE_MIN_STAY_AMOUNT * 100,
        max: REFERENCE_MAX_STAY_AMOUNT * 100,
      })
      .map((paise) => paise / 100),
    weight: 5,
  },
);

/**
 * A Total_Stay_Amount that may be zero — a zero-total stay is non-billable and
 * checks out without a Final_Consolidated_Invoice (Req 8.2).
 */
export const arbTotalStayAmountOrZero: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: arbTotalStayAmount, weight: 5 },
);

/**
 * A stored Payment_Transaction amount: strictly positive, at most the cap — the
 * `amount > 0` CHECK on `stay_payment_transactions` makes anything else
 * unreachable in the ledger (Req 6.2).
 */
export const arbTransactionAmount: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      0.01,
      REFERENCE_MIN_STAY_AMOUNT,
      1.01,
      99.99,
      REFERENCE_MAX_STAY_AMOUNT,
    ),
    weight: 3,
  },
  {
    arbitrary: fc
      .integer({ min: 1, max: REFERENCE_MAX_STAY_AMOUNT * 100 })
      .map((paise) => paise / 100),
    weight: 5,
  },
  { arbitrary: fc.integer({ min: 1, max: 50_000 }), weight: 3 },
);

// ─── 5. Comments and remarks ─────────────────────────────────────────────────

function textOfLength(length: number): string {
  return "x".repeat(length);
}

/** A `comment` / `remark` value as the ledger stores it: text or absent. */
export const arbStoredText: fc.Arbitrary<string | null> = fc.oneof(
  { arbitrary: fc.constant<string | null>(null), weight: 2 },
  {
    arbitrary: fc.constantFrom<string | null>(
      "Cash at reception",
      "UPI ref 90210",
      "Refund initiated to source account",
      textOfLength(REFERENCE_MAX_TEXT_LENGTH),
    ),
    weight: 3,
  },
  {
    arbitrary: fc.string({ minLength: 1, maxLength: 40 }) as fc.Arbitrary<
      string | null
    >,
    weight: 2,
  },
);

/**
 * Any value a Record Payment / Record Refund text field could carry: accepted
 * text alongside every rejection shape the requirements name — empty,
 * whitespace-only (a required comment must not be satisfiable by spaces), and
 * exactly 500 / 501 characters. (Req 5.3, 5.4, 5.7, 12.10)
 */
export const arbSubmittedText: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "",
      " ",
      "   ",
      "\t\n ",
      "Cash at reception",
      textOfLength(REFERENCE_MAX_TEXT_LENGTH),
      textOfLength(REFERENCE_MAX_TEXT_LENGTH + 1),
      ` ${textOfLength(REFERENCE_MAX_TEXT_LENGTH)} `,
    ),
    weight: 5,
  },
  { arbitrary: fc.string({ maxLength: 60 }), weight: 3 },
);

/** An optional text field submission — absent is a legitimate value. */
export const arbOptionalSubmittedText: fc.Arbitrary<string | undefined> =
  fc.oneof(
    { arbitrary: fc.constant<string | undefined>(undefined), weight: 2 },
    { arbitrary: arbSubmittedText as fc.Arbitrary<string | undefined>, weight: 5 },
  );

// ─── 6. Payment_Transaction records ──────────────────────────────────────────

export const arbTransactionType: fc.Arbitrary<PaymentTransactionType> =
  fc.constantFrom(...PAYMENT_TRANSACTION_TYPES);

/** Money coming *in* — the two types that increase Total_Paid (Req 6.3). */
export const arbInboundTransactionType: fc.Arbitrary<PaymentTransactionType> =
  fc.constantFrom<PaymentTransactionType>("ADVANCE", "PARTIAL_BALANCE_PAYMENT");

/** Refund-dominant type draw, backing the refund-heavy ledger shape. */
export const arbRefundHeavyTransactionType: fc.Arbitrary<PaymentTransactionType> =
  fc.oneof(
    { arbitrary: fc.constant<PaymentTransactionType>("REFUND"), weight: 4 },
    {
      arbitrary: fc.constant<PaymentTransactionType>(
        "PARTIAL_BALANCE_PAYMENT",
      ),
      weight: 1,
    },
  );

/**
 * The generated part of a Payment_Transaction. Identity, ownership, and the
 * creation timestamp are supplied by {@link materializeTransaction} from the
 * row's position, so a ledger's insertion order is reproducible.
 */
export interface TransactionSeed {
  transactionType: PaymentTransactionType;
  amount: number;
  /** Offset in days from the anchor date; a small pool makes date ties common. */
  dateSlot: number;
  /** Sub-minute jitter, so `createdAt` still ascends with the row's position. */
  createdJitter: number;
  comment: string | null;
  remark: string | null;
  createdBy: string | null;
}

export interface TransactionSeedOptions {
  type?: fc.Arbitrary<PaymentTransactionType>;
  amount?: fc.Arbitrary<number>;
  /** Half-width of the transaction-date pool, in days. Small values force ties. */
  dateSpread?: number;
}

export function arbTransactionSeed(
  options: TransactionSeedOptions = {},
): fc.Arbitrary<TransactionSeed> {
  const {
    type = arbTransactionType,
    amount = arbTransactionAmount,
    dateSpread = 3,
  } = options;

  return fc.record({
    transactionType: type,
    amount,
    dateSlot: fc.integer({ min: -dateSpread, max: dateSpread }),
    createdJitter: fc.integer({ min: 0, max: 3 }),
    comment: arbStoredText,
    remark: arbStoredText,
    createdBy: fc.oneof(
      { arbitrary: fc.constant<string | null>(null), weight: 1 },
      { arbitrary: arbActorUserId as fc.Arbitrary<string | null>, weight: 3 },
    ),
  });
}

export interface MaterializeOptions {
  stayEntryId?: string;
  customerProfileId?: string;
  /** Anchor the transaction dates cluster around. */
  anchorDate?: string;
}

/**
 * Turns a seed plus its position into a full Payment_Transaction. `createdAt`
 * ascends strictly with `index` (a minute apart, jittered by seconds) while
 * `transactionDate` is drawn from a deliberately narrow pool — so ledgers
 * routinely contain rows sharing a transaction date but differing in creation
 * order, which is what makes the history-ordering tie-break observable
 * (Req 6.5).
 */
export function materializeTransaction(
  seed: TransactionSeed,
  index: number,
  options: MaterializeOptions = {},
): StayPaymentTransaction {
  const {
    stayEntryId = DEFAULT_STAY_ID,
    customerProfileId = DEFAULT_CUSTOMER_PROFILE_ID,
    anchorDate = REFERENCE_TODAY_IST,
  } = options;

  return {
    id: fixtureUuid(44, index + 1),
    stayEntryId,
    customerProfileId,
    transactionType: seed.transactionType,
    amount: roundToPaise(seed.amount),
    transactionDate: shiftISODate(anchorDate, seed.dateSlot),
    comment: seed.comment,
    remark: seed.remark,
    createdBy: seed.createdBy,
    createdAt: fixtureTimestamp(index * 60 + seed.createdJitter),
  };
}

/** A single Payment_Transaction across all three types (Req 6.2, 10.2). */
export const arbTransaction: fc.Arbitrary<StayPaymentTransaction> =
  arbTransactionSeed().map((seed) => materializeTransaction(seed, 0));

/** A Payment_Transaction of a specific type — one Payment_Receipt per type. */
export function arbTransactionOfType(
  transactionType: PaymentTransactionType,
  options: MaterializeOptions = {},
): fc.Arbitrary<StayPaymentTransaction> {
  return arbTransactionSeed({ type: fc.constant(transactionType) }).map((seed) =>
    materializeTransaction(seed, 0, options),
  );
}

// ─── 7. Ledgers ──────────────────────────────────────────────────────────────

export interface LedgerOptions extends MaterializeOptions {
  minLength?: number;
  /** Hard cap of 20 rows keeps shrinking fast while still spanning long ledgers. */
  maxLength?: number;
}

function materializeLedger(
  seeds: readonly TransactionSeed[],
  options: MaterializeOptions,
): StayPaymentTransaction[] {
  return seeds.map((seed, index) =>
    materializeTransaction(seed, index, options),
  );
}

/**
 * A Payment_Transaction ledger for one stay, 0–20 rows, in insertion order.
 *
 * The shapes are chosen so balance derivation is pinned from every angle:
 *
 * - **empty** — Total_Paid must read 0 and Remaining_Balance the full total (Req 6.7)
 * - **advance only** — the single row onboarding creates (Req 4.5)
 * - **advance + partials** — the ordinary collection sequence (Req 5.8)
 * - **refund-heavy** — refunds dominate, so Total_Paid can go negative and
 *   Remaining_Balance can exceed the total (Req 6.3, 12.11)
 * - **fully mixed** — any interleaving of the three types, up to the 20-row cap
 */
export function arbLedgerWith(
  options: LedgerOptions = {},
): fc.Arbitrary<StayPaymentTransaction[]> {
  const { minLength = 0, maxLength = 20, ...materialize } = options;

  const advanceSeed = arbTransactionSeed({
    type: fc.constant<PaymentTransactionType>("ADVANCE"),
  });

  /** An ADVANCE row followed by `[tailMin, tailMax]` rows of the given type. */
  const advanceThen = (
    tailType: fc.Arbitrary<PaymentTransactionType>,
    tailCap: number,
  ): fc.Arbitrary<StayPaymentTransaction[]> => {
    const tailMin = Math.max(1, minLength - 1);
    const tailMax = Math.max(tailMin, Math.min(maxLength - 1, tailCap));
    return fc
      .tuple(
        advanceSeed,
        fc.array(arbTransactionSeed({ type: tailType }), {
          minLength: tailMin,
          maxLength: tailMax,
        }),
      )
      .map(([advance, tail]) =>
        materializeLedger([advance, ...tail], materialize),
      );
  };

  const shapes: Array<{
    arbitrary: fc.Arbitrary<StayPaymentTransaction[]>;
    weight: number;
  }> = [];

  // Empty ledger — Total_Paid 0, Remaining_Balance the full total (Req 6.7).
  if (minLength === 0) {
    shapes.push({ arbitrary: fc.constant([]), weight: 2 });
  }

  // Advance only — the single row onboarding creates (Req 4.5).
  if (minLength <= 1) {
    shapes.push({
      arbitrary: advanceSeed.map((seed) =>
        materializeLedger([seed], materialize),
      ),
      weight: 2,
    });
  }

  if (maxLength >= 2) {
    // Advance followed by partial/balance payments (Req 5.8).
    shapes.push({
      arbitrary: advanceThen(
        fc.constant<PaymentTransactionType>("PARTIAL_BALANCE_PAYMENT"),
        8,
      ),
      weight: 4,
    });
    // Refund-heavy — Total_Paid may go negative (Req 6.3, 12.11).
    shapes.push({
      arbitrary: advanceThen(arbRefundHeavyTransactionType, 6),
      weight: 3,
    });
  }

  // Fully mixed, up to the 20-row cap.
  shapes.push({
    arbitrary: fc
      .array(arbTransactionSeed(), { minLength, maxLength })
      .map((seeds) => materializeLedger(seeds, materialize)),
    weight: 4,
  });

  return fc.oneof(...shapes);
}

/** A Payment_Transaction ledger for {@link DEFAULT_STAY_ID}. */
export const arbLedger: fc.Arbitrary<StayPaymentTransaction[]> = arbLedgerWith();

/** A ledger with at least one row — for properties about a non-empty history. */
export const arbNonEmptyLedger: fc.Arbitrary<StayPaymentTransaction[]> =
  arbLedgerWith({ minLength: 1 });

/**
 * A ledger handed over in an arbitrary order, as an unsorted read could deliver
 * it. Insertion order (and therefore `createdAt`) is unchanged — only the array
 * order is shuffled, so a correct history renderer must sort rather than trust
 * the array (Req 6.5).
 */
export const arbShuffledLedger: fc.Arbitrary<StayPaymentTransaction[]> =
  arbLedger.chain((transactions) =>
    transactions.length < 2
      ? fc.constant(transactions)
      : fc.shuffledSubarray(transactions, {
          minLength: transactions.length,
          maxLength: transactions.length,
        }),
  );

// ─── 8. Dates ────────────────────────────────────────────────────────────────

/**
 * An IST calendar date (YYYY-MM-DD) standing in for "today". Biased towards the
 * boundaries date arithmetic gets wrong: month ends, year ends, the leap day,
 * and the day after a leap day.
 */
export const arbISTDate: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "2024-01-01",
      "2024-01-31",
      "2024-02-28",
      "2024-02-29", // leap day
      "2024-03-01",
      "2024-12-31",
      "2025-01-01",
      "2025-02-28",
      "2025-03-01",
      "2025-12-31",
      "2100-02-28", // century, non-leap
    ),
    weight: 3,
  },
  {
    arbitrary: fc
      .integer({ min: -800, max: 800 })
      .map((days) => shiftISODate(REFERENCE_TODAY_IST, days)),
    weight: 5,
  },
);

/**
 * Day offsets around "today" spanning ±`span` days, biased towards every
 * boundary the two start-date windows turn on: the 30-day backdating edge and
 * the day beyond it, yesterday, today, tomorrow, and the 365-day forward edge
 * and the day beyond it. (Req 1.2, 1.3, 3.5)
 */
export function arbStartOffsetAround(span = 400): fc.Arbitrary<number> {
  return fc.oneof(
    {
      arbitrary: fc.constantFrom(
        -span,
        -REFERENCE_MAX_BACKDATED_DAYS - 1,
        -REFERENCE_MAX_BACKDATED_DAYS,
        -REFERENCE_MAX_BACKDATED_DAYS + 1,
        -1,
        0,
        1,
        REFERENCE_MAX_FORWARD_START_DAYS - 1,
        REFERENCE_MAX_FORWARD_START_DAYS,
        REFERENCE_MAX_FORWARD_START_DAYS + 1,
        span,
      ),
      weight: 5,
    },
    { arbitrary: fc.integer({ min: -span, max: span }), weight: 5 },
  );
}

/**
 * A candidate stay start date within ±400 days of the given IST "today" — the
 * input space both start-date windows are quantified over (Req 1.2, 1.3).
 */
export function arbStartDateAround(
  today: string = REFERENCE_TODAY_IST,
  span = 400,
): fc.Arbitrary<string> {
  return arbStartOffsetAround(span).map((days) => shiftISODate(today, days));
}

/** A Past_Stay_Start inside the accepted backdating window `[today−30, today−1]`. */
export function arbPastStartDate(
  today: string = REFERENCE_TODAY_IST,
): fc.Arbitrary<string> {
  return fc
    .integer({ min: -REFERENCE_MAX_BACKDATED_DAYS, max: -1 })
    .map((days) => shiftISODate(today, days));
}

/** Booked total nights, biased towards both ends of `[1, 365]`. */
export const arbTotalNights: fc.Arbitrary<number> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      1,
      2,
      3,
      REFERENCE_MAX_TOTAL_NIGHTS - 1,
      REFERENCE_MAX_TOTAL_NIGHTS,
    ),
    weight: 3,
  },
  {
    arbitrary: fc.integer({ min: 1, max: REFERENCE_MAX_TOTAL_NIGHTS }),
    weight: 5,
  },
);

// ─── 9. Stay_Entry records ───────────────────────────────────────────────────

export const arbStayStatus: fc.Arbitrary<StayStatus> = fc.constantFrom(
  ...STAY_STATUSES,
);

export const arbStayType: fc.Arbitrary<StayType> = fc.constantFrom(
  "AC Villa",
  "Village Style Hut",
);

export const arbOccupancyType: fc.Arbitrary<OccupancyType> = fc.constantFrom(
  "Single",
  "Double",
);

export const arbMealPreference: fc.Arbitrary<MealPreference> = fc.constantFrom(
  "VEG",
  "EGG",
  "CHICKEN",
);

export interface StayEntryOptions {
  id?: string;
  customerProfileId?: string;
  /** The IST date the stay's dates are positioned against. */
  today?: string;
  status?: fc.Arbitrary<StayStatus>;
  /** Shared_Payment stays carry no Total_Stay_Amount and no ledger (Req 4.7). */
  sharedPayment?: fc.Arbitrary<boolean>;
  isBackdated?: fc.Arbitrary<boolean>;
  earlyCheckoutApplied?: fc.Arbitrary<boolean>;
  /** Total_Stay_Amount when the stay is not shared-payment. */
  totalStayAmount?: fc.Arbitrary<number>;
  totalNights?: fc.Arbitrary<number>;
  /** Whether a Final_Consolidated_Invoice already exists (Req 8.6, 9.2). */
  hasFinalInvoice?: fc.Arbitrary<boolean>;
}

/**
 * A Stay_Entry spanning the combination space the visibility, checkout, and
 * invoice properties quantify over: every Stay_Status × Backdated_Stay ×
 * Early_Checkout × shared-payment, each with a coherent set of dependent
 * fields —
 *
 * - `endDate` always equals start date + nights − 1
 * - a shared-payment stay has `paymentAmount`, `baseAmount` and `taxAmount` null
 * - a billable stay's GST breakup is derived from its current Total_Stay_Amount
 * - a Backdated_Stay starts within `[today−30, today−1]`
 * - `earlyCheckoutApplied` implies `actualNightsStayed === totalNights` with the
 *   pre-checkout figures preserved in `originalTotalNights` /
 *   `originalTotalAmount`, and null on both when it is false
 * - `finalInvoicePaymentId` and `finalInvoiceGeneratedAt` are set together, only
 *   for a billable stay, and `finalInvoiceError` only ever appears without them
 *
 * (Req 3.1, 4.7, 8.2, 8.7, 12.6, 12.15)
 */
export function arbStayEntryWith(
  options: StayEntryOptions = {},
): fc.Arbitrary<StayEntry> {
  const {
    id = DEFAULT_STAY_ID,
    customerProfileId = DEFAULT_CUSTOMER_PROFILE_ID,
    today = REFERENCE_TODAY_IST,
    status = arbStayStatus,
    sharedPayment = fc.oneof(
      { arbitrary: fc.constant(false), weight: 4 },
      { arbitrary: fc.constant(true), weight: 1 },
    ),
    isBackdated = fc.boolean(),
    earlyCheckoutApplied = fc.oneof(
      { arbitrary: fc.constant(false), weight: 3 },
      { arbitrary: fc.constant(true), weight: 1 },
    ),
    totalStayAmount = arbTotalStayAmountOrZero,
    totalNights = arbTotalNights,
    hasFinalInvoice = fc.boolean(),
  } = options;

  return fc
    .record({
      status,
      stayType: arbStayType,
      occupancyType: arbOccupancyType,
      mealPreference: arbMealPreference,
      totalNights,
      startOffset: arbStartOffsetAround(),
      backdatedOffset: fc.integer({
        min: -REFERENCE_MAX_BACKDATED_DAYS,
        max: -1,
      }),
      isBackdated,
      sharedPayment,
      earlyCheckoutApplied,
      totalStayAmount,
      originalTotalAmount: arbTotalStayAmount,
      extraOriginalNights: fc.integer({ min: 1, max: 60 }),
      hasFinalInvoice,
      invoiceError: fc.oneof(
        { arbitrary: fc.constant<string | null>(null), weight: 3 },
        {
          arbitrary: fc.constantFrom<string | null>(
            "Invoice generation failed.",
            "duplicate key value violates unique constraint",
          ),
          weight: 1,
        },
      ),
      ageSeconds: fc.integer({ min: 0, max: 100_000 }),
    })
    .map((seed): StayEntry => {
      const startDate = seed.isBackdated
        ? shiftISODate(today, seed.backdatedOffset)
        : shiftISODate(today, seed.startOffset);
      const nights = seed.totalNights;

      const paymentAmount = seed.sharedPayment ? null : seed.totalStayAmount;
      const gst =
        paymentAmount === null
          ? { baseAmount: null, taxAmount: null }
          : referenceGstBreakup(paymentAmount);

      const isBillable = paymentAmount !== null && paymentAmount > 0;
      const invoicePresent = seed.hasFinalInvoice && isBillable;

      const checkedOut = seed.status === "FINISHED" && !seed.isBackdated;

      return {
        id,
        customerProfileId,
        startDate,
        totalNights: nights,
        stayType: seed.stayType,
        occupancyType: seed.occupancyType,
        status: seed.status,
        paymentAmount,
        baseAmount: gst.baseAmount,
        taxAmount: gst.taxAmount,
        taxPercentage: REFERENCE_TAX_PERCENTAGE,
        paymentHostProfileId: seed.sharedPayment
          ? PAYMENT_HOST_PROFILE_ID
          : null,
        mealPreference: seed.mealPreference,
        endDate: computeReferenceEndDate(startDate, nights),
        createdAt: fixtureTimestamp(-seed.ageSeconds),
        updatedAt: fixtureTimestamp(0),

        isBackdated: seed.isBackdated,
        earlyCheckoutApplied: seed.earlyCheckoutApplied,
        // Early_Checkout sets total nights to the nights actually stayed and
        // keeps the pre-checkout figures as audit values (Req 12.6, 12.15).
        actualNightsStayed: seed.earlyCheckoutApplied ? nights : null,
        originalTotalNights: seed.earlyCheckoutApplied
          ? nights + seed.extraOriginalNights
          : null,
        originalTotalAmount:
          seed.earlyCheckoutApplied && paymentAmount !== null
            ? seed.originalTotalAmount
            : null,
        checkedOutAt: checkedOut ? fixtureTimestamp(seed.ageSeconds) : null,
        finalInvoicePaymentId: invoicePresent ? fixtureUuid(55, 1) : null,
        finalInvoiceGeneratedAt: invoicePresent
          ? fixtureTimestamp(seed.ageSeconds + 10)
          : null,
        finalInvoiceError: invoicePresent ? null : seed.invoiceError,
      };
    });
}

/** A Stay_Entry across the full combination space. */
export const arbStayEntry: fc.Arbitrary<StayEntry> = arbStayEntryWith();

/**
 * An ACTIVE, billable (non-shared, positive total), not-yet-early-checked-out
 * stay — the only shape Mark as Checked Out, Early Checkout, and Stay_Extension
 * may legitimately act on (Req 7.1, 11.5, 12.1).
 */
export const arbActiveBillableStayEntry: fc.Arbitrary<StayEntry> =
  arbStayEntryWith({
    status: fc.constant<StayStatus>("ACTIVE"),
    sharedPayment: fc.constant(false),
    earlyCheckoutApplied: fc.constant(false),
    totalStayAmount: arbTotalStayAmount,
    hasFinalInvoice: fc.constant(false),
  });

/** A Backdated_Stay: FINISHED at creation, `isBackdated` set (Req 3.1, 9.1). */
export const arbBackdatedStayEntry: fc.Arbitrary<StayEntry> = arbStayEntryWith({
  status: fc.constant<StayStatus>("FINISHED"),
  isBackdated: fc.constant(true),
  sharedPayment: fc.constant(false),
  totalStayAmount: arbTotalStayAmount,
});

/** A stay in any status other than ACTIVE — the rejection side of the gate. */
export const arbNonActiveStayEntry: fc.Arbitrary<StayEntry> = arbStayEntryWith({
  status: fc.constantFrom<StayStatus>("PENDING", "FINISHED", "EXPIRED"),
});

// ─── 10. Early_Checkout submissions ──────────────────────────────────────────

/**
 * An Early_Checkout form submission as it arrives — the numeric fields are typed
 * `unknown` because a submission legitimately carries anything a form or an
 * action payload can produce, and the property under test asserts acceptance is
 * *exactly* "integer in `[1, bookedTotalNights − 1]`" paired with "amount in
 * `[1, 9,999,999]`" (Req 12.3, 12.4, 12.5).
 */
export interface EarlyCheckoutSubmissionSample {
  bookedTotalNights: number;
  actualNightsStayed: unknown;
  recalculatedStayAmount: unknown;
}

function arbCandidateNights(booked: number): fc.Arbitrary<unknown> {
  return fc.oneof(
    // In range whenever one exists — with booked = 1 there is none, and the
    // single value produced here is then correctly out of range.
    {
      arbitrary: fc.integer({
        min: 1,
        max: Math.max(1, booked - 1),
      }) as fc.Arbitrary<unknown>,
      weight: 5,
    },
    // Boundaries either side of the accepted range.
    {
      arbitrary: fc.constantFrom<unknown>(
        0,
        -1,
        1,
        booked - 1,
        booked,
        booked + 1,
        REFERENCE_MAX_TOTAL_NIGHTS + 1,
      ),
      weight: 4,
    },
    // Non-integral values — an integer bound must reject these.
    {
      arbitrary: fc.constantFrom<unknown>(
        0.5,
        1.5,
        booked - 0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ),
      weight: 2,
    },
    // Shapes a payload can carry where a number is expected.
    {
      arbitrary: fc.constantFrom<unknown>("2", "", null, undefined, true),
      weight: 2,
    },
  );
}

const arbCandidateRecalculatedAmount: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: arbMoney as fc.Arbitrary<unknown>, weight: 5 },
  {
    arbitrary: fc.constantFrom<unknown>(
      0,
      -1,
      0.5,
      REFERENCE_ABOVE_MAX_STAY_AMOUNT,
      Number.NaN,
      "1000",
      null,
      undefined,
    ),
    weight: 3,
  },
);

/** Early_Checkout submissions spanning the accepted range and every rejection shape. */
export const arbEarlyCheckoutSubmission: fc.Arbitrary<EarlyCheckoutSubmissionSample> =
  fc
    .integer({ min: 1, max: REFERENCE_MAX_TOTAL_NIGHTS })
    .chain((bookedTotalNights) =>
      fc.record({
        bookedTotalNights: fc.constant(bookedTotalNights),
        actualNightsStayed: arbCandidateNights(bookedTotalNights),
        recalculatedStayAmount: arbCandidateRecalculatedAmount,
      }),
    );

/** A guaranteed-valid Early_Checkout submission, for the math and branch properties. */
export interface ValidEarlyCheckoutSubmission {
  bookedTotalNights: number;
  actualNightsStayed: number;
  recalculatedStayAmount: number;
}

export const arbValidEarlyCheckoutSubmission: fc.Arbitrary<ValidEarlyCheckoutSubmission> =
  fc
    .integer({ min: 2, max: REFERENCE_MAX_TOTAL_NIGHTS })
    .chain((bookedTotalNights) =>
      fc.record({
        bookedTotalNights: fc.constant(bookedTotalNights),
        actualNightsStayed: fc.integer({ min: 1, max: bookedTotalNights - 1 }),
        recalculatedStayAmount: arbTotalStayAmount,
      }),
    );

/**
 * A Recalculated_Stay_Amount positioned relative to a known Total_Paid so all
 * three Early_Checkout branches are reached: greater than Total_Paid (collect
 * the balance), exactly equal (check out immediately), and less (record a
 * refund of the excess). (Req 12.7, 12.8, 12.12)
 */
export function arbRecalculatedAmountAround(
  totalPaid: number,
): fc.Arbitrary<number> {
  const paidPaise = Math.round(totalPaid * 100);
  const clamp = (paise: number): number =>
    Math.min(
      Math.max(paise, REFERENCE_MIN_STAY_AMOUNT * 100),
      REFERENCE_MAX_STAY_AMOUNT * 100,
    );

  return fc.oneof(
    // Exactly equal — the immediate-checkout branch.
    { arbitrary: fc.constant(clamp(paidPaise) / 100), weight: 3 },
    // One paise either side — the tightest possible branch boundary.
    {
      arbitrary: fc
        .constantFrom(paidPaise - 1, paidPaise + 1)
        .map((paise) => clamp(paise) / 100),
      weight: 3,
    },
    // Clearly above and clearly below.
    {
      arbitrary: fc
        .integer({ min: 1, max: 500_000 })
        .chain((delta) =>
          fc.constantFrom(paidPaise - delta, paidPaise + delta),
        )
        .map((paise) => clamp(paise) / 100),
      weight: 3,
    },
    // Unrelated valid amount.
    { arbitrary: arbTotalStayAmount, weight: 2 },
  );
}
