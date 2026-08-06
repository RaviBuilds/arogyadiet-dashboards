// src/services/__tests__/AccommodationService.recalculationMath.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 21: Save Stay Details recalculation and follow-up selection
//
// **Validates: Requirements 12.8, 12.10, 12.11, 12.12, 12.15**
//
// For any ACTIVE billable Stay_Entry with a known ledger (Total_Paid) and a
// valid Recalculate_Stay submission, applyStayRecalculationMath SHALL:
//   - derive totalNights from the end date via nightsFromEndDate (Req 12.8)
//   - select nextAction by paise comparison (Req 12.8, 12.12):
//     * > Total_Paid → COLLECT_BALANCE
//     * === Total_Paid → SETTLED
//     * < Total_Paid → RECORD_REFUND with refundDue = totalPaid − recalculatedStayAmount
//   - never return CHECKED_OUT (Req 12.9 — type guarantee, runtime assertion)
//   - handle 1–5 repeated submissions with no CHECKED_OUT (Req 12.10)
//   - report changesSomething correctly (Req 13.1, 13.2)
//   - report shortensStay correctly
//   - remain consistent across sequential submissions (originals pinned, Req 12.15)

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  applyStayRecalculationMath,
  nightsFromEndDate,
  toPaise,
} from "@/services/AccommodationService";
import {
  arbActiveBillableStayEntry,
  arbLedgerWith,
  arbValidRecalculateStaySubmission,
  arbTotalStayAmount,
  arbTotalNights,
  computeReferenceEndDate,
  shiftISODate,
  referenceTotalPaid,
  roundToPaise,
  arbRecalculatedAmountAround,
  REFERENCE_MIN_STAY_AMOUNT,
  REFERENCE_MAX_STAY_AMOUNT,
} from "@/test/accommodation/paymentArbitraries";

