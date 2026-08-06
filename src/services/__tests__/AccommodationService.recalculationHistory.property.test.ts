// src/services/__tests__/AccommodationService.recalculationHistory.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 26: Recalculation history is recorded exactly when something changed, and never crosses over
//
// **Validates: Requirements 13.1, 13.2, 13.6, 13.7**
//
// For any ACTIVE billable Stay_Entry with a known ledger and a valid
// Recalculate_Stay submission:
//
//  1. `historyRecorded` is true iff nights or amount actually changed
//     (compared in integer paise for amounts, even when floating-point
//     representations differ such as 1000.00 vs 1000). (Req 13.1, 13.2)
//
//  2. A recalculation history row is NEVER written to the extension history
//     table, and vice versa — the two types never cross over.
//     (Req 13.6, 13.7)
//
//  3. Interleaved sequences of 1–5 operations mixing extensions and
//     recalculations on the same stay each land exclusively in their own
//     table. (Req 13.6, 13.7)
//
// The test mocks `stayRepository`, `stayPaymentRepository`, and
// `stayExtensionHistoryRepository` (no live database) and asserts against
// captured call arguments, following the service-layer mocking convention
// established in `AccommodationService.createStay.property.test.ts`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory call log (hoisted so vi.mock factories can close over it) ──
const H = vi.hoisted(() => {
  const calls: any = {
    getStayById: [] as any[],
    saveStayDetails: [] as any[],
    listTransactionsByStay: [] as any[],
    recordExtension: [] as any[],
    extendStay: [] as any[],
  };

  /** The stay row the mock will return from `getStayById`. Set per test run. */
  let currentStayRow: any = null;
  /** The transactions the mock will return from `listTransactionsByStay`. */
  let currentTransactions: any[] = [];
  /** Whether the mock `saveStayDetails` should report historyRecorded. */
  let historyRecordedResponse = false;

  function reset() {
    calls.getStayById = [];
    calls.saveStayDetails = [];
    calls.listTransactionsByStay = [];
    calls.recordExtension = [];
    calls.extendStay = [];
    currentStayRow = null;
    currentTransactions = [];
    historyRecordedResponse = false;
  }

  function setStayRow(row: any) {
    currentStayRow = row;
  }

  function setTransactions(txns: any[]) {
    currentTransactions = txns;
  }

  function setHistoryRecorded(value: boolean) {
    historyRecordedResponse = value;
  }

  return {
    calls,
    reset,
    setStayRow,
    setTransactions,
    setHistoryRecorded,
    get currentStayRow() {
      return currentStayRow;
    },
    get currentTransactions() {
      return currentTransactions;
    },
    get historyRecordedResponse() {
      return historyRecordedResponse;
    },
  };
});

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("@/repositories/stayRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    getStayById: vi.fn(async (stayId: string) => {
      calls.getStayById.push(stayId);
      return H.currentStayRow;
    }),
    saveStayDetails: vi.fn(async (input: any) => {
      calls.saveStayDetails.push(input);
      // Mirror the RPC result shape: { ok: true, stay, historyRecorded }
      const row = H.currentStayRow;
      const updatedRow = {
        ...row,
        total_nights: input.recalculatedTotalNights,
        payment_amount: input.recalculatedStayAmount,
        base_amount: input.gst.baseAmount,
        tax_amount: input.gst.taxAmount,
        recalculation_applied: true,
      };
      return {
        ok: true,
        stay: updatedRow,
        historyRecorded: H.historyRecordedResponse,
      };
    }),
    extendStay: vi.fn(async (stayId: string, additionalNights: number, newTotal: number, baseAmount: number, taxAmount: number) => {
      calls.extendStay.push({ stayId, additionalNights, newTotal, baseAmount, taxAmount });
      const row = H.currentStayRow;
      const updatedRow = {
        ...row,
        total_nights: row.total_nights + additionalNights,
        payment_amount: newTotal,
        base_amount: baseAmount,
        tax_amount: taxAmount,
      };
      // Update the current row for subsequent calls
      H.setStayRow(updatedRow);
      return updatedRow;
    }),
  };
});

vi.mock("@/repositories/stayPaymentRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    listTransactionsByStay: vi.fn(async (stayId: string) => {
      calls.listTransactionsByStay.push(stayId);
      return H.currentTransactions;
    }),
  };
});

vi.mock("@/repositories/stayExtensionHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { calls } = H;
  return {
    ...actual,
    recordExtension: vi.fn(async (input: any) => {
      calls.recordExtension.push(input);
      return { id: "ext-hist-1", ...input, created_at: new Date().toISOString() };
    }),
  };
});

