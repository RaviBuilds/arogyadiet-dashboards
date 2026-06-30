// Unit tests for master-portal business/city/kitchen/clinic Server Actions:
// happy-path and not-found example cases (core-clinic-architecture, task 3.10).
//
// Covers example cases for:
//   - Req 20.2  createBusiness returns the new record's unique id
//   - Req 20.7  updateBusiness / deleteBusiness on a missing id → not found
//   - Req 1.2   createCity creates a city (happy path)
//   - Req 1.7   updateCity / deleteCity on a missing id → not found
//   - Req 2.12  one Business may own multiple Kitchens (no upper limit)
//   - Req 3.8   createClinic rejects a non-existent kitchen reference
//   - Req 14.1  createClinic happy path persists a full-address clinic
//
// A live Supabase connection is not available, so the data-access and auth
// layers are backed by the shared in-memory model in ./helpers/inMemoryDb.

import { describe, it, expect, beforeEach, vi } from "vitest";

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
  createBusiness,
  updateBusiness,
  deleteBusiness,
} from "@/actions/master-actions/businessActions";
import {
  createCity,
  updateCity,
  deleteCity,
} from "@/actions/master-actions/cityActions";
import { createKitchen } from "@/actions/master-actions/kitchenActions";
import { createClinic } from "@/actions/master-actions/clinicActions";
import {
  db,
  resetDb,
  addBusiness,
  addCity,
  addKitchen,
} from "./helpers/inMemoryDb";

beforeEach(() => {
  resetDb();
});

// ─── Business (Req 20.2, 20.7) ────────────────────────────────────────────────

describe("businessActions", () => {
  it("createBusiness returns the new record's unique id on valid input (Req 20.2)", async () => {
    const result = await createBusiness({ name: "Core Hyderabad", type: "Core" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.id).toBe("string");
      expect(result.data.id.length).toBeGreaterThan(0);
      expect(db.businesses.some((b) => b.id === result.data.id)).toBe(true);
    }
  });

  it("updateBusiness on a non-existent id returns not found (Req 20.7)", async () => {
    const result = await updateBusiness("missing-id", { name: "X", type: "Core" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.toLowerCase()).toContain("not found");
  });

  it("deleteBusiness on a non-existent id returns not found (Req 20.7)", async () => {
    const result = await deleteBusiness("missing-id");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.toLowerCase()).toContain("not found");
  });
});

// ─── City (Req 1.2, 1.7) ──────────────────────────────────────────────────────

describe("cityActions", () => {
  it("createCity creates a city on a valid name (Req 1.2)", async () => {
    const result = await createCity({ name: "Hyderabad" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Hyderabad");
      expect(db.cities.some((c) => c.id === result.data.id)).toBe(true);
    }
  });

  it("updateCity on a non-existent id returns not found (Req 1.7)", async () => {
    const result = await updateCity("missing-id", { name: "Hyderabad" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.toLowerCase()).toContain("not found");
  });

  it("deleteCity on a non-existent id returns not found (Req 1.7)", async () => {
    const result = await deleteCity("missing-id");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.toLowerCase()).toContain("not found");
  });
});

// ─── Kitchen (Req 2.12) ───────────────────────────────────────────────────────

describe("kitchenActions", () => {
  it("allows one Business to own multiple Kitchens with no upper limit (Req 2.12)", async () => {
    const businessId = addBusiness();
    const cityId = addCity();

    const first = await createKitchen({
      name: "Kitchen One",
      business_id: businessId,
      city_id: cityId,
    });
    const second = await createKitchen({
      name: "Kitchen Two",
      business_id: businessId,
      city_id: cityId,
    });
    const third = await createKitchen({
      name: "Kitchen Three",
      business_id: businessId,
      city_id: cityId,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(true);

    const owned = db.kitchens.filter((k) => k.business_id === businessId);
    expect(owned).toHaveLength(3);
  });
});

// ─── Clinic (Req 3.8 not-found kitchen, Req 14.1 happy path) ──────────────────

describe("clinicActions", () => {
  const validClinic = (kitchen_id: string) => ({
    name: "Madhapur Clinic",
    address: "Plot 12, Madhapur, Hyderabad",
    latitude: 17.4486,
    longitude: 78.3908,
    kitchen_id,
  });

  it("createClinic rejects a non-existent kitchen reference and persists no record (Req 3.8)", async () => {
    const before = db.clinics.length;
    const result = await createClinic(validClinic("no-such-kitchen"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.field).toBe("kitchen_id");
    expect(db.clinics.length).toBe(before);
  });

  it("createClinic persists a full-address Core clinic on valid input (Req 14.1)", async () => {
    const businessId = addBusiness();
    const cityId = addCity();
    const kitchenId = addKitchen({ business_id: businessId, city_id: cityId });

    const result = await createClinic(validClinic(kitchenId));
    expect(result.success).toBe(true);
    if (result.success) {
      const persisted = db.clinics.find((c) => c.id === result.data.id)!;
      expect(persisted.name).toBe("Madhapur Clinic");
      expect(persisted.address).toBe("Plot 12, Madhapur, Hyderabad");
      expect(persisted.latitude).toBe(17.4486);
      expect(persisted.longitude).toBe(78.3908);
      expect(persisted.kitchen_id).toBe(kitchenId);
      expect(persisted.franchise_id).toBeNull();
    }
  });
});
