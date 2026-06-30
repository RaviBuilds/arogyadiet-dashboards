// src/actions/system-actions/__tests__/routing-batch-count.property.test.ts
//
// Feature: core-clinic-architecture, Property 22: One batch per active rider, and total batches equal the sum across clinics
//
// Validates: Requirements 10.2, 10.3
//
// For any collection of clinics, each populated with a set of riders and
// routable orders distributed across those riders' pincodes, the routing engine
// produces exactly one batch per active rider that has at least one routable
// order within a clinic scope, and the total number of batches equals the sum,
// over every clinic, of that clinic's active riders with routable orders.
//
// Strategy: drive the real `executeAutomatedDispatch` (FRANCHISE_FEATURES_ENABLED
// off) against an in-memory fake admin client, forcing the Haversine fallback
// (Google route resolves to null). Every `delivery_batches` insert is captured
// so the test can count batches and inspect their (clinic_id, assigned_rider_id)
// stamps. The engine creates its admin client at module load, so the fake reads
// from a hoisted, mutable state object that each generated case repopulates.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted shared state + captured batch inserts ──────────────────────────
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
    // Each seeded rider's linked clinic, mirroring rider_profiles.clinic_id.
    riderClinics: [] as Array<{ id: string; clinic_id: string | null }>,
    payoutPerKm: 16,
    batchSeq: 1,
  },
  // Every delivery_batches insert payload recorded here.
  batches: [] as Array<{ clinic_id: string | null; assigned_rider_id: string }>,
}));

// ─── Feature flag forced OFF (core per-clinic path) ─────────────────────────
vi.mock("@/lib/franchise/constants", () => ({
  FRANCHISE_FEATURES_ENABLED: false,
}));

// ─── Routing primitives: force the Haversine fallback ───────────────────────
// Google route resolves to null so the engine always falls back to the local
// Haversine route, which returns one leg per order (a non-empty route → the
// rider's batch is committed).
vi.mock("@/lib/routing/googleRoutes", () => ({
  computeOpenLoopRoute: vi.fn(async () => null),
}));

