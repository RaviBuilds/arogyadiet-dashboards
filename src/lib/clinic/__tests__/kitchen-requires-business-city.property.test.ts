// Feature: core-clinic-architecture, Property 4: Kitchen requires a valid Business and City — for any Kitchen save input, the save is accepted iff it references an existing Business and an existing City; otherwise it is rejected indicating the required association and any existing Kitchen record is left unchanged.
//
// Property test for the master-portal kitchen Server Actions:
//   - createKitchen (src/actions/master-actions/kitchenActions.ts)
//   - updateKitchen (src/actions/master-actions/kitchenActions.ts)
//
// Property 4: Kitchen requires a valid Business and City
//   For any Kitchen save input, the save is accepted if and only if it
//   references an existing Business and an existing City; otherwise the
//   operation is rejected with an indication that the Business (or City)
//   association is required and any existing Kitchen record is left unchanged.
//
// A live Supabase connection is not available, so the data-access layer and the
// auth layer are backed by the shared in-memory model in ./helpers/inMemoryDb.
//
// Validates: Requirements 2.8, 2.9, 2.4

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

import { createKitchen, updateKitchen } from "@/actions/master-actions/kitchenActions";
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

// Each reference is one of: a valid (existing) id, a non-existent id, or blank.
type RefKind = "valid" | "missing" | "blank";
const refKindArb = fc.constantFrom<RefKind>("valid", "missing", "blank");

describe("Property 4: Kitchen requires a valid Business and City", () => {
  it("createKitchen accepts iff both Business and City references exist; otherwise no kitchen is created", async () => {
    await fc.assert(
      fc.asyncProperty(refKindArb, refKindArb, async (bizKind, cityKind) => {
        resetDb();
        const realBusiness = addBusiness();
        const realCity = addCity();

        const business_id =
          bizKind === "valid" ? realBusiness : bizKind === "missing" ? "no-such-business" : "";
        const city_id =
          cityKind === "valid" ? realCity : cityKind === "missing" ? "no-such-city" : "";

        const before = db.kitchens.length;
        const result = await createKitchen({ name: "Central Kitchen", business_id, city_id });

        const shouldSucceed = bizKind === "valid" && cityKind === "valid";
        expect(result.success).toBe(shouldSucceed);

        if (shouldSucceed) {
          expect(db.kitchens.length).toBe(before + 1);
        } else {
          // No kitchen is created on rejection (Req 2.9), and the offending
          // association is named.
          expect(db.kitchens.length).toBe(before);
          if (!result.success) {
            if (bizKind !== "valid") expect(result.field).toBe("business_id");
            else expect(result.field).toBe("city_id");
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it("updateKitchen accepts iff both references exist; otherwise the existing kitchen is left unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(refKindArb, refKindArb, async (bizKind, cityKind) => {
        resetDb();
        const realBusiness = addBusiness();
        const realCity = addCity();
        // The original (valid) association the kitchen starts with.
        const originalBiz = addBusiness();
        const originalCity = addCity();
        const kitchenId = addKitchen({
          name: "Original",
          business_id: originalBiz,
          city_id: originalCity,
        });

        const business_id =
          bizKind === "valid" ? realBusiness : bizKind === "missing" ? "no-such-business" : "";
        const city_id =
          cityKind === "valid" ? realCity : cityKind === "missing" ? "no-such-city" : "";

        const result = await updateKitchen(kitchenId, {
          name: "Renamed",
          business_id,
          city_id,
        });

        const persisted = db.kitchens.find((k) => k.id === kitchenId)!;
        const shouldSucceed = bizKind === "valid" && cityKind === "valid";
        expect(result.success).toBe(shouldSucceed);

        if (shouldSucceed) {
          expect(persisted.business_id).toBe(realBusiness);
          expect(persisted.city_id).toBe(realCity);
          expect(persisted.name).toBe("Renamed");
        } else {
          // Left entirely unchanged on rejection (Req 2.9).
          expect(persisted.business_id).toBe(originalBiz);
          expect(persisted.city_id).toBe(originalCity);
          expect(persisted.name).toBe("Original");
        }
      }),
      { numRuns: 150 },
    );
  });
});
