// src/actions/system-actions/__tests__/snapshot-wellformed.property.test.ts
//
// Feature: core-clinic-architecture, Property 28: Snapshot finalization produces one well-formed snapshot per clinic
//
// Validates: Requirements 11.4, 12.1
//
// For any set of clinics with order and shop-purchase data, the snapshotting
// step produces exactly ONE finalized Workload_Snapshot per clinic, each
// containing veg/non-veg/egg meal counts plus shop product counts, with every
// count a non-negative integer that matches the tallied source data.
//
// Strategy: this exercises the workload derivation + finalize path directly
// (cleaner and far lighter than driving the heavy `runDailyPipeline`). The
// `@/lib/supabase/admin` client is replaced with an in-memory model that backs
// the three queries the production code issues:
//
//   1. `computeClinicMealCounts`   — delivery_orders.select("meal_category_id,
//      meal_categories(code)").eq(clinic_id).eq(delivery_date)
//   2. `computeClinicShopProductCounts` — delivery_orders.select("id")…  then
//      addon_orders.select("delivery_order_id, addon_order_items(product_id,
//      quantity)").in("delivery_order_id", orderIds)
//   3. `finalizeWorkloadSnapshot`  — workload_snapshots.insert(payload)
//      .select("id").single(), enforcing the unique (clinic, kitchen, date)
//      triple exactly as `uq_snapshot_clinic_kitchen_date` would.
//
// For each generated clinic we call computeClinicMealCounts +
// computeClinicShopProductCounts and then finalizeWorkloadSnapshot, then assert
// the persisted snapshot is well-formed and equals the independently tallied
// source data.

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// Meal-category codes mirrored from workload.ts (exact seed values).
const VEG_CODE = "VEG";
const NON_VEG_CODE = "CHICKEN";
const EGG_CODE = "EGG";

// The clinic + date the snapshotting step runs against.
const TARGET_DATE = "2024-05-01";
// A different date used to seed "noise" orders that must NOT be counted.
const OTHER_DATE = "2024-04-30";
const COUNT_MAX = 100000;

// ─── Hoisted in-memory model backing the fake admin client ───────────────────

const model = vi.hoisted(() => {
  interface OrderRow {
    id: string;
    clinic_id: string;
    delivery_date: string;
    meal_category_id: string;
    code: string | null;
  }
  interface AddonOrderRow {
    delivery_order_id: string;
    items: Array<{ product_id: string; quantity: number }>;
  }
  interface SnapshotRow {
    id: string;
    clinic_id: string;
    kitchen_id: string;
    target_date: string;
    veg_count: number;
    non_veg_count: number;
    egg_count: number;
    shop_product_counts: Record<string, number>;
  }

  const orders: OrderRow[] = [];
  const addonOrders: AddonOrderRow[] = [];
  const snapshots: SnapshotRow[] = [];
  let counter = 0;

  return {
    orders,
    addonOrders,
    snapshots,
    nextId: () => `snap-${++counter}`,
    reset: () => {
      orders.length = 0;
      addonOrders.length = 0;
      snapshots.length = 0;
      counter = 0;
    },
  };
});

// ─── Fake admin client: resolves the three production query chains ───────────

