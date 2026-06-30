// src/lib/__tests__/route-sequence.property.test.ts
// Feature: core-clinic-architecture, Property 24: Route sequence is a gapless 1..n ordering
//
// Property 24: Route sequence is a gapless 1..n ordering.
// For any batch of n stops, the route_sequence values assigned by the
// open-loop Haversine routing engine are exactly the consecutive integers
// 1..n in delivery order — with no gaps and no duplicates, and exactly one
// leg per input stop.
//
// Validates: Requirements 10.5

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computeOpenLoopHaversineRoute,
  type RoutableOrder,
} from "../distance";

// ─── Arbitrary generators ──────────────────────────────────────────────────
// Coordinates are constrained to valid lat/lng ranges so the Haversine math is
// well-defined. Stop ids are unique so legs map one-to-one to input stops.
const arbLat = fc.double({ min: -90, max: 90, noNaN: true });
const arbLng = fc.double({ min: -180, max: 180, noNaN: true });

// A batch of n stops (n from 1..20, matching MAX_STOPS_PER_RIDER) with
// guaranteed-unique ids so we can assert one leg per distinct stop.
const arbBatch: fc.Arbitrary<RoutableOrder[]> = fc
  .uniqueArray(
    fc.record({ id: fc.uuid(), lat: arbLat, lng: arbLng }),
    {
      minLength: 1,
      maxLength: 20,
      selector: (stop) => stop.id,
    }
  );

// An origin coordinate (the clinic) for the open-loop route.
const arbOrigin = fc.record({ lat: arbLat, lng: arbLng });

// payout_per_km is a positive system setting; its exact value does not affect
// the sequence, but we vary it to exercise the function across realistic input.
const arbPayoutPerKm = fc.double({ min: 1, max: 100, noNaN: true });

describe("Property 24: Route sequence is a gapless 1..n ordering", () => {
  it("assigns route_sequence values that are exactly 1..n with no gaps or duplicates", () => {
    fc.assert(
      fc.property(
        arbBatch,
        arbOrigin,
        arbPayoutPerKm,
        (stops, origin, payoutPerKm) => {
          const route = computeOpenLoopHaversineRoute(
            stops,
            origin.lat,
            origin.lng,
            payoutPerKm
          );

          const n = stops.length;

          // Exactly one leg per input stop.
          expect(route.legs).toHaveLength(n);

          // The route_sequence values, sorted ascending, are exactly the
          // consecutive integers 1..n: gapless and duplicate-free.
          const sortedSequences = route.legs
            .map((leg) => leg.routeSequence)
            .sort((a, b) => a - b);
          const expected = Array.from({ length: n }, (_, i) => i + 1);
          expect(sortedSequences).toEqual(expected);

          // Equivalently: no duplicates (the set has n members) and the legs in
          // delivery order are already numbered 1..n consecutively.
          const uniqueSequences = new Set(
            route.legs.map((leg) => leg.routeSequence)
          );
          expect(uniqueSequences.size).toBe(n);
          route.legs.forEach((leg, index) => {
            expect(leg.routeSequence).toBe(index + 1);
          });

          // Every routed stop corresponds to one of the input stops (one leg
          // per input stop, no fabricated stops).
          const inputIds = new Set(stops.map((s) => s.id));
          const legIds = new Set(route.legs.map((leg) => leg.orderId));
          expect(legIds.size).toBe(n);
          for (const id of legIds) {
            expect(inputIds.has(id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
