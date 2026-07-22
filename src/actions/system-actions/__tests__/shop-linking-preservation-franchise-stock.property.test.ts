// src/actions/system-actions/__tests__/shop-linking-preservation-franchise-stock.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 7: Preservation — payment verification for NON-buggy inputs.
//
// Validates: Requirements 3.6, 3.7, 3.8
//
// PRESERVATION TEST — MUST PASS on the UNFIXED code. Exercises only inputs where
// `isBugCondition(X)` is FALSE (no failed franchise decrement):
//
//   - Req 3.6: a FRANCHISE purchase with sufficient stock (the decrement RPC
//     returns true) still decrements franchise stock once per item and completes
//     the order as PAID.
//   - Req 3.7: a CORE (non-franchise) purchase still completes as PAID with NO
//     franchise stock decrement at all.
//   - Req 3.8: a successfully verified purchase still sends the existing customer
//     and admin purchase-confirmation notifications.
//
// Strategy: drive the REAL `verifyAddonPayment` server action against an
// in-memory fake `@/lib/supabase/server` client whose
// `decrement_franchise_product_stock` RPC returns `true` (sufficient stock) and
// records every call, so we can assert core vs franchise behavior precisely.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted in-memory DB + generic query builder ───────────────────────────
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state: {
    tables: Record<string, Row[]>;
    seq: number;
    addonUpdates: Row[];
    rpcCalls: Array<{ name: string; args: unknown }>;
  } = { tables: {}, seq: 0, addonUpdates: [], rpcCalls: [] };

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
    // Sufficient stock: the decrement always succeeds. Record each call.
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
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
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";

function seedOrder(opts: {
  franchiseId: string | null;
  items: Array<{ product_id: string; quantity: number }>;
}) {
  h.state.tables = {};
  h.state.seq = 0;
  h.state.addonUpdates = [];
  h.state.rpcCalls = [];
  h.state.tables["razorpay_transactions"] = [];
  h.state.tables["payments"] = [
    { id: "pay-1", status: "PENDING", customer_profile_id: "p1" },
  ];
  h.state.tables["customer_profiles"] = [{ id: "p1", user_id: "u1" }];
  h.state.tables["addon_orders"] = [
    {
      id: "ao-1",
      payment_id: "pay-1",
      status: "PENDING",
      franchise_id: opts.franchiseId,
      addon_order_items: opts.items,
    },
  ];
}

const SERVER_VERIFIED = {
  razorpay_order_id: "rzp_order_1",
  razorpay_payment_id: "rzp_pay_1",
  razorpay_signature: "server-verified-via-razorpay-api",
};

const arbItems = fc.array(
  fc.record({
    product_id: fc.constantFrom("prod-1", "prod-2", "prod-3"),
    quantity: fc.integer({ min: 1, max: 25 }),
  }),
  { minLength: 1, maxLength: 4 },
);

describe("Property 7 (Preservation): payment verification for non-buggy inputs", () => {
  beforeEach(() => {
    h.state.tables = {};
    h.state.seq = 0;
    h.state.addonUpdates = [];
    h.state.rpcCalls = [];
    vi.clearAllMocks();
  });

  it("Req 3.6/3.8: a franchise purchase with sufficient stock decrements once per item and completes PAID with notifications", async () => {
    await fc.assert(
      fc.asyncProperty(arbItems, async (items) => {
        seedOrder({ franchiseId: "F1", items });

        const result = await verifyAddonPayment("pay-1", SERVER_VERIFIED);

        expect(result.success).toBe(true);

        // Order marked PAID.
        const order = (h.state.tables["addon_orders"] ?? []).find((r) => r.id === "ao-1")!;
        expect(order.status).toBe("PAID");

        // Franchise stock decremented exactly once per item, all against F1.
        const decrementCalls = h.state.rpcCalls.filter(
          (c) => c.name === "decrement_franchise_product_stock",
        );
        expect(decrementCalls.length).toBe(items.length);
        for (const call of decrementCalls) {
          expect((call.args as { p_franchise_id: string }).p_franchise_id).toBe("F1");
        }

        // Existing notifications still fire (customer + admin).
        expect(sendNotificationToUser).toHaveBeenCalled();
        expect(notifyAdmins).toHaveBeenCalled();
      }),
      { numRuns: 40 },
    );
  });

  it("Req 3.7/3.8: a core purchase completes PAID with NO franchise decrement and still notifies", async () => {
    await fc.assert(
      fc.asyncProperty(arbItems, async (items) => {
        seedOrder({ franchiseId: null, items });

        const result = await verifyAddonPayment("pay-1", SERVER_VERIFIED);

        expect(result.success).toBe(true);

        const order = (h.state.tables["addon_orders"] ?? []).find((r) => r.id === "ao-1")!;
        expect(order.status).toBe("PAID");

        // No franchise stock decrement for core orders.
        const decrementCalls = h.state.rpcCalls.filter(
          (c) => c.name === "decrement_franchise_product_stock",
        );
        expect(decrementCalls.length).toBe(0);

        // Existing notifications still fire.
        expect(sendNotificationToUser).toHaveBeenCalled();
        expect(notifyAdmins).toHaveBeenCalled();
      }),
      { numRuns: 40 },
    );
  });
});
