// Feature: core-clinic-architecture, Property 7: Clinic persistence round-trip — creating a clinic from valid input and reading it back yields equal name/address/latitude/longitude/kitchen_id; editing to new valid values and reading back yields the updated values.
//
// Property test for the master-portal clinic Server Actions:
//   - createClinic (src/actions/master-actions/clinicActions.ts)
//   - updateClinic (src/actions/master-actions/clinicActions.ts)
// read back through `getClinicById` (src/repositories/clinic/clinicRepository.ts).
//
// Property 7: Clinic persistence round-trip
//   For any valid clinic input, creating the clinic and then reading it back
//   yields equal values for name, address, latitude, longitude, and kitchen_id;
//   and editing to new valid values then reading back yields the updated values.
//
// A live Supabase connection is not available, so the data-access and auth
// layers are backed by the shared in-memory model in ./helpers/inMemoryDb.
//
// Validates: Requirements 3.1, 14.4

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

import { createClinic, updateClinic } from "@/actions/master-actions/clinicActions";
import { getClinicById } from "@/repositories/clinic/clinicRepository";
import {
  resetDb,
  addBusiness,
  addCity,
  addKitchen,
} from "./helpers/inMemoryDb";

beforeEach(() => {
  resetDb();
});

// ─── Generators producing valid, trim-stable values ──────────────────────────

/** A non-blank token of length 1..max with no leading/trailing whitespace. */
const tokenOfMax = (max: number) =>
  fc
    .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength: max,
    })
    .map((cs) => cs.join(""));

const latArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const lngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

// Create bounds: name 1..120, address 1..255.
const createInputArb = fc.record({
  name: tokenOfMax(120),
  address: tokenOfMax(255),
  latitude: latArb,
  longitude: lngArb,
});

// Edit (master form) bounds: name 1..200, address 1..500.
const editInputArb = fc.record({
  name: tokenOfMax(200),
  address: tokenOfMax(500),
  latitude: latArb,
  longitude: lngArb,
});

describe("Property 7: Clinic persistence round-trip", () => {
  it("create then read-back yields equal name/address/latitude/longitude/kitchen_id; edit then read-back yields updated values", async () => {
    await fc.assert(
      fc.asyncProperty(createInputArb, editInputArb, async (createInput, editInput) => {
        resetDb();
        const cityId = addCity();
        const businessId = addBusiness();
        const kitchenId = addKitchen({ business_id: businessId, city_id: cityId });

        // ── Create ──
        const created = await createClinic({
          name: createInput.name,
          address: createInput.address,
          latitude: createInput.latitude,
          longitude: createInput.longitude,
          kitchen_id: kitchenId,
        });
        expect(created.success).toBe(true);
        if (!created.success) return;

        const afterCreate = await getClinicById(created.data.id);
        expect(afterCreate).not.toBeNull();
        expect(afterCreate!.name).toBe(createInput.name);
        expect(afterCreate!.address).toBe(createInput.address);
        expect(afterCreate!.latitude).toBe(createInput.latitude);
        expect(afterCreate!.longitude).toBe(createInput.longitude);
        expect(afterCreate!.kitchen_id).toBe(kitchenId);
        // A clinic with no franchise is a Core clinic (Req 3.4 default).
        expect(afterCreate!.franchise_id).toBeNull();

        // ── Edit to new valid values (kitchen unchanged) ──
        const updated = await updateClinic(created.data.id, {
          name: editInput.name,
          address: editInput.address,
          latitude: editInput.latitude,
          longitude: editInput.longitude,
        });
        expect(updated.success).toBe(true);
        if (!updated.success) return;

        const afterEdit = await getClinicById(created.data.id);
        expect(afterEdit!.name).toBe(editInput.name);
        expect(afterEdit!.address).toBe(editInput.address);
        expect(afterEdit!.latitude).toBe(editInput.latitude);
        expect(afterEdit!.longitude).toBe(editInput.longitude);
        // kitchen_id is preserved across the edit.
        expect(afterEdit!.kitchen_id).toBe(kitchenId);
      }),
      { numRuns: 150 },
    );
  });
});
