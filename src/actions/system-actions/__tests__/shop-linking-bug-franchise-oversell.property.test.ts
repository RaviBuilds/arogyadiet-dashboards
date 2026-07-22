// src/actions/system-actions/__tests__/shop-linking-bug-franchise-oversell.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 1: Bug Condition — sub-condition #6 (franchise stock oversell)
//
// Validates: Requirements 1.7 (defect) / expected behavior 2.7
//
// EXPLORATION TEST — MUST FAIL on the UNFIXED code. The failure is the
// counterexample proving the defect exists.
//
// Bug: in `verifyAddonPayment`, the addon_order is marked PAID BEFORE franchise
// stock is decremented, and a `false`/error result from
// `decrement_franchise_product_stock` is only `console.error`-logged — the order
// stays silently PAID with no reserved stock (oversold from the customer's view).
//
// Expected behavior (Property 6 / Req 2.7): when franchise stock cannot be
// decremented for an item, the item/order must be treated as unfulfillable
// (flagged for ops review / refund, or the call reports failure) rather than
// left silently completed as a plain PAID order.
//
// Strategy: drive the REAL `verifyAddonPayment` server action against an
// in-memory fake `@/lib/supabase/server` client whose
// `decrement_franchise_product_stock` RPC always returns `false` (concurrent
// sale / insufficient stock). We record every `addon_orders` update and the
// function's result, then assert the order is NOT left silently PAID.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted in-memory DB + generic query builder ───────────────────────────
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state: {
    tables: Record<string, Row[]>;
    seq: number;
    addonUpdates: Row[];
  } = { tables: {}, seq: 0, addonUpdates: [] };

  function ensure(table: string): Row[] {
    if (!state.tables[table]) state.tables[table] = [];
    return state.tables[table];
  }

  function makeBuilder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let wantReturning = false;
    let limitN: number | null = null;

    function run() {
      const rows = ensure(table);
      if (op === "select") {
        let res = rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
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
        // Record every addon_orders mutation so the test can inspect fulfillment
        // handling.
        if (table === "addon_orders") state.addonUpdates.push({ ...(payload as Row) });
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        matched.forEach((r) => Object.assign(r, payload));
        return { data: wantReturning ? matched.map((r) => ({ ...r })) : null, error: null };
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
      delete: () => {
        op = "delete";
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
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

  const client = {
    from: (table: string) => makeBuilder(table),
    // Force the decrement to fail for every item (concurrent sale / oversell).
    rpc: async () => ({ data: false, error: null }),
  };

  return { state, client };
});

// ─── Mocks ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.client,
}));

vi.mock("razorpay", () => ({
  default: class {
    orders = { create: vi.fn(async () => ({ id: "rzp_order_1" })) };
  },
}));

vi.mock("@/lib/notifications", () => ({
  notifyAdmins: vi.fn(async () => {}),
  sendNotificationToUser: vi.fn(async () => {}),
  buildPushPayload: vi.fn(() => ({})),
}));

vi.mock("@/lib/notifications/lookups", () => ({
  getCustomerNameByProfileId: vi.fn(async () => "Test Customer"),
}));

// Import AFTER mocks.
import { verifyAddonPayment } from "@/actions/shop-actions";

// Regex signalling that an item/order was flagged unfulfillable by the fix.
const UNFULFILLABLE_KEY = /(fulfill|refund|review|unfulfill|cancel|hold|oversold)/i;

function seedFranchiseOrder(items: Array<{ product_id: string; quantity: number }>) {
  h.state.tables = {};
  h.state.seq = 0;
  h.state.addonUpdates = [];
  h.state.tables["razorpay_transactions"] = [];
  h.state.tables["payments"] = [
    { id: "pay-1", status: "PENDING", customer_profile_id: null },
  ];
  h.state.tables["addon_orders"] = [
    {
      id: "ao-1",
      payment_id: "pay-1",
      status: "PENDING",
      franchise_id: "franchise-1",
      addon_order_items: items,
    },
  ];
}

describe("Property 1 (Bug Condition #6): no franchise oversell", () => {
  beforeEach(() => {
    h.state.tables = {};
    h.state.seq = 0;
    h.state.addonUpdates = [];
  });

  const arbItems = fc.array(
    fc.record({
      product_id: fc.constantFrom("prod-1", "prod-2", "prod-3"),
      quantity: fc.integer({ min: 1, max: 25 }),
    }),
    { minLength: 1, maxLength: 4 },
  );

  it("a franchise order whose stock decrement fails is not left silently completed as PAID", async () => {
    await fc.assert(
      fc.asyncProperty(arbItems, async (items) => {
        seedFranchiseOrder(items);

        // "server-verified-via-razorpay-api" bypasses HMAC signature checking.
        const result = await verifyAddonPayment("pay-1", {
          razorpay_order_id: "rzp_order_1",
          razorpay_payment_id: "rzp_pay_1",
          razorpay_signature: "server-verified-via-razorpay-api",
        });

        const updates = h.state.addonUpdates;
        const markedPaid = updates.some((u) => u.status === "PAID");
        const flaggedUnfulfillable =
          updates.some((u) => typeof u.status === "string" && u.status !== "PAID") ||
          updates.some((u) => Object.keys(u).some((k) => UNFULFILLABLE_KEY.test(k)));

        // Order is "silently oversold" when the call reports success, the order
        // was marked PAID, and nothing flagged it unfulfillable.
        const silentlyOversold =
          result.success === true && markedPaid && !flaggedUnfulfillable;

        // EXPECTED (Property 6 / Req 2.7): the failed decrement must NOT leave a
        // silently PAID order. On unfixed code the failure is only logged and
        // the order stays PAID, so `silentlyOversold` is true and this FAILS.
        expect(silentlyOversold).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});
