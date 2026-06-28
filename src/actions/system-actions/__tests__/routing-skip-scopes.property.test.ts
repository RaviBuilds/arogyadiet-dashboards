// src/actions/system-actions/__tests__/routing-skip-scopes.property.test.ts
//
// Feature: core-clinic-architecture, Property 25: Routing skips degenerate and invalid scopes without aborting
//
// Property 25: Routing skips degenerate and invalid scopes without aborting —
// A clinic scope with zero routable orders or zero active riders is skipped
// without raising an error; a clinic with missing or out-of-range coordinates
// is skipped with an error indication identifying that clinic; in both cases
// the remaining valid clinic scopes are still routed.
//
// **Validates: Requirements 10.6, 10.7**
//
// Strategy: drive `executeAutomatedDispatch` (the real per-clinic core path,
// FRANCHISE_FEATURES_ENABLED forced off) against an in-memory fake
// `createAdminClient`. Each generated scenario mixes three clinic kinds:
//   (a) invalid/missing coordinates  → must land in stats.skippedClinics (10.7)
//   (b) valid coords but zero orders OR zero active riders → skipped silently,
//       no batch, no error, NOT in skippedClinics (10.6)
//   (c) at least one fully valid clinic (orders + mapped active rider) → routed
// External collaborators (Google Routes, Haversine, geocoding, IST helpers,
// notifications, next/cache) are stubbed so routing logic runs in isolation.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Hoisted in-memory DB holder shared with the admin-client mock ───────────
const h = vi.hoisted(() => ({ db: null as Record<string, any[]> | null }));

// ─── Mock: feature flag OFF (per-clinic core path) ───────────────────────────
vi.mock("@/lib/franchise/constants", () => ({
  FRANCHISE_FEATURES_ENABLED: false,
}));

// ─── Mock: Supabase admin client backed by the hoisted in-memory DB ──────────
vi.mock("@/lib/supabase/admin", () => {
  let idCounter = 0;

  type Filter =
    | { type: "eq"; col: string; val: unknown }
    | { type: "in"; col: string; vals: unknown[] }
    | { type: "is"; col: string; val: unknown }
    | { type: "notnull"; col: string };

  function matches(row: Record<string, unknown>, filters: Filter[]) {
    return filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "in") return f.vals.includes(row[f.col]);
      if (f.type === "is") return row[f.col] === f.val;
      // notnull
      return row[f.col] !== null && row[f.col] !== undefined;
    });
  }

  function createQuery(table: string) {
    const filters: Filter[] = [];
    let action: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let payload: Record<string, unknown> | Record<string, unknown>[] = {};

    const tableRows = () => (h.db && h.db[table] ? h.db[table] : []);

    const run = async () => {
      const rows = tableRows();

      if (action === "update") {
        const matched = rows.filter((r) => matches(r, filters));
        for (const r of matched) Object.assign(r, payload);
        return { data: matched, error: null, count: matched.length };
      }

      if (action === "delete") {
        const survivors: Record<string, unknown>[] = [];
        for (const r of rows) {
          if (!matches(r, filters)) survivors.push(r);
        }
        if (h.db) h.db[table] = survivors;
        return { data: null, error: null };
      }

      if (action === "insert" || action === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload];
        const inserted = list.map((p) => {
          const row: Record<string, unknown> = { ...p };
          if (row.id === undefined) row.id = `${table}-${++idCounter}`;
          rows.push(row);
          return row;
        });
        if (h.db && !h.db[table]) h.db[table] = rows;
        return { data: inserted, error: null };
      }

      // select
      const matched = rows.filter((r) => matches(r, filters));
      return { data: matched, error: null };
    };

    const api: any = {
      select() {
        // `.select()` after a mutation is a RETURNING clause; before is a read.
        if (action === "select") action = "select";
        return api;
      },
      update(values: Record<string, unknown>) {
        action = "update";
        payload = values;
        return api;
      },
      insert(values: Record<string, unknown> | Record<string, unknown>[]) {
        action = "insert";
        payload = values;
        return api;
      },
      upsert(values: Record<string, unknown> | Record<string, unknown>[]) {
        action = "upsert";
        payload = values;
        return api;
      },
      delete() {
        action = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ type: "eq", col, val });
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push({ type: "in", col, vals });
        return api;
      },
      is(col: string, val: unknown) {
        filters.push({ type: "is", col, val });
        return api;
      },
      not(col: string, _op: string, _val: unknown) {
        filters.push({ type: "notnull", col });
        return api;
      },
      async single() {
        const r = await run();
        const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
        return { data: arr[0] ?? null, error: r.error ?? null };
      },
      async maybeSingle() {
        const r = await run();
        const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
        return { data: arr[0] ?? null, error: r.error ?? null };
      },
      then<T1 = unknown, T2 = never>(
        onFulfilled?: ((value: unknown) => T1 | PromiseLike<T1>) | null,
        onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ): Promise<T1 | T2> {
        return run().then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return {
    createAdminClient: () => ({ from: (table: string) => createQuery(table) }),
  };
});

