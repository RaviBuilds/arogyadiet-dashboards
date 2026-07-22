// src/actions/system-actions/__tests__/shop-linking-bug-rollforward-and-counts.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 1: Bug Condition — sub-conditions #2, #3, #4, #5
//
// Validates: Requirements 1.3, 1.4, 1.5, 1.6 (defects) / expected 2.3, 2.4, 2.5, 2.6
//
// EXPLORATION TESTS — MUST FAIL on the UNFIXED code. Each failure is the
// counterexample proving the corresponding defect exists.
//
//   #2 (Req 1.3 / 2.3): a PAID addon_order whose target_delivery_date has no
//      linkable ORDER_CREATED delivery is left with delivery_order_id NULL
//      forever. Expected: roll forward to the customer's next available delivery.
//   #3 (Req 1.4 / 2.4): the target day is later paused/rescheduled while the
//      order is still unlinked; the order stays bound to a day with no delivery.
//      Expected: re-target to the next available delivery day.
//   #4 (Req 1.5 / 2.5): a manual recovery re-run after the delivery advanced
//      past ORDER_CREATED links nothing (`.eq("status","ORDER_CREATED")`).
//      Expected: still link outstanding PAID orders to that day's delivery.
//   #5 (Req 1.6 / 2.6): a product linked AFTER persistWorkloadSnapshots ran is
//      omitted from the kitchen shop-product count. Expected: the persisted
//      count reflects the late link.
//
// Strategy: drive the REAL `runProductLinkingAction` and the REAL workload
// snapshot code (`persistWorkloadSnapshots` / `computeClinicShopProductCounts`)
// against a shared in-memory fake `@/lib/supabase/admin` client. The fake models
// delivery_orders / addon_orders / clinics / workload_snapshots generically so
// both the current (unfixed) queries and reasonable fixed queries resolve.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { getISTDateString, addDaysToISODate } from "@/lib/dates/ist";

// ─── Hoisted in-memory DB + generic query builder ───────────────────────────
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state: { tables: Record<string, Row[]>; seq: number } = {
    tables: {},
    seq: 0,
  };

  function ensure(table: string): Row[] {
    if (!state.tables[table]) state.tables[table] = [];
    return state.tables[table];
  }

  function makeBuilder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let conflictKeys: string[] | null = null;
    let wantReturning = false;
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    function run() {
      const rows = ensure(table);
      if (op === "select") {
        let res = rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
        if (orderKey) {
          const k = orderKey;
          res.sort((a, b) => {
            const av = a[k] as never;
            const bv = b[k] as never;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
        }
        if (limitN != null) res = res.slice(0, limitN);
        return { data: res, error: null };
      }
      if (op === "insert") {
        const items = Array.isArray(payload) ? payload : [payload as Row];
        const inserted = items.map((it) => {
          const row: Row = { ...it };
          if (row.id === undefined) row.id = `${table}-${++state.seq}`;
          rows.push(row);
          return { ...row };
        });
        return { data: wantReturning ? inserted : null, error: null };
      }
      if (op === "update") {
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        matched.forEach((r) => Object.assign(r, payload));
        return { data: wantReturning ? matched.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "upsert") {
        const items = Array.isArray(payload) ? payload : [payload as Row];
        const out = items.map((it) => {
          let existing: Row | undefined;
          if (conflictKeys) {
            existing = rows.find((r) => conflictKeys!.every((k) => r[k] === it[k]));
          }
          if (existing) {
            Object.assign(existing, it);
            return { ...existing };
          }
          const row: Row = { ...it };
          if (row.id === undefined) row.id = `${table}-${++state.seq}`;
          rows.push(row);
          return { ...row };
        });
        return { data: wantReturning ? out : null, error: null };
      }
      if (op === "delete") {
        state.tables[table] = rows.filter((r) => !filters.every((f) => f(r)));
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    function single() {
      const { data, error } = run();
      if (error) return Promise.resolve({ data: null, error });
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    }

    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => {
        wantReturning = true;
        return b;
      },
      insert: (p: Row | Row[]) => {
        op = "insert";
        payload = p;
        wantReturning = false;
        return b;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return b;
      },
      upsert: (p: Row | Row[], o?: { onConflict?: string }) => {
        op = "upsert";
        payload = p;
        conflictKeys = o?.onConflict ? o.onConflict.split(",") : null;
        return b;
      },
      delete: () => {
        op = "delete";
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      neq: (k: string, v: unknown) => {
        filters.push((r) => r[k] !== v);
        return b;
      },
      gt: (k: string, v: never) => {
        filters.push((r) => (r[k] as never) > v);
        return b;
      },
      gte: (k: string, v: never) => {
        filters.push((r) => (r[k] as never) >= v);
        return b;
      },
      lt: (k: string, v: never) => {
        filters.push((r) => (r[k] as never) < v);
        return b;
      },
      lte: (k: string, v: never) => {
        filters.push((r) => (r[k] as never) <= v);
        return b;
      },
      in: (k: string, arr: unknown[]) => {
        filters.push((r) => arr.includes(r[k]));
        return b;
      },
      is: (k: string, v: unknown) => {
        filters.push((r) => (v === null ? r[k] === null || r[k] === undefined : r[k] === v));
        return b;
      },
      not: (k: string, _op: string, v: unknown) => {
        filters.push((r) => !(v === null ? r[k] === null || r[k] === undefined : r[k] === v));
        return b;
      },
      order: (k: string, o?: { ascending?: boolean }) => {
        orderKey = k;
        orderAsc = o?.ascending !== false;
        return b;
      },
      limit: (n: number) => {
        limitN = n;
        return b;
      },
      single: () => single(),
      maybeSingle: () => single(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    });
    return b;
  }

  return {
    state,
    ensure,
    client: { from: (table: string) => makeBuilder(table) },
  };
});

// ─── Mocks ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.client,
}));

