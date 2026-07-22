// src/lib/shop/retargetUnlinkedAddonOrders.test.ts
//
// Feature: shop-product-delivery-linking-fix — Task 3.3 (Defect #3).
// Property 3 / Req 2.4: when a customer pauses/reschedules the day that is the
// target_delivery_date of an UNLINKED PAID shop order, that order is re-targeted
// to the customer's next active delivery day. Property 7 preservation: linked
// orders and non-target-day pauses are never touched, and scoping is strict.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  selectNextActiveDeliveryDate,
  retargetUnlinkedAddonOrdersForPausedDates,
  type DailyPreferenceRow,
} from "./retargetUnlinkedAddonOrders";

// ─── Minimal in-memory Supabase fake (only what this helper uses) ────────────
type Row = Record<string, unknown>;

function makeClient(tables: Record<string, Row[]>): SupabaseClient {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" = "select";
    let payload: Row | null = null;
    let orderKey: string | null = null;
    let orderAsc = true;

    function run() {
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "select") {
        let res = rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
        if (orderKey) {
          const k = orderKey;
          res = res.sort((a, b) => {
            const av = a[k] as never;
            const bv = b[k] as never;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
        }
        return { data: res, error: null };
      }
      // update
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      matched.forEach((r) => Object.assign(r, payload));
      return { data: matched.map((r) => ({ ...r })), error: null };
    }

    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      update: (p: Row) => {
        op = "update";
        payload = p;
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      gt: (k: string, v: never) => {
        filters.push((r) => (r[k] as never) > v);
        return b;
      },
      in: (k: string, arr: unknown[]) => {
        filters.push((r) => arr.includes(r[k]));
        return b;
      },
      is: (k: string, v: unknown) => {
        filters.push((r) =>
          v === null ? r[k] === null || r[k] === undefined : r[k] === v,
        );
        return b;
      },
      order: (k: string, o?: { ascending?: boolean }) => {
        orderKey = k;
        orderAsc = o?.ascending !== false;
        return b;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    });
    return b;
  }

  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

// ─── Pure selection semantics ────────────────────────────────────────────────
describe("selectNextActiveDeliveryDate (pure)", () => {
  it("returns the earliest non-paused preference strictly after today", () => {
    const prefs: DailyPreferenceRow[] = [
      { preference_date: "2025-03-10", is_paused: false }, // == today, excluded
      { preference_date: "2025-03-11", is_paused: true }, // paused, excluded
      { preference_date: "2025-03-12", is_paused: false }, // winner
      { preference_date: "2025-03-13", is_paused: false },
    ];
    expect(selectNextActiveDeliveryDate(prefs, "2025-03-10")).toBe("2025-03-12");
  });

  it("returns null when there is no upcoming active day", () => {
    const prefs: DailyPreferenceRow[] = [
      { preference_date: "2025-03-09", is_paused: false }, // past
      { preference_date: "2025-03-12", is_paused: true }, // paused
    ];
    expect(selectNextActiveDeliveryDate(prefs, "2025-03-10")).toBeNull();
  });

  it("property: result is always non-paused and strictly after today, or null", () => {
    const day = (n: number) =>
      `2025-04-${String(n).padStart(2, "0")}`;
    const arb = fc.record({
      today: fc.integer({ min: 1, max: 20 }),
      prefs: fc.array(
        fc.record({
          offset: fc.integer({ min: -5, max: 10 }),
          is_paused: fc.boolean(),
        }),
        { minLength: 0, maxLength: 12 },
      ),
    });

    fc.assert(
      fc.property(arb, ({ today, prefs }) => {
        const todayStr = day(today);
        const rows: DailyPreferenceRow[] = prefs.map((p) => ({
          preference_date: day(today + p.offset),
          is_paused: p.is_paused,
        }));
        const result = selectNextActiveDeliveryDate(rows, todayStr);

        const activeFuture = rows
          .filter((r) => !r.is_paused && r.preference_date > todayStr)
          .map((r) => r.preference_date)
          .sort();

        if (activeFuture.length === 0) {
          expect(result).toBeNull();
        } else {
          // Must be the earliest active future day.
          expect(result).toBe(activeFuture[0]);
          expect(result! > todayStr).toBe(true);
        }
      }),
    );
  });
});

// ─── IO: scoped re-target on pause ───────────────────────────────────────────
describe("retargetUnlinkedAddonOrdersForPausedDates (IO)", () => {
  const today = "2025-05-10";

  function seed() {
    const tables: Record<string, Row[]> = {
      addon_orders: [
        // p1: unlinked PAID order targeting the paused day -> should re-target
        {
          id: "o1",
          customer_profile_id: "p1",
          status: "PAID",
          delivery_order_id: null,
          target_delivery_date: "2025-05-12",
        },
        // p1: linked order on the paused day -> must NOT be touched (guard)
        {
          id: "o2",
          customer_profile_id: "p1",
          status: "PAID",
          delivery_order_id: "d-linked",
          target_delivery_date: "2025-05-12",
        },
        // p1: unlinked PAID order on a NON-paused day -> must NOT be touched
        {
          id: "o3",
          customer_profile_id: "p1",
          status: "PAID",
          delivery_order_id: null,
          target_delivery_date: "2025-05-15",
        },
        // p2: another customer's unlinked order on the same date -> scoping
        {
          id: "o4",
          customer_profile_id: "p2",
          status: "PAID",
          delivery_order_id: null,
          target_delivery_date: "2025-05-12",
        },
      ],
      subscription_daily_preferences: [
        { customer_profile_id: "p1", preference_date: "2025-05-12", is_paused: true },
        { customer_profile_id: "p1", preference_date: "2025-05-13", is_paused: true },
        { customer_profile_id: "p1", preference_date: "2025-05-14", is_paused: false },
        { customer_profile_id: "p1", preference_date: "2025-05-15", is_paused: false },
        // p2 has an earlier active day but must be ignored by scoping
        { customer_profile_id: "p2", preference_date: "2025-05-11", is_paused: false },
      ],
    };
    return tables;
  }

  it("re-targets the unlinked PAID order on a paused day to the next active day", async () => {
    const tables = seed();
    const supabase = makeClient(tables);

    const res = await retargetUnlinkedAddonOrdersForPausedDates(
      supabase,
      "p1",
      ["2025-05-12"],
      today,
    );

    expect(res.retargeted).toBe(1);
    const orders = tables.addon_orders;
    expect(orders.find((o) => o.id === "o1")!.target_delivery_date).toBe(
      "2025-05-14",
    );
    // Linked order untouched.
    expect(orders.find((o) => o.id === "o2")!.target_delivery_date).toBe(
      "2025-05-12",
    );
    // Non-target-day order untouched.
    expect(orders.find((o) => o.id === "o3")!.target_delivery_date).toBe(
      "2025-05-15",
    );
    // Another customer's order untouched (strict scoping).
    expect(orders.find((o) => o.id === "o4")!.target_delivery_date).toBe(
      "2025-05-12",
    );
  });

  it("does nothing when there is no upcoming active day", async () => {
    const tables = seed();
    // Pause every future p1 day.
    tables.subscription_daily_preferences
      .filter((p) => p.customer_profile_id === "p1")
      .forEach((p) => (p.is_paused = true));
    const supabase = makeClient(tables);

    const res = await retargetUnlinkedAddonOrdersForPausedDates(
      supabase,
      "p1",
      ["2025-05-12"],
      today,
    );

    expect(res.retargeted).toBe(0);
    expect(
      tables.addon_orders.find((o) => o.id === "o1")!.target_delivery_date,
    ).toBe("2025-05-12");
  });

  it("no-ops when no dates were paused", async () => {
    const tables = seed();
    const supabase = makeClient(tables);
    const res = await retargetUnlinkedAddonOrdersForPausedDates(
      supabase,
      "p1",
      [],
      today,
    );
    expect(res.retargeted).toBe(0);
  });
});
