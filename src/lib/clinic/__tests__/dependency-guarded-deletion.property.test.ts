// Feature: core-clinic-architecture, Property 3: Dependency-guarded deletion (Business, City, Kitchen, Clinic) — for any record and any number of dependent records referencing it, deletion succeeds iff the dependent count is zero; when dependents exist the record is retained and an error indicating dependents is returned.
//
// Property test for the master-portal delete Server Actions:
//   - deleteBusiness (src/actions/master-actions/businessActions.ts)
//   - deleteCity     (src/actions/master-actions/cityActions.ts)
//   - deleteKitchen  (src/actions/master-actions/kitchenActions.ts)
//   - deleteClinic   (src/actions/master-actions/clinicActions.ts)
//
// Property 3: Dependency-guarded deletion
//   For any Business, City, Kitchen, or Clinic and any number of dependent
//   records referencing it, deletion succeeds if and only if the dependent
//   count is zero; when dependents exist the record and its associations are
//   retained and an error indicating dependents is returned.
//
// A live Supabase connection is not available, so the data-access layer
// (createAdminClient) and the auth layer (createClient) are backed by the
// shared in-memory model in ./helpers/inMemoryDb. The pure decision under test
// is "dependent count === 0 → allow deletion".
//
// Validates: Requirements 1.5, 1.6, 14.5, 14.6, 20.5, 20.6

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

import { deleteBusiness } from "@/actions/master-actions/businessActions";
import { deleteCity } from "@/actions/master-actions/cityActions";
import { deleteKitchen } from "@/actions/master-actions/kitchenActions";
import { deleteClinic } from "@/actions/master-actions/clinicActions";
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

const countArb = fc.integer({ min: 0, max: 6 });

describe("Property 3: Dependency-guarded deletion", () => {
  it("Business: deletes iff no kitchen references it; otherwise retained with a dependents error", async () => {
    await fc.assert(
      fc.asyncProperty(countArb, async (depCount) => {
        resetDb();
        const cityId = addCity();
        const businessId = addBusiness();
        for (let i = 0; i < depCount; i++) {
          addKitchen({ business_id: businessId, city_id: cityId });
        }

        const result = await deleteBusiness(businessId);
        const stillExists = db.businesses.some((b) => b.id === businessId);

        if (depCount === 0) {
          expect(result.success).toBe(true);
          expect(stillExists).toBe(false);
        } else {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.toLowerCase()).toContain("kitchen");
          expect(stillExists).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("City: deletes iff no kitchen references it; otherwise retained with a dependents error", async () => {
    await fc.assert(
      fc.asyncProperty(countArb, async (depCount) => {
        resetDb();
        const businessId = addBusiness();
        const cityId = addCity();
        for (let i = 0; i < depCount; i++) {
          addKitchen({ business_id: businessId, city_id: cityId });
        }

        const result = await deleteCity(cityId);
        const stillExists = db.cities.some((c) => c.id === cityId);

        if (depCount === 0) {
          expect(result.success).toBe(true);
          expect(stillExists).toBe(false);
        } else {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.toLowerCase()).toContain("kitchen");
          expect(stillExists).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("Kitchen: deletes iff no clinic references it; otherwise retained with a dependents error", async () => {
    await fc.assert(
      fc.asyncProperty(countArb, async (depCount) => {
        resetDb();
        const cityId = addCity();
        const businessId = addBusiness();
        const kitchenId = addKitchen({ business_id: businessId, city_id: cityId });
        for (let i = 0; i < depCount; i++) {
          addClinic({ kitchen_id: kitchenId });
        }

        const result = await deleteKitchen(kitchenId);
        const stillExists = db.kitchens.some((k) => k.id === kitchenId);

        if (depCount === 0) {
          expect(result.success).toBe(true);
          expect(stillExists).toBe(false);
        } else {
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.toLowerCase()).toContain("clinic");
          expect(stillExists).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("Clinic: deletes iff no service-area/rider/customer/snapshot references it; otherwise retained with a dependents error", async () => {
    // Spread an arbitrary number of dependents across the four referencing tables.
    const depSpreadArb = fc.record({
      serviceAreas: fc.integer({ min: 0, max: 3 }),
      riders: fc.integer({ min: 0, max: 3 }),
      customers: fc.integer({ min: 0, max: 3 }),
      snapshots: fc.integer({ min: 0, max: 3 }),
    });

    await fc.assert(
      fc.asyncProperty(depSpreadArb, async (spread) => {
        resetDb();
        const cityId = addCity();
        const businessId = addBusiness();
        const kitchenId = addKitchen({ business_id: businessId, city_id: cityId });
        const clinicId = addClinic({ kitchen_id: kitchenId });

        for (let i = 0; i < spread.serviceAreas; i++)
          db.rider_service_areas.push({ id: `sa-${i}`, clinic_id: clinicId });
        for (let i = 0; i < spread.riders; i++)
          db.rider_profiles.push({ id: `rp-${i}`, clinic_id: clinicId });
        for (let i = 0; i < spread.customers; i++)
          db.customer_profiles.push({ id: `cp-${i}`, clinic_id: clinicId });
        for (let i = 0; i < spread.snapshots; i++)
          db.workload_snapshots.push({ id: `ws-${i}`, clinic_id: clinicId });

        const total =
          spread.serviceAreas + spread.riders + spread.customers + spread.snapshots;

        const result = await deleteClinic(clinicId);
        const stillExists = db.clinics.some((c) => c.id === clinicId);

        if (total === 0) {
          expect(result.success).toBe(true);
          expect(stillExists).toBe(false);
        } else {
          expect(result.success).toBe(false);
          expect(stillExists).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});
