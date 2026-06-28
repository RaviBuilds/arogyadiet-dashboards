// Feature: core-clinic-architecture, Property 17: Rider has at most one clinic, replaced on reassignment
//
// Property test for the Rider ↔ Clinic linkage Server Action
// `assignRiderToClinic` (core-clinic-architecture, task 9.2).
//
// Property 17: Rider has at most one clinic, replaced on reassignment
//   For any sequence of rider-to-clinic assignment and reassignment operations
//   against existing active clinics, each rider retains at most one active
//   clinic linkage, and after a reassignment the single remaining linkage
//   equals the most recently assigned clinic.
//
// The linkage is stored on the single `rider_profiles.clinic_id` column, so
// each successful assignment necessarily REPLACES any prior one. We exercise the
// REAL action against the shared in-memory Supabase fake to confirm this
// holds across arbitrary assignment sequences.
//
// Validates: Requirements 8.1, 8.3

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

/** Seed a rider profile, optionally pre-linked to a clinic. */
function addRider(id: string, clinicId: string | null = null): void {
  db.rider_profiles.push({ id, clinic_id: clinicId });
}

function riderClinic(riderId: string): string | null | undefined {
  const row = db.rider_profiles.find((r) => r.id === riderId);
  return row ? (row.clinic_id as string | null) : undefined;
}

describe("Property 17: Rider has at most one clinic, replaced on reassignment", () => {
  it("after any sequence of valid assignments, the rider's single linkage equals the most recently assigned clinic", async () => {
    await fc.assert(
      fc.asyncProperty(
        // At least one assignment so there is a "most recent" clinic.
        fc.array(fc.constantFrom("clinic-A", "clinic-B", "clinic-C", "clinic-D"), {
          minLength: 1,
          maxLength: 12,
        }),
        async (sequence) => {
          resetDb();
          // All four clinics exist (are active) for the whole sequence.
          for (const id of ["clinic-A", "clinic-B", "clinic-C", "clinic-D"]) {
            addClinic({ id });
          }
          addRider("rider-1");

          for (const clinicId of sequence) {
            const result = await assignRiderToClinic("rider-1", clinicId);
            expect(result.success).toBe(true);

            // At every step exactly one rider row exists and it carries a
            // single clinic linkage (the column is scalar, never a set).
            const riderRows = db.rider_profiles.filter((r) => r.id === "rider-1");
            expect(riderRows).toHaveLength(1);
          }

          // The single remaining linkage equals the most recently assigned clinic.
          expect(riderClinic("rider-1")).toBe(sequence[sequence.length - 1]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reassigning replaces the prior linkage rather than accumulating linkages", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("clinic-A", "clinic-B", "clinic-C"),
        fc.constantFrom("clinic-A", "clinic-B", "clinic-C"),
        async (firstClinic, secondClinic) => {
          resetDb();
          for (const id of ["clinic-A", "clinic-B", "clinic-C"]) addClinic({ id });
          addRider("rider-1");

          const first = await assignRiderToClinic("rider-1", firstClinic);
          expect(first.success).toBe(true);
          expect(riderClinic("rider-1")).toBe(firstClinic);

          const second = await assignRiderToClinic("rider-1", secondClinic);
          expect(second.success).toBe(true);

          // Still exactly one rider row, now pointing at the second clinic.
          expect(db.rider_profiles.filter((r) => r.id === "rider-1")).toHaveLength(1);
          expect(riderClinic("rider-1")).toBe(secondClinic);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
