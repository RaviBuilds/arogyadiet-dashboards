// Feature: core-clinic-architecture, Property 42: Per-clinic workload and history derive from the order stamp
//
// Property test for `computeClinicMealCounts` (src/lib/clinic/workload.ts).
//
// Property 42: Per-clinic workload and history derive from the order stamp
//   For any set of Delivery_Orders whose STAMPED `clinic_id` may differ from
//   their customers' CURRENT `clinic_id`, the per-clinic workload counts for a
//   (clinic, date) are computed by attributing each order to its STAMPED
//   `clinic_id` and `delivery_date`, never the customer's current `clinic_id`.
//   Consequently, moving a customer to a different clinic (i.e. changing the
//   customer's current clinic) leaves the attribution of prior orders unchanged.
//
// Because a live Supabase connection is not available in unit tests, the
// `delivery_orders` table is modeled by an IN-MEMORY store. Each stored order
// carries:
//   - `clinic_id`                  — the IMMUTABLE Order_Clinic_Stamp (Req 19).
//   - `customer_current_clinic_id` — the customer's CURRENT clinic, a distinct
//                                     field that the derivation must IGNORE.
//   - `delivery_date`              — the order's delivery date.
//   - `meal_categories`            — the embedded relation `{ code }`.
//
// The fake's `.eq("clinic_id", x)` filters on the STAMP field ONLY (mirroring
// the real query `delivery_orders.clinic_id`); it never consults
// `customer_current_clinic_id`. The query chain
// `.from("delivery_orders").select(...).eq("clinic_id", c).eq("delivery_date", d)`
// resolves to `{ data, error: null }`.
//
// Validates: Requirements 19.6, 19.7

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (hoisted so the mock factory can close over it) ───

const store = vi.hoisted(() => {
  interface OrderRow {
    clinic_id: string | null; // the STAMP — what derivation must use
    customer_current_clinic_id: string | null; // current clinic — must be IGNORED
    delivery_date: string;
    meal_categories: { code: string } | null;
    // Index signature so rows are assignable to the fake builder's generic
    // `Record<string, unknown>` column access (e.g. `r[col]`).
    [key: string]: unknown;
  }

  const rows: OrderRow[] = [];

  return {
    rows,
    setRows: (next: OrderRow[]) => {
      rows.length = 0;
      rows.push(...next);
    },
    reset: () => {
      rows.length = 0;
    },
  };
});

// ─── Mock: in-memory Supabase admin client over `delivery_orders` ─────────────

vi.mock("@/lib/supabase/admin", () => {
  // A thenable query builder mirroring the chain used by computeClinicMealCounts:
  //   admin.from("delivery_orders").select(cols).eq("clinic_id", c).eq("delivery_date", d)
  // The awaited result is `{ data, error }`.
  class TableQuery {
    private filters: Record<string, unknown> = {};

    select(_cols?: string) {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters[column] = value;
      return this;
    }

    private run() {
      const data = store.rows
        .filter((r) => {
          // Filter STRICTLY on the STAMP (`clinic_id`) and `delivery_date`.
          // `customer_current_clinic_id` is intentionally never consulted.
          for (const [col, val] of Object.entries(this.filters)) {
            if ((r as Record<string, unknown>)[col] !== val) return false;
          }
          return true;
        })
        .map((r) => ({
          meal_category_id: null,
          meal_categories: r.meal_categories,
        }));
      return { data, error: null as null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  return {
    createAdminClient: () => ({
      from: (_table: string) => new TableQuery(),
    }),
  };
});

// Import AFTER the mock so the module binds to the fake admin client.
import { computeClinicMealCounts } from "../workload";

// ─── Generators ───────────────────────────────────────────────────────────────

// Small pools so the chosen (clinic, date) target recurs and matches many orders.
const arbClinic = fc.constantFrom("clinic-A", "clinic-B", "clinic-C");
// Include `null` to model unresolved/unstamped customers and orders.
const arbCurrentClinic = fc.constantFrom("clinic-A", "clinic-B", "clinic-C", null);
const arbStamp = fc.constantFrom("clinic-A", "clinic-B", "clinic-C", null);
const arbDate = fc.constantFrom("2024-01-01", "2024-01-02", "2024-01-03");
// VEG → veg, CHICKEN → non_veg, EGG → egg; an extra unknown code is ignored.
const arbCode = fc.constantFrom("VEG", "CHICKEN", "EGG", "OTHER");

const arbOrder = fc.record({
  clinic_id: arbStamp,
  customer_current_clinic_id: arbCurrentClinic,
  delivery_date: arbDate,
  meal_categories: arbCode.map((code) => ({ code })),
});

const arbOrders = fc.array(arbOrder, { minLength: 0, maxLength: 40 });

// ─── Expected derivation (attributes by STAMP + date only) ─────────────────────

function expectedCounts(
  orders: Array<{
    clinic_id: string | null;
    delivery_date: string;
    meal_categories: { code: string } | null;
  }>,
  clinicId: string,
  targetDate: string
) {
  let veg = 0;
  let non_veg = 0;
  let egg = 0;
  for (const o of orders) {
    if (o.clinic_id !== clinicId) continue;
    if (o.delivery_date !== targetDate) continue;
    const code = o.meal_categories?.code;
    if (code === "VEG") veg += 1;
    else if (code === "CHICKEN") non_veg += 1;
    else if (code === "EGG") egg += 1;
  }
  return { veg_count: veg, non_veg_count: non_veg, egg_count: egg };
}

// ─── Property ──────────────────────────────────────────────────────────────────

describe("Property 42: Per-clinic workload and history derive from the order stamp", () => {
  it("attributes each order to its STAMPED clinic_id + delivery_date (never the customer's current clinic), and changing every customer's current clinic leaves the computed counts unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbOrders,
        arbClinic,
        arbDate,
        async (orders, targetClinic, targetDate) => {
          // (1) Derivation attributes by the STAMP only.
          store.setRows(orders);
          const counts = await computeClinicMealCounts(targetClinic, targetDate);
          expect(counts).toEqual(expectedCounts(orders, targetClinic, targetDate));

          // (2) Metamorphic: simulate every customer moving to a DIFFERENT clinic
          //     by rewriting `customer_current_clinic_id` on every order. The
          //     STAMP (`clinic_id`) and `delivery_date` are untouched.
          const moved = orders.map((o) => ({
            ...o,
            customer_current_clinic_id:
              o.customer_current_clinic_id === "clinic-A" ? "clinic-C" : "clinic-A",
          }));
          store.setRows(moved);
          const countsAfterMove = await computeClinicMealCounts(
            targetClinic,
            targetDate
          );

          // Attribution of prior orders is unchanged by the customer move.
          expect(countsAfterMove).toEqual(counts);
        }
      ),
      { numRuns: 100 }
    );
  });
});
