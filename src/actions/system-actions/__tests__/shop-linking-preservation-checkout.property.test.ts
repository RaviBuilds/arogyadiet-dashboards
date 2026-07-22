// src/actions/system-actions/__tests__/shop-linking-preservation-checkout.property.test.ts
//
// Feature: shop-product-delivery-linking-fix
// Property 7: Preservation — checkout targeting for NON-buggy inputs.
//
// Validates: Requirements 3.1, 3.2, 3.3
//
// PRESERVATION TEST — MUST PASS on the UNFIXED code (it locks in the baseline
// behavior the fix must preserve). It exercises only inputs where
// `isBugCondition(X)` is FALSE:
//
//   - Req 3.3: checkout instants OUTSIDE the IST 00:00–05:30 window (i.e. where
//     the UTC calendar date and the IST calendar date AGREE) still target the
//     same next active delivery day (the earliest non-paused preference day
//     strictly after "today").
//   - Req 3.1: a customer WITHOUT an ACTIVE meal subscription is still rejected
//     with the active-subscription error.
//   - Req 3.2: a customer with NO upcoming active (non-paused) delivery day is
//     still rejected with the "no upcoming active delivery days" error.
//
// Strategy: drive the REAL `processStandaloneCheckout` server action against an
// in-memory fake `@/lib/supabase/server` client, with the wall-clock pinned via
// fake Date. For the non-buggy window UTC and IST agree, so the unfixed
// UTC-based `today` equals the IST date and the target date is deterministic.

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
type PrefSpec = { offset: number; paused: boolean };

function seedCustomer(opts: {
  istDay: string;
  prefs: PrefSpec[];
  hasActiveSubscription?: boolean;
}) {
  h.state.tables = {};
  h.state.seq = 0;
  h.state.tables["users"] = [{ id: "u1", auth_user_id: "auth-1", full_name: "Test" }];
  h.state.tables["customer_profiles"] = [{ id: "p1", user_id: "u1", franchise_id: null }];
  h.state.tables["subscriptions"] =
    opts.hasActiveSubscription === false
      ? []
      : [{ id: "s1", customer_profile_id: "p1", status: "ACTIVE" }];
  h.state.tables["subscription_daily_preferences"] = opts.prefs.map((p, i) => ({
    id: `pref-${i}`,
    customer_profile_id: "p1",
    preference_date: addDaysToISODate(opts.istDay, p.offset),
    is_paused: p.paused,
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

// Checkout instants OUTSIDE the buggy window (IST time-of-day >= 05:30), so the
// UTC calendar date and the IST calendar date AGREE.
const BASE_DATES = ["2025-01-12", "2025-03-15", "2025-07-01", "2025-11-09"];

const arbNonBuggyInstant = fc
  .record({
    dateIdx: fc.integer({ min: 0, max: BASE_DATES.length - 1 }),
    hour: fc.integer({ min: 6, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map((x) => ({ ...x, istDay: BASE_DATES[x.dateIdx] }));

describe("Property 7 (Preservation): checkout targeting for non-buggy inputs", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    h.state.tables = {};
    h.state.seq = 0;
    vi.clearAllMocks();
  });

  it("Req 3.3: when UTC and IST agree, checkout targets the earliest non-paused preference day strictly after today", async () => {
    const arb = fc
      .record({
        instant: arbNonBuggyInstant,
        // Candidate future preference days at distinct offsets (1..12).
        futureDays: fc.uniqueArray(
          fc.record({
            offset: fc.integer({ min: 1, max: 12 }),
            paused: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6, selector: (d) => d.offset },
        ),
      })
      // Require at least one active (non-paused) future day so the flow succeeds
      // (the "no active day" case is a separate preservation test below).
      .filter((x) => x.futureDays.some((d) => !d.paused));

    await fc.assert(
      fc.asyncProperty(arb, async ({ instant, futureDays }) => {
        const { istDay, hour, minute } = instant;
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        const inst = new Date(`${istDay}T${hh}:${mm}:00.000+05:30`);

        // Confirm this is a NON-buggy instant: UTC and IST agree on the date.
        fc.pre(istDateStringOf(inst) === istDay);
        const utcDate = inst.toISOString().split("T")[0];
        fc.pre(utcDate === istDay);

        // Seed an inactive/past-equal today day (offset 0, excluded by > today)
        // plus the generated future days.
        seedCustomer({
          istDay,
          prefs: [{ offset: 0, paused: false }, ...futureDays],
        });

        vi.setSystemTime(inst);

        const result = await processStandaloneCheckout([
          { id: "prod-1", quantity: 1 } as never,
        ]);

        expect(result.success).toBe(true);

        const orders = h.state.tables["addon_orders"] ?? [];
        expect(orders.length).toBe(1);
        const targetDeliveryDate = orders[0].target_delivery_date as string;

        // Baseline expected behavior: the earliest NON-paused preference day
        // strictly after "today" (== istDay when UTC/IST agree).
        const earliestActiveOffset = Math.min(
          ...futureDays.filter((d) => !d.paused).map((d) => d.offset),
        );
        const expected = addDaysToISODate(istDay, earliestActiveOffset);

        expect(targetDeliveryDate).toBe(expected);
        // And it is strictly after today, exactly as today's behavior.
        expect(targetDeliveryDate > istDay).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("Req 3.1: a customer without an ACTIVE subscription is still rejected", async () => {
    const inst = new Date("2025-03-15T10:00:00.000+05:30");
    vi.setSystemTime(inst);
    seedCustomer({
      istDay: "2025-03-15",
      prefs: [{ offset: 1, paused: false }],
      hasActiveSubscription: false,
    });

    const result = await processStandaloneCheckout([
      { id: "prod-1", quantity: 1 } as never,
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/active meal subscription/i);
  });

  it("Req 3.2: a customer with no upcoming active delivery day is still rejected", async () => {
    const inst = new Date("2025-03-15T10:00:00.000+05:30");
    vi.setSystemTime(inst);
    // Only a paused future day and a past/today day → no upcoming active day.
    seedCustomer({
      istDay: "2025-03-15",
      prefs: [
        { offset: 0, paused: false },
        { offset: 2, paused: true },
      ],
    });

    const result = await processStandaloneCheckout([
      { id: "prod-1", quantity: 1 } as never,
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no upcoming active delivery days/i);
  });
});
