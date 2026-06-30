// src/lib/franchise-inventory/__tests__/scope-isolation.property.test.ts
// Property-based tests for scope isolation and ordered ledger reads.
//
// **Property 5: Scope isolation hides other franchises' data**
// **Property 20: Ledger is scoped and ordered newest-first**
//
// For any franchise scope and any set of rows belonging to mixed franchises,
// a scoped read returns only rows whose franchise_id equals the caller's
// franchise and never discloses another franchise's rows.
//
// For ledger entries pre-sorted newest-first (occurred_at DESC, id DESC),
// the scoped result preserves that ordering.
//
// **Validates: Requirements 2.6, 11.3, 11.4, 11.6**

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { filterByScope, type ScopedRow } from "../scope-predicate";

// --- Arbitraries ---

/** A small set of franchise IDs to encourage mixing. */
const FRANCHISE_IDS = ["franchise-A", "franchise-B", "franchise-C", "franchise-D"];

const arbFranchiseId: fc.Arbitrary<string> = fc.constantFrom(...FRANCHISE_IDS);

/** Generates a generic ScopedRow with a random franchise_id and extra fields. */
const arbScopedRow: fc.Arbitrary<ScopedRow> = fc.record({
  franchise_id: arbFranchiseId,
  product_id: fc.string({ minLength: 1, maxLength: 10 }),
  quantity: fc.integer({ min: 0, max: 9999 }),
});

/** Generates an array of 0–50 ScopedRow objects with mixed franchise_ids. */
const arbRows: fc.Arbitrary<ScopedRow[]> = fc.array(arbScopedRow, {
  minLength: 0,
  maxLength: 50,
});

// --- Ledger-specific arbitraries ---

interface LedgerScopedRow extends ScopedRow {
  id: number;
  occurred_at: string;
  direction: "IN" | "OUT";
}

/** Generates an ISO timestamp for ledger entries. */
const arbTimestamp: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(
    ({ year, month, day, hour, minute, second }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`
  );

/** Generates a ledger row with franchise_id, id, occurred_at, and direction. */
const arbLedgerRow: fc.Arbitrary<LedgerScopedRow> = fc.record({
  franchise_id: arbFranchiseId,
  id: fc.integer({ min: 1, max: 100000 }),
  occurred_at: arbTimestamp,
  direction: fc.constantFrom("IN" as const, "OUT" as const),
});

/**
 * Generates an array of ledger rows pre-sorted newest-first
 * (occurred_at DESC, id DESC) to simulate DB ordering.
 */
const arbSortedLedgerRows: fc.Arbitrary<LedgerScopedRow[]> = fc
  .array(arbLedgerRow, { minLength: 0, maxLength: 50 })
  .map((rows) =>
    [...rows].sort((a, b) => {
      const timeDiff = b.occurred_at.localeCompare(a.occurred_at);
      if (timeDiff !== 0) return timeDiff;
      return b.id - a.id;
    })
  );

// --- Property tests ---

describe("Property 5: Scope isolation hides other franchises' data", () => {
  it("filterByScope returns only rows where franchise_id === callerFranchiseId", () => {
    fc.assert(
      fc.property(arbRows, arbFranchiseId, (rows, callerFranchiseId) => {
        const result = filterByScope(rows, callerFranchiseId);

        // Assert 1: Every returned row must belong to the caller's franchise
        for (const row of result) {
          expect(row.franchise_id).toBe(callerFranchiseId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("no row in the result has a different franchise_id", () => {
    fc.assert(
      fc.property(arbRows, arbFranchiseId, (rows, callerFranchiseId) => {
        const result = filterByScope(rows, callerFranchiseId);

        // Assert 2: No row in the result has a non-matching franchise_id
        const foreignRows = result.filter(
          (r) => r.franchise_id !== callerFranchiseId
        );
        expect(foreignRows).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it("result length equals count of matching rows in the input", () => {
    fc.assert(
      fc.property(arbRows, arbFranchiseId, (rows, callerFranchiseId) => {
        const result = filterByScope(rows, callerFranchiseId);

        // Assert 3: Length matches the expected count of matching rows
        const expectedCount = rows.filter(
          (r) => r.franchise_id === callerFranchiseId
        ).length;
        expect(result).toHaveLength(expectedCount);
      }),
      { numRuns: 100 }
    );
  });

  it("never discloses another franchise's rows regardless of input size", () => {
    fc.assert(
      fc.property(arbRows, arbFranchiseId, (rows, callerFranchiseId) => {
        const result = filterByScope(rows, callerFranchiseId);

        // The set of franchise_ids in the result must be at most {callerFranchiseId}
        const uniqueIds = new Set(result.map((r) => r.franchise_id));
        if (result.length > 0) {
          expect(uniqueIds.size).toBe(1);
          expect(uniqueIds.has(callerFranchiseId)).toBe(true);
        } else {
          expect(uniqueIds.size).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 20: Ledger is scoped and ordered newest-first", () => {
  it("scoped ledger rows preserve newest-first ordering (occurred_at DESC, id DESC)", () => {
    fc.assert(
      fc.property(
        arbSortedLedgerRows,
        arbFranchiseId,
        (sortedRows, callerFranchiseId) => {
          const result = filterByScope(sortedRows, callerFranchiseId);

          // After scope-filtering a pre-sorted array, the result must still
          // be in newest-first order (occurred_at DESC, then id DESC for ties)
          for (let i = 1; i < result.length; i++) {
            const prev = result[i - 1];
            const curr = result[i];

            const timeCompare = prev.occurred_at.localeCompare(curr.occurred_at);
            if (timeCompare === 0) {
              // Same timestamp: id must be descending
              expect(prev.id).toBeGreaterThanOrEqual(curr.id);
            } else {
              // prev.occurred_at should be >= curr.occurred_at (descending)
              expect(timeCompare).toBeGreaterThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("scoped ledger read returns only the caller's entries from a mixed set", () => {
    fc.assert(
      fc.property(
        arbSortedLedgerRows,
        arbFranchiseId,
        (sortedRows, callerFranchiseId) => {
          const result = filterByScope(sortedRows, callerFranchiseId);

          // All returned ledger entries belong to the caller
          for (const entry of result) {
            expect(entry.franchise_id).toBe(callerFranchiseId);
          }

          // Count matches expected
          const expectedCount = sortedRows.filter(
            (r) => r.franchise_id === callerFranchiseId
          ).length;
          expect(result).toHaveLength(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
