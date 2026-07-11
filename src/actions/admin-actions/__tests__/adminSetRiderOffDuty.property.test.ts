// Feature: android-background-gps-tracking
// Property 13: Admin off-duty is guarded — the action flips `is_online=false`
// iff the rider has zero active assignments today; otherwise it errors and
// makes no change.
//
// **Validates: Requirements 11.4, 11.5**
//
// Strategy:
// - Generate random rider IDs (existing vs non-existing).
// - Generate random sets of orders (some active, some terminal, some empty).
// - Assert:
//   • When admin is unauthorized → typed "unauthorized" error, no state change.
//   • When rider doesn't exist → typed "not_found" error, no state change.
//   • When rider has ≥1 active order today → typed "active_assignment" error,
//     no state change to is_online or last_offline_at.
//   • When rider exists AND has zero active orders → success, is_online set to
//     false and last_offline_at updated.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Trackable state ─────────────────────────────────────────────────────────

/** Whether checkGroupManage will approve the call */
let authorizationResult: { ok: true } | { ok: false; error: string } = {
  ok: true,
};

/** In-memory rider_profiles store */
let riderStore: Map<string, { id: string; is_online: boolean; last_offline_at: string | null }>;

/** In-memory delivery_orders store (keyed by rider_id for today) */
let ordersStore: Map<string, Array<{ id: string; status: string }>>;

/** Track update calls to rider_profiles */
let updateCalls: Array<{ riderId: string; patch: Record<string, unknown> }> = [];

/** Track if propagateOffDuty was called */
let propagateOffDutyCalls: string[] = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/adminAccess", () => ({
  checkGroupManage: vi.fn(async () => authorizationResult),
}));

vi.mock("@/lib/delivery/duty-lifecycle", () => ({
  ACTIVE_DELIVERY_STATUSES: [
    "OUT_FOR_DELIVERY",
    "ON_THE_WAY",
    "REACHING_TO_LOCATION",
    "PICKED",
  ],
  getISTToday: vi.fn(() => "2025-01-15"),
  propagateOffDuty: vi.fn(async (riderId: string) => {
    propagateOffDutyCalls.push(riderId);
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const from = (table: string) => {
      if (table === "rider_profiles") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, riderId: string) => ({
              maybeSingle: async () => {
                const rider = riderStore.get(riderId) ?? null;
                return { data: rider ? { id: rider.id } : null, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, riderId: string) => {
              updateCalls.push({ riderId, patch: { ...patch } });
              // Apply to in-memory store
              const rider = riderStore.get(riderId);
              if (rider) {
                if ("is_online" in patch) rider.is_online = patch.is_online as boolean;
                if ("last_offline_at" in patch) rider.last_offline_at = patch.last_offline_at as string;
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "delivery_orders") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: unknown) => {
              // First eq is assigned_rider_id
              const riderId = val as string;
              return {
                eq: (_col2: string, _val2: unknown) => ({
                  // Second eq is delivery_date
                  in: (_col3: string, statuses: string[]) => ({
                    limit: (_n: number) => {
                      const orders = ordersStore.get(riderId) ?? [];
                      const matching = orders.filter((o) =>
                        statuses.includes(o.status),
                      );
                      return Promise.resolve({
                        data: matching.slice(0, 1),
                        error: null,
                      });
                    },
                  }),
                }),
              };
            },
          }),
        };
      }

      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    };

    return { from };
  },
}));

import { adminSetRiderOffDutyAction } from "../liveTrackingActions";

// ─── Generators ──────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
  "PICKED",
] as const;

const TERMINAL_STATUSES = ["DELIVERED", "FAILED"] as const;

/** A valid rider ID (UUID-like string) */
const arbRiderId = fc.uuid();

/** Generate a set of orders: mix of active and terminal */
const arbActiveOrder = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom(...ACTIVE_STATUSES),
});

const arbTerminalOrder = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom(...TERMINAL_STATUSES),
});

/** Orders that are purely terminal (no active) */
const arbTerminalOnlyOrders = fc.array(arbTerminalOrder, { minLength: 0, maxLength: 10 });

