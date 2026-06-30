// Feature: core-clinic-architecture, Property 30: Snapshot persistence is unique per (clinic, kitchen, date)
//
// Property test for `finalizeWorkloadSnapshot` (src/lib/clinic/workload.ts).
//
// Property 30: Snapshot persistence is unique per (clinic, kitchen, date)
//   A finalize request whose (clinic_id, kitchen_id, target_date) triple
//   already has a snapshot is rejected (already-exists), retaining the existing
//   record. The FIRST finalize for a combination persists a record whose values
//   read back equal those written (clamped) — a round trip.
//
// Because a live Supabase connection is not available in unit tests, the
// `workload_snapshots` table is modeled by an IN-MEMORY store that ENFORCES the
// unique key (clinic_id, kitchen_id, target_date): on insert, if a row with the
// same triple already exists it resolves `{ data: null, error: { code: "23505" } }`
// (the Postgres unique-violation `uq_snapshot_clinic_kitchen_date` raises);
// otherwise it stores the row (clamping counts to 0..100000 as the DB CHECK
// constraints would) and resolves `{ data: { id }, error: null }`. The mock
// supports the `.from("workload_snapshots").insert(payload).select("id").single()`
// chain used by `finalizeWorkloadSnapshot`.
//
// Validates: Requirements 12.1, 12.2

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so the mock factory can close over it) ───

const store = vi.hoisted(() => {
  const COUNT_MIN = 0;
  const COUNT_MAX = 100000;

  // Clamp mirrors the DB CHECK constraints (Req 12.1): non-negative integer 0..100000.
  const clamp = (value: number): number => {
    if (!Number.isFinite(value)) return COUNT_MIN;
    const truncated = Math.trunc(value);
    if (truncated < COUNT_MIN) return COUNT_MIN;
    if (truncated > COUNT_MAX) return COUNT_MAX;
    return truncated;
  };

  const clampMap = (counts: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [productId, raw] of Object.entries(counts ?? {})) {
      const c = clamp(raw);
      if (c > 0) out[productId] = c;
    }
    return out;
  };

  interface SnapshotRow {
    id: string;
    clinic_id: string;
    kitchen_id: string;
    target_date: string;
    veg_count: number;
    non_veg_count: number;
    egg_count: number;
    shop_product_counts: Record<string, number>;
    [key: string]: unknown;
  }

  const rows: SnapshotRow[] = [];
  let counter = 0;

  return {
    rows,
    clamp,
    clampMap,
    nextId: () => `snap-${++counter}`,
    reset: () => {
      rows.length = 0;
      counter = 0;
    },
  };
});

// ─── Mock: in-memory Supabase admin client enforcing the unique triple ────────

vi.mock("@/lib/supabase/admin", () => {
  const UNIQUE_VIOLATION = "23505";

  class TableQuery {
    private insertData: Record<string, unknown> | null = null;

    insert(data: Record<string, unknown>) {
      this.insertData = data;
      return this;
    }

    // `.select("id")` is part of the chain but doesn't change behavior here.
    select(_cols?: string) {
      return this;
    }

    single() {
      const data = this.insertData!;
      const clinic_id = data.clinic_id as string;
      const kitchen_id = data.kitchen_id as string;
      const target_date = data.target_date as string;

      // Simulate uq_snapshot_clinic_kitchen_date: reject a duplicate triple.
      const duplicate = store.rows.some(
        (r) =>
          r.clinic_id === clinic_id &&
          r.kitchen_id === kitchen_id &&
          r.target_date === target_date
      );
      if (duplicate) {
        return Promise.resolve({
          data: null,
          error: { code: UNIQUE_VIOLATION, message: "duplicate key value" },
        });
      }

      // Store the row, clamping counts exactly as the DB CHECK constraints would.
      const row = {
        id: store.nextId(),
        clinic_id,
        kitchen_id,
        target_date,
        veg_count: store.clamp(data.veg_count as number),
        non_veg_count: store.clamp(data.non_veg_count as number),
        egg_count: store.clamp(data.egg_count as number),
        shop_product_counts: store.clampMap(
          data.shop_product_counts as Record<string, number>
        ),
      };
      store.rows.push(row);
      return Promise.resolve({ data: { id: row.id }, error: null });
    }
  }

  return {
    createAdminClient: () => ({
      from: (_table: string) => new TableQuery(),
    }),
  };
});

// Import AFTER the mock so the module binds to the fake admin client.
import { finalizeWorkloadSnapshot } from "../workload";
import type { WorkloadSnapshotInput } from "@/types/clinic";

