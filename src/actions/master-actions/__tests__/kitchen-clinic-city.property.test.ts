// src/actions/master-actions/__tests__/kitchen-clinic-city.property.test.ts
// Feature: core-clinic-architecture, Property 3: Kitchen requires a valid city, and clinic–kitchen must share a city
//
// Property 3 (Validates: Requirements 2.6, 2.7)
//
//   Req 2.6 — A Kitchen save (create/update) is accepted only when it
//   references an EXISTING City; otherwise it is rejected and no Kitchen
//   record is inserted/updated.
//
//   Req 2.7 — A clinic→kitchen re-association is accepted iff the new Kitchen
//   exists AND belongs to the same City as the clinic's current Kitchen (when
//   the current Kitchen has a city). Otherwise the association is rejected and
//   the existing linkage is left unchanged (the update repo fn is not called).
//
// Approach: the clinic-domain repositories and the Supabase server client are
// MOCKED so the Server Actions run as an authorized ADMIN without any live
// Supabase connection. fast-check drives the City/Kitchen existence and
// city-matching state space across ≥100 generated cases.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Module mocks ───────────────────────────────────────────────────────────

// Next.js cache side effect — no-op in tests.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Authorize every call as a global ADMIN. The actions call
// `await createClient()` then read auth user + the user's role.
vi.mock("@/lib/supabase/server", () => {
  const makeAdminClient = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-user-admin" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "user-admin", roles: { code: "ADMIN" } },
          }),
        }),
      }),
    }),
  });
  return { createClient: vi.fn(async () => makeAdminClient()) };
});

vi.mock("@/repositories/clinic/cityRepository", () => ({
  getCityById: vi.fn(),
}));

vi.mock("@/repositories/clinic/kitchenRepository", () => ({
  getKitchenById: vi.fn(),
  insertKitchen: vi.fn(),
  updateKitchen: vi.fn(),
  deleteKitchen: vi.fn(),
  countClinicsForKitchen: vi.fn(),
}));

vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: vi.fn(),
  insertClinic: vi.fn(),
  updateClinic: vi.fn(),
  deleteClinic: vi.fn(),
  countClinicDependents: vi.fn(),
}));

// Imports AFTER the mocks so the actions bind to the mocked repositories.
import { getCityById } from "@/repositories/clinic/cityRepository";
import {
  getKitchenById,
  insertKitchen,
  updateKitchen as updateKitchenRecord,
} from "@/repositories/clinic/kitchenRepository";
import {
  getClinicById,
  updateClinic as updateClinicRecord,
} from "@/repositories/clinic/clinicRepository";
import { createKitchen, updateKitchen } from "@/actions/master-actions/kitchenActions";
import { updateClinic } from "@/actions/master-actions/clinicActions";
import type { City, Kitchen, Clinic } from "@/types/clinic";

// ─── Fixtures / helpers ──────────────────────────────────────────────────────

const city = (id: string): City => ({
  id,
  name: "City",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
});

const kitchen = (id: string, cityId: string | null): Kitchen => ({
  id,
  name: "Kitchen",
  address_text: null,
  lat: null,
  lng: null,
  is_active: true,
  city_id: cityId,
});

const CURRENT_KITCHEN_ID = "current-kitchen";

const existingClinic = (): Clinic => ({
  id: "clinic-1",
  name: "Existing Clinic",
  address: "123 Test Street",
  latitude: 17.45,
  longitude: 78.39,
  kitchen_id: CURRENT_KITCHEN_ID,
  franchise_id: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
});

// A non-empty, in-bounds kitchen/clinic name.
const arbName = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Property 3 ───────────────────────────────────────────────────────────────

describe("Property 3: Kitchen requires a valid city, and clinic–kitchen must share a city", () => {
  // Req 2.6 — Kitchen create/update accepted iff the referenced City exists.
  it("kitchen create/update is accepted iff the referenced city exists (Req 2.6)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // cityExists
        fc.uuid(), // city_id referenced by the kitchen
        arbName,
        fc.boolean(), // isUpdate: false → createKitchen, true → updateKitchen
        async (cityExists, cityId, name, isUpdate) => {
          vi.clearAllMocks();

          vi.mocked(getCityById).mockResolvedValue(
            cityExists ? city(cityId) : null
          );
          vi.mocked(insertKitchen).mockResolvedValue(kitchen("new-kitchen", cityId));
          vi.mocked(updateKitchenRecord).mockResolvedValue(
            kitchen(CURRENT_KITCHEN_ID, cityId)
          );
          // updateKitchen first confirms the kitchen exists.
          vi.mocked(getKitchenById).mockResolvedValue(
            kitchen(CURRENT_KITCHEN_ID, "old-city")
          );

          const result = isUpdate
            ? await updateKitchen(CURRENT_KITCHEN_ID, { city_id: cityId })
            : await createKitchen({ name, city_id: cityId });

          // Save succeeds iff the city exists.
          expect(result.success).toBe(cityExists);

          if (cityExists) {
            if (isUpdate) {
              expect(updateKitchenRecord).toHaveBeenCalledTimes(1);
            } else {
              expect(insertKitchen).toHaveBeenCalledTimes(1);
            }
          } else {
            // On failure the city_id is flagged and the write never happens.
            if (!result.success) {
              expect(result.field).toBe("city_id");
            }
            expect(insertKitchen).not.toHaveBeenCalled();
            expect(updateKitchenRecord).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // Req 2.7 — Clinic re-association accepted iff the new kitchen exists AND
  // shares the current kitchen's city (when the current kitchen has a city).
  it("clinic→kitchen re-association is accepted iff new kitchen exists and shares the city (Req 2.7)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.uuid(), { nil: null }), // current kitchen's city (null = legacy/unassociated)
        fc.boolean(), // newKitchenExists
        fc.boolean(), // sameCity: reuse the current city for the new kitchen
        fc.uuid(), // new kitchen id (distinct from CURRENT_KITCHEN_ID)
        fc.uuid(), // a fresh, different city id
        async (currentCityId, newKitchenExists, sameCity, newKitchenId, freshCityId) => {
          vi.clearAllMocks();

          // The new kitchen's city: equal to current when sameCity (and current
          // has a city), otherwise a different city.
          const newCityId =
            sameCity && currentCityId ? currentCityId : freshCityId;

          vi.mocked(getClinicById).mockResolvedValue(existingClinic());
          vi.mocked(updateClinicRecord).mockResolvedValue({
            ...existingClinic(),
            kitchen_id: newKitchenId,
          });

          vi.mocked(getKitchenById).mockImplementation(async (kid: string) => {
            if (kid === CURRENT_KITCHEN_ID) {
              return kitchen(CURRENT_KITCHEN_ID, currentCityId);
            }
            if (kid === newKitchenId) {
              return newKitchenExists ? kitchen(newKitchenId, newCityId) : null;
            }
            return null;
          });

          const result = await updateClinic("clinic-1", {
            kitchen_id: newKitchenId,
          });

          // Accepted iff new kitchen exists AND (current has no city OR cities match).
          const shouldAccept =
            newKitchenExists &&
            (!currentCityId || newCityId === currentCityId);

          expect(result.success).toBe(shouldAccept);

          if (shouldAccept) {
            expect(updateClinicRecord).toHaveBeenCalledTimes(1);
          } else {
            // Rejected → existing linkage unchanged (update never issued).
            expect(updateClinicRecord).not.toHaveBeenCalled();
            if (!result.success) {
              expect(result.field).toBe("kitchen_id");
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
