// src/actions/master-actions/__tests__/crud-happy-paths.unit.test.ts
// Example-based unit tests for the City → Kitchen → Clinic master Server Actions
// (core-clinic-architecture, Task 2.9).
//
// These cover representative happy-paths and not-found cases:
//   - Req 1.2  : creating a city with a valid unique name returns its id
//   - Req 1.7  : editing/deleting a non-existent city → not-found error
//   - Req 2.5  : saving a kitchen with a valid existing city succeeds
//   - Req 14.1 : creating a clinic (happy path) succeeds and returns its id
//
// The clinic-domain repositories and Supabase auth are mocked so the tests run
// without a live Supabase instance. Auth always resolves to an authorized
// ADMIN user; `next/cache` revalidation is stubbed out.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub Next.js cache revalidation (no-op outside the Next runtime).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Authorized ADMIN user for every action call.
vi.mock("@/lib/supabase/server", () => {
  const single = vi.fn().mockResolvedValue({
    data: { id: "admin-user-1", roles: { code: "ADMIN" } },
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: "auth-user-1" } } });

  return {
    createClient: vi.fn(async () => ({
      auth: { getUser },
      from,
    })),
  };
});

// City repository.
vi.mock("@/repositories/clinic/cityRepository", () => ({
  getCityById: vi.fn(),
  getCityByNameLower: vi.fn(),
  insertCity: vi.fn(),
  updateCity: vi.fn(),
  deleteCity: vi.fn(),
  countKitchensForCity: vi.fn(),
}));

// Kitchen repository.
vi.mock("@/repositories/clinic/kitchenRepository", () => ({
  getKitchenById: vi.fn(),
  insertKitchen: vi.fn(),
  updateKitchen: vi.fn(),
  deleteKitchen: vi.fn(),
  countClinicsForKitchen: vi.fn(),
}));

// Clinic repository.
vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: vi.fn(),
  insertClinic: vi.fn(),
  updateClinic: vi.fn(),
  deleteClinic: vi.fn(),
  countClinicDependents: vi.fn(),
}));

import { createCity, updateCity, deleteCity } from "../cityActions";
import { createKitchen } from "../kitchenActions";
import { createClinic } from "../clinicActions";

import * as cityRepo from "@/repositories/clinic/cityRepository";
import * as kitchenRepo from "@/repositories/clinic/kitchenRepository";
import * as clinicRepo from "@/repositories/clinic/clinicRepository";

import type { City, Kitchen, Clinic } from "@/types/clinic";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const cityFixture: City = {
  id: "city-1",
  name: "Pune",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

const kitchenFixture: Kitchen = {
  id: "kitchen-1",
  name: "Central Kitchen",
  address_text: "12 MG Road",
  lat: 18.52,
  lng: 73.85,
  is_active: true,
  city_id: cityFixture.id,
};

const clinicFixture: Clinic = {
  id: "clinic-1",
  name: "Koregaon Park Clinic",
  address: "5 North Main Road",
  latitude: 18.54,
  longitude: 73.89,
  kitchen_id: kitchenFixture.id,
  franchise_id: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── City happy path (Req 1.2) ───────────────────────────────────────────────

describe("createCity — happy path (Req 1.2)", () => {
  it("creates a city with a valid unique name and returns its id", async () => {
    // No existing city with this name → unique.
    vi.mocked(cityRepo.getCityByNameLower).mockResolvedValue(null);
    vi.mocked(cityRepo.insertCity).mockResolvedValue(cityFixture);

    const result = await createCity({ name: "Pune" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("city-1");
      expect(result.data.name).toBe("Pune");
    }
    expect(cityRepo.insertCity).toHaveBeenCalledWith("Pune");
  });
});

// ─── City not-found (Req 1.7) ────────────────────────────────────────────────

describe("updateCity / deleteCity — not found (Req 1.7)", () => {
  it("updateCity returns a not-found error when the city does not exist", async () => {
    vi.mocked(cityRepo.getCityById).mockResolvedValue(null);

    const result = await updateCity("missing-city", { name: "New Name" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
    // No write should occur for a non-existent record.
    expect(cityRepo.updateCity).not.toHaveBeenCalled();
  });

  it("deleteCity returns a not-found error when the city does not exist", async () => {
    vi.mocked(cityRepo.getCityById).mockResolvedValue(null);

    const result = await deleteCity("missing-city");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
    expect(cityRepo.deleteCity).not.toHaveBeenCalled();
  });
});

// ─── Kitchen happy path (Req 2.5) ────────────────────────────────────────────

describe("createKitchen — happy path with valid city (Req 2.5)", () => {
  it("saves a kitchen referencing an existing city and returns its id", async () => {
    // City reference resolves to a real city.
    vi.mocked(cityRepo.getCityById).mockResolvedValue(cityFixture);
    vi.mocked(kitchenRepo.insertKitchen).mockResolvedValue(kitchenFixture);

    const result = await createKitchen({
      name: "Central Kitchen",
      city_id: cityFixture.id,
      address_text: "12 MG Road",
      lat: 18.52,
      lng: 73.85,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("kitchen-1");
    }
    expect(kitchenRepo.insertKitchen).toHaveBeenCalledTimes(1);
  });
});

// ─── Clinic happy path (Req 14.1) ────────────────────────────────────────────

describe("createClinic — happy path (Req 14.1)", () => {
  it("creates a clinic with valid input and an existing kitchen, returning its id", async () => {
    // Kitchen reference resolves to a real kitchen.
    vi.mocked(kitchenRepo.getKitchenById).mockResolvedValue(kitchenFixture);
    vi.mocked(clinicRepo.insertClinic).mockResolvedValue(clinicFixture);

    const result = await createClinic({
      name: "Koregaon Park Clinic",
      address: "5 North Main Road",
      latitude: 18.54,
      longitude: 73.89,
      kitchen_id: kitchenFixture.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("clinic-1");
    }
    expect(clinicRepo.insertClinic).toHaveBeenCalledTimes(1);
  });
});
