// src/test/shop/property23-ledgerOrderingFiltering.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 23 (Task 4.13)
//
// Property 23: Ledger ordering is total and stable.
//
// For any set of ledger entries for one clinic, the ledger view orders them by
// occurrence timestamp descending with ties broken by entry identifier
// descending, producing one deterministic total order; and for any applied
// direction filter, the result contains exactly the entries of that direction
// in that same relative order.
//
// **Validates: Requirements 9.6, 9.7, 9.8**
//
// This property pins the ORDERING CONTRACT itself as a pure function over an
// in-memory array. The real ledger view is read through
// `listLedgerEntries` (`src/repositories/clinic/clinicProductLedgerRepository.ts`),
// which expresses the same ordering via
// `.order("occurred_at", { ascending: false }).order("id", { ascending: false })`
// on a Supabase query builder — that call cannot be exercised without a live
// database. `sortLedgerDescending` / `filterByDirection` below are a from-scratch
// reference implementation (not imported from any source module, since no
// equivalent pure exported helper exists yet) that any pure helper extracted
// from the repository, or the repository's `.order(...)` chain itself, must
// agree with.
//
// `arbLedgerEntrySet` (Task 2.4) deliberately draws `occurred_at` from a small
// pool of offsets so duplicate timestamps are common — that is what forces the
// identifier tie-break to matter, and what this property is built to catch.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { arbLedgerEntrySet } from "@/test/shop/clinicStockArbitraries";
import type { ClinicLedgerEntry, ClinicLedgerDirection } from "@/types/clinicShop";

const NUM_RUNS = 200;

// ─── Reference ordering contract ─────────────────────────────────────────────

/**
 * The ledger view's ordering contract (Req 9.7): `occurred_at` descending, with
 * ties broken by `id` descending. `occurred_at` is compared as a timestamp
 * (`Date.parse`), not as a raw string, to be explicit about the intended
 * semantics even though these fixtures' ISO-8601 strings also sort correctly
 * lexically. `id` is a `BIGINT` serialised as a string (see
 * `ClinicLedgerEntry.id`), so it is compared numerically via `BigInt`, never as
 * a string, to stay correct past 2^53.
 */
export function sortLedgerDescending(
  entries: readonly ClinicLedgerEntry[],
): ClinicLedgerEntry[] {
  return [...entries].sort((a, b) => {
    const occurredDelta = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    if (occurredDelta !== 0) return occurredDelta;
    const idDelta = BigInt(b.id) - BigInt(a.id);
    return idDelta > BigInt(0) ? 1 : idDelta < BigInt(0) ? -1 : 0;
  });
}

/** THE clinic ledger view's `IN` / `OUT` filter (Req 9.8). */
export function filterByDirection(
  entries: readonly ClinicLedgerEntry[],
  direction: ClinicLedgerDirection,
): ClinicLedgerEntry[] {
  return entries.filter((entry) => entry.direction === direction);
}

describe("Property 23: Ledger ordering is total and stable", () => {
  it("sorts by occurred_at descending, ties broken by id descending — a single deterministic total order", () => {
    fc.assert(
      fc.property(arbLedgerEntrySet(), (entries) => {
        const sorted = sortLedgerDescending(entries);

        for (let index = 0; index < sorted.length - 1; index += 1) {
          const current = sorted[index];
          const next = sorted[index + 1];
          const currentTick = Date.parse(current.occurred_at);
          const nextTick = Date.parse(next.occurred_at);

          // occurred_at is non-increasing across the whole order.
          expect(currentTick).toBeGreaterThanOrEqual(nextTick);

          // When occurred_at ties, id must strictly decrease — the tie-break.
          if (currentTick === nextTick) {
            expect(BigInt(current.id) > BigInt(next.id)).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("sorting is deterministic: sorting the same set twice (in any starting order) yields the same sequence of ids", () => {
    fc.assert(
      fc.property(arbLedgerEntrySet(), fc.integer({ min: 0, max: 6 }), (entries, seed) => {
        // Shuffle deterministically from the seed, then sort. The result must
        // not depend on the input's starting order — a genuine TOTAL order,
        // not merely "some order that happens to look sorted".
        const shuffled = [...entries];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = (seed * (i + 1) * 2654435761) % (i + 1);
          const jSafe = ((j % (i + 1)) + (i + 1)) % (i + 1);
          [shuffled[i], shuffled[jSafe]] = [shuffled[jSafe], shuffled[i]];
        }

        const sortedOriginal = sortLedgerDescending(entries).map((e) => e.id);
        const sortedShuffled = sortLedgerDescending(shuffled).map((e) => e.id);
        expect(sortedShuffled).toEqual(sortedOriginal);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a genuine permutation of the input (same multiset, nothing dropped or duplicated) and is idempotent", () => {
    fc.assert(
      fc.property(arbLedgerEntrySet(), (entries) => {
        const sorted = sortLedgerDescending(entries);

        expect(sorted).toHaveLength(entries.length);
        expect([...sorted].map((e) => e.id).sort()).toEqual(
          [...entries].map((e) => e.id).sort(),
        );

        // Sorting an already-sorted array is a no-op.
        const sortedAgain = sortLedgerDescending(sorted);
        expect(sortedAgain.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("when two entries share occurred_at, the one with the numerically larger id sorts first (the tie-break in action)", () => {
    fc.assert(
      fc.property(arbLedgerEntrySet({ minLength: 2 }), (entries) => {
        // Find at least one genuine tie in this sample; arbLedgerEntrySet's
        // small timestamp-slot pool makes this common, but skip samples where
        // none occurs rather than forcing one artificially.
        const byTimestamp = new Map<string, ClinicLedgerEntry[]>();
        for (const entry of entries) {
          const bucket = byTimestamp.get(entry.occurred_at) ?? [];
          bucket.push(entry);
          byTimestamp.set(entry.occurred_at, bucket);
        }
        const tiedBucket = [...byTimestamp.values()].find((bucket) => bucket.length >= 2);
        fc.pre(tiedBucket !== undefined);

        const sorted = sortLedgerDescending(entries);
        const tiedIds = new Set(tiedBucket!.map((e) => e.id));
        const tiedInSortedOrder = sorted.filter((e) => tiedIds.has(e.id));

        for (let index = 0; index < tiedInSortedOrder.length - 1; index += 1) {
          expect(
            BigInt(tiedInSortedOrder[index].id) > BigInt(tiedInSortedOrder[index + 1].id),
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("filter-then-sort and sort-then-filter commute: the direction filter preserves the sorted relative order (Req 9.8)", () => {
    fc.assert(
      fc.property(
        arbLedgerEntrySet(),
        fc.constantFrom<ClinicLedgerDirection>("IN", "OUT"),
        (entries, direction) => {
          const sortThenFilter = filterByDirection(
            sortLedgerDescending(entries),
            direction,
          );
          const filterThenSort = sortLedgerDescending(
            filterByDirection(entries, direction),
          );

          expect(sortThenFilter.map((e) => e.id)).toEqual(
            filterThenSort.map((e) => e.id),
          );

          // And the filtered result contains EXACTLY the entries of that
          // direction — no more, no fewer.
          expect(sortThenFilter.every((e) => e.direction === direction)).toBe(true);
          expect(sortThenFilter).toHaveLength(
            entries.filter((e) => e.direction === direction).length,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
