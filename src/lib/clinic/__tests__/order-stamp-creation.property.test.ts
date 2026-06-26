// src/lib/clinic/__tests__/order-stamp-creation.property.test.ts
// Feature: core-clinic-architecture, Property 37: Order and batch clinic stamps are set once at creation
//
// Property 37: Order and batch clinic stamps are set once at creation.
// When a Delivery_Order is created, its clinic_id equals the clinic the
// customer's delivery address resolves to at that time (null when unresolved,
// without blocking); when a Delivery_Batch is created during routing, its
// clinic_id equals the routing rider's linked clinic at that time (null when
// unlinked, without blocking). In every case the stamp equals the resolved
// clinic at creation time and is written exactly once.
//
// Validates: Requirements 19.2, 19.3, 19.8, 19.9

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveOrderClinicStamp,
  resolveBatchClinicStamp,
} from "../order-stamp";

// ─── Arbitrary generators ──────────────────────────────────────────────────
// A resolved clinic is a uuid; an unresolved/unlinked one is null. Generating
// either constrains the inputs to the real domain of these pure resolvers:
// `addresses.clinic_id` / `rider_profiles.clinic_id`, both `string | null`.
const arbClinicIdOrNull: fc.Arbitrary<string | null> = fc.oneof(
  fc.uuid(),
  fc.constant(null)
);

describe("Property 37: Order and batch clinic stamps are set once at creation", () => {
  it("order stamp equals the address's resolved clinic (null when unresolved)", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, (addressClinicId) => {
        // Req 19.2: when the delivery address resolves to a clinic, the order
        // stamp is that clinic. Req 19.8: when it resolves to none, the stamp
        // is null (and creation is never blocked — the resolver always returns
        // a value rather than throwing).
        const stamp = resolveOrderClinicStamp(addressClinicId);
        expect(stamp).toBe(addressClinicId);
      }),
      { numRuns: 100 }
    );
  });

  it("batch stamp equals the routing rider's linked clinic (null when unlinked)", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, (riderClinicId) => {
        // Req 19.3: when the routing rider has a linked clinic, the batch stamp
        // is that clinic. Req 19.9: when the rider is unlinked, the stamp is
        // null (and routing/batch creation is never blocked).
        const stamp = resolveBatchClinicStamp(riderClinicId);
        expect(stamp).toBe(riderClinicId);
      }),
      { numRuns: 100 }
    );
  });

  it("both resolvers are total — every input (uuid or null) yields a defined stamp", () => {
    fc.assert(
      fc.property(arbClinicIdOrNull, arbClinicIdOrNull, (addressClinicId, riderClinicId) => {
        // Creation is never blocked: the resolvers return for every input,
        // and a null resolution maps to a null stamp rather than an error.
        const orderStamp = resolveOrderClinicStamp(addressClinicId);
        const batchStamp = resolveBatchClinicStamp(riderClinicId);

        expect(orderStamp === null || typeof orderStamp === "string").toBe(true);
        expect(batchStamp === null || typeof batchStamp === "string").toBe(true);

        // The stamp equals the resolved clinic at creation time in every case.
        expect(orderStamp).toBe(addressClinicId);
        expect(batchStamp).toBe(riderClinicId);
      }),
      { numRuns: 100 }
    );
  });
});