vi.mock("@/lib/supabase/admin", () => {
  const UNIQUE_VIOLATION = "23505";

  function makeBuilder(table: string) {
    const ctx: {
      table: string;
      op: "select" | "insert";
      selectArg: string;
      eqs: Record<string, unknown>;
      inFilter: { key: string; values: unknown[] } | null;
      insertData: Record<string, unknown> | null;
    } = {
      table,
      op: "select",
      selectArg: "",
      eqs: {},
      inFilter: null,
      insertData: null,
    };

    function resolve() {
      // ── delivery_orders ─────────────────────────────────────────────────
      if (ctx.table === "delivery_orders") {
        const matching = model.orders.filter(
          (o) =>
            o.clinic_id === ctx.eqs["clinic_id"] &&
            o.delivery_date === ctx.eqs["delivery_date"]
        );

        // Meal-count path: select("meal_category_id, meal_categories(code)").
        if (ctx.selectArg.includes("meal_categories")) {
          return {
            data: matching.map((o) => ({
              meal_category_id: o.meal_category_id,
              // Surface the embedded relation as an object (Supabase shape).
              meal_categories: o.code === null ? null : { code: o.code },
            })),
            error: null,
          };
        }

        // Shop path step 1: select("id").
        return { data: matching.map((o) => ({ id: o.id })), error: null };
      }

      // ── addon_orders ──────────────────────────────────────────────────────
      if (ctx.table === "addon_orders") {
        const ids = new Set((ctx.inFilter?.values ?? []) as string[]);
        const matching = model.addonOrders.filter((a) =>
          ids.has(a.delivery_order_id)
        );
        return {
          data: matching.map((a) => ({
            delivery_order_id: a.delivery_order_id,
            addon_order_items: a.items.map((it) => ({
              product_id: it.product_id,
              quantity: it.quantity,
            })),
          })),
          error: null,
        };
      }

      // ── workload_snapshots insert (enforce the unique triple) ──────────────
      if (ctx.table === "workload_snapshots" && ctx.op === "insert") {
        const data = ctx.insertData!;
        const clinic_id = data.clinic_id as string;
        const kitchen_id = data.kitchen_id as string;
        const target_date = data.target_date as string;

        const duplicate = model.snapshots.some(
          (r) =>
            r.clinic_id === clinic_id &&
            r.kitchen_id === kitchen_id &&
            r.target_date === target_date
        );
        if (duplicate) {
          return {
            data: null,
            error: { code: UNIQUE_VIOLATION, message: "duplicate key value" },
          };
        }

        const row = {
          id: model.nextId(),
          clinic_id,
          kitchen_id,
          target_date,
          veg_count: data.veg_count as number,
          non_veg_count: data.non_veg_count as number,
          egg_count: data.egg_count as number,
          shop_product_counts: data.shop_product_counts as Record<
            string,
            number
          >,
        };
        model.snapshots.push(row);
        return { data: { id: row.id }, error: null };
      }

      return { data: null, error: null };
    }

    const builder: {
      select: (arg?: string) => typeof builder;
      insert: (data: Record<string, unknown>) => typeof builder;
      eq: (key: string, value: unknown) => typeof builder;
      in: (key: string, values: unknown[]) => typeof builder;
      single: () => Promise<unknown>;
      then: (onFulfilled: unknown, onRejected?: unknown) => Promise<unknown>;
    } = {
      select(arg = "") {
        ctx.selectArg = arg;
        return builder;
      },
      insert(data) {
        ctx.op = "insert";
        ctx.insertData = data;
        return builder;
      },
      eq(key, value) {
        ctx.eqs[key] = value;
        return builder;
      },
      in(key, values) {
        ctx.inFilter = { key, values };
        return builder;
      },
      single() {
        return Promise.resolve(resolve());
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(
          onFulfilled as never,
          onRejected as never
        );
      },
    };
    return builder;
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => makeBuilder(table),
    }),
  };
});

// Import AFTER the mock so the module binds to the fake admin client.
import {
  computeClinicMealCounts,
  computeClinicShopProductCounts,
  finalizeWorkloadSnapshot,
} from "@/lib/clinic/workload";

// ─── Generators ──────────────────────────────────────────────────────────────

// One order: a meal code (VEG/CHICKEN/EGG, an unrelated code, or none) plus an
// optional set of addon line items (shop purchases) attached to that order.
const arbOrder = fc.record({
  code: fc.constantFrom(VEG_CODE, NON_VEG_CODE, EGG_CODE, "SALAD", null),
  items: fc.array(
    fc.record({
      product_id: fc.constantFrom("prod-1", "prod-2", "prod-3"),
      quantity: fc.integer({ min: 1, max: 50 }),
    }),
    { maxLength: 4 }
  ),
});

// A clinic with its kitchen and the orders/shop data on the target date.
const arbClinic = fc.record({
  orders: fc.array(arbOrder, { maxLength: 8 }),
});

// A set of distinct clinics (1..5) so we verify per-clinic scoping and that
// exactly one snapshot is finalized per clinic.
const arbClinics = fc
  .array(arbClinic, { minLength: 1, maxLength: 5 })
  .map((clinics) =>
    clinics.map((c, i) => ({
      id: `clinic-${i}`,
      kitchen_id: `kitchen-${i}`,
      orders: c.orders,
    }))
  );

// ─── Expected-value helpers (independent tally of the source data) ───────────

function expectedMealCounts(orders: Array<{ code: string | null }>) {
  let veg = 0;
  let nonVeg = 0;
  let egg = 0;
  for (const o of orders) {
    if (o.code === VEG_CODE) veg += 1;
    else if (o.code === NON_VEG_CODE) nonVeg += 1;
    else if (o.code === EGG_CODE) egg += 1;
  }
  return { veg, nonVeg, egg };
}