// ─── Mock: Google Routes returns null so the Haversine fallback is used ──────
vi.mock("@/lib/routing/googleRoutes", () => ({
  computeOpenLoopRoute: vi.fn(async () => null),
}));

// ─── Mock: Haversine route — a deterministic, well-formed committed route ────
vi.mock("@/lib/distance", () => ({
  computeOpenLoopHaversineRoute: (
    orders: { id: string }[],
    _originLat: number,
    _originLng: number,
    _payoutPerKm: number
  ) => ({
    totalKm: orders.length * 2,
    expectedPayout: orders.length * 10,
    legs: orders.map((o, i) => ({
      orderId: o.id,
      routeSequence: i + 1,
      payoutAmount: 10,
    })),
  }),
}));

// ─── Mock: geocoding always resolves coordinates (no pincode fallback) ───────
vi.mock("@/lib/geocoding", () => ({
  resolveAddressCoordinates: vi.fn(async () => ({
    coords: { lat: 17.4, lng: 78.4 },
    usedPincodeFallback: false,
  })),
}));

// ─── Mock: IST helpers (deterministic, future departure) ─────────────────────
vi.mock("@/lib/dates/ist", () => ({
  DEFAULT_RIDER_DEPARTURE_TIME_IST: "05:00:00",
  buildISTDepartureISO: () => "2999-01-01T05:00:00+05:30",
  isFutureISO8601: () => true,
}));

