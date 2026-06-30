// src/lib/__tests__/payout-formula.property.test.ts
// Feature: core-clinic-architecture, Property 23: Rider payout formula
//
// Property 23: Rider payout formula
// For any clinic origin, ordered list of stops, and Payout_Per_Km, the computed
// payout equals the sum of per-leg distances — each leg = Haversine distance ×
// 1.3, covering clinic origin→first stop and each consecutive stop→stop —
// multiplied by Payout_Per_Km and rounded to two decimals.
//
// Validates: Requirements 10.4

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computeOpenLoopHaversineRoute,
  type RoutableOrder,
} from "@/lib/distance";

// ─── Independent reference implementation ───────────────────────────────────
// Mirrors the repo's Haversine constants/formula exactly (R = 6371 km, the same
// sequence of arithmetic operations) so the reference is bit-for-bit comparable
// with the implementation under test. This is a metamorphic / model-based
// property: payout computed by the engine is checked against this independent
// open-loop reference rather than against a hand-picked expected number.

const EARTH_RADIUS_KM = 6371;
const HAVERSINE_MULTIPLIER = 1.3;

function referenceHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

type ReferenceRoute = {
  totalKm: number;
  expectedPayout: number;
  legs: { orderId: string; routeSequence: number; payoutAmount: number }[];
};

/**
 * Computes the open-loop payout over an ALREADY-ORDERED list of stops, starting
 * from the clinic origin. The implementation reorders stops (nearest-neighbor
 * with the farthest stop last) and exposes that order via
 * `optimizedWaypointIndex`; we reconstruct the same visited order so this
 * reference isolates the PAYOUT FORMULA (Property 23) from the ordering
 * heuristic.
 */
function referenceOpenLoopPayout(
  orderedStops: RoutableOrder[],
  originLat: number,
  originLng: number,
  payoutPerKm: number,
): ReferenceRoute {
  let currentLat = originLat;
  let currentLng = originLng;
  let totalKm = 0;

  const legs = orderedStops.map((stop, index) => {
    const straightLine = referenceHaversineKm(
      currentLat,
      currentLng,
      stop.lat,
      stop.lng,
    );
    const roadKm = straightLine * HAVERSINE_MULTIPLIER;
    totalKm += roadKm;
    currentLat = stop.lat;
    currentLng = stop.lng;

    return {
      orderId: stop.id,
      routeSequence: index + 1,
      payoutAmount: Number((roadKm * payoutPerKm).toFixed(2)),
    };
  });

  return {
    totalKm: Number(totalKm.toFixed(2)),
    expectedPayout: Number(
      legs.reduce((s, l) => s + l.payoutAmount, 0).toFixed(2),
    ),
    legs,
  };
}

// ─── Arbitrary generators ───────────────────────────────────────────────────
// Constrain coordinates to valid lat/lng ranges and payout-per-km to a sane,
// strictly positive setting (the real `rider_payout_per_km` default is 16).

const arbLat = fc.double({
  min: -90,
  max: 90,
  noNaN: true,
  noDefaultInfinity: true,
});
const arbLng = fc.double({
  min: -180,
  max: 180,
  noNaN: true,
  noDefaultInfinity: true,
});
const arbCoord = fc.record({ lat: arbLat, lng: arbLng });

const arbPayoutPerKm = fc.double({
  min: 0.5,
  max: 500,
  noNaN: true,
  noDefaultInfinity: true,
});

// 1..10 stops. Ids are assigned by index to guarantee uniqueness, which the
// implementation relies on when mapping `optimizedWaypointIndex` back to stops.
const arbStops = fc
  .array(arbCoord, { minLength: 1, maxLength: 10 })
  .map((coords) =>
    coords.map((c, i) => ({ id: `stop-${i}`, lat: c.lat, lng: c.lng })),
  );

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Property 23: Rider payout formula", () => {
  it("payout equals the open-loop Haversine×1.3×payoutPerKm reference over the routed order", () => {
    fc.assert(
      fc.property(
        arbCoord, // clinic origin
        arbStops,
        arbPayoutPerKm,
        (origin, stops, payoutPerKm) => {
          const result = computeOpenLoopHaversineRoute(
            stops,
            origin.lat,
            origin.lng,
            payoutPerKm,
          );

          // Reconstruct the exact order the engine visited stops in, so the
          // reference walks the same legs (origin→first→…→last).
          const visited = result.optimizedWaypointIndex.map((i) => stops[i]);
          const reference = referenceOpenLoopPayout(
            visited,
            origin.lat,
            origin.lng,
            payoutPerKm,
          );

          // Sanity: the engine routed every stop exactly once.
          expect(result.optimizedWaypointIndex.length).toBe(stops.length);
          expect(new Set(result.optimizedWaypointIndex).size).toBe(stops.length);

          // Core of Property 23: total payout matches the reference formula.
          expect(result.expectedPayout).toBe(reference.expectedPayout);
          // And the per-leg distance accumulation (×1.3) matches.
          expect(result.totalKm).toBe(reference.totalKm);

          // Each leg's payout = Haversine×1.3×payoutPerKm rounded to 2 decimals.
          expect(result.legs).toHaveLength(reference.legs.length);
          result.legs.forEach((leg, idx) => {
            expect(leg.orderId).toBe(reference.legs[idx].orderId);
            expect(leg.routeSequence).toBe(reference.legs[idx].routeSequence);
            expect(leg.payoutAmount).toBe(reference.legs[idx].payoutAmount);
          });

          // The per-leg payout amounts sum to the total (reference) payout.
          const sumOfLegPayouts = result.legs.reduce(
            (sum, leg) => sum + leg.payoutAmount,
            0,
          );
          const referenceLegSum = reference.legs.reduce(
            (sum, leg) => sum + leg.payoutAmount,
            0,
          );
          expect(Number(sumOfLegPayouts.toFixed(2))).toBe(
            Number(referenceLegSum.toFixed(2)),
          );

          // Option C core invariant: the aggregate payout EQUALS the sum of the
          // per-leg payoutAmounts, rounded to 2 decimals.
          expect(result.expectedPayout).toBe(
            Number(sumOfLegPayouts.toFixed(2)),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("each leg payout is exactly Haversine×1.3×payoutPerKm rounded to 2 decimals (single stop)", () => {
    fc.assert(
      fc.property(
        arbCoord,
        arbCoord,
        arbPayoutPerKm,
        (origin, stop, payoutPerKm) => {
          const orders: RoutableOrder[] = [
            { id: "only-stop", lat: stop.lat, lng: stop.lng },
          ];
          const result = computeOpenLoopHaversineRoute(
            orders,
            origin.lat,
            origin.lng,
            payoutPerKm,
          );

          const straightLine = referenceHaversineKm(
            origin.lat,
            origin.lng,
            stop.lat,
            stop.lng,
          );
          const roadKm = straightLine * HAVERSINE_MULTIPLIER;
          const expectedLegPayout = Number((roadKm * payoutPerKm).toFixed(2));

          expect(result.legs).toHaveLength(1);
          expect(result.legs[0].payoutAmount).toBe(expectedLegPayout);
          expect(result.legs[0].routeSequence).toBe(1);
          // Option C: aggregate payout equals the single leg's payoutAmount.
          expect(result.expectedPayout).toBe(expectedLegPayout);
        },
      ),
      { numRuns: 200 },
    );
  });
});
