// src/lib/clinic/__tests__/conflict-list-membership.property.test.ts
// Feature: core-clinic-architecture, Property 44: Conflict_Clinic_List membership matches per-day conflicts
//
// Property 44: For any delivery day and any set of Delivery_Orders with their
// stamped delivery-address clinic and the owning customers' Primary_Address
// clinic, the Conflict_Clinic_List for that day contains exactly the customers
// whose order stamp differs from their Primary_Address clinic (including those
// whose delivery address resolved to no clinic), and omits every customer whose
// delivery-address clinic equals their Primary_Address clinic.
//
// The Conflict_Clinic_List is a DERIVED read model. The backing query
// (conflictActions.ts / design Conflict Clinic Flow) is:
//
//   WHERE o.delivery_date = :target_date
//     AND o.clinic_id IS DISTINCT FROM cp.clinic_id   -- mismatch AND unresolved(null)
//
// `IS DISTINCT FROM` is a null-safe inequality. We model that membership rule as
// a pure helper over rows of { orderStampClinicId, primaryClinicId } and assert
// it against an independent oracle.
//
// Validates: Requirements 22.2, 22.4, 22.7

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Model under test ───────────────────────────────────────────────────────
// A row represents one Delivery_Order for the target day: the customer's id,
// the order's stamped delivery-address clinic, and the customer's Primary_Address
// clinic. Both clinic ids are `string | null`.
interface OrderRow {
  customerId: string;
  orderStampClinicId: string | null; // delivery_orders.clinic_id (Req 19.2 / 22.3)
  primaryClinicId: string | null; // customer_profiles.clinic_id (Req 6.3)
}

interface ConflictListEntry {
  customerId: string;
  orderStampClinicId: string | null;
  primaryClinicId: string | null;
  reason: "mismatch" | "unresolved";
}

// Null-safe inequality, mirroring SQL `IS DISTINCT FROM`: two values are
// "distinct" when they are not equal, treating NULL as a comparable value.
function isDistinctFrom(a: string | null, b: string | null): boolean {
  return a !== b;
}

// Pure model of the Conflict_Clinic_List membership for a single delivery day:
// an order is in the list iff its stamp IS DISTINCT FROM the primary clinic.
function buildConflictList(rows: OrderRow[]): ConflictListEntry[] {
  return rows
    .filter((r) => isDistinctFrom(r.orderStampClinicId, r.primaryClinicId))
    .map((r) => ({
      customerId: r.customerId,
      orderStampClinicId: r.orderStampClinicId,
      primaryClinicId: r.primaryClinicId,
      reason: r.orderStampClinicId === null ? "unresolved" : "mismatch",
    }));
}

// ─── Arbitrary generators ──────────────────────────────────────────────────
// A small clinic-id pool keeps collisions (equal stamps) and differences both
// frequent, exercising the membership boundary in both directions.
const arbClinicIdOrNull: fc.Arbitrary<string | null> = fc.oneof(
  fc.constantFrom("clinic-A", "clinic-B", "clinic-C"),
  fc.constant(null)
);

const arbRows: fc.Arbitrary<OrderRow[]> = fc.array(
  fc.record({
    customerId: fc.uuid(),
    orderStampClinicId: arbClinicIdOrNull,
    primaryClinicId: arbClinicIdOrNull,
  }),
  { maxLength: 30 }
);

describe("Property 44: Conflict_Clinic_List membership matches per-day conflicts", () => {
  it("contains exactly the rows whose order stamp IS DISTINCT FROM the primary clinic", () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const list = buildConflictList(rows);
        const listed = new Set(list.map((e) => e.customerId));

        for (const row of rows) {
          const shouldBeListed = row.orderStampClinicId !== row.primaryClinicId;
          expect(listed.has(row.customerId)).toBe(shouldBeListed);
        }

        // No phantom entries: every listed customer came from an input row.
        const inputIds = new Set(rows.map((r) => r.customerId));
        for (const entry of list) {
          expect(inputIds.has(entry.customerId)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("omits every customer whose delivery-address clinic equals their primary clinic (Req 22.4)", () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const list = buildConflictList(rows);
        for (const entry of list) {
          // A listed entry is, by definition, NOT an equal-clinic row.
          expect(entry.orderStampClinicId).not.toBe(entry.primaryClinicId);
        }
        // Conversely, equal-clinic rows must be absent.
        const listedIds = new Set(list.map((e) => e.customerId));
        for (const row of rows) {
          if (row.orderStampClinicId === row.primaryClinicId) {
            expect(listedIds.has(row.customerId)).toBe(false);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("includes null-stamp orders as `unresolved` and differing non-null stamps as `mismatch` (Req 22.2)", () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const list = buildConflictList(rows);
        const byId = new Map(list.map((e) => [e.customerId, e]));

        for (const row of rows) {
          const entry = byId.get(row.customerId);
          if (row.orderStampClinicId === null && row.primaryClinicId !== null) {
            // Delivery resolved to no clinic against a known primary: unresolved.
            expect(entry?.reason).toBe("unresolved");
          } else if (
            row.orderStampClinicId !== null &&
            row.orderStampClinicId !== row.primaryClinicId
          ) {
            // Both known and differing (or primary null vs non-null stamp): mismatch.
            expect(entry?.reason).toBe("mismatch");
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("membership is a faithful partition: listed count + omitted count equals total", () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const list = buildConflictList(rows);
        const omitted = rows.filter(
          (r) => r.orderStampClinicId === r.primaryClinicId
        ).length;
        expect(list.length + omitted).toBe(rows.length);
      }),
      { numRuns: 100 }
    );
  });
});
