// Feature: core-clinic-architecture, Property 18: Rider–clinic assignment rejects invalid targets
//
// Property test for the Rider ↔ Clinic linkage Server Action
// `assignRiderToClinic` (core-clinic-architecture, task 9.3).
//
// Property 18: Rider–clinic assignment rejects invalid targets
//   For any assignment targeting a clinic that does not exist or is not active,
//   the assignment is rejected and any existing rider-to-clinic linkage is left
//   unchanged.
//
// For core operations "active" ≡ "exists" (the `clinics` table has no
// `is_active` column), so an invalid target is a clinic id that does not resolve
// to a clinic row. We exercise the REAL action against the shared in-memory
// Supabase fake.
//
// Validates: Requirements 8.5

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

import { assignRiderToClinic } from "@/actions/admin-actions/riderClinicActions";
import { db, resetDb, addClinic } from "./helpers/inMemoryDb";

const NUM_RUNS = 100;

beforeEach(() => {
  resetDb();
});

function addRider(id: string, clinicId: string | null = null): void {
  db.rider_profiles.push({ id, clinic_id: clinicId });
}

function riderClinic(riderId: string): string | null | undefined {
  const row = db.rider_profiles.find((r) => r.id === riderId);
  return row ? (row.clinic_id as string | null) : undefined;
}

describe("Property 18: Rider–clinic assignment rejects invalid targets", () => {
  it("rejects a non-existent (inactive) clinic and leaves the prior linkage unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A non-empty target id that is NEVER one of the existing clinics.
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => s.trim().length > 0 && !s.startsWith("clinic-existing")),
        // The rider may already be unlinked or linked to an existing clinic.
        fc.option(fc.constant("clinic-existing-A"), { nil: null }),
        async (invalidClinicId, priorLinkage) => {
          resetDb();
          addClinic({ id: "clinic-existing-A" });
          addClinic({ id: "clinic-existing-B" });
          addRider("rider-1", priorLinkage);

          const before = riderClinic("rider-1");

          const result = await assignRiderToClinic("rider-1", invalidClinicId);

          // Rejected...
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.field).toBe("clinicId");
          }
          // ...and the existing linkage is untouched.
          expect(riderClinic("rider-1")).toBe(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a valid existing clinic is accepted (contrast case)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("clinic-existing-A", "clinic-existing-B"),
        async (validClinicId) => {
          resetDb();
          addClinic({ id: "clinic-existing-A" });
          addClinic({ id: "clinic-existing-B" });
          addRider("rider-1", null);

          const result = await assignRiderToClinic("rider-1", validClinicId);

          expect(result.success).toBe(true);
          expect(riderClinic("rider-1")).toBe(validClinicId);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
