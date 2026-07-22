// src/actions/system-actions/__tests__/shop-linking-preservation-linking-scope.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 7: Preservation — linking for NON-buggy inputs.
//
// Validates: Requirements 3.4, 3.5
//
// PRESERVATION TEST — MUST PASS on the UNFIXED code. Exercises only inputs where
// `isBugCondition(X)` is FALSE (every PAID order already has an ORDER_CREATED
// delivery on its own target date):
//
//   - Req 3.4: a PAID addon_order with a valid ORDER_CREATED delivery on its
//     target_delivery_date is linked to that delivery exactly as today.
//   - Req 3.5: linking only touches the customer's OWN PAID addon orders and the
//     customer's OWN delivery orders (`customer_profile_id` scoping), for BOTH
//     core and franchise customers. Already-linked orders and other customers'
//     rows are never disturbed.
//
// Strategy: drive the REAL `runProductLinkingAction` against a shared in-memory
// fake `@/lib/supabase/admin` client seeded with many customers (core and
// franchise), each with their own ORDER_CREATED delivery + PAID order for the
// target date, plus decoys (already-linked orders, wrong-date orders).

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
      upsert: (p: Row | Row[]) => {
        op = "upsert";
        payload = p;
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

vi.mock("@/actions/system-actions/routeEngine", () => ({
  executeAutomatedDispatch: vi.fn(async () => ({ success: true, stats: {} })),
}));
vi.mock("@/actions/system-actions/orderGeneration", () => ({
  generateDailyOrders: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Import AFTER mocks.
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";

function reset() {
  h.state.tables = {};
  h.state.seq = 0;
}

describe("Property 7 (Preservation): scoped linking of already-linkable orders", () => {
  beforeEach(reset);

  // Each customer already has an ORDER_CREATED delivery on the target date and a
  // PAID unlinked order targeting that date (a non-buggy input).
  const arbCustomers = fc.uniqueArray(
    fc.record({
      id: fc.integer({ min: 1, max: 999 }),
      isFranchise: fc.boolean(),
      quantity: fc.integer({ min: 1, max: 9 }),
    }),
    { minLength: 1, maxLength: 6, selector: (c) => c.id },
  );

  it("Req 3.4/3.5: every customer's PAID order links to its OWN delivery; other rows are untouched", async () => {
    await fc.assert(
      fc.asyncProperty(arbCustomers, async (customers) => {
        reset();
        const today = getISTDateString(0);
        const otherDate = addDaysToISODate(today, 3);

        const deliveries: Record<string, unknown>[] = [];
        const addons: Record<string, unknown>[] = [];

        for (const c of customers) {
          const cid = `P${c.id}`;
          const doId = `do-${cid}`;
          deliveries.push({
            id: doId,
            customer_profile_id: cid,
            delivery_date: today,
            status: "ORDER_CREATED",
            clinic_id: "C",
            franchise_id: c.isFranchise ? "F1" : null,
          });
          addons.push({
            id: `ao-${cid}`,
            customer_profile_id: cid,
            status: "PAID",
            target_delivery_date: today,
            delivery_order_id: null,
            franchise_id: c.isFranchise ? "F1" : null,
            addon_order_items: [{ product_id: "prod-1", quantity: c.quantity }],
          });
        }

        // Decoy 1: an already-linked PAID order — must stay pinned to its
        // original delivery (never re-linked).
        addons.push({
          id: "ao-already-linked",
          customer_profile_id: `P${customers[0].id}`,
          status: "PAID",
          target_delivery_date: today,
          delivery_order_id: "do-preexisting",
          addon_order_items: [{ product_id: "prod-1", quantity: 1 }],
        });

        // Decoy 2: a PAID order targeting a DIFFERENT date — must not link today.
        addons.push({
          id: "ao-wrong-date",
          customer_profile_id: `P${customers[0].id}`,
          status: "PAID",
          target_delivery_date: otherDate,
          delivery_order_id: null,
          addon_order_items: [{ product_id: "prod-1", quantity: 1 }],
        });

        // Decoy 3: a non-PAID (PENDING) order on the target date — must not link.
        addons.push({
          id: "ao-pending",
          customer_profile_id: `P${customers[0].id}`,
          status: "PENDING",
          target_delivery_date: today,
          delivery_order_id: null,
          addon_order_items: [{ product_id: "prod-1", quantity: 1 }],
        });

        h.state.tables["delivery_orders"] = deliveries;
        h.state.tables["addon_orders"] = addons;

        const result = await runProductLinkingAction(today, "cron");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.count).toBe(customers.length);
        }

        const rows = h.state.tables["addon_orders"] ?? [];
        const byId = (id: string) => rows.find((r) => r.id === id)!;

        // Each customer's own PAID order links to its OWN delivery — exactly the
        // baseline behavior (Req 3.4), and never crosses customers (Req 3.5).
        for (const c of customers) {
          const cid = `P${c.id}`;
          expect(byId(`ao-${cid}`).delivery_order_id).toBe(`do-${cid}`);
        }

        // Decoys are untouched.
        expect(byId("ao-already-linked").delivery_order_id).toBe("do-preexisting");
        expect(byId("ao-wrong-date").delivery_order_id).toBeNull();
        expect(byId("ao-pending").delivery_order_id).toBeNull();
      }),
      { numRuns: 50 },
    );
  });
});