// ─── Generators ────────────────────────────────────────────────────────────

// Small pools so the same (clinic, kitchen, date) triple recurs frequently,
// exercising the unique-violation rejection path.
const arbClinic = fc.constantFrom("clinic-A", "clinic-B", "clinic-C");
const arbKitchen = fc.constantFrom("kitchen-1", "kitchen-2");
const arbDate = fc.constantFrom("2024-01-01", "2024-01-02", "2024-01-03");

// Counts span well below 0 and above 100000 to also exercise clamping (Req 12.1).
const arbCount = fc.integer({ min: -50, max: 150000 });

const arbShopCounts = fc.dictionary(
  fc.constantFrom("prod-1", "prod-2", "prod-3"),
  fc.integer({ min: -10, max: 150000 }),
  { maxKeys: 3 }
);

const arbInput: fc.Arbitrary<WorkloadSnapshotInput> = fc.record({
  clinic_id: arbClinic,
  kitchen_id: arbKitchen,
  target_date: arbDate,
  veg_count: arbCount,
  non_veg_count: arbCount,
  egg_count: arbCount,
  shop_product_counts: arbShopCounts,
});

const arbInputs = fc.array(arbInput, { minLength: 1, maxLength: 25 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tripleKey = (i: { clinic_id: string; kitchen_id: string; target_date: string }) =>
  `${i.clinic_id}\u0000${i.kitchen_id}\u0000${i.target_date}`;

function expectedClamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = Math.trunc(value);
  return Math.min(100000, Math.max(0, t));
}

function expectedClampMap(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    const c = expectedClamp(v);
    if (c > 0) out[k] = c;
  }
  return out;
}

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 30: Snapshot persistence is unique per (clinic, kitchen, date)", () => {
  it("first finalize for a triple persists a round-trippable record; any subsequent finalize for the same triple is rejected as already-exists and leaves the stored record unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbInputs, async (inputs) => {
        store.reset();

        // Track the first persisted record per triple, by id, to verify it is
        // never mutated by a later (rejected) finalize.
        const firstRecordByTriple = new Map<
          string,
          { id: string; snapshot: Record<string, unknown> }
        >();

        for (const input of inputs) {
          const key = tripleKey(input);
          const alreadyExists = firstRecordByTriple.has(key);

          const result = await finalizeWorkloadSnapshot(input);

          if (alreadyExists) {
            // Subsequent finalize for an existing triple is rejected (Req 12.2).
            expect(result.success).toBe(false);
            if (result.success === false) {
              expect(result.error.toLowerCase()).toContain("already exists");
            }

            // The existing record is retained unchanged: still exactly one row
            // for the triple, same id, same values as first written.
            const matching = store.rows.filter(
              (r) =>
                r.clinic_id === input.clinic_id &&
                r.kitchen_id === input.kitchen_id &&
                r.target_date === input.target_date
            );
            expect(matching).toHaveLength(1);

            const prior = firstRecordByTriple.get(key)!;
            expect(matching[0].id).toBe(prior.id);
            expect(matching[0]).toEqual(prior.snapshot);
          } else {
            // First finalize for the triple succeeds (Req 12.1) and the stored
            // row's values read back equal the (clamped) written values.
            expect(result.success).toBe(true);
            if (result.success === true) {
              const persisted = store.rows.find((r) => r.id === result.data.id);
              expect(persisted).toBeDefined();

              expect(persisted!.clinic_id).toBe(input.clinic_id);
              expect(persisted!.kitchen_id).toBe(input.kitchen_id);
              expect(persisted!.target_date).toBe(input.target_date);
              expect(persisted!.veg_count).toBe(expectedClamp(input.veg_count));
              expect(persisted!.non_veg_count).toBe(
                expectedClamp(input.non_veg_count)
              );
              expect(persisted!.egg_count).toBe(expectedClamp(input.egg_count));
              expect(persisted!.shop_product_counts).toEqual(
                expectedClampMap(input.shop_product_counts)
              );

              firstRecordByTriple.set(key, {
                id: result.data.id,
                snapshot: { ...persisted! },
              });
            }
          }
        }

        // Global invariant: at most one persisted row per triple.
        const seen = new Set<string>();
        for (const r of store.rows) {
          const k = `${r.clinic_id}\u0000${r.kitchen_id}\u0000${r.target_date}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }),
      { numRuns: 200 }
    );
  });
});