// ─── Mock: notifications + next/cache (inert side effects) ───────────────────
vi.mock("@/lib/delivery/deliveryStatusNotifications", () => ({
  notifyRoutingAssignmentComplete: vi.fn(async () => {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { executeAutomatedDispatch } from "../routeEngine";

const TARGET_DATE = "2025-01-15";

// ─── Generators ──────────────────────────────────────────────────────────────

// Coordinates that must fail the engine's validity check (null or out-of-range).
const arbInvalidCoords = fc.constantFrom(
  { latitude: null, longitude: 78.4 },
  { latitude: 17.4, longitude: null },
  { latitude: null, longitude: null },
  { latitude: 200, longitude: 78.4 },
  { latitude: 17.4, longitude: 500 },
  { latitude: -91, longitude: 78.4 },
  { latitude: 17.4, longitude: -181 }
);

const arbInvalidClinics = fc.array(arbInvalidCoords, {
  minLength: 1,
  maxLength: 3,
});

// Degenerate-but-valid clinics: either no orders, or orders with no rider.
const arbDegenerateClinics = fc.array(
  fc.constantFrom<"noOrders" | "noRiders">("noOrders", "noRiders"),
  { minLength: 1, maxLength: 3 }
);

// Fully valid clinics, each with 1..3 routable orders + one mapped active rider.
const arbValidClinics = fc.array(fc.integer({ min: 1, max: 3 }), {
  minLength: 1,
  maxLength: 2,
});

type Scenario = {
  invalidClinicIds: string[];
  degenerateClinicIds: string[];
  validClinicIds: string[];
};

function buildDb(
  invalid: { latitude: number | null; longitude: number | null }[],
  degenerate: ("noOrders" | "noRiders")[],
  valid: number[]
): Scenario {
  let seq = 0;
  const pin = () => String(500000 + seq++); // unique 6-digit pincode

  const clinics: any[] = [];
  const delivery_orders: any[] = [];
  const rider_service_areas: any[] = [];

  const invalidClinicIds: string[] = [];
  const degenerateClinicIds: string[] = [];
  const validClinicIds: string[] = [];

  invalid.forEach((c, i) => {
    const id = `inv-${i}`;
    invalidClinicIds.push(id);
    clinics.push({
      id,
      name: `Invalid Clinic ${i}`,
      latitude: c.latitude,
      longitude: c.longitude,
      franchise_id: null,
    });
  });

  degenerate.forEach((kind, i) => {
    const id = `deg-${i}`;
    degenerateClinicIds.push(id);
    clinics.push({
      id,
      name: `Degenerate Clinic ${i}`,
      latitude: 17.4,
      longitude: 78.4,
      franchise_id: null,
    });
    if (kind === "noRiders") {
      // Orders exist but no rider_service_areas → zero active riders.
      const pincode = pin();
      delivery_orders.push({
        id: `ord-${id}-0`,
        clinic_id: id,
        delivery_date: TARGET_DATE,
        status: "ORDER_CREATED",
        batch_id: null,
        customer_profile_id: `cust-${id}-0`,
        delivery_address_id: `addr-${id}-0`,
        addresses: {
          id: `addr-${id}-0`,
          pincode,
          lat: 17.4,
          lng: 78.4,
          city: "Hyderabad",
          state: "TS",
        },
      });
    }
    // "noOrders": leave delivery_orders empty for this clinic.
  });

  valid.forEach((orderCount, i) => {
    const id = `val-${i}`;
    validClinicIds.push(id);
    clinics.push({
      id,
      name: `Valid Clinic ${i}`,
      latitude: 17.45,
      longitude: 78.45,
      franchise_id: null,
    });
    const pincode = pin();
    rider_service_areas.push({
      pincode,
      rider_id: `rider-${id}`,
      clinic_id: id,
    });
    for (let o = 0; o < orderCount; o++) {
      delivery_orders.push({
        id: `ord-${id}-${o}`,
        clinic_id: id,
        delivery_date: TARGET_DATE,
        status: "ORDER_CREATED",
        batch_id: null,
        customer_profile_id: `cust-${id}-${o}`,
        delivery_address_id: `addr-${id}-${o}`,
        addresses: {
          id: `addr-${id}-${o}`,
          pincode,
          lat: 17.45,
          lng: 78.45,
          city: "Hyderabad",
          state: "TS",
        },
      });
    }
  });

  h.db = {
    clinics,
    delivery_orders,
    delivery_batches: [],
    rider_service_areas,
    delivery_status_logs: [],
    automation_logs: [],
    system_settings: [{ id: "global", rider_payout_per_km: 16 }],
    fixed_rider_assignments: [],
    addresses: [],
  };

  return { invalidClinicIds, degenerateClinicIds, validClinicIds };
}

// ─── Property Test ────────────────────────────────────────────────────────────

describe("executeAutomatedDispatch - Property 25: skips degenerate and invalid scopes without aborting", () => {
  beforeAll(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
  });

  beforeEach(() => {
    h.db = null;
  });

  it("invalid-coord clinics are recorded as skipped, degenerate clinics are silently skipped, and valid clinics still route", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInvalidClinics,
        arbDegenerateClinics,
        arbValidClinics,
        async (invalid, degenerate, valid) => {
          const { invalidClinicIds, degenerateClinicIds, validClinicIds } =
            buildDb(invalid, degenerate, valid);

          const result: any = await executeAutomatedDispatch(TARGET_DATE);

          // The run resolves successfully — at least one valid scope routed,
          // so degenerate/invalid scopes never abort the whole run (10.6/10.7).
          expect(result.error).toBeUndefined();
          expect(result.success).toBe(true);
          expect(result.stats).toBeDefined();

          const stats = result.stats;
          const skippedIds = stats.skippedClinics.map(
            (s: { clinicId: string }) => s.clinicId
          );

          // (10.7) Every invalid-coord clinic appears in skippedClinics, by id,
          // with an identifying name and reason.
          for (const id of invalidClinicIds) {
            expect(skippedIds).toContain(id);
            const entry = stats.skippedClinics.find(
              (s: { clinicId: string }) => s.clinicId === id
            );
            expect(entry).toBeTruthy();
            expect(typeof entry.reason).toBe("string");
            expect(entry.reason.length).toBeGreaterThan(0);
          }

          // skippedClinics contains ONLY the invalid clinics — degenerate but
          // coordinate-valid clinics are never recorded as skipped (10.6).
          expect(skippedIds.sort()).toEqual([...invalidClinicIds].sort());

          // (10.6) Degenerate clinics produce no batch and no error. They are
          // valid-coordinate scopes, so they appear in the scope list with a
          // zero batch count, and never in skippedClinics.
          const scopeById = new Map<string, any>(
            stats.scopes.map((sc: any) => [sc.clinicId, sc])
          );
          for (const id of degenerateClinicIds) {
            expect(skippedIds).not.toContain(id);
            const sc = scopeById.get(id);
            expect(sc).toBeTruthy();
            expect(sc.batchesCreated).toBe(0);
          }

          // No rider-level routing errors were raised anywhere (10.6).
          expect(stats.riderErrors).toEqual([]);

          // (10.6) Valid clinics still routed: each created at least one batch.
          for (const id of validClinicIds) {
            const sc = scopeById.get(id);
            expect(sc).toBeTruthy();
            expect(sc.batchesCreated).toBeGreaterThanOrEqual(1);
          }
          expect(stats.batchesCreated).toBeGreaterThanOrEqual(
            validClinicIds.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
