// src/actions/system-actions/__tests__/pipeline-integration.test.ts
//
// Feature: core-clinic-architecture
// Integration test for the daily pipeline ordering, timing, and retry behavior.
//
// Validates: Requirements 11.1, 11.5, 11.6, 11.8
//
// These are EXAMPLE-BASED integration tests (not property tests). They drive
// the real `runDailyPipeline` against fully mocked step dependencies and assert
// on the observable orchestration behavior:
//
//   1. SEQUENTIAL ORDER (Req 11.6): the four steps run in strict order
//      order-creation → product-linking → snapshotting → routing. We record a
//      global call-order array as each step's dependency executes and assert
//      the steps appear in exactly that sequence. On a fully successful run the
//      result reports success with all four step outcomes present (Req 11.1,
//      11.5).
//   2. RETRY THEN SUCCEED (Req 11.8): order-creation fails once, then succeeds.
//      The pipeline retries and ultimately succeeds with attempts === 2.
//   3. RETRY THEN HALT (Req 11.8): product-linking always fails. The step is
//      attempted up to the retry limit (4 = 1 initial + 3 retries) and then the
//      pipeline halts with failedStep === "productLinking"; routing never runs.
//
// The four sequential steps wire to:
//   1. orderCreation  → generateDailyOrders            (mocked module)
//   2. productLinking → linkDailyShopPurchases (internal; uses the admin
//                       client's `addon_orders` query)
//   3. snapshotting   → runSnapshotting (internal; reads core clinics via the
//                       admin client, then per-clinic finalizeWorkloadSnapshot)
//   4. routing        → executeAutomatedDispatch        (mocked module)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted, mutable per-case state ─────────────────────────────────────────
const h = vi.hoisted(() => ({
  state: {
    // Records the sequence in which the four steps' dependencies execute.
    callOrder: [] as string[],
    // How many times order-creation should fail before succeeding.
    orderCreationFailuresRemaining: 0,
    // Whether the product-linking (addon_orders) query succeeds.
    productLinkingSucceeds: true,
    // Whether snapshotting (finalizeWorkloadSnapshot) succeeds.
    snapshottingSucceeds: true,
    // Whether routing (executeAutomatedDispatch) succeeds.
    routingSucceeds: true,
    // One core clinic so the snapshotting loop runs exactly once.
    coreClinics: [{ id: "clinic-1", kitchen_id: "kitchen-1" }] as Array<{
      id: string;
      kitchen_id: string;
    }>,
  },
}));

// ─── Step 1: order creation (retryable) ──────────────────────────────────────
vi.mock("../orderGeneration", () => ({
  generateDailyOrders: vi.fn(async () => {
    h.state.callOrder.push("orderCreation");
    if (h.state.orderCreationFailuresRemaining > 0) {
      h.state.orderCreationFailuresRemaining -= 1;
      return { success: false, error: "order generation failed" };
    }
    return { success: true, inserted: 1, skipped: 0 };
  }),
}));

// ─── Step 4: routing (no retry) ──────────────────────────────────────────────
vi.mock("../routeEngine", () => ({
  executeAutomatedDispatch: vi.fn(async () => {
    h.state.callOrder.push("routing");
    return h.state.routingSucceeds
      ? { success: true, message: "routed" }
      : { error: "routing failed" };
  }),
}));

// ─── Step 3: snapshotting workload dependencies ──────────────────────────────
vi.mock("@/lib/clinic/workload", () => ({
  computeClinicMealCounts: vi.fn(async () => ({
    veg_count: 0,
    non_veg_count: 0,
    egg_count: 0,
  })),
  computeClinicShopProductCounts: vi.fn(async () => ({})),
  finalizeWorkloadSnapshot: vi.fn(async () => {
    h.state.callOrder.push("snapshotting");
    return h.state.snapshottingSucceeds
      ? { success: true, data: { id: "snapshot-1" } }
      : { success: false, error: "snapshot persistence failed" };
  }),
}));

// ─── IST helper used by the product-linking step (inert) ─────────────────────
vi.mock("@/lib/dates/ist", () => ({
  purchaseAttributionDate: () => "2099-01-01",
}));

// ─── In-memory fake admin client backed by hoisted state ─────────────────────
// Used by linkDailyShopPurchases (addon_orders query) and runSnapshotting
// (clinics query). Each query chain terminates by awaiting the thenable builder.
vi.mock("@/lib/supabase/admin", () => {
  const state = h.state;

  function resolveResult(table: string) {
    if (table === "addon_orders") {
      // Product-linking step: record the call and optionally force an error.
      state.callOrder.push("productLinking");
      return state.productLinkingSucceeds
        ? { data: [], error: null }
        : { data: null, error: { message: "addon_orders query failed" } };
    }
    if (table === "clinics") {
      // Snapshotting step: return the core clinics to iterate over. (Recording
      // happens at finalizeWorkloadSnapshot so it reflects actual snapshotting.)
      return { data: state.coreClinics, error: null };
    }
    return { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const b: any = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      in() {
        return b;
      },
      is() {
        return b;
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(resolveResult(table)).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return b;
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => makeBuilder(table),
    }),
  };
});

