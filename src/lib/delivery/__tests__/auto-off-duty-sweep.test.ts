// Feature: android-background-gps-tracking
// Property 12: Auto off-duty never fires during an active delivery
//
// **Validates: Requirements 10.4, 10.7**
//
// For any rider with ≥1 active order today, the sweep makes no change
// (rider stays online). Only riders with ALL orders terminal AND past grace
// are flipped to offline.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mock duty-lifecycle utilities ───────────────────────────────────────────

vi.mock("@/lib/delivery/duty-lifecycle", () => ({
  ACTIVE_DELIVERY_STATUSES: [
    "OUT_FOR_DELIVERY",
    "ON_THE_WAY",
    "REACHING_TO_LOCATION",
    "PICKED",
  ] as const,
  TERMINAL_DELIVERY_STATUSES: ["DELIVERED", "FAILED"] as const,
  getAutoOffDutyGracePeriodMinutes: () => 5,
  getISTToday: () => "2025-01-15",
}));

import { runAutoOffDutySweep } from "../auto-off-duty-sweep";

// ─── Test Constants ──────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
  "PICKED",
] as const;

const TERMINAL_STATUSES = ["DELIVERED", "FAILED"] as const;

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a unique rider ID */
const riderIdArb = fc.uuid();

/** Generate an active delivery status */
const activeStatusArb = fc.constantFrom(...ACTIVE_STATUSES);

/** Generate a terminal delivery status */
const terminalStatusArb = fc.constantFrom(...TERMINAL_STATUSES);

/**
 * Generate a timestamp that is well past the grace period (> 5 min ago).
 * We use a time 30 minutes before the execution time.
 */
const pastGraceTimestampArb = fc.constant(
  new Date(Date.now() - 30 * 60 * 1000).toISOString(),
);

/** Generate at least 1 active order (possibly mixed with terminal orders) */
const activeOrdersArb = fc
  .tuple(
    // At least 1 active order
    fc.array(activeStatusArb, { minLength: 1, maxLength: 5 }),
    // Optionally some terminal orders too
    fc.array(terminalStatusArb, { minLength: 0, maxLength: 5 }),
  )
  .map(([activeStatuses, terminalStatuses]) => [
    ...activeStatuses.map((status, i) => ({
      id: `active-order-${i}`,
      status,
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })),
    ...terminalStatuses.map((status, i) => ({
      id: `terminal-order-${i}`,
      status,
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    })),
  ]);

/** Generate all-terminal orders that are past the grace period */
const allTerminalPastGraceOrdersArb = fc
  .array(terminalStatusArb, { minLength: 1, maxLength: 5 })
  .map((statuses) =>
    statuses.map((status, i) => ({
      id: `terminal-order-${i}`,
      status,
      // All terminal transitions > 5 minutes ago (well past grace)
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    })),
  );

// ─── Mock Supabase Client Factory ────────────────────────────────────────────

interface MockOrder {
  id: string;
  status: string;
  updated_at: string;
}

/**
 * Creates a mock Supabase admin client that returns controlled data.
 *
 * @param riders - Array of rider rows returned by the rider_profiles query
 * @param ordersByRider - Map of riderId → orders for the delivery_orders query
 * @param updateTracker - Tracks which riders get update calls
 */