/** Orders that contain at least one active order */
const arbOrdersWithActive = fc
  .tuple(
    fc.array(arbActiveOrder, { minLength: 1, maxLength: 5 }),
    fc.array(arbTerminalOrder, { minLength: 0, maxLength: 5 }),
  )
  .map(([active, terminal]) => [...active, ...terminal]);

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  riderStore = new Map();
  ordersStore = new Map();
  updateCalls = [];
  propagateOffDutyCalls = [];
  authorizationResult = { ok: true };
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("adminSetRiderOffDutyAction — Property 13: Admin off-duty is guarded", () => {
  it("returns unauthorized error and makes no change when admin auth fails", async () => {
    await fc.assert(
      fc.asyncProperty(arbRiderId, async (riderId) => {
        // Setup: auth fails
        authorizationResult = { ok: false, error: "You do not have permission." };
        riderStore.set(riderId, { id: riderId, is_online: true, last_offline_at: null });
        ordersStore.set(riderId, []);
        updateCalls = [];
        propagateOffDutyCalls = [];

        const result = await adminSetRiderOffDutyAction(riderId);

        expect(result).toEqual({ success: false, error: "unauthorized" });
        expect(updateCalls).toHaveLength(0);
        expect(propagateOffDutyCalls).toHaveLength(0);

        // Verify rider state unchanged
        const rider = riderStore.get(riderId)!;
        expect(rider.is_online).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("returns not_found error and makes no change for non-existent rider", async () => {
    await fc.assert(
      fc.asyncProperty(arbRiderId, async (riderId) => {
        // Setup: auth succeeds, rider does NOT exist in store
        authorizationResult = { ok: true };
        riderStore.clear();
        ordersStore.clear();
        updateCalls = [];
        propagateOffDutyCalls = [];

        const result = await adminSetRiderOffDutyAction(riderId);

        expect(result).toEqual({ success: false, error: "not_found" });
        expect(updateCalls).toHaveLength(0);
        expect(propagateOffDutyCalls).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  });

  it("returns active_assignment error and makes no change when rider has ≥1 active order today", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRiderId,
        arbOrdersWithActive,
        async (riderId, orders) => {
          // Setup: auth succeeds, rider exists, has active orders
          authorizationResult = { ok: true };
          riderStore.set(riderId, { id: riderId, is_online: true, last_offline_at: null });
          ordersStore.set(riderId, orders);
          updateCalls = [];
          propagateOffDutyCalls = [];

          const result = await adminSetRiderOffDutyAction(riderId);

          expect(result).toEqual({ success: false, error: "active_assignment" });
          expect(updateCalls).toHaveLength(0);
          expect(propagateOffDutyCalls).toHaveLength(0);

          // Verify rider state unchanged
          const rider = riderStore.get(riderId)!;
          expect(rider.is_online).toBe(true);
          expect(rider.last_offline_at).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flips is_online=false and invokes propagateOffDuty when rider has zero active orders", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRiderId,
        arbTerminalOnlyOrders,
        async (riderId, orders) => {
          // Setup: auth succeeds, rider exists and is online, only terminal orders
          authorizationResult = { ok: true };
          riderStore.set(riderId, { id: riderId, is_online: true, last_offline_at: null });
          ordersStore.set(riderId, orders);
          updateCalls = [];
          propagateOffDutyCalls = [];

          const result = await adminSetRiderOffDutyAction(riderId);

          expect(result).toEqual({ success: true });

          // Verify update was called with is_online=false
          expect(updateCalls).toHaveLength(1);
          expect(updateCalls[0].riderId).toBe(riderId);
          expect(updateCalls[0].patch.is_online).toBe(false);
          expect(updateCalls[0].patch.last_offline_at).toBeDefined();

          // Verify propagateOffDuty was called
          expect(propagateOffDutyCalls).toHaveLength(1);
          expect(propagateOffDutyCalls[0]).toBe(riderId);

          // Verify in-memory state reflects the flip
          const rider = riderStore.get(riderId)!;
          expect(rider.is_online).toBe(false);
          expect(rider.last_offline_at).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