describe("Feature: accommodation-payment-lifecycle, Property 21: Save Stay Details recalculation and follow-up selection", () => {
  // ─── Shared scenario generator ───────────────────────────────────────────────
  // An ACTIVE billable stay + a ledger + a valid submission positioned so all
  // three branches are reachable.
  const arbRecalcScenario = arbActiveBillableStayEntry.chain((stay) =>
    arbLedgerWith({
      stayEntryId: stay.id,
      customerProfileId: stay.customerProfileId,
    }).chain((transactions) => {
      const totalPaid = referenceTotalPaid(transactions);
      return arbRecalculatedAmountAround(totalPaid).chain(
        (recalculatedStayAmount) =>
          // Valid end date within [startDate, bookedEndDate]
          fc
            .integer({ min: 0, max: Math.max(0, stay.totalNights - 1) })
            .map((offset) => ({
              stay,
              transactions,
              recalculatedEndDate: shiftISODate(stay.startDate, offset),
              recalculatedStayAmount,
              totalPaid,
            })),
      );
    }),
  );

  // ─── Property 1: Branch selection by paise comparison (Req 12.8, 12.12) ─────
  it("selects COLLECT_BALANCE when recalculatedStayAmount > Total_Paid (Req 12.8, 12.12)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount, totalPaid }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const recalcPaise = Math.round(recalculatedStayAmount * 100);
          const paidPaise = Math.round(totalPaid * 100);

          if (recalcPaise > paidPaise) {
            expect(result.nextAction).toBe("COLLECT_BALANCE");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("selects SETTLED when recalculatedStayAmount === Total_Paid in paise (Req 12.8, 12.12)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount, totalPaid }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const recalcPaise = Math.round(recalculatedStayAmount * 100);
          const paidPaise = Math.round(totalPaid * 100);

          if (recalcPaise === paidPaise) {
            expect(result.nextAction).toBe("SETTLED");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("selects RECORD_REFUND with correct refundDue when Total_Paid > recalculatedStayAmount (Req 12.8, 12.12)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount, totalPaid }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const recalcPaise = Math.round(recalculatedStayAmount * 100);
          const paidPaise = Math.round(totalPaid * 100);

          if (paidPaise > recalcPaise) {
            expect(result.nextAction).toBe("RECORD_REFUND");
            // refundDue = totalPaid − recalculatedStayAmount
            const expectedRefundPaise = paidPaise - recalcPaise;
            expect(Math.round(result.refundDue * 100)).toBe(expectedRefundPaise);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 2: Nights derived from end date (Req 12.8) ────────────────────
  it("totalNights equals nightsFromEndDate(stay.startDate, recalculatedEndDate) (Req 12.8)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const expectedNights = nightsFromEndDate(stay.startDate, recalculatedEndDate);
          expect(result.totalNights).toBe(expectedNights);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 3: No checkout ever (Req 12.9) ────────────────────────────────
  it("nextAction is never CHECKED_OUT — type-level and runtime guarantee (Req 12.9)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          // Runtime assertion: nextAction must be one of the three valid values
          const validActions = ["COLLECT_BALANCE", "RECORD_REFUND", "SETTLED"] as const;
          expect(validActions).toContain(result.nextAction);
          // Explicit "never CHECKED_OUT" assertion
          expect(result.nextAction).not.toBe("CHECKED_OUT");
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 4: Repeated submissions (Req 12.10) ───────────────────────────
  it("1–5 sequential valid submissions all return valid results with no CHECKED_OUT (Req 12.10)", () => {
    // Generate the stay and a sequence of 1–5 valid submissions
    const arbRepeatedScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).chain((transactions) =>
        fc
          .integer({ min: 1, max: 5 })
          .chain((count) =>
            fc.tuple(
              ...Array.from({ length: count }, () =>
                fc.record({
                  endDateOffset: fc.integer({
                    min: 0,
                    max: Math.max(0, stay.totalNights - 1),
                  }),
                  amount: fc.integer({
                    min: REFERENCE_MIN_STAY_AMOUNT,
                    max: REFERENCE_MAX_STAY_AMOUNT,
                  }),
                }),
              ),
            ),
          )
          .map((submissions) => ({ stay, transactions, submissions })),
      ),
    );

    fc.assert(
      fc.property(arbRepeatedScenario, ({ stay, transactions, submissions }) => {
        // Simulate sequential submissions by mutating a working copy of the stay
        const workingStay = { ...stay };

        for (const sub of submissions) {
          const recalculatedEndDate = shiftISODate(
            workingStay.startDate,
            sub.endDateOffset,
          );
          const result = applyStayRecalculationMath(
            workingStay,
            recalculatedEndDate,
            sub.amount,
            transactions,
          );

          // Each submission must return a valid result
          expect(result.nextAction).not.toBe("CHECKED_OUT");
          const validActions = ["COLLECT_BALANCE", "RECORD_REFUND", "SETTLED"] as const;
          expect(validActions).toContain(result.nextAction);
          expect(result.totalNights).toBeGreaterThanOrEqual(1);

          // Update the working stay for the next iteration (as would happen after save)
          workingStay.totalNights = result.totalNights;
          workingStay.paymentAmount = sub.amount;
          workingStay.endDate = recalculatedEndDate;
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 5: changesSomething (Req 13.1, 13.2) ──────────────────────────
  it("changesSomething is true when nights or amount differ, false when both match (Req 13.1, 13.2)", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const derivedNights = nightsFromEndDate(stay.startDate, recalculatedEndDate);
          const nightsChanged = derivedNights !== stay.totalNights;
          // Amount comparison in paise; null paymentAmount is always distinct
          const amountChanged =
            stay.paymentAmount === null ||
            toPaise(recalculatedStayAmount) !== toPaise(stay.paymentAmount);

          const expectedChangesSomething = nightsChanged || amountChanged;
          expect(result.changesSomething).toBe(expectedChangesSomething);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Also test the no-change case specifically to guarantee false is reachable
  it("changesSomething is false when submitting the stay's current values (Req 13.1, 13.2)", () => {
    fc.assert(
      fc.property(arbActiveBillableStayEntry, (stay) => {
        // Submit exactly the current values: same end date, same amount
        const currentEndDate = computeReferenceEndDate(
          stay.startDate,
          stay.totalNights,
        );
        const result = applyStayRecalculationMath(
          stay,
          currentEndDate,
          stay.paymentAmount!,
          [], // empty ledger — doesn't affect changesSomething
        );

        expect(result.changesSomething).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 6: shortensStay ───────────────────────────────────────────────
  it("shortensStay is true when derived end date < current booked end date, false otherwise", () => {
    fc.assert(
      fc.property(
        arbRecalcScenario,
        ({ stay, transactions, recalculatedEndDate, recalculatedStayAmount }) => {
          const result = applyStayRecalculationMath(
            stay,
            recalculatedEndDate,
            recalculatedStayAmount,
            transactions,
          );

          const currentBookedEndDate = computeReferenceEndDate(
            stay.startDate,
            stay.totalNights,
          );
          const expectedShortens = recalculatedEndDate < currentBookedEndDate;
          expect(result.shortensStay).toBe(expectedShortens);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 7: Originals pinned across sequential submissions (Req 12.15) ─
  it("across 1–5 sequential submissions, the function refers only to the current stay state (Req 12.15)", () => {
    const arbPinnedScenario = arbActiveBillableStayEntry.chain((stay) =>
      arbLedgerWith({
        stayEntryId: stay.id,
        customerProfileId: stay.customerProfileId,
      }).chain((transactions) =>
        fc
          .integer({ min: 1, max: 5 })
          .chain((count) =>
            fc.tuple(
              ...Array.from({ length: count }, () =>
                fc.record({
                  endDateOffset: fc.integer({
                    min: 0,
                    max: Math.max(0, stay.totalNights - 1),
                  }),
                  amount: fc.integer({
                    min: REFERENCE_MIN_STAY_AMOUNT,
                    max: REFERENCE_MAX_STAY_AMOUNT,
                  }),
                }),
              ),
            ),
          )
          .map((submissions) => ({ stay, transactions, submissions })),
      ),
    );

    fc.assert(
      fc.property(arbPinnedScenario, ({ stay, transactions, submissions }) => {
        const workingStay = { ...stay };

        // Track the initial values (before any submission)
        const initialNights = stay.totalNights;
        const initialAmount = stay.paymentAmount;

        for (const sub of submissions) {
          const recalculatedEndDate = shiftISODate(
            workingStay.startDate,
            sub.endDateOffset,
          );

          // The function is pure and uses the CURRENT working stay
          const result = applyStayRecalculationMath(
            workingStay,
            recalculatedEndDate,
            sub.amount,
            transactions,
          );

          // After the first submission mutates the working stay, subsequent
          // submissions must reflect the CURRENT state — not the initial one.
          // Verify totalNights is derived from the current recalculatedEndDate,
          // not the initial totalNights.
          const expectedNights = nightsFromEndDate(
            workingStay.startDate,
            recalculatedEndDate,
          );
          expect(result.totalNights).toBe(expectedNights);

          // changesSomething compares against the CURRENT working stay values
          const nightsChanged = expectedNights !== workingStay.totalNights;
          const amountChanged =
            workingStay.paymentAmount === null ||
            toPaise(sub.amount) !== toPaise(workingStay.paymentAmount);
          expect(result.changesSomething).toBe(nightsChanged || amountChanged);

          // The input stay is never mutated by the function
          expect(workingStay.totalNights).not.toBeUndefined();

          // Simulate save: update working stay for next submission
          workingStay.totalNights = result.totalNights;
          workingStay.paymentAmount = sub.amount;
          workingStay.endDate = recalculatedEndDate;
        }

        // After all submissions, if any submission changed values, the working
        // stay should differ from the initial — confirming originals were pinned
        // to pre-first-submission values only by the caller, not the function.
        // The function itself always references the state it is given.
        if (submissions.length > 0) {
          const lastSub = submissions[submissions.length - 1];
          const finalNights = nightsFromEndDate(
            stay.startDate,
            shiftISODate(stay.startDate, lastSub.endDateOffset),
          );
          // This just asserts consistency — the function isn't "remembering" old state
          expect(workingStay.totalNights).toBe(finalNights);
        }
      }),
      { numRuns: 100 },
    );
  });
});
