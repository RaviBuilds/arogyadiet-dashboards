// Unit test for the rider ↔ clinic assignment happy path
// (core-clinic-architecture, task 9.5).
//
// Covers the Requirement 8.2 example case: a manual admin assignment of a rider
// to a valid (existing/active) clinic succeeds and persists the linkage on
// `rider_profiles.clinic_id`.
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

import { assignRiderToClinic } from "@/actions/admin-actions/riderClinicActions";
import { db, resetDb, addClinic } from "./helpers/inMemoryDb";

beforeEach(() => {
  resetDb();
});

describe("assignRiderToClinic happy path (Req 8.2)", () => {
  it("assigns an unlinked rider to a valid clinic and persists the linkage", async () => {
    const clinicId = addClinic({ id: "clinic-madhapur" });
    db.rider_profiles.push({ id: "rider-7", clinic_id: null });

    const result = await assignRiderToClinic("rider-7", clinicId);

    expect(result.success).toBe(true);
    const rider = db.rider_profiles.find((r) => r.id === "rider-7")!;
    expect(rider.clinic_id).toBe(clinicId);
  });

  it("re-links an already-linked rider to a different valid clinic", async () => {
    const first = addClinic({ id: "clinic-uppal" });
    const second = addClinic({ id: "clinic-madhapur" });
    db.rider_profiles.push({ id: "rider-7", clinic_id: first });

    const result = await assignRiderToClinic("rider-7", second);

    expect(result.success).toBe(true);
    const rider = db.rider_profiles.find((r) => r.id === "rider-7")!;
    expect(rider.clinic_id).toBe(second);
  });
});
