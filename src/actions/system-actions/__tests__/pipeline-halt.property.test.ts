// src/actions/system-actions/__tests__/pipeline-halt.property.test.ts
//
// Feature: core-clinic-architecture, Property 29: Pipeline halts at the failing step and preserves prior output
//
// Validates: Requirements 11.7
//
// For any pipeline step that fails, `runDailyPipeline` halts AT that step: it
// returns success=false, records the failing step in `failedStep`, preserves
// the (successful) output of every step that ran BEFORE it in `steps`, marks
// the failing step's own entry as a failure, and never runs any later step
// (so no `steps` entry exists for steps after the failing one).
//
// Strategy: drive the real `runDailyPipeline` against fully mocked step
// dependencies. The four sequential steps are:
//   1. orderCreation  → generateDailyOrders            (mocked module)
//   2. productLinking → linkDailyShopPurchases (internal; uses the admin
//                       client's `addon_orders` query → forced to error)
//   3. snapshotting   → runSnapshotting (internal; reads core clinics via the
//                       admin client, then per-clinic uses the workload module
//                       → finalizeWorkloadSnapshot forced to fail)
//   4. routing        → executeAutomatedDispatch        (mocked module)
//
// A hoisted, mutable state object selects which step is forced to fail; every
// generated case repopulates it. orderCreation and productLinking retry up to 3
// times before halting (Req 11.8); when forced to always fail they still halt.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted, mutable per-case state ─────────────────────────────────────────
const h = vi.hoisted(() => ({
  state: {
    orderCreationSucceeds: true,
    productLinkingSucceeds: true,
    snapshottingSucceeds: true,
    routingSucceeds: true,
    // At least one core clinic so the snapshotting loop actually runs and can
    // observe a finalize failure.
    coreClinics: [{ id: "clinic-1", kitchen_id: "kitchen-1" }] as Array<{
      id: string;
      kitchen_id: string;
    }>,
  },
}));

// ─── Step 1: order creation (retryable) ──────────────────────────────────────
vi.mock("../orderGeneration", () => ({
  generateDailyOrders: vi.fn(async () =>
    h.state.orderCreationSucceeds
      ? { success: true, inserted: 1, skipped: 0 }
      : { success: false, error: "order generation failed" },
  ),
}));

// ─── Step 4: routing (no retry) ──────────────────────────────────────────────
vi.mock("../routeEngine", () => ({
  executeAutomatedDispatch: vi.fn(async () =>
    h.state.routingSucceeds
      ? { success: true, message: "routed" }
      : { error: "routing failed" },
  ),
}));

// ─── Step 3: snapshotting workload dependencies ──────────────────────────────
vi.mock("@/lib/clinic/workload", () => ({
  computeClinicMealCounts: vi.fn(async () => ({
    veg_count: 0,
    non_veg_count: 0,
    egg_count: 0,
  })),
  computeClinicShopProductCounts: vi.fn(async () => ({})),
  finalizeWorkloadSnapshot: vi.fn(async () =>
    h.state.snapshottingSucceeds
      ? { success: true, data: { id: "snapshot-1" } }
      : // NOTE: must NOT match /already exists/ — that is treated as a soft
        // "already finalized" success inside runSnapshotting.
        { success: false, error: "snapshot persistence failed" },
  ),
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
      // Product-linking step: forced error halts the step (after retries).
      return state.productLinkingSucceeds
        ? { data: [], error: null }
        : { data: null, error: { message: "addon_orders query failed" } };
    }
    if (table === "clinics") {
      // Snapshotting step: return the core clinics to iterate over.
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
import { runDailyPipeline, type PipelineStepName } from "../dailyPipeline";

// The four steps in strict execution order (Req 11.6).
const STEPS: PipelineStepName[] = [
  "orderCreation",
  "productLinking",
  "snapshotting",
  "routing",
];

/** Configure the mocks so exactly `failingStep` fails and earlier steps pass. */
function configure(failingStep: PipelineStepName) {
  // A step is made to succeed unless it is the chosen failing step. Steps after
  // the failing one never run, so their setting is irrelevant.
  h.state.orderCreationSucceeds = failingStep !== "orderCreation";
  h.state.productLinkingSucceeds = failingStep !== "productLinking";
  h.state.snapshottingSucceeds = failingStep !== "snapshotting";
  h.state.routingSucceeds = failingStep !== "routing";
}

// A `YYYY-MM-DD` date string generator (purely for input variety). Built from
// integer parts so it is always a well-formed, valid calendar date.
const dateArb = fc
  .record({
    year: fc.integer({ min: 2020, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );

describe("Daily pipeline - halt-on-failure / prior-output preservation property", () => {
  beforeEach(() => {
    h.state.orderCreationSucceeds = true;
    h.state.productLinkingSucceeds = true;
    h.state.snapshottingSucceeds = true;
    h.state.routingSucceeds = true;
    h.state.coreClinics = [{ id: "clinic-1", kitchen_id: "kitchen-1" }];
  });

  it("Property 29: halts at the failing step, preserves prior output, records the failed step", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<PipelineStepName>(...STEPS),
        dateArb,
        async (failingStep, targetDate) => {
          configure(failingStep);

          const result = await runDailyPipeline(targetDate);
          const failingIndex = STEPS.indexOf(failingStep);

          // (a) The pipeline reports overall failure and names the failed step.
          expect(result.success).toBe(false);
          expect(result.failedStep).toBe(failingStep);
          expect(result.targetDate).toBe(targetDate);

          // (b) Per-step invariants: earlier steps preserved & successful, the
          //     failing step present & marked failed, later steps absent.
          STEPS.forEach((step, idx) => {
            const entry = (result.steps as Record<string, { success: boolean } | undefined>)[
              step
            ];
            if (idx < failingIndex) {
              // Prior step output is preserved and marks success.
              expect(entry).toBeDefined();
              expect(entry!.success).toBe(true);
            } else if (idx === failingIndex) {
              // The failing step's own entry is present and marks failure.
              expect(entry).toBeDefined();
              expect(entry!.success).toBe(false);
            } else {
              // No step after the failing one ever ran.
              expect(entry).toBeUndefined();
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