function createMockSupabaseClient(
  riders: Array<{ id: string; is_online: boolean }>,
  ordersByRider: Map<string, MockOrder[]>,
  updateTracker: Map<string, Record<string, unknown>>,
) {
  return {
    from: (table: string) => {
      if (table === "rider_profiles") {
        return {
          select: () => ({
            eq: (field: string, value: unknown) => {
              if (field === "is_online" && value === true) {
                return {
                  data: riders.filter((r) => r.is_online),
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (field: string, value: unknown) => {
              if (field === "id") {
                const riderId = value as string;
                return {
                  eq: () => {
                    updateTracker.set(riderId, payload);
                    return { error: null };
                  },
                };
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "delivery_orders") {
        return {
          select: () => ({
            eq: (field: string, value: unknown) => {
              if (field === "assigned_rider_id") {
                const riderId = value as string;
                const orders = ordersByRider.get(riderId) ?? [];
                return {
                  eq: () => ({
                    data: orders,
                    error: null,
                  }),
                };
              }
              return {
                eq: () => ({
                  data: [],
                  error: null,
                }),
              };
            },
          }),
        };
      }

      return {
        select: () => ({ eq: () => ({ data: [], error: null }) }),
        update: () => ({ eq: () => ({ eq: () => ({ error: null }) }) }),
      };
    },
  } as unknown;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Auto Off-Duty Sweep — Property 12: Never fires during active delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "NEVER flips a rider who has at least 1 active order today",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          riderIdArb,
          activeOrdersArb,
          async (riderId, orders) => {
            const riders = [{ id: riderId, is_online: true }];
            const ordersByRider = new Map<string, MockOrder[]>();
            ordersByRider.set(riderId, orders);
            const updateTracker = new Map<string, Record<string, unknown>>();

            const client = createMockSupabaseClient(
              riders,
              ordersByRider,
              updateTracker,
            );

            const result = await runAutoOffDutySweep(
              client as any,
              new Date().toISOString(),
            );

            // The rider must NOT be flipped
            expect(result.flipped).not.toContain(riderId);
            // The rider must be skipped
            expect(result.skipped).toContain(riderId);
            // No update should be tracked for this rider
            expect(updateTracker.has(riderId)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  it(
    "ONLY flips riders whose orders are ALL terminal AND past grace period",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          riderIdArb,
          allTerminalPastGraceOrdersArb,
          async (riderId, orders) => {
            const riders = [{ id: riderId, is_online: true }];
            const ordersByRider = new Map<string, MockOrder[]>();
            ordersByRider.set(riderId, orders);
            const updateTracker = new Map<string, Record<string, unknown>>();

            const client = createMockSupabaseClient(
              riders,
              ordersByRider,
              updateTracker,
            );

            const result = await runAutoOffDutySweep(
              client as any,
              new Date().toISOString(),
            );

            // The rider SHOULD be flipped (all terminal, past grace)
            expect(result.flipped).toContain(riderId);
            // The update should set is_online to false
            expect(updateTracker.has(riderId)).toBe(true);
            expect(updateTracker.get(riderId)!.is_online).toBe(false);
            expect(updateTracker.get(riderId)!.last_offline_at).toBeDefined();
          },
        ),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  it(
    "with mixed riders: active-order riders are never flipped while terminal-past-grace riders are",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          riderIdArb,
          riderIdArb,
          activeOrdersArb,
          allTerminalPastGraceOrdersArb,
          async (activeRiderId, eligibleRiderId, activeOrders, terminalOrders) => {
            // Ensure distinct rider IDs
            fc.pre(activeRiderId !== eligibleRiderId);

            const riders = [
              { id: activeRiderId, is_online: true },
              { id: eligibleRiderId, is_online: true },
            ];
            const ordersByRider = new Map<string, MockOrder[]>();
            ordersByRider.set(activeRiderId, activeOrders);
            ordersByRider.set(eligibleRiderId, terminalOrders);
            const updateTracker = new Map<string, Record<string, unknown>>();

            const client = createMockSupabaseClient(
              riders,
              ordersByRider,
              updateTracker,
            );

            const result = await runAutoOffDutySweep(
              client as any,
              new Date().toISOString(),
            );

            // Active rider must NOT be flipped
            expect(result.flipped).not.toContain(activeRiderId);
            expect(result.skipped).toContain(activeRiderId);
            expect(updateTracker.has(activeRiderId)).toBe(false);

            // Eligible rider (all terminal, past grace) SHOULD be flipped
            expect(result.flipped).toContain(eligibleRiderId);
            expect(updateTracker.has(eligibleRiderId)).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    },
    30_000,
  );
});