vi.mock("@/lib/logger", () => ({ logAdminAction: vi.fn(async () => {}) }));

vi.mock("@/lib/auth/adminAccess", () => ({
  checkGroupManage: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/automation/logging", () => ({
  upsertAutomationLog: vi.fn(async () => {}),
  initAutomationSubTasks: vi.fn(async () => {}),
  updateAutomationSubTask: vi.fn(async () => {}),
}));

// Heavy sibling actions statically imported by systemActions but unused here.
vi.mock("@/actions/system-actions/routeEngine", () => ({
  executeAutomatedDispatch: vi.fn(async () => ({ success: true, stats: {} })),
}));
vi.mock("@/actions/system-actions/orderGeneration", () => ({
  generateDailyOrders: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Import AFTER mocks. `@/lib/clinic/workload` is intentionally NOT mocked so the
// real snapshot logic runs against the fake admin client.
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";

function reset() {
  h.state.tables = {};
  h.state.seq = 0;
}

describe("Property 1 (Bug Condition #2/#3): roll-forward for unlinkable / paused target dates", () => {
  beforeEach(reset);

  // #2: target day has no linkable ORDER_CREATED delivery for the customer, but
  // the customer HAS a later delivery. #3: same shape framed as "target day
  // paused while unlinked". A generated future gap covers both.
  const arb = fc.record({
    quantity: fc.integer({ min: 1, max: 9 }),
    futureGap: fc.integer({ min: 1, max: 5 }),
  });

  it("a PAID order with no delivery on its target date is rolled forward to the next available delivery (not left NULL)", async () => {
    await fc.assert(
      fc.asyncProperty(arb, async ({ quantity, futureGap }) => {
        reset();
        const today = getISTDateString(0);
        const futureDate = addDaysToISODate(today, futureGap);

        // Customer P: PAID, unlinked addon targeting today; P has NO delivery on
        // today (paused) but a real ORDER_CREATED delivery in the future.
        // Customer Q: has an ORDER_CREATED delivery today so the main loop runs
        // (deliveries.length > 0) — i.e. this is not a trivial empty-day.
        h.state.tables["delivery_orders"] = [
          {
            id: "do-q-today",
            customer_profile_id: "Q",
            delivery_date: today,
            status: "ORDER_CREATED",
            clinic_id: "C",
          },
          {
            id: "do-p-future",
            customer_profile_id: "P",
            delivery_date: futureDate,
            status: "ORDER_CREATED",
            clinic_id: "C",
          },
        ];
        h.state.tables["addon_orders"] = [
          {
            id: "ao-p",
            customer_profile_id: "P",
            status: "PAID",
            target_delivery_date: today,
            delivery_order_id: null,
            addon_order_items: [{ product_id: "prod-1", quantity }],
          },
        ];

        const result = await runProductLinkingAction(today, "cron");
        expect(result.success).toBe(true);

        const ao = (h.state.tables["addon_orders"] ?? []).find((r) => r.id === "ao-p")!;

        // EXPECTED (Property 2 / Req 2.3, 2.4): the paid order must be linked to
        // a real delivery — never left with delivery_order_id NULL — and its
        // target date re-pointed to the linked delivery's date. On unfixed code
        // the order stays NULL (no roll-forward), so this FAILS.
        expect(ao.delivery_order_id).not.toBeNull();
        expect(ao.delivery_order_id).toBe("do-p-future");
        expect(ao.target_delivery_date).toBe(futureDate);
      }),
      { numRuns: 40 },
    );
  });
});

describe("Property 1 (Bug Condition #4): recovery re-run links past ORDER_CREATED", () => {
  beforeEach(reset);

  // The customer's delivery on the target date has advanced to a non-terminal
  // status past ORDER_CREATED. A manual recovery re-run should still link.
  const advancedStatus = fc.constantFrom(
    "PACKED",
    "OUT_FOR_DELIVERY",
    "ASSIGNED",
    "IN_TRANSIT",
  );

  it("a manual re-run links outstanding PAID orders even when the delivery advanced past ORDER_CREATED", async () => {
    await fc.assert(
      fc.asyncProperty(advancedStatus, fc.integer({ min: 1, max: 9 }), async (status, quantity) => {
        reset();
        const today = getISTDateString(0);

        h.state.tables["delivery_orders"] = [
          {
            id: "do-p-today",
            customer_profile_id: "P",
            delivery_date: today,
            status, // advanced past ORDER_CREATED
            clinic_id: "C",
          },
        ];
        h.state.tables["addon_orders"] = [
          {
            id: "ao-p",
            customer_profile_id: "P",
            status: "PAID",
            target_delivery_date: today,
            delivery_order_id: null,
            addon_order_items: [{ product_id: "prod-1", quantity }],
          },
        ];

        const result = await runProductLinkingAction(today, "manual");
        expect(result.success).toBe(true);

        const ao = (h.state.tables["addon_orders"] ?? []).find((r) => r.id === "ao-p")!;

        // EXPECTED (Property 4 / Req 2.5): the outstanding PAID order is linked
        // to the customer's delivery for that day even though it advanced past
        // ORDER_CREATED. On unfixed code the strict `.eq("status",
        // "ORDER_CREATED")` filter matches nothing, so this FAILS.
        expect(ao.delivery_order_id).toBe("do-p-today");
      }),
      { numRuns: 40 },
    );
  });
});

describe("Property 1 (Bug Condition #5): kitchen counts reflect late links", () => {
  beforeEach(reset);

  it("the persisted kitchen shop-product count reflects a product linked after the snapshot ran", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (quantity) => {
        reset();
        const today = getISTDateString(0);

        // One core clinic C with kitchen K.
        h.state.tables["clinics"] = [
          { id: "C", kitchen_id: "K", franchise_id: null },
        ];
        // A delivery on the target date belonging to customer P.
        h.state.tables["delivery_orders"] = [
          {
            id: "do-p-today",
            customer_profile_id: "P",
            delivery_date: today,
            status: "ORDER_CREATED",
            clinic_id: "C",
            meal_category_id: "mc-1",
          },
        ];
        // A PAID addon order for P, targeting today, still UNLINKED at snapshot
        // time (e.g. a payment verified just after the cron's snapshot step).
        h.state.tables["addon_orders"] = [
          {
            id: "ao-p",
            customer_profile_id: "P",
            status: "PAID",
            target_delivery_date: today,
            delivery_order_id: null,
            addon_order_items: [{ product_id: "prod-1", quantity }],
          },
        ];

        // 1) Snapshot runs BEFORE the link — count omits the unlinked product.
        await persistWorkloadSnapshots(today);

        // 2) Late link: a manual recovery re-run links the product AFTER the
        //    snapshot already ran.
        await runProductLinkingAction(today, "manual");

        // 3) The persisted snapshot for the date must reflect the linked product.
        const snap = (h.state.tables["workload_snapshots"] ?? []).find(
          (r) => r.clinic_id === "C" && r.target_date === today,
        );
        expect(snap).toBeDefined();
        const counts = (snap!.shop_product_counts ?? {}) as Record<string, number>;

        // EXPECTED (Property 5 / Req 2.6): the kitchen count reflects the late
        // link. On unfixed code the snapshot is persisted once (before the link)
        // and never refreshed, so `prod-1` is missing — this FAILS.
        expect(counts["prod-1"]).toBe(quantity);
      }),
      { numRuns: 30 },
    );
  });
});
