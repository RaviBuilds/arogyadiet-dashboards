// src/lib/accommodation/__tests__/recalculationHistory.property.test.ts
// Feature: accommodation-payment-lifecycle, Property 27: Recalculation history ordering and completeness
//
// Asserts that `buildRecalculationHistoryRows` produces a complete, correctly
// ordered, and accurately projected list from any set of StayRecalculation
// records. The function under test is a pure sort+project — no DB, no side
// effects — so each property holds unconditionally.
//
// **Validates: Requirements 13.4, 13.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { buildRecalculationHistoryRows } from "@/lib/accommodation/recalculationHistory";
import {
  arbStayRecalculation,
  arbInterleavedHistorySequence,
} from "@/test/accommodation/paymentArbitraries";
import type { StayRecalculation } from "@/types/accommodation";

/** The task requires at least 100 iterations per property. */
const NUM_RUNS = 100;

/**
 * Generates a list of 0–10 StayRecalculation records with ascending indices,
 * suitable for testing ordering and completeness properties.
 */
const arbRecalculationList: fc.Arbitrary<StayRecalculation[]> = fc
  .integer({ min: 0, max: 10 })
  .chain((count) =>
    count === 0
      ? fc.constant<StayRecalculation[]>([])
      : fc
          .tuple(
            ...Array.from({ length: count }, (_, i) =>
              arbStayRecalculation({ index: i }),
            ),
          )
          .map((recs) => recs as StayRecalculation[]),
  );

/**
 * Generates a non-empty list (1–10) of StayRecalculation records.
 */
const arbNonEmptyRecalculationList: fc.Arbitrary<StayRecalculation[]> = fc
  .integer({ min: 1, max: 10 })
  .chain((count) =>
    fc
      .tuple(
        ...Array.from({ length: count }, (_, i) =>
          arbStayRecalculation({ index: i }),
        ),
      )
      .map((recs) => recs as StayRecalculation[]),
  );

describe("Feature: accommodation-payment-lifecycle, Property 27: Recalculation history ordering and completeness", () => {
  it("total/completeness: output length equals input length (Req 13.4)", () => {
    /**
     * **Validates: Requirements 13.4**
     *
     * Every recalculation must be represented in the output — none lost, none
     * duplicated.
     */
    fc.assert(
      fc.property(arbRecalculationList, (recalculations) => {
        const rows = buildRecalculationHistoryRows(recalculations);
        expect(rows.length).toBe(recalculations.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("ordering: output rows are ascending by (date, createdAt) (Req 13.5)", () => {
    /**
     * **Validates: Requirements 13.5**
     *
     * Rows must be sorted ascending by `recalculatedOn` (projected as `date`),
     * with `createdAt` as the tiebreaker for same-date records.
     */
    fc.assert(
      fc.property(arbNonEmptyRecalculationList, (recalculations) => {
        const rows = buildRecalculationHistoryRows(recalculations);

        for (let i = 0; i < rows.length - 1; i++) {
          const current = rows[i];
          const next = rows[i + 1];

          // Primary sort: date ascending
          expect(current.date <= next.date).toBe(true);

          // When dates are equal, the relative order must match createdAt order
          if (current.date === next.date) {
            // Find the corresponding input records to verify createdAt ordering
            const currentInput = recalculations.find((r) => r.id === current.id);
            const nextInput = recalculations.find((r) => r.id === next.id);
            expect(currentInput).toBeDefined();
            expect(nextInput).toBeDefined();
            expect(currentInput!.createdAt <= nextInput!.createdAt).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input yields empty output (Req 13.4 empty state)", () => {
    /**
     * **Validates: Requirements 13.4**
     *
     * An empty recalculations array produces an empty rows array — no throw,
     * no null.
     */
    const rows = buildRecalculationHistoryRows([]);
    expect(rows).toEqual([]);
  });

  it("shuffled input still yields correct ascending order (Req 13.5)", () => {
    /**
     * **Validates: Requirements 13.5**
     *
     * Regardless of the input array order, the output must be sorted ascending
     * by (date, createdAt). This proves the function sorts internally rather
     * than trusting the input ordering.
     */
    fc.assert(
      fc.property(
        arbNonEmptyRecalculationList.chain((recs) =>
          recs.length < 2
            ? fc.constant(recs)
            : fc.shuffledSubarray(recs, {
                minLength: recs.length,
                maxLength: recs.length,
              }),
        ),
        (shuffled) => {
          const rows = buildRecalculationHistoryRows(shuffled);

          // Verify ascending order
          for (let i = 0; i < rows.length - 1; i++) {
            const current = rows[i];
            const next = rows[i + 1];
            expect(current.date <= next.date).toBe(true);

            if (current.date === next.date) {
              const currentInput = shuffled.find((r) => r.id === current.id);
              const nextInput = shuffled.find((r) => r.id === next.id);
              expect(currentInput).toBeDefined();
              expect(nextInput).toBeDefined();
              expect(currentInput!.createdAt <= nextInput!.createdAt).toBe(true);
            }
          }

          // Completeness still holds after shuffling
          expect(rows.length).toBe(shuffled.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("field projection: every output row maps correctly from the corresponding input (Req 13.4, 13.5)", () => {
    /**
     * **Validates: Requirements 13.4, 13.5**
     *
     * Every field on a RecalculationHistoryRow must equal the corresponding
     * field on the input StayRecalculation it was projected from.
     */
    fc.assert(
      fc.property(arbRecalculationList, (recalculations) => {
        const rows = buildRecalculationHistoryRows(recalculations);

        for (const row of rows) {
          const source = recalculations.find((r) => r.id === row.id);
          expect(source).toBeDefined();

          // Verify every projected field
          expect(row.id).toBe(source!.id);
          expect(row.date).toBe(source!.recalculatedOn);
          expect(row.nightsBefore).toBe(source!.nightsBefore);
          expect(row.nightsAfter).toBe(source!.nightsAfter);
          expect(row.totalAmountBefore).toBe(source!.totalAmountBefore);
          expect(row.totalAmountAfter).toBe(source!.totalAmountAfter);
          expect(row.endDateBefore).toBe(source!.endDateBefore);
          expect(row.endDateAfter).toBe(source!.endDateAfter);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("interleaved history: recalculation list is independently sorted (Req 13.5)", () => {
    /**
     * **Validates: Requirements 13.5**
     *
     * When recalculations come from an interleaved history sequence (mixed with
     * extensions), the ordering property still holds — the function sorts its
     * own input independently.
     */
    fc.assert(
      fc.property(arbInterleavedHistorySequence, ({ recalculations }) => {
        const rows = buildRecalculationHistoryRows(recalculations);

        // Completeness
        expect(rows.length).toBe(recalculations.length);

        // Ordering
        for (let i = 0; i < rows.length - 1; i++) {
          const current = rows[i];
          const next = rows[i + 1];
          expect(current.date <= next.date).toBe(true);

          if (current.date === next.date) {
            const currentInput = recalculations.find((r) => r.id === current.id);
            const nextInput = recalculations.find((r) => r.id === next.id);
            expect(currentInput).toBeDefined();
            expect(nextInput).toBeDefined();
            expect(currentInput!.createdAt <= nextInput!.createdAt).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