// Import AFTER mocks are registered.
import { runDailyPipeline } from "../dailyPipeline";

const TARGET_DATE = "2025-06-01";

describe("Daily pipeline - integration (ordering, timing, retry)", () => {
  beforeEach(() => {
    h.state.callOrder = [];
    h.state.orderCreationFailuresRemaining = 0;
    h.state.productLinkingSucceeds = true;
    h.state.snapshottingSucceeds = true;
    h.state.routingSucceeds = true;
    h.state.coreClinics = [{ id: "clinic-1", kitchen_id: "kitchen-1" }];
  });

  it("runs steps in strict order order→link→snapshot→route on a fully successful run (Req 11.1, 11.5, 11.6)", async () => {
    const result = await runDailyPipeline(TARGET_DATE);

    // Strict sequential execution (Req 11.6).
    expect(h.state.callOrder).toEqual([
      "orderCreation",
      "productLinking",
      "snapshotting",
      "routing",
    ]);

    // generateDailyOrders runs before the addon_orders query, which runs before
    // finalizeWorkloadSnapshot, which runs before executeAutomatedDispatch.
    expect(h.state.callOrder.indexOf("orderCreation")).toBeLessThan(
      h.state.callOrder.indexOf("productLinking"),
    );
    expect(h.state.callOrder.indexOf("productLinking")).toBeLessThan(
      h.state.callOrder.indexOf("snapshotting"),
    );
    expect(h.state.callOrder.indexOf("snapshotting")).toBeLessThan(
      h.state.callOrder.indexOf("routing"),
    );

    // Overall success with all four step outcomes present (Req 11.1, 11.5).
    expect(result.success).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.targetDate).toBe(TARGET_DATE);
    expect(result.steps.orderCreation).toBeDefined();
    expect(result.steps.productLinking).toBeDefined();
    expect(result.steps.snapshotting).toBeDefined();
    expect(result.steps.routing).toBeDefined();
    expect(result.steps.orderCreation!.success).toBe(true);
    expect(result.steps.productLinking!.success).toBe(true);
    expect(result.steps.snapshotting!.success).toBe(true);
    expect(result.steps.routing!.success).toBe(true);
  });

  it("retries order-creation after one failure and ultimately succeeds (Req 11.8)", async () => {
    h.state.orderCreationFailuresRemaining = 1; // fail once, then succeed

    const result = await runDailyPipeline(TARGET_DATE);

    // The whole pipeline succeeds despite the transient order-creation failure.
    expect(result.success).toBe(true);
    expect(result.failedStep).toBeUndefined();

    // Order-creation was retried: 1 initial attempt + 1 retry = 2 attempts.
    expect(result.steps.orderCreation).toBeDefined();
    expect(result.steps.orderCreation!.success).toBe(true);
    expect(result.steps.orderCreation!.attempts).toBe(2);

    // It still proceeded through the remaining steps in order afterwards.
    expect(h.state.callOrder).toEqual([
      "orderCreation", // failed attempt
      "orderCreation", // successful retry
      "productLinking",
      "snapshotting",
      "routing",
    ]);
  });

  it("retries product-linking up to the limit then halts; routing never runs (Req 11.8)", async () => {
    h.state.productLinkingSucceeds = false; // always fails

    const result = await runDailyPipeline(TARGET_DATE);

    // The pipeline halts at product-linking.
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("productLinking");

    // Order-creation completed normally before the failing step.
    expect(result.steps.orderCreation).toBeDefined();
    expect(result.steps.orderCreation!.success).toBe(true);

    // Product-linking was attempted up to the retry limit: 1 initial + 3
    // retries = 4 attempts, then halted.
    expect(result.steps.productLinking).toBeDefined();
    expect(result.steps.productLinking!.success).toBe(false);
    expect(result.steps.productLinking!.attempts).toBe(4);

    // Later steps never ran (halt-on-failure).
    expect(result.steps.snapshotting).toBeUndefined();
    expect(result.steps.routing).toBeUndefined();
    expect(h.state.callOrder).not.toContain("snapshotting");
    expect(h.state.callOrder).not.toContain("routing");

    // The product-linking dependency (addon_orders query) was invoked 4 times.
    expect(
      h.state.callOrder.filter((s) => s === "productLinking").length,
    ).toBe(4);
  });
});
