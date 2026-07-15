// Feature: connectivity-based auto off-duty
//
// The auto off-duty sweep ties "Online" to actual app connectivity via the
// rider's live-location heartbeat (rider_live_locations.updated_at), floored by
// their go-online time (rider_profiles.last_online_at):
//
//   * A rider with a FRESH heartbeat stays online.
//   * A rider with a STALE heartbeat (app not reporting) is flipped offline,
//     even if they hold assigned orders.
//   * A rider with an in-progress (active) delivery is never flipped, tolerating
//     brief signal gaps mid-delivery.

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
  getRiderHeartbeatStaleMinutes: () => 5,
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

/** Statuses that do NOT protect a rider from being flipped (no active delivery). */
const NON_ACTIVE_STATUSES = [
  "ORDER_CREATED",
  "ASSIGNED",
  "DELIVERED",
  "FAILED",
] as const;

const STALE_TS = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
const FRESH_TS = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // 1 min ago

// ─── Generators ──────────────────────────────────────────────────────────────

const riderIdArb = fc.uuid();
const activeStatusArb = fc.constantFrom(...ACTIVE_STATUSES);
const nonActiveStatusArb = fc.constantFrom(...NON_ACTIVE_STATUSES);

/** At least 1 active order (optionally mixed with non-active orders). */
const activeOrdersArb = fc
  .tuple(
    fc.array(activeStatusArb, { minLength: 1, maxLength: 5 }),
    fc.array(nonActiveStatusArb, { minLength: 0, maxLength: 5 }),
  )
  .map(([active, nonActive]) =>
    [...active, ...nonActive].map((status) => ({ status })),
  );

/** Zero or more orders, NONE of which are active (assigned/created/terminal). */
const nonActiveOrdersArb = fc
  .array(nonActiveStatusArb, { minLength: 0, maxLength: 5 })
  .map((statuses) => statuses.map((status) => ({ status })));

// ─── Mock Supabase Client Factory ────────────────────────────────────────────

interface MockOrder {
  status: string;
}

type MockLocation = { updated_at: string } | null;

/**
 * Creates a mock Supabase admin client that returns controlled data for the
 * three tables the sweep reads/writes: rider_profiles, delivery_orders,
 * rider_live_locations.
 */
