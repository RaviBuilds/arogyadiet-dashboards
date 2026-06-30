// src/actions/system-actions/__tests__/routing-clinic-origin.property.test.ts
//
// Feature: core-clinic-architecture, Property 21: Routing uses each clinic as its own origin, never the kitchen
//
// Validates: Requirements 10.1, 2.7, 3.11
//
// For any set of clinics with valid coordinates, the routing engine builds one
// independent scope per clinic whose route origin coordinate equals that
// clinic's stored latitude/longitude, and never uses kitchen coordinates as
// the routing origin.
//
// Strategy: drive the real `executeAutomatedDispatch` (FRANCHISE_FEATURES_ENABLED
// off) against an in-memory fake admin client, and capture the (originLat,
// originLng) passed to the routing primitives. The engine creates its admin
// client at module load, so the fake reads from a hoisted, mutable state object
// that each generated case repopulates.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted shared state + recorded routing-origin calls ───────────────────
const h = vi.hoisted(() => ({
  state: {
    clinics: [] as Array<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
    }>,
    ordersByClinic: new Map<string, any[]>(),
    serviceAreasByClinic: new Map<
      string,
      Array<{ pincode: string; rider_id: string }>
    >(),
    payoutPerKm: 16,
    batchSeq: 1,
  },
  calls: {
    google: [] as Array<{ lat: number; lng: number }>,
    haversine: [] as Array<{ lat: number; lng: number }>,
  },
}));

// ─── Feature flag forced OFF (core per-clinic path) ─────────────────────────
vi.mock("@/lib/franchise/constants", () => ({
  FRANCHISE_FEATURES_ENABLED: false,
}));

// ─── Routing primitives: record the origin they are invoked with ────────────
vi.mock("@/lib/routing/googleRoutes", () => ({
  computeOpenLoopRoute: vi.fn(
    async (
      originLat: number,
      originLng: number,
      stops: Array<{ id: string }>,
    ) => {
      h.calls.google.push({ lat: originLat, lng: originLng });
      return {
        totalKm: 1,
        expectedPayout: 1,
        legs: stops.map((s, i) => ({
          orderId: s.id,
          routeSequence: i + 1,
          payoutAmount: 1,
        })),
        optimizedWaypointIndex: stops.map((_, i) => i),
      };
    },
  ),
}));

vi.mock("@/lib/distance", () => ({
  computeOpenLoopHaversineRoute: vi.fn(
    (
      orders: Array<{ id: string }>,
      originLat: number,
      originLng: number,
    ) => {
      h.calls.haversine.push({ lat: originLat, lng: originLng });
      return {
        totalKm: 1,
        expectedPayout: 1,
        legs: orders.map((o, i) => ({
          orderId: o.id,
          routeSequence: i + 1,
          payoutAmount: 1,
        })),
        optimizedWaypointIndex: orders.map((_, i) => i),
      };
    },
  ),
}));

// ─── Geocoding: trust the stored address coordinates ────────────────────────
vi.mock("@/lib/geocoding", () => ({
  resolveAddressCoordinates: vi.fn(async (address: any) => {
    if (address && address.lat != null && address.lng != null) {
      return {
        coords: { lat: Number(address.lat), lng: Number(address.lng) },
        usedPincodeFallback: false,
      };
    }
    return null;
  }),
}));

// ─── IST helpers / notifications / cache: inert ─────────────────────────────
vi.mock("@/lib/dates/ist", () => ({
  buildISTDepartureISO: () => "2099-01-01T05:00:00+05:30",
  isFutureISO8601: () => true,
  DEFAULT_RIDER_DEPARTURE_TIME_IST: "05:00:00",
}));

