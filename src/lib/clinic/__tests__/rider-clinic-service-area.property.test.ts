// Feature: core-clinic-architecture, Property 19: Service-area assignment is bounded by the rider's clinic
//
// Property test for the rider service-area Server Actions
// `getAssignablePincodesForRider` and `assignServiceAreaToRider`
// (core-clinic-architecture, task 9.4).
//
// Property 19: Service-area assignment is bounded by the rider's clinic
//   For any rider, if the rider has no linked clinic then every service-area
//   assignment is rejected with a clinic-required error and no change is made;
//   if the rider is linked to a clinic, the set of assignable pincodes equals
//   exactly that clinic's pincodes, and an attempt to assign any pincode outside
//   that clinic is rejected leaving existing associations unchanged.
//
// We exercise the REAL actions against the shared in-memory Supabase fake.
//
// Validates: Requirements 9.1, 9.2, 9.3

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/supabase/admin", async () => {
  const h = await vi.importActual<typeof import("./helpers/inMemoryDb")>(
    "./helpers/inMemoryDb",
  );
  return { createAdminClient: () => h.makeAdminClient() };
});

vi.mock("@/lib/supabase/server", async () => {
  const h = await vi.importActual<typeof import("./helpers/inMemoryDb")>(
    "./helpers/inMemoryDb",
  );
  return { createClient: async () => h.makeServerClient() };
});

import {
  getAssignablePincodesForRider,
  assignServiceAreaToRider,
} from "@/actions/admin-actions/riderClinicActions";
import { db, resetDb, addClinic } from "./helpers/inMemoryDb";

const NUM_RUNS = 100;

beforeEach(() => {
  resetDb();
});

function addRider(id: string, clinicId: string | null = null): void {
  db.rider_profiles.push({ id, clinic_id: clinicId });
}

/** Seed a service-area row (one pincode → one clinic, globally unique). */
function addServiceArea(pincode: string, clinicId: string): void {
  db.rider_service_areas.push({
    id: `sa-${pincode}`,
    pincode,
    clinic_id: clinicId,
    rider_id: null,
  });
}

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

describe("Property 19: Service-area assignment is bounded by the rider's clinic", () => {
  it("an unlinked rider has no assignable pincodes and every assignment is rejected with no change", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbPincode, { minLength: 0, maxLength: 8 }),
        async (pincodes) => {
          resetDb();
          addClinic({ id: "clinic-A" });
          // Pincodes exist in the system, owned by clinic-A, but the rider has
          // NO linked clinic.
          for (const p of pincodes) addServiceArea(p, "clinic-A");
          addRider("rider-1", null);

          const snapshot = JSON.stringify(db.rider_service_areas);

          // No clinic linked ⇒ assignable list is an error (clinic required).
          const assignable = await getAssignablePincodesForRider("rider-1");
          expect(assignable.success).toBe(false);

          // Every assignment attempt is rejected, leaving associations unchanged.
          for (const p of pincodes.length ? pincodes : ["500001"]) {
            const result = await assignServiceAreaToRider("rider-1", p);
            expect(result.success).toBe(false);
            if (!result.success) expect(result.field).toBe("riderId");
          }
          expect(JSON.stringify(db.rider_service_areas)).toBe(snapshot);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a linked rider's assignable set equals exactly its clinic's pincodes; in-clinic assigns succeed, out-of-clinic are rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Disjoint pincode sets for the rider's clinic vs. another clinic.
        fc
          .uniqueArray(arbPincode, { minLength: 1, maxLength: 12 })
          .chain((all) =>
            fc
              .integer({ min: 1, max: all.length })
              .map((split) => ({
                ownPincodes: all.slice(0, split),
                otherPincodes: all.slice(split),
              })),
          ),
        async ({ ownPincodes, otherPincodes }) => {
          resetDb();
          addClinic({ id: "clinic-own" });
          addClinic({ id: "clinic-other" });
          for (const p of ownPincodes) addServiceArea(p, "clinic-own");
          for (const p of otherPincodes) addServiceArea(p, "clinic-other");
          addRider("rider-1", "clinic-own");

          // Assignable set equals EXACTLY the rider's clinic's pincodes.
          const assignable = await getAssignablePincodesForRider("rider-1");
          expect(assignable.success).toBe(true);
          if (assignable.success) {
            expect([...assignable.data].sort()).toEqual([...ownPincodes].sort());
          }

          // Every in-clinic pincode can be assigned to the rider.
          for (const p of ownPincodes) {
            const result = await assignServiceAreaToRider("rider-1", p);
            expect(result.success).toBe(true);
            const row = db.rider_service_areas.find((r) => r.pincode === p)!;
            expect(row.rider_id).toBe("rider-1");
          }

          // Every out-of-clinic pincode is rejected, leaving its row's rider
          // association unchanged (still null / its other clinic).
          for (const p of otherPincodes) {
            const result = await assignServiceAreaToRider("rider-1", p);
            expect(result.success).toBe(false);
            if (!result.success) expect(result.field).toBe("pincode");
            const row = db.rider_service_areas.find((r) => r.pincode === p)!;
            expect(row.rider_id).toBeNull();
            expect(row.clinic_id).toBe("clinic-other");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("assigning an unknown pincode (owned by no clinic) is rejected, leaving associations unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbPincode, arbPincode, async (ownPincode, unknownPincode) => {
        fc.pre(ownPincode !== unknownPincode);
        resetDb();
        addClinic({ id: "clinic-own" });
        addServiceArea(ownPincode, "clinic-own");
        addRider("rider-1", "clinic-own");

        const snapshot = JSON.stringify(db.rider_service_areas);
        const result = await assignServiceAreaToRider("rider-1", unknownPincode);

        expect(result.success).toBe(false);
        if (!result.success) expect(result.field).toBe("pincode");
        expect(JSON.stringify(db.rider_service_areas)).toBe(snapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