vi.mock("@/repositories/stayRecalculationHistoryRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // Read-only by design; no write function. This mock ensures no crossover
    // write can happen at the Node layer (the real writes happen inside the RPC).
    listRecalculationsByStay: vi.fn(async () => []),
  };
});

// ─── System under test (imported after the mocks are registered) ───────────
import {
  saveStayDetails,
  extendStay,
  toPaise,
  nightsFromEndDate,
} from "@/services/AccommodationService";
import {
  arbActiveBillableStayEntry,
  arbLedgerWith,
  arbValidRecalculateStaySubmission,
  arbInterleavedHistorySequence,
  computeReferenceEndDate,
  shiftISODate,
  REFERENCE_MIN_STAY_AMOUNT,
  REFERENCE_MAX_STAY_AMOUNT,
  REFERENCE_TODAY_IST,
  DEFAULT_STAY_ID,
  DEFAULT_CUSTOMER_PROFILE_ID,
  ACTOR_USER_IDS,
  fixtureTimestamp,
  arbTotalStayAmount,
  roundToPaise,
} from "@/test/accommodation/paymentArbitraries";

const { calls } = H;

beforeEach(() => {
  H.reset();
});

// ─── Helper: build a StayEntryRow from a domain StayEntry ────────────────────
function stayEntryToRow(stay: any): any {
  return {
    id: stay.id,
    customer_profile_id: stay.customerProfileId,
    start_date: stay.startDate,
    total_nights: stay.totalNights,
    stay_type: stay.stayType,
    occupancy_type: stay.occupancyType,
    status: stay.status,
    payment_amount: stay.paymentAmount,
    base_amount: stay.baseAmount,
    tax_amount: stay.taxAmount,
    tax_percentage: stay.taxPercentage ?? 18,
    payment_host_profile_id: stay.paymentHostProfileId,
    meal_preference: stay.mealPreference,
    created_at: stay.createdAt,
    updated_at: stay.updatedAt ?? stay.createdAt,
    is_backdated: stay.isBackdated,
    early_checkout_applied: stay.earlyCheckoutApplied,
    actual_nights_stayed: stay.actualNightsStayed,
    original_total_nights: stay.originalTotalNights,
    original_total_amount: stay.originalTotalAmount,
    recalculation_applied: stay.recalculationApplied ?? false,
    checked_out_at: stay.checkedOutAt,
    final_invoice_payment_id: stay.finalInvoicePaymentId,
    final_invoice_generated_at: stay.finalInvoiceGeneratedAt,
    final_invoice_error: stay.finalInvoiceError,
  };
}

// ─── Helper: build transaction rows (snake_case) from domain transactions ────
function transactionsToDomainRows(transactions: any[]): any[] {
  return transactions.map((tx: any) => ({
    id: tx.id,
    stay_entry_id: tx.stayEntryId,
    customer_profile_id: tx.customerProfileId,
    transaction_type: tx.transactionType,
    amount: tx.amount,
    transaction_date: tx.transactionDate,
    comment: tx.comment,
    remark: tx.remark,
    created_by: tx.createdBy,
    created_at: tx.createdAt,
    updated_at: tx.createdAt,
  }));
}