function expectedShopCounts(
  orders: Array<{ items: Array<{ product_id: string; quantity: number }> }>
) {
  const counts: Record<string, number> = {};
  for (const o of orders) {
    for (const it of o.items) {
      counts[it.product_id] = (counts[it.product_id] ?? 0) + it.quantity;
    }
  }
  // Mirror clampShopProductCounts: drop zero (none here) and clamp to 0..100000.
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    const c = Math.min(COUNT_MAX, Math.max(0, Math.trunc(v)));
    if (c > 0) out[k] = c;
  }
  return out;
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= COUNT_MAX;
}

// ─── Property ────────────────────────────────────────────────────────────────

describe("Property 28: Snapshot finalization produces one well-formed snapshot per clinic", () => {
  it("finalizes exactly one well-formed snapshot per clinic, with veg/non-veg/egg and shop counts equal to the tallied source data", async () => {
    await fc.assert(
      fc.asyncProperty(arbClinics, async (clinics) => {
        model.reset();

        // Seed the in-memory model from the generated source data.
        for (const clinic of clinics) {
          clinic.orders.forEach((o, oi) => {
            const orderId = `${clinic.id}-o-${oi}`;
            model.orders.push({
              id: orderId,
              clinic_id: clinic.id,
              delivery_date: TARGET_DATE,
              meal_category_id: `mc-${oi}`,
              code: o.code,
            });
            if (o.items.length > 0) {
              model.addonOrders.push({
                delivery_order_id: orderId,
                items: o.items,
              });
            }
          });

          // Noise: one order on a DIFFERENT date — must never be counted.
          const noiseId = `${clinic.id}-noise`;
          model.orders.push({
            id: noiseId,
            clinic_id: clinic.id,
            delivery_date: OTHER_DATE,
            meal_category_id: "mc-noise",
            code: VEG_CODE,
          });
          model.addonOrders.push({
            delivery_order_id: noiseId,
            items: [{ product_id: "prod-1", quantity: 999 }],
          });
        }

        // Snapshotting step: derive + finalize one snapshot per clinic.
        for (const clinic of clinics) {
          const meals = await computeClinicMealCounts(clinic.id, TARGET_DATE);
          const shop = await computeClinicShopProductCounts(
            clinic.id,
            TARGET_DATE
          );
          const result = await finalizeWorkloadSnapshot({
            clinic_id: clinic.id,
            kitchen_id: clinic.kitchen_id,
            target_date: TARGET_DATE,
            veg_count: meals.veg_count,
            non_veg_count: meals.non_veg_count,
            egg_count: meals.egg_count,
            shop_product_counts: shop,
          });
          expect(result.success).toBe(true);
        }

        // (1) Exactly one snapshot persisted per clinic — no more, no fewer.
        expect(model.snapshots).toHaveLength(clinics.length);
        const clinicIds = new Set(model.snapshots.map((s) => s.clinic_id));
        expect(clinicIds.size).toBe(clinics.length);

        // (2) Each snapshot is well-formed and matches the tallied source.
        for (const clinic of clinics) {
          const snap = model.snapshots.find((s) => s.clinic_id === clinic.id);
          expect(snap).toBeDefined();

          const expMeals = expectedMealCounts(clinic.orders);
          const expShop = expectedShopCounts(clinic.orders);

          // Counts equal the independently tallied source data (TARGET_DATE only).
          expect(snap!.veg_count).toBe(expMeals.veg);
          expect(snap!.non_veg_count).toBe(expMeals.nonVeg);
          expect(snap!.egg_count).toBe(expMeals.egg);
          expect(snap!.shop_product_counts).toEqual(expShop);

          // Every count is a non-negative integer within 0..100000.
          expect(isNonNegativeInt(snap!.veg_count)).toBe(true);
          expect(isNonNegativeInt(snap!.non_veg_count)).toBe(true);
          expect(isNonNegativeInt(snap!.egg_count)).toBe(true);
          for (const v of Object.values(snap!.shop_product_counts)) {
            expect(isNonNegativeInt(v)).toBe(true);
          }

          // Kitchen association is preserved.
          expect(snap!.kitchen_id).toBe(clinic.kitchen_id);
          expect(snap!.target_date).toBe(TARGET_DATE);
        }
      }),
      { numRuns: 100 }
    );
  });
});
