// Feature: core-clinic-architecture, Property 5: Clinic–Kitchen association obeys the same-city rule and re-resolves the Business — a reassociation is accepted iff the target Kitchen and the Clinic share a City; on acceptance the Clinic's kitchen_id becomes the target and the resolved Business equals the target Kitchen's Business (Clinic → Kitchen → Business); on rejection the kitchen_id and resolved Business are unchanged.
//
// Property test for the master-portal clinic-kitchen reassignment Server Action
// `reassignClinicKitchen` (src/actions/master-actions/kitchenActions.ts), with
// the resolved Business verified through `resolveBusinessForClinic`
// (src/repositories/clinic/clinicRepository.ts).
//
// Property 5: Clinic–Kitchen association obeys the same-city rule and re-resolves the Business
//   For any Clinic-to-Kitchen association or reassignment, the operation is
//   accepted iff the target Kitchen and the Clinic belong to the same City; on
//   acceptance the Clinic's kitchen_id becomes the target Kitchen and the
//   Clinic's resolved Business equals that Kitchen's Business; on rejection the
//   Clinic's existing kitchen_id and resolved Business are left unchanged.
//
// A live Supabase connection is not available, so the data-access and auth
// layers are backed by the shared in-memory model in ./helpers/inMemoryDb.
//
// Validates: Requirements 2.10, 2.13, 2.14, 3.10, 20.9

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

import { reassignClinicKitchen } from "@/actions/master-actions/kitchenActions";
import { resolveBusinessForClinic } from "@/repositories/clinic/clinicRepository";
import {
  db,
  resetDb,
  addBusiness,
  addCity,
  addKitchen,
  addClinic,
} from "./helpers/inMemoryDb";

beforeEach(() => {
  resetDb();
});

describe("Property 5: Clinic–Kitchen same-city rule and Business re-resolution", () => {
  it("accepts iff target kitchen shares the clinic's city; re-resolves Business on accept; leaves all unchanged on reject", async () => {
    await fc.assert(
      // sameCity = the target kitchen is in the clinic's city (must be accepted)
      // when false the target is in a different city (must be rejected).
      fc.asyncProperty(fc.boolean(), async (sameCity) => {
        resetDb();

        const cityHome = addCity({ name: "Hyderabad" });
        const cityOther = addCity({ name: "Bengaluru" });

        const businessA = addBusiness({ name: "Business A" });
        const businessB = addBusiness({ name: "Business B" });

        // The clinic's current kitchen anchors its city (cityHome) and Business A.
        const currentKitchen = addKitchen({
          name: "Home Kitchen",
          business_id: businessA,
          city_id: cityHome,
        });
        // The target kitchen belongs to Business B, in either the same or a
        // different city than the clinic.
        const targetKitchen = addKitchen({
          name: "Target Kitchen",
          business_id: businessB,
          city_id: sameCity ? cityHome : cityOther,
        });

        const clinicId = addClinic({ kitchen_id: currentKitchen });

        const result = await reassignClinicKitchen(clinicId, targetKitchen);

        const clinic = db.clinics.find((c) => c.id === clinicId)!;
        const resolution = await resolveBusinessForClinic(clinicId);

        expect(result.success).toBe(sameCity);

        if (sameCity) {
          // Accepted: kitchen_id moves to the target and the Business
          // re-resolves through it (Clinic → Kitchen → Business).
          expect(clinic.kitchen_id).toBe(targetKitchen);
          expect(resolution?.business.id).toBe(businessB);
        } else {
          // Rejected: kitchen_id and resolved Business unchanged.
          expect(clinic.kitchen_id).toBe(currentKitchen);
          expect(resolution?.business.id).toBe(businessA);
          if (!result.success) expect(result.field).toBe("kitchen_id");
        }
      }),
      { numRuns: 150 },
    );
  });
});