vi.mock("@/lib/delivery/deliveryStatusNotifications", () => ({
  notifyRoutingAssignmentComplete: vi.fn(async () => {}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ─── In-memory fake admin client backed by hoisted state ────────────────────
vi.mock("@/lib/supabase/admin", () => {
  const state = h.state;

  function resolveResult(ctx: any) {
    const t = ctx.table;

    if (t === "system_settings") {
      return { data: { rider_payout_per_km: state.payoutPerKm }, error: null };
    }
    if (t === "fixed_rider_assignments") {
      return { data: [], error: null };
    }
    if (t === "clinics") {
      return { data: state.clinics, error: null };
    }
    if (t === "automation_logs") {
      if (ctx.op === "select") return { data: null, error: null };
      return { error: null };
    }
    if (t === "delivery_status_logs") return { error: null };
    if (t === "addresses") return { error: null };

    if (t === "delivery_batches") {
      if (ctx.op === "insert") {
        return { data: { id: `batch-${state.batchSeq++}` }, error: null };
      }
      if (ctx.op === "delete") return { error: null };
      // pending-batch lookup during reset
      return { data: [], error: null };
    }

    if (t === "delivery_orders") {
      if (ctx.op === "update") {
        // reset query returns the (empty) set of reset orders; per-leg update
        // (filtered by id, no returning select) returns nothing.
        return { data: ctx.returning ? [] : null, error: null };
      }
      if (ctx.op === "select") {
        // reset's active-batch reference probe: select("batch_id")
        if (
          ctx.selectArgs &&
          ctx.selectArgs.length === 1 &&
          ctx.selectArgs[0] === "batch_id"
        ) {
          return { data: [], error: null };
        }
        // scope orders for a specific clinic
        const clinicId = ctx.eqs["clinic_id"];
        return { data: state.ordersByClinic.get(clinicId) ?? [], error: null };
      }
    }

    if (t === "rider_service_areas") {
      const clinicId = ctx.eqs["clinic_id"];
      return {
        data: state.serviceAreasByClinic.get(clinicId) ?? [],
        error: null,
      };
    }

    return { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const ctx: any = {
      table,
      op: "select",
      selectArgs: null,
      returning: false,
      eqs: {} as Record<string, unknown>,
    };
    const b: any = {
      select(...args: unknown[]) {
        ctx.selectArgs = args;
        ctx.returning = true;
        return b;
      },
      update(payload: unknown) {
        ctx.op = "update";
        ctx.payload = payload;
        return b;
      },
      insert(payload: unknown) {
        ctx.op = "insert";
        ctx.payload = payload;
        return b;
      },
      upsert(payload: unknown) {
        ctx.op = "upsert";
        ctx.payload = payload;
        return b;
      },
      delete() {
        ctx.op = "delete";
        return b;
      },
      eq(key: string, value: unknown) {
        ctx.eqs[key] = value;
        return b;
      },
      in() {
        return b;
      },
      is() {
        return b;
      },
      not() {
        return b;
      },
      single() {
        return Promise.resolve(resolveResult(ctx));
      },
      maybeSingle() {
        return Promise.resolve(resolveResult(ctx));
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(resolveResult(ctx)).then(
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
import { executeAutomatedDispatch } from "../routeEngine";

beforeAll(() => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});

// ─── Generators ─────────────────────────────────────────────────────────────
// Distinct clinics with valid (India-range) coordinates. Coordinates are kept
// unique across clinics so each routed origin maps unambiguously to one clinic.
const clinicSetArb = fc
  .uniqueArray(
    fc.record({
      latSeed: fc.integer({ min: 0, max: 480 }),
      lngSeed: fc.integer({ min: 0, max: 480 }),
      orderCount: fc.integer({ min: 1, max: 3 }),
    }),
    {
      minLength: 1,
      maxLength: 5,
      selector: (r) => `${r.latSeed},${r.lngSeed}`,
    },
  )
  .map((rows) =>
    rows.map((r, i) => ({
      id: `clinic-${i}`,
      name: `Clinic ${i}`,
      pincode: String(500000 + i),
      // 8..32 lat, 69..93 lng — comfortably inside the valid coordinate window.
      latitude: 8 + r.latSeed * 0.05,
      longitude: 69 + r.lngSeed * 0.05,
      orderCount: r.orderCount,
    })),
  );

function loadState(
  clinics: Array<{
    id: string;
    name: string;
    pincode: string;
    latitude: number;
    longitude: number;
    orderCount: number;
  }>,
) {
  h.state.clinics = clinics.map((c) => ({
    id: c.id,
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
  }));
  h.state.ordersByClinic = new Map();
  h.state.serviceAreasByClinic = new Map();
  h.state.batchSeq = 1;
  h.state.payoutPerKm = 16;

  clinics.forEach((c, ci) => {
    const riderId = `rider-${ci}`;
    h.state.serviceAreasByClinic.set(c.id, [
      { pincode: c.pincode, rider_id: riderId },
    ]);

    const orders: any[] = [];
    for (let o = 0; o < c.orderCount; o++) {
      orders.push({
        id: `${c.id}-order-${o}`,
        customer_profile_id: null,
        delivery_address_id: `${c.id}-addr-${o}`,
        // Stop coordinates deliberately differ from the clinic origin.
        addresses: {
          id: `${c.id}-addr-${o}`,
          pincode: c.pincode,
          lat: c.latitude + 0.01,
          lng: c.longitude + 0.01,
          city: "City",
          state: "State",
        },
        clinic_id: c.id,
      });
    }
    h.state.ordersByClinic.set(c.id, orders);
  });

  h.calls.google.length = 0;
  h.calls.haversine.length = 0;
}

// ─── Property test ───────────────────────────────────────────────────────────
describe("Routing engine - clinic-origin property", () => {
  beforeEach(() => {
    h.calls.google.length = 0;
    h.calls.haversine.length = 0;
  });

  it("Property 21: each clinic scope routes from its own coordinates, never a kitchen coordinate", async () => {
    await fc.assert(
      fc.asyncProperty(clinicSetArb, async (clinics) => {
        loadState(clinics);

        await executeAutomatedDispatch("2099-01-01");

        const allOrigins = [...h.calls.google, ...h.calls.haversine];

        // At least one routing call happened (every clinic has orders + rider).
        expect(allOrigins.length).toBeGreaterThan(0);

        const clinicOriginKeys = new Set(
          clinics.map((c) => `${c.latitude},${c.longitude}`),
        );

        // (a) Every routing origin used belongs to some clinic — never an
        //     unrelated (e.g. kitchen) coordinate.
        for (const call of allOrigins) {
          expect(clinicOriginKeys.has(`${call.lat},${call.lng}`)).toBe(true);
        }

        // (b) Each clinic routed from EXACTLY its own stored lat/lng.
        for (const c of clinics) {
          const routedFromOwnOrigin = allOrigins.some(
            (call) => call.lat === c.latitude && call.lng === c.longitude,
          );
          expect(routedFromOwnOrigin).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