function createMockSupabaseClient(
  riders: Array<{ id: string; is_online: boolean; last_online_at: string | null }>,
  ordersByRider: Map<string, MockOrder[]>,
  locationByRider: Map<string, MockLocation>,
  updateTracker: Map<string, Record<string, unknown>>,
) {
  return {
    from: (table: string) => {
      if (table === "rider_profiles") {
        return {
          select: () => ({
            eq: (field: string, value: unknown) => {
              if (field === "is_online" && value === true) {
                return { data: riders.filter((r) => r.is_online), error: null };
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
              return { eq: () => ({ error: null }) };
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
                return { eq: () => ({ data: orders, error: null }) };
              }
              return { eq: () => ({ data: [], error: null }) };
            },
          }),
        };
      }

      if (table === "rider_live_locations") {
        return {
          select: () => ({
            eq: (field: string, value: unknown) => {
              if (field === "rider_id") {
                const riderId = value as string;
                const loc = locationByRider.get(riderId) ?? null;
                return { maybeSingle: () => ({ data: loc, error: null }) };
              }
              return { maybeSingle: () => ({ data: null, error: null }) };
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

describe("Auto Off-Duty Sweep — connectivity-based", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "NEVER flips a rider who has an active (in-progress) delivery, even with a stale heartbeat",
    async () => {
      await fc.assert(
        fc.asyncProperty(riderIdArb, activeOrdersArb, async (riderId, orders) => {
          const riders = [{ id: riderId, is_online: true, last_online_at: STALE_TS }];
          const ordersByRider = new Map<string, MockOrder[]>([[riderId, orders]]);
          const locationByRider = new Map<string, MockLocation>([
            [riderId, { updated_at: STALE_TS }],
          ]);
          const updateTracker = new Map<string, Record<string, unknown>>();

          const client = createMockSupabaseClient(
            riders,
            ordersByRider,
            locationByRider,
            updateTracker,
          );

          const result = await runAutoOffDutySweep(client as any, new Date().toISOString());

          expect(result.flipped).not.toContain(riderId);
          expect(result.skipped).toContain(riderId);
          expect(updateTracker.has(riderId)).toBe(false);
        }),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  it(
    "flips a rider with a STALE heartbeat and no active delivery (even if they hold assigned orders)",
    async () => {
      await fc.assert(
        fc.asyncProperty(riderIdArb, nonActiveOrdersArb, async (riderId, orders) => {
          const riders = [{ id: riderId, is_online: true, last_online_at: STALE_TS }];
          const ordersByRider = new Map<string, MockOrder[]>([[riderId, orders]]);
          const locationByRider = new Map<string, MockLocation>([
            [riderId, { updated_at: STALE_TS }],
          ]);
          const updateTracker = new Map<string, Record<string, unknown>>();

          const client = createMockSupabaseClient(
            riders,
            ordersByRider,
            locationByRider,
            updateTracker,
          );

          const result = await runAutoOffDutySweep(client as any, new Date().toISOString());

          expect(result.flipped).toContain(riderId);
          expect(updateTracker.has(riderId)).toBe(true);
          expect(updateTracker.get(riderId)!.is_online).toBe(false);
          expect(updateTracker.get(riderId)!.last_offline_at).toBeDefined();
        }),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  it(
    "NEVER flips a rider with a FRESH heartbeat (app is connected)",
    async () => {
      await fc.assert(
        fc.asyncProperty(riderIdArb, nonActiveOrdersArb, async (riderId, orders) => {
          const riders = [{ id: riderId, is_online: true, last_online_at: STALE_TS }];
          const ordersByRider = new Map<string, MockOrder[]>([[riderId, orders]]);
          // Fresh heartbeat — the app is reporting right now.
          const locationByRider = new Map<string, MockLocation>([
            [riderId, { updated_at: FRESH_TS }],
          ]);
          const updateTracker = new Map<string, Record<string, unknown>>();

          const client = createMockSupabaseClient(
            riders,
            ordersByRider,
            locationByRider,
            updateTracker,
          );

          const result = await runAutoOffDutySweep(client as any, new Date().toISOString());

          expect(result.flipped).not.toContain(riderId);
          expect(result.skipped).toContain(riderId);
          expect(updateTracker.has(riderId)).toBe(false);
        }),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  it(
    "does not flip a freshly-online rider with no heartbeat yet (grace floor via last_online_at)",
    async () => {
      await fc.assert(
        fc.asyncProperty(riderIdArb, async (riderId) => {
          // Just toggled online; native service hasn't sent its first ping.
          const riders = [{ id: riderId, is_online: true, last_online_at: FRESH_TS }];
          const ordersByRider = new Map<string, MockOrder[]>([[riderId, []]]);
          const locationByRider = new Map<string, MockLocation>([[riderId, null]]);
          const updateTracker = new Map<string, Record<string, unknown>>();

          const client = createMockSupabaseClient(
            riders,
            ordersByRider,
            locationByRider,
            updateTracker,
          );

          const result = await runAutoOffDutySweep(client as any, new Date().toISOString());

          expect(result.flipped).not.toContain(riderId);
          expect(result.skipped).toContain(riderId);
        }),
        { numRuns: 30 },
      );
    },
    30_000,
  );

  it(
    "mixed: fresh/active riders stay online while stale riders are flipped",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          riderIdArb,
          riderIdArb,
          nonActiveOrdersArb,
          nonActiveOrdersArb,
          async (freshRiderId, staleRiderId, freshOrders, staleOrders) => {
            fc.pre(freshRiderId !== staleRiderId);

            const riders = [
              { id: freshRiderId, is_online: true, last_online_at: STALE_TS },
              { id: staleRiderId, is_online: true, last_online_at: STALE_TS },
            ];
            const ordersByRider = new Map<string, MockOrder[]>([
              [freshRiderId, freshOrders],
              [staleRiderId, staleOrders],
            ]);
            const locationByRider = new Map<string, MockLocation>([
              [freshRiderId, { updated_at: FRESH_TS }],
              [staleRiderId, { updated_at: STALE_TS }],
            ]);
            const updateTracker = new Map<string, Record<string, unknown>>();

            const client = createMockSupabaseClient(
              riders,
              ordersByRider,
              locationByRider,
              updateTracker,
            );

            const result = await runAutoOffDutySweep(client as any, new Date().toISOString());

            // Fresh rider stays online
            expect(result.flipped).not.toContain(freshRiderId);
            expect(result.skipped).toContain(freshRiderId);
            expect(updateTracker.has(freshRiderId)).toBe(false);

            // Stale rider is flipped offline
            expect(result.flipped).toContain(staleRiderId);
            expect(updateTracker.has(staleRiderId)).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    },
    30_000,
  );
});
