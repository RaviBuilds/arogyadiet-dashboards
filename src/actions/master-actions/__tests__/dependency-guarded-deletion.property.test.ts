// src/actions/master-actions/__tests__/dependency-guarded-deletion.property.test.ts
// Feature: core-clinic-architecture, Property 2: Dependency-guarded deletion
//
// Property 2: Dependency-guarded deletion — For any City, Kitchen, or Clinic and
// any number of dependent records, deletion succeeds iff the dependent count is
// zero; when dependents exist the record is retained and an error indicating
// dependents is returned.
//
// Validates: Requirements 1.5, 1.6, 14.5, 14.6
//
// These delete actions (deleteCity, deleteKitchen, deleteClinic) call repository
// count functions then either delete or reject. We test them as properties by
// MOCKING the clinic repositories and the Supabase auth client (authorized ADMIN
// user), generating arbitrary dependent counts (0 and >0) and asserting the
// delete/reject decision against the count.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// next/cache revalidatePath is a no-op side effect in unit tests.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Authorized ADMIN user. createClient is awaited inside each action; the chained
// `.from("users").select(...).eq(...).single()` resolves a user holding ADMIN.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-user-1" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "user-1", roles: { code: "ADMIN" } },
          }),
        }),
      }),
    }),
  })),
}));

// Clinic-domain repositories — every data-access call is replaced by a spy.
vi.mock("@/repositories/clinic/cityRepository", () => ({
  getCityById: vi.fn(),
  countKitchensForCity: vi.fn(),
  deleteCity: vi.fn(),
  // Unused-by-delete exports kept defined so the module shape is complete.
  getCityByNameLower: vi.fn(),
  insertCity: vi.fn(),
  updateCity: vi.fn(),
}));

vi.mock("@/repositories/clinic/kitchenRepository", () => ({
  getKitchenById: vi.fn(),
  countClinicsForKitchen: vi.fn(),
  deleteKitchen: vi.fn(),
  insertKitchen: vi.fn(),
  updateKitchen: vi.fn(),
}));

vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: vi.fn(),
  countClinicDependents: vi.fn(),
  deleteClinic: vi.fn(),
  insertClinic: vi.fn(),
  updateClinic: vi.fn(),
}));

// ─── Imports under test (after mocks are declared) ───────────────────────────

import { deleteCity } from "../cityActions";
import { deleteKitchen } from "../kitchenActions";
import { deleteClinic } from "../clinicActions";

import {
  getCityById,
  countKitchensForCity,
  deleteCity as deleteCityRecord,
} from "@/repositories/clinic/cityRepository";
import {
  getKitchenById,
  countClinicsForKitchen,
  deleteKitchen as deleteKitchenRecord,
} from "@/repositories/clinic/kitchenRepository";
import {
  getClinicById,
  countClinicDependents,
  deleteClinic as deleteClinicRecord,
  type ClinicDependencyCounts,
} from "@/repositories/clinic/clinicRepository";

const getCityByIdMock = vi.mocked(getCityById);
const countKitchensForCityMock = vi.mocked(countKitchensForCity);
const deleteCityRecordMock = vi.mocked(deleteCityRecord);

const getKitchenByIdMock = vi.mocked(getKitchenById);
const countClinicsForKitchenMock = vi.mocked(countClinicsForKitchen);
const deleteKitchenRecordMock = vi.mocked(deleteKitchenRecord);

