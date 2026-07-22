// src/actions/system-actions/__tests__/shop-linking-bug-checkout-ist-date.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 1: Bug Condition — sub-condition #1 (IST/UTC date mismatch at checkout)
//
// Validates: Requirements 1.1, 1.2 (defect) / expected behavior 2.1, 2.2
//
// EXPLORATION TEST — MUST FAIL on the UNFIXED code. The failure is the
// counterexample that proves the bug exists.
//
// Bug: `processStandaloneCheckout` computes the "today" basis used to pick the
// customer's next active delivery day with
//     const today = new Date().toISOString().split("T")[0];   // UTC calendar date
// Between IST midnight (00:00) and 05:30 IST the UTC calendar date still reads
// the PREVIOUS IST day, so `.gt("preference_date", today)` can select the
// CURRENT IST day as `target_delivery_date` — a day whose ~12:05 AM IST
// `link-products` cron has already run. The paid product is then never linked.
//
// Expected behavior (Property 1 / Req 2.1, 2.2): the checkout must compute the
// upcoming delivery day from the IST calendar date (consistent with
// `getISTDateString`), so `target_delivery_date` is ALWAYS strictly after the
// IST checkout day and never equals a day whose cron already ran.
//
// Strategy: drive the REAL `processStandaloneCheckout` server action against an
// in-memory fake `@/lib/supabase/server` client, with the wall-clock pinned via
// fake Date to a checkout instant inside the IST 00:00–05:30 window. We capture
// the `target_delivery_date` written to `addon_orders` and assert it is strictly
// after the IST checkout date. Only the date basis matters, so the customer is a
// core (non-franchise) customer to keep the flow minimal.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as fc from "fast-check";
import { istDateStringOf, addDaysToISODate } from "@/lib/dates/ist";

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

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-1" } }, error: null }),
    },
    from: (table: string) => makeBuilder(table),
    rpc: async () => ({ data: null, error: null }),
  };

  return { state, ensure, client };
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
import { processStandaloneCheckout } from "@/actions/shop-actions";

// ─── Seeding ──────────────────────────────────────────────────────────────────
function seedBaseCustomer(prefDates: string[]) {
  h.state.tables = {};
  h.state.seq = 0;
  h.state.tables["users"] = [{ id: "u1", auth_user_id: "auth-1", full_name: "Test" }];
  h.state.tables["customer_profiles"] = [
    { id: "p1", user_id: "u1", franchise_id: null },
  ];
  h.state.tables["subscriptions"] = [
    { id: "s1", customer_profile_id: "p1", status: "ACTIVE" },
  ];
  h.state.tables["subscription_daily_preferences"] = prefDates.map((d, i) => ({
    id: `pref-${i}`,
    customer_profile_id: "p1",
    preference_date: d,
    is_paused: false,
  }));
  h.state.tables["products"] = [
    {
      id: "prod-1",
      original_price: 100,
      sale_price: null,
      tax_percent: 0,
      deleted_at: null,
      is_active: true,
    },
  ];
  h.state.tables["addon_orders"] = [];
  h.state.tables["payments"] = [];
  h.state.tables["addon_order_items"] = [];
}

// ─── Generator: checkout instants inside the IST 00:00–05:30 window ─────────
const BASE_DATES = ["2025-01-12", "2025-03-15", "2025-07-01", "2025-11-09"];

const arbInstant = fc
  .record({
    dateIdx: fc.integer({ min: 0, max: BASE_DATES.length - 1 }),
    hour: fc.integer({ min: 0, max: 5 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  // Constrain strictly to the failing window: 00:00 <= t < 05:30 IST.
  .filter((x) => x.hour * 60 + x.minute < 5 * 60 + 30);

describe("Property 1 (Bug Condition #1): IST-consistent target date at checkout", () => {
  beforeAll(() => {
    // Only fake `Date` so promises/microtasks are unaffected.
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    h.state.tables = {};
    h.state.seq = 0;
  });

  it("target_delivery_date is always strictly after the IST checkout day (never a day whose cron already ran)", async () => {
    await fc.assert(
      fc.asyncProperty(arbInstant, async ({ dateIdx, hour, minute }) => {
        const istDay = BASE_DATES[dateIdx];
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        // Checkout instant expressed in IST wall-clock (+05:30). For hour<5:30
        // the corresponding UTC calendar date is the PREVIOUS day.
        const instant = new Date(`${istDay}T${hh}:${mm}:00.000+05:30`);

        // Preconditions: the IST date of the instant is istDay, and the UTC date
        // lags (confirming we are inside the buggy window).
        fc.pre(istDateStringOf(instant) === istDay);
        const utcDate = instant.toISOString().split("T")[0];
        fc.pre(utcDate < istDay);

        // Active delivery days: the IST checkout day and the two days after it.
        // The IST checkout day (istDay) is an active, non-paused day whose
        // linking cron already ran at ~00:05 IST.
        seedBaseCustomer([
          istDay,
          addDaysToISODate(istDay, 1),
          addDaysToISODate(istDay, 2),
        ]);

        vi.setSystemTime(instant);

        const result = await processStandaloneCheckout([
          { id: "prod-1", quantity: 1 } as never,
        ]);

        // The flow must complete so we can inspect the chosen target date.
        expect(result.success).toBe(true);

        const orders = h.state.tables["addon_orders"] ?? [];
        expect(orders.length).toBe(1);
        const targetDeliveryDate = orders[0].target_delivery_date as string;

        const istCheckoutDay = istDateStringOf(instant);

        // EXPECTED (Property 1 / Req 2.1, 2.2): the target delivery day must be
        // strictly AFTER the IST checkout day. On unfixed code the UTC-based
        // `today` (previous IST day) lets the query select `istCheckoutDay`
        // itself — a day whose cron already ran — so this assertion FAILS.
        expect(targetDeliveryDate > istCheckoutDay).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});
