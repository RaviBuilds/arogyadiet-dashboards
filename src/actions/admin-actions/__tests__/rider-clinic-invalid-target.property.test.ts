// Feature: core-clinic-architecture, Property 15: Rider–clinic assignment rejects invalid targets
//
// Property test for `assignRiderToClinic`
// (src/actions/admin-actions/riderClinicActions.ts).
//
// Property 15: Rider–clinic assignment rejects invalid targets
//   For any assignment targeting a clinic that does not exist (or is not
//   active; "active" ≡ "exists" for core operations), the assignment is
//   REJECTED and any existing rider-to-clinic linkage is left UNCHANGED. When
//   the target clinic resolves, the assignment SUCCEEDS and the rider's stored
//   `clinic_id` becomes the target.
//
// A live Supabase connection is unavailable in unit tests, so:
//   - `@/lib/supabase/admin` `createAdminClient` is mocked to back the rider
//     read (`getRiderClinicId`) and the linkage write (the `clinic_id` UPDATE)
//     with an IN-MEMORY `rider_profiles` store (Map<riderId, clinic_id|null>).
//   - `@/repositories/clinic/clinicRepository` `getClinicById` is mocked to
//     resolve a clinic only when the target id is in the set of existing
//     clinics, returning `null` otherwise (modeling an invalid/nonexistent
//     target — "active" ≡ "exists").
//   - Auth (`@/lib/supabase/server`) resolves an ADMIN, and `next/cache` /
//     `@/lib/logger` are stubbed.
//
// Validates: Requirements 8.5

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (declared before the mock factories) ─────────────
//
// riderStore models `rider_profiles.clinic_id` keyed by rider id.
// existingClinics is the set of clinic ids that `getClinicById` resolves;
// a target id absent from this set models an invalid / nonexistent clinic.

const riderStore = new Map<string, string | null>();
const existingClinics = new Set<string>();

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub Next.js cache revalidation (no-op outside a request scope).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// Stub the admin action logger.
vi.mock("@/lib/logger", () => ({
  logAdminAction: async () => {},
}));

// Authorize every call as a global ADMIN, mirroring the user/roles lookup chain
// in `assertCallerCanManageRiders`.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-admin" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "admin-user", roles: { code: "ADMIN" } },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

// Resolve a clinic only when its id is an existing clinic; otherwise `null`
// (invalid / nonexistent target). This is the validity gate exercised by
// `assignRiderToClinic` (Req 8.5: "active" ≡ "exists").
vi.mock("@/repositories/clinic/clinicRepository", () => ({
  getClinicById: async (id: string) =>
    existingClinics.has(id)
      ? {
          id,
          name: `Clinic ${id}`,
          address: "addr",
          latitude: 0,
          longitude: 0,
          kitchen_id: "kitchen-1",
          franchise_id: null,
        }
      : null,
}));

// Back the rider read/write with the in-memory `rider_profiles` store. A small
// chainable query builder reproduces the two chains used by the action:
//   read  : .from("rider_profiles").select("id, clinic_id").eq("id", riderId).maybeSingle()
//   write : .from("rider_profiles").update({ clinic_id }).eq("id", riderId)
vi.mock("@/lib/supabase/admin", () => {
  function makeQuery(table: string) {
    let op: "select" | "update" = "select";
    let updateData: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};

    const builder: any = {
      select: () => {
        op = "select";
        return builder;
      },
      update: (data: Record<string, unknown>) => {
        op = "update";
        updateData = data;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      maybeSingle: () => {
        if (table === "rider_profiles" && op === "select") {
          const riderId = filters["id"] as string;
          if (!riderStore.has(riderId)) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({
            data: { id: riderId, clinic_id: riderStore.get(riderId) ?? null },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // Awaiting the builder directly executes a pending update.
      then: (onFulfilled: any, onRejected: any) => {
        if (table === "rider_profiles" && op === "update" && updateData) {
          const riderId = filters["id"] as string;
          if (riderStore.has(riderId)) {
            riderStore.set(
              riderId,
              (updateData["clinic_id"] as string | null) ?? null
            );
          }
        }
        return Promise.resolve({ data: null, error: null }).then(
          onFulfilled,
          onRejected
        );
      },
    };
    return builder;
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => makeQuery(table),
    }),
  };
});

// Import AFTER the mocks are registered so the action binds to the fakes.
import { assignRiderToClinic } from "../riderClinicActions";

// ─── Generators ────────────────────────────────────────────────────────────

const arbRiderId = fc.uuid();

// The rider's pre-existing linkage: sometimes unlinked (null), sometimes an
// existing clinic id.
const arbPreexisting = fc.option(fc.uuid(), { nil: null });

const arbTargetClinic = fc.uuid();

// Whether the target clinic resolves (valid) or not (invalid / nonexistent).
const arbTargetValid = fc.boolean();

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Property 15: Rider–clinic assignment rejects invalid targets", () => {
  beforeEach(() => {
    riderStore.clear();
    existingClinics.clear();
  });

  it("rejects assignment to a clinic that does not resolve and leaves any existing linkage unchanged; a resolving target updates the linkage", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRiderId,
        arbPreexisting,
        arbTargetClinic,
        arbTargetValid,
        async (riderId, preexisting, targetClinic, targetValid) => {
          // Arrange: the rider exists with its pre-existing linkage. Any
          // pre-existing clinic is itself a valid (existing) clinic.
          riderStore.clear();
          existingClinics.clear();
          riderStore.set(riderId, preexisting);
          if (preexisting !== null) existingClinics.add(preexisting);

          // Make the target resolve or not based on validity. Guard the rare
          // collision where a randomly-generated "invalid" target equals the
          // pre-existing (existing) clinic.
          const isValid = targetValid || targetClinic === preexisting;
          if (isValid) existingClinics.add(targetClinic);

          // Act.
          const result = await assignRiderToClinic(riderId, targetClinic);

          const storedAfter = riderStore.get(riderId) ?? null;

          if (isValid) {
            // Resolving target ⇒ success and the linkage becomes the target.
            expect(result.success).toBe(true);
            expect(storedAfter).toBe(targetClinic);
          } else {
            // Nonexistent / invalid target ⇒ rejection with the linkage left
            // exactly as it was (Req 8.5).
            expect(result.success).toBe(false);
            expect(storedAfter).toBe(preexisting);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