const getClinicByIdMock = vi.mocked(getClinicById);
const countClinicDependentsMock = vi.mocked(countClinicDependents);
const deleteClinicRecordMock = vi.mocked(deleteClinicRecord);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CITY = { id: "city-1", name: "Hyderabad" } as never;
const KITCHEN = { id: "kitchen-1", name: "Central", city_id: "city-1" } as never;
const CLINIC = {
  id: "clinic-1",
  name: "Madhapur",
  address: "Somewhere",
  latitude: 17.4,
  longitude: 78.4,
  kitchen_id: "kitchen-1",
  franchise_id: null,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Generators ───────────────────────────────────────────────────────────────

// A non-negative dependent count, biased to include the boundary 0 frequently.
const arbCount = fc.nat({ max: 100_000 });

// A clinic dependency breakdown across its four reference tables; the action
// only consults `total`, but we exercise realistic multi-table aggregation.
const arbClinicDependents = fc
  .record({
    serviceAreas: fc.nat({ max: 25_000 }),
    riders: fc.nat({ max: 25_000 }),
    customers: fc.nat({ max: 25_000 }),
    snapshots: fc.nat({ max: 25_000 }),
  })
  .map(
    (b): ClinicDependencyCounts => ({
      ...b,
      total: b.serviceAreas + b.riders + b.customers + b.snapshots,
    })
  );

// ─── Property Tests ────────────────────────────────────────────────────────────

describe("Property 2: Dependency-guarded deletion", () => {
  it("City deletes iff zero kitchens reference it; otherwise retained with a dependent error", async () => {
    await fc.assert(
      fc.asyncProperty(arbCount, async (count) => {
        vi.clearAllMocks();
        getCityByIdMock.mockResolvedValue(CITY);
        countKitchensForCityMock.mockResolvedValue(count);
        deleteCityRecordMock.mockResolvedValue(undefined);

        const result = await deleteCity("city-1");

        if (count === 0) {
          // Deletion succeeds and the repository delete is invoked.
          expect(result.success).toBe(true);
          expect(deleteCityRecordMock).toHaveBeenCalledTimes(1);
          expect(deleteCityRecordMock).toHaveBeenCalledWith("city-1");
        } else {
          // Deletion is rejected, the record is retained (delete NOT called),
          // and an error indicating dependents is returned.
          expect(result.success).toBe(false);
          expect(deleteCityRecordMock).not.toHaveBeenCalled();
          if (!result.success) {
            expect(result.error).toBeTruthy();
            expect(result.error).toMatch(/associated|kitchen/i);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("Kitchen deletes iff zero clinics reference it; otherwise retained with a dependent error", async () => {
    await fc.assert(
      fc.asyncProperty(arbCount, async (count) => {
        vi.clearAllMocks();
        getKitchenByIdMock.mockResolvedValue(KITCHEN);
        countClinicsForKitchenMock.mockResolvedValue(count);
        deleteKitchenRecordMock.mockResolvedValue(undefined);

        const result = await deleteKitchen("kitchen-1");

        if (count === 0) {
          expect(result.success).toBe(true);
          expect(deleteKitchenRecordMock).toHaveBeenCalledTimes(1);
          expect(deleteKitchenRecordMock).toHaveBeenCalledWith("kitchen-1");
        } else {
          expect(result.success).toBe(false);
          expect(deleteKitchenRecordMock).not.toHaveBeenCalled();
          if (!result.success) {
            expect(result.error).toBeTruthy();
            expect(result.error).toMatch(/clinic/i);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("Clinic deletes iff total dependents is zero; otherwise retained with a dependent error", async () => {
    await fc.assert(
      fc.asyncProperty(arbClinicDependents, async (dependents) => {
        vi.clearAllMocks();
        getClinicByIdMock.mockResolvedValue(CLINIC);
        countClinicDependentsMock.mockResolvedValue(dependents);
        deleteClinicRecordMock.mockResolvedValue(undefined);

        const result = await deleteClinic("clinic-1");

        if (dependents.total === 0) {
          expect(result.success).toBe(true);
          expect(deleteClinicRecordMock).toHaveBeenCalledTimes(1);
          expect(deleteClinicRecordMock).toHaveBeenCalledWith("clinic-1");
        } else {
          expect(result.success).toBe(false);
          expect(deleteClinicRecordMock).not.toHaveBeenCalled();
          if (!result.success) {
            expect(result.error).toBeTruthy();
            expect(result.error).toMatch(/dependent|referenced/i);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
