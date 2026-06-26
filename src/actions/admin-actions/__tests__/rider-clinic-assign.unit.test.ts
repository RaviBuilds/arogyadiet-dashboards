// src/actions/admin-actions/__tests__/rider-clinic-assign.unit.test.ts
// Example-based unit test for the rider ↔ clinic assignment happy-path
// (core-clinic-architecture, Task 6.5).
//
// Covers Requirement 8.2: when an Admin assigns a Rider to a Clinic that
// exists (and is therefore "active" — "active" ≡ "exists" for core
// operations), the System stores the Rider-to-Clinic linkage and indicates
// that the assignment succeeded.
//
// Following the mocking conventions in
// `src/actions/master-actions/__tests__/crud-happy-paths.unit.test.ts`:
//   - `@/lib/supabase/server` resolves auth to an authorized ADMIN user.
//   - `@/lib/supabase/admin` (`createAdminClient`) is backed by an in-memory
//     `rider_profiles` store so the linkage write is observable without a
//     live Supabase instance.
//   - `@/repositories/clinic/clinicRepository` `getClinicById` returns an
//     existing clinic (existence ⇒ valid/active target).
//   - `next/cache` revalidation and `@/lib/logger` are stubbed out.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Clinic } from "@/types/clinic";

// ─── In-memory rider_profiles store (shared with the admin-client mock) ──────

const RIDER_ID = "rider-1";
const CLINIC_ID = "clinic-1";

// A single rider that exists and starts with no clinic linkage (clinic_id null).
let riderProfiles: Array<{ id: string; clinic_id: string | null }>;

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub Next.js cache revalidation (no-op outside the Next runtime).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Stub the admin activity logger (no-op).
vi.mock("@/lib/logger", () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

// Clinic repository: the target clinic exists.
vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: vi.fn(),
}));

// Authorized ADMIN user for every action call (mirrors crud-happy-paths).
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

// Service-role admin client backed by the in-memory `rider_profiles` store.
// Supports the two query shapes used by `assignRiderToClinic`:
//   - read : .from("rider_profiles").select(...).eq("id", id).maybeSingle()
//   - write: .from("rider_profiles").update({ clinic_id }).eq("id", id)
vi.mock("@/lib/supabase/admin", () => {
  const from = (table: string) => {
    if (table !== "rider_profiles") {
      throw new Error(`Unexpected table in test: ${table}`);
    }

    return {
      // Read path.
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            const row = riderProfiles.find((r) => r.id === id) ?? null;
            return { data: row, error: null };
          },
        }),
      }),
      // Write path: persist the linkage into the in-memory store.
      update: (patch: { clinic_id: string | null }) => ({
        eq: async (_col: string, id: string) => {
          const row = riderProfiles.find((r) => r.id === id);
          if (row) row.clinic_id = patch.clinic_id;
          return { error: null };
        },
      }),
    };
  };

  return {
    createAdminClient: vi.fn(() => ({ from })),
  };
});

import { assignRiderToClinic } from "../riderClinicActions";
import * as clinicRepo from "@/repositories/clinic/clinicRepository";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const clinicFixture: Clinic = {
  id: CLINIC_ID,
  name: "Koregaon Park Clinic",
  address: "5 North Main Road",
  latitude: 18.54,
  longitude: 73.89,
  kitchen_id: "kitchen-1",
  franchise_id: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Rider exists, initially unlinked.
  riderProfiles = [{ id: RIDER_ID, clinic_id: null }];
});

// ─── Rider ↔ Clinic assignment happy path (Req 8.2) ──────────────────────────

describe("assignRiderToClinic — happy path (Req 8.2)", () => {
  it("stores the linkage and indicates success when assigning to an existing clinic", async () => {
    // The target clinic exists ⇒ a valid/active assignment target.
    vi.mocked(clinicRepo.getClinicById).mockResolvedValue(clinicFixture);

    const result = await assignRiderToClinic(RIDER_ID, CLINIC_ID);

    // Success is indicated to the Admin.
    expect(result.success).toBe(true);

    // The linkage is stored: the rider's persisted clinic_id equals the clinic.
    expect(riderProfiles[0].clinic_id).toBe(CLINIC_ID);

    // The clinic existence (validity) check was consulted with the target id.
    expect(clinicRepo.getClinicById).toHaveBeenCalledWith(CLINIC_ID);
  });
});