vi.mock("@/lib/distance", () => ({
  computeOpenLoopHaversineRoute: vi.fn(
    (orders: Array<{ id: string }>) => ({
      totalKm: 1,
      expectedPayout: 1,
      legs: orders.map((o, i) => ({
        orderId: o.id,
        routeSequence: i + 1,
        payoutAmount: 1,
      })),
      optimizedWaypointIndex: orders.map((_, i) => i),
    }),
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
        const payload = ctx.payload ?? {};
        h.batches.push({
          clinic_id: payload.clinic_id ?? null,
          assigned_rider_id: payload.assigned_rider_id,
        });
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

    if (t === "rider_profiles") {
      // dispatchScope resolves each grouped rider's linked clinic via
      // .select("id, clinic_id").in("id", riderIds). Return the seeded
      // rider→clinic rows so resolveBatchClinicStamp stamps the batch with
      // the rider's clinic (Req 19.3), matching the per-clinic scope clinic.
      return { data: state.riderClinics, error: null };
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
// A model is a list of clinics; each clinic is a list of riders, where each
// rider carries the number of routable orders it owns (0 = an active rider with
// no routable orders → no batch). A clinic may have zero riders (skipped scope).
const modelArb = fc.array(
  fc.record({
    riders: fc.array(fc.integer({ min: 0, max: 3 }), {
      minLength: 0,
      maxLength: 3,
    }),
  }),
  { minLength: 1, maxLength: 4 },
);

type Scenario = {
  expectedTotal: number;
  expectedPerClinic: Record<string, number>;
};

function loadState(model: Array<{ riders: number[] }>): Scenario {
  h.state.clinics = [];
  h.state.ordersByClinic = new Map();
  h.state.serviceAreasByClinic = new Map();
  h.state.riderClinics = [];
  h.state.batchSeq = 1;
  h.state.payoutPerKm = 16;
  h.batches.length = 0;

  const expectedPerClinic: Record<string, number> = {};
  let expectedTotal = 0;

  // Global, monotonically increasing counters guarantee that every pincode and
  // rider id is unique across the whole model (one pincode → one clinic).
  let pinSeq = 100000;
  let riderSeq = 0;

  model.forEach((clinic, ci) => {
    const clinicId = `clinic-${ci}`;
    // Valid India-range coordinates, distinct per clinic.
    const latitude = 10 + ci * 3; // 10, 13, 16, 19
    const longitude = 75 + ci * 2; // 75, 77, 79, 81

    h.state.clinics.push({
      id: clinicId,
      name: `Clinic ${ci}`,
      latitude,
      longitude,
    });

    const serviceAreas: Array<{ pincode: string; rider_id: string }> = [];
    const orders: any[] = [];
    let clinicBatches = 0;

    clinic.riders.forEach((orderCount, ri) => {
      const riderId = `rider-${riderSeq++}`;
      const pincode = String(++pinSeq);

      // Every rider (even one with zero orders) owns a service-area pincode,
      // confirming that an active rider with no routable orders yields no batch.
      serviceAreas.push({ pincode, rider_id: riderId });

      // Mirror rider_profiles.clinic_id: this rider is linked to the clinic it
      // serves, so the engine's batch clinic stamp resolves to this clinic.
      h.state.riderClinics.push({ id: riderId, clinic_id: clinicId });

      for (let o = 0; o < orderCount; o++) {
        orders.push({
          id: `${clinicId}-r${ri}-o${o}`,
          customer_profile_id: null,
          delivery_address_id: `${clinicId}-r${ri}-addr${o}`,
          addresses: {
            id: `${clinicId}-r${ri}-addr${o}`,
            pincode,
            lat: latitude + 0.01 * (o + 1),
            lng: longitude + 0.01 * (o + 1),
            city: "City",
            state: "State",
          },
          clinic_id: clinicId,
        });
      }

      if (orderCount > 0) {
        clinicBatches += 1;
        expectedTotal += 1;
      }
    });

    h.state.serviceAreasByClinic.set(clinicId, serviceAreas);
    h.state.ordersByClinic.set(clinicId, orders);
    expectedPerClinic[clinicId] = clinicBatches;
  });

  return { expectedTotal, expectedPerClinic };
}

// ─── Property test ───────────────────────────────────────────────────────────
describe("Routing engine - one-batch-per-rider / total batch count property", () => {
  beforeEach(() => {
    h.batches.length = 0;
  });

  it("Property 22: exactly one batch per active rider with orders; total = sum across clinics", async () => {
    await fc.assert(
      fc.asyncProperty(modelArb, async (model) => {
        const { expectedTotal, expectedPerClinic } = loadState(model);

        await executeAutomatedDispatch("2099-01-01");

        const batches = h.batches;

        // (a) Total batch count equals the number of (clinic, rider) pairs that
        //     have at least one routable order — i.e. the sum, across all
        //     clinics, of that clinic's active riders with routable orders.
        expect(batches.length).toBe(expectedTotal);

        // (b) The total equals the sum of the per-clinic active-rider counts.
        const sumAcrossClinics = Object.values(expectedPerClinic).reduce(
          (acc, n) => acc + n,
          0,
        );
        expect(batches.length).toBe(sumAcrossClinics);

        // (c) Each clinic scope produced exactly one batch per active rider
        //     with orders (and zero for clinics/riders without orders).
        const perClinicActual: Record<string, number> = {};
        for (const b of batches) {
          const cid = b.clinic_id ?? "__null__";
          perClinicActual[cid] = (perClinicActual[cid] ?? 0) + 1;
        }
        for (const [clinicId, expected] of Object.entries(expectedPerClinic)) {
          expect(perClinicActual[clinicId] ?? 0).toBe(expected);
        }

        // (d) No rider receives more than one batch — "exactly one batch per
        //     active rider", even when that rider owns several orders.
        const perRiderActual: Record<string, number> = {};
        for (const b of batches) {
          perRiderActual[b.assigned_rider_id] =
            (perRiderActual[b.assigned_rider_id] ?? 0) + 1;
        }
        for (const count of Object.values(perRiderActual)) {
          expect(count).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