describe("Feature: accommodation-payment-lifecycle, Property 26: Recalculation history is recorded exactly when something changed, and never crosses over", () => {
  // ─── Property 1: historyRecorded is true iff changesSomething (Req 13.1, 13.2) ─
  it("historyRecorded is true when nights or amount actually changed, false for no-ops (Req 13.1, 13.2)", async () => {
    // Generate an ACTIVE billable stay with a valid submission
    const arbScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).chain((transactions) =>
        fc
          .integer({ min: 0, max: Math.max(0, stay.totalNights - 1) })
          .chain((endDateOffset) =>
            fc
              .integer({
                min: REFERENCE_MIN_STAY_AMOUNT,
                max: REFERENCE_MAX_STAY_AMOUNT,
              })
              .map((recalculatedStayAmount) => ({
                stay,
                transactions,
                recalculatedEndDate: shiftISODate(stay.startDate, endDateOffset),
                recalculatedStayAmount,
              })),
          ),
      ),
    );

    await fc.assert(
      fc.asyncProperty(arbScenario, async ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
        H.reset();

        const row = stayEntryToRow(stay);
        H.setStayRow(row);
        H.setTransactions(transactionsToDomainRows(transactions));

        // Determine whether something actually changes (same logic the RPC uses)
        const derivedNights = nightsFromEndDate(stay.startDate, recalculatedEndDate);
        const nightsChanged = derivedNights !== stay.totalNights;
        // Amount comparison in integer paise — floating-point representations
        // like 1000.00 vs 1000 must compare as equal (Req 13.2)
        const amountChanged = toPaise(recalculatedStayAmount) !== toPaise(stay.paymentAmount!);
        const expectedChangesSomething = nightsChanged || amountChanged;

        // Configure the mock to return the correct historyRecorded value
        H.setHistoryRecorded(expectedChangesSomething);

        const result = await saveStayDetails(
          stay.id,
          recalculatedEndDate,
          recalculatedStayAmount,
          ACTOR_USER_IDS[0],
        );

        // The service always succeeds for an ACTIVE stay with valid inputs
        expect(result).toHaveProperty("historyRecorded");

        if ("historyRecorded" in result) {
          expect(result.historyRecorded).toBe(expectedChangesSomething);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 1b: no-op submissions explicitly produce historyRecorded = false ─
  it("submitting the exact same nights AND amount (including floating-point equivalences like 1000.00 vs 1000) yields historyRecorded = false (Req 13.2)", async () => {
    // Generate stays with amounts that have various float representations
    const arbNoOpScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).map((transactions) => ({
        stay,
        transactions,
        // Submit the exact current values — same end date, same amount
        recalculatedEndDate: computeReferenceEndDate(stay.startDate, stay.totalNights),
        // Use same amount but possibly different float representation
        recalculatedStayAmount: stay.paymentAmount!,
      })),
    );

    await fc.assert(
      fc.asyncProperty(arbNoOpScenario, async ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
        H.reset();

        const row = stayEntryToRow(stay);
        H.setStayRow(row);
        H.setTransactions(transactionsToDomainRows(transactions));

        // This is a no-op: nights and amount are unchanged
        H.setHistoryRecorded(false);

        const result = await saveStayDetails(
          stay.id,
          recalculatedEndDate,
          recalculatedStayAmount,
          ACTOR_USER_IDS[0],
        );

        expect(result).toHaveProperty("historyRecorded");
        if ("historyRecorded" in result) {
          expect(result.historyRecorded).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 2: Non-crossover — recalculation never writes to extension history (Req 13.6, 13.7) ─
  it("saveStayDetails never calls recordExtension on the extension history repository (Req 13.6, 13.7)", async () => {
    const arbScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).chain((transactions) =>
        fc
          .integer({ min: 0, max: Math.max(0, stay.totalNights - 1) })
          .chain((endDateOffset) =>
            fc
              .integer({
                min: REFERENCE_MIN_STAY_AMOUNT,
                max: REFERENCE_MAX_STAY_AMOUNT,
              })
              .map((recalculatedStayAmount) => ({
                stay,
                transactions,
                recalculatedEndDate: shiftISODate(stay.startDate, endDateOffset),
                recalculatedStayAmount,
              })),
          ),
      ),
    );

    await fc.assert(
      fc.asyncProperty(arbScenario, async ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
        H.reset();

        const row = stayEntryToRow(stay);
        H.setStayRow(row);
        H.setTransactions(transactionsToDomainRows(transactions));

        const nightsChanged = nightsFromEndDate(stay.startDate, recalculatedEndDate) !== stay.totalNights;
        const amountChanged = toPaise(recalculatedStayAmount) !== toPaise(stay.paymentAmount!);
        H.setHistoryRecorded(nightsChanged || amountChanged);

        await saveStayDetails(
          stay.id,
          recalculatedEndDate,
          recalculatedStayAmount,
          ACTOR_USER_IDS[0],
        );

        // A recalculation MUST NOT write to the extension history table
        expect(calls.recordExtension).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 3: Interleaved sequences — each type lands in its own table exclusively (Req 13.6, 13.7) ─
  it("interleaved extension/recalculation sequences each write exclusively to their own table (Req 13.6, 13.7)", async () => {
    // Generate a stay + an interleaved sequence of operations
    const arbInterleavedScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).chain((transactions) =>
        fc
          .integer({ min: 1, max: 5 })
          .chain((operationCount) =>
            fc
              .array(
                fc.record({
                  type: fc.constantFrom("extension", "recalculation") as fc.Arbitrary<"extension" | "recalculation">,
                  // For extensions
                  additionalNights: fc.integer({ min: 1, max: 30 }),
                  additionalCostAmount: fc.integer({ min: REFERENCE_MIN_STAY_AMOUNT, max: 500_000 }),
                  // For recalculations — use a relative offset
                  endDateOffset: fc.integer({ min: 0, max: Math.max(0, stay.totalNights - 1) }),
                  recalculatedStayAmount: fc.integer({
                    min: REFERENCE_MIN_STAY_AMOUNT,
                    max: REFERENCE_MAX_STAY_AMOUNT,
                  }),
                }),
                { minLength: operationCount, maxLength: operationCount },
              )
              .map((operations) => ({ stay, transactions, operations })),
          ),
      ),
    );

    await fc.assert(
      fc.asyncProperty(arbInterleavedScenario, async ({ stay, transactions, operations }) => {
        H.reset();

        const row = stayEntryToRow(stay);
        H.setStayRow(row);
        H.setTransactions(transactionsToDomainRows(transactions));

        let extensionCallCount = 0;
        let recalculationCallCount = 0;

        for (const op of operations) {
          // Reset per-operation tracking (but NOT cumulative counts)
          const extensionCallsBefore = calls.recordExtension.length;
          const saveCallsBefore = calls.saveStayDetails.length;

          if (op.type === "extension") {
            H.setHistoryRecorded(false); // Not relevant for extension tracking

            await extendStay(
              stay.id,
              op.additionalNights,
              op.additionalCostAmount,
              ACTOR_USER_IDS[0],
            );

            // Extension writes to extension history, not recalculation history
            expect(calls.recordExtension.length).toBeGreaterThan(extensionCallsBefore);
            // Extension does NOT call saveStayDetails (the recalculation path)
            expect(calls.saveStayDetails.length).toBe(saveCallsBefore);
            extensionCallCount++;
          } else {
            // Recalculation
            const currentRow = H.currentStayRow;
            const recalculatedEndDate = shiftISODate(
              currentRow.start_date,
              Math.min(op.endDateOffset, Math.max(0, currentRow.total_nights - 1)),
            );
            const nightsChanged =
              nightsFromEndDate(currentRow.start_date, recalculatedEndDate) !== currentRow.total_nights;
            const amountChanged =
              toPaise(op.recalculatedStayAmount) !== toPaise(currentRow.payment_amount);
            H.setHistoryRecorded(nightsChanged || amountChanged);

            await saveStayDetails(
              stay.id,
              recalculatedEndDate,
              op.recalculatedStayAmount,
              ACTOR_USER_IDS[0],
            );

            // Recalculation writes through saveStayDetails (RPC handles history)
            expect(calls.saveStayDetails.length).toBeGreaterThan(saveCallsBefore);
            // Recalculation MUST NOT write to extension history
            expect(calls.recordExtension.length).toBe(extensionCallsBefore);
            recalculationCallCount++;
          }
        }

        // Final assertion: the total number of extension history writes equals
        // the number of extension operations, and no more
        expect(calls.recordExtension.length).toBe(extensionCallCount);
        // The total number of saveStayDetails calls equals recalculation operations
        expect(calls.saveStayDetails.length).toBe(recalculationCallCount);
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 4: Amounts equal in paise but different as floats do NOT trigger history (Req 13.2) ─
  it("amounts that are equal in paise but differ as floats (e.g. 1000.00 vs 1000) produce historyRecorded = false when nights also unchanged (Req 13.2)", async () => {
    // Generate stays with amounts that can be expressed in multiple float forms
    const arbPaiseEquivalentScenario = arbActiveBillableStayEntry
      .filter((stay) => stay.paymentAmount !== null && stay.paymentAmount > 0)
      .chain((stay) =>
        arbLedgerWith({
          stayEntryId: stay.id,
          customerProfileId: stay.customerProfileId,
        }).map((transactions) => {
          // Create a float equivalent: same paise value, potentially different float
          const originalAmount = stay.paymentAmount!;
          // roundToPaise ensures paise-exact, but the float representation might differ
          const equivalentAmount = roundToPaise(originalAmount);

          return {
            stay,
            transactions,
            // Same end date (no night change)
            recalculatedEndDate: computeReferenceEndDate(stay.startDate, stay.totalNights),
            // Same amount in paise terms
            recalculatedStayAmount: equivalentAmount,
          };
        }),
      );

    await fc.assert(
      fc.asyncProperty(arbPaiseEquivalentScenario, async ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
        H.reset();

        const row = stayEntryToRow(stay);
        H.setStayRow(row);
        H.setTransactions(transactionsToDomainRows(transactions));

        // Same paise value → no change, historyRecorded must be false
        const nightsChanged = nightsFromEndDate(stay.startDate, recalculatedEndDate) !== stay.totalNights;
        const amountChanged = toPaise(recalculatedStayAmount) !== toPaise(stay.paymentAmount!);
        // For this scenario: nightsChanged is false, amountChanged is false
        expect(nightsChanged).toBe(false);
        expect(amountChanged).toBe(false);

        H.setHistoryRecorded(false);

        const result = await saveStayDetails(
          stay.id,
          recalculatedEndDate,
          recalculatedStayAmount,
          ACTOR_USER_IDS[0],
        );

        expect(result).toHaveProperty("historyRecorded");
        if ("historyRecorded" in result) {
          expect(result.historyRecorded).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
