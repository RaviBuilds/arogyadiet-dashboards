/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/dietitian-link-writes.property.test.ts
// Feature: dietitian-management, Property 8
//
// Property 8: Dietitian_Link writes round-trip and are idempotent.
//
//   For any Customer_Record of any Customer_Category and any Dietitian_Link
//   value including empty, reading the persisted link and writing the read
//   value back leaves the stored link unchanged, and writing the same value
//   twice produces the same stored state as writing it once. For any
//   candidate user that is not a Dietitian, the write is rejected with
//   `Selected user is not a dietitian` and nothing is stored.
//
// Validates: Requirements 6.2, 6.4, 6.6, 6.7
//
// `AssignmentService.getDietitianLink`/`setDietitianLink` perform I/O via
// `@/lib/supabase/admin`'s `createAdminClient`. We MOCK that dependency with an
// in-memory fake `customer_profiles`/`users`/`admin_activity_logs` store (the
// same `vi.hoisted` in-memory-DB pattern as
// `src/services/__tests__/onboardingService.property.test.ts`) so the
// round-trip/idempotence/rejection logic in
// `src/repositories/dietitian/assignmentRepository.ts` and
// `src/services/AssignmentService.ts` runs deterministically, with no real
// database involved.
//
// vitest + fast-check, >=100 runs per property.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory world (hoisted so the vi.mock factories can close over it)
const H = vi.hoisted(() => {
  const db: {
    profiles: Map<string, { id: string; dietitian_id: string | null }>;
    users: Map<string, { admin_access_level: string }>;
    activityLogs: any[];
  } = {
    profiles: new Map(),
    users: new Map(),
    activityLogs: [],
  };

  function reset() {
    db.profiles.clear();
    db.users.clear();
    db.activityLogs.length = 0;
  }

  /** Seed (or overwrite) a Customer_Record's stored Dietitian_Link. */
  function seedProfile(id: string, dietitianId: string | null) {
    db.profiles.set(id, { id, dietitian_id: dietitianId });
  }

  /** Seed a `users` row with a given `admin_access_level` (or leave absent). */
  function seedUser(id: string, adminAccessLevel: string) {
    db.users.set(id, { admin_access_level: adminAccessLevel });
  }

  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let updatePayload: Record<string, unknown> | undefined;

    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return b;
      },
      // customer_profiles.select("dietitian_id").eq("id", id).maybeSingle()
      // users.select("admin_access_level").eq("id", id).maybeSingle()
      maybeSingle: async () => {
        if (table === "customer_profiles") {
          const row = db.profiles.get(filters.id as string);
          return {
            data: row ? { dietitian_id: row.dietitian_id } : null,
            error: null,
          };
        }
        if (table === "users") {
          const row = db.users.get(filters.id as string);
          return {
            data: row ? { admin_access_level: row.admin_access_level } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
      // customer_profiles.update({dietitian_id}).eq("id", id).select("dietitian_id").single()
      single: async () => {
        if (table === "customer_profiles" && updatePayload) {
          const id = filters.id as string;
          let row = db.profiles.get(id);
          if (!row) {
            row = { id, dietitian_id: null };
            db.profiles.set(id, row);
          }
          row.dietitian_id = (updatePayload.dietitian_id as string | null) ?? null;
          return { data: { dietitian_id: row.dietitian_id }, error: null };
        }
        return { data: null, error: { message: "not found" } };
      },
      // admin_activity_logs.insert({...}) — awaited directly, no further chain.
      insert: async (obj: any) => {
        if (table === "admin_activity_logs") {
          db.activityLogs.push(obj);
        }
        return { data: null, error: null };
      },
    };
    return b;
  }

  function makeFakeAdmin() {
    return { from: (t: string) => makeBuilder(t) };
  }

  reset();
  return { db, reset, seedProfile, seedUser, makeFakeAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => H.makeFakeAdmin(),
}));

// ─── System under test (imported after the mock is registered) ─────────────────
import { getDietitianLink, setDietitianLink } from "@/services/AssignmentService";
import { SELECTED_USER_IS_NOT_A_DIETITIAN } from "@/lib/dietitian/messages";

const { db } = H;

// ─── Generators ────────────────────────────────────────────────────────────────
const CATEGORIES = ["MEAL", "KIT", "ACCOMMODATION"] as const;

const DIETITIAN_IDS = ["dietitian-1", "dietitian-2", "dietitian-3"] as const;
/** Existing `users` rows whose Access_Level is anything but `dietitian`. */
const NON_DIETITIAN_EXISTING_IDS = ["staff-inventory", "staff-operations", "staff-full"] as const;
const NON_DIETITIAN_ACCESS_LEVELS = ["inventory", "operations", "inventory_operations"] as const;
/** `users` ids with no row at all — `isDietitianUser` must treat these as false too. */
const MISSING_USER_IDS = ["missing-user-1", "missing-user-2"] as const;

/** Every category — the property must hold irrespective of Customer_Category. */
const categoryArb = fc.constantFrom(...CATEGORIES);

/** A Dietitian_Link value, including the empty (`null`) link (Req 6.2). */
const dietitianLinkArb = fc.oneof(
  { arbitrary: fc.constant<string | null>(null), weight: 2 },
  { arbitrary: fc.constantFrom(...DIETITIAN_IDS), weight: 3 },
);

/** A candidate that is NOT a Dietitian: an existing non-Dietitian user, or a missing one. */
const nonDietitianCandidateArb = fc.constantFrom(
  ...NON_DIETITIAN_EXISTING_IDS,
  ...MISSING_USER_IDS,
);

const profileIdArb = fc.uuid();

/** Seeds every Dietitian/non-Dietitian users row fresh for one property run. */
function seedUsers() {
  for (const id of DIETITIAN_IDS) H.seedUser(id, "dietitian");
  NON_DIETITIAN_EXISTING_IDS.forEach((id, i) =>
    H.seedUser(id, NON_DIETITIAN_ACCESS_LEVELS[i % NON_DIETITIAN_ACCESS_LEVELS.length]),
  );
  // MISSING_USER_IDS deliberately left unseeded.
}

beforeEach(() => {
  H.reset();
});

// ─── Property 8: Dietitian_Link writes round-trip and are idempotent ───────────
// Validates: Requirements 6.2, 6.4, 6.6, 6.7
describe("Property 8: Dietitian_Link writes round-trip and are idempotent", () => {
  it("reading the persisted link and writing it back leaves the stored link unchanged, for any category and any link value including empty", async () => {
    await fc.assert(
      fc.asyncProperty(
        profileIdArb,
        categoryArb,
        dietitianLinkArb,
        async (profileId, _category, initialLink) => {
          H.reset();
          seedUsers();
          H.seedProfile(profileId, initialLink);

          const readBack = await getDietitianLink(profileId);
          expect(readBack).toBe(initialLink);

          const result = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: readBack,
            actingUserId: null,
          });

          expect(result.ok).toBe(true);
          if (result.ok) {
            // Writing back exactly what was read is a no-op change.
            expect(result.changed).toBe(false);
            expect(result.dietitianId).toBe(initialLink);
          }

          const afterWrite = await getDietitianLink(profileId);
          expect(afterWrite).toBe(initialLink);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("writing the same value twice produces the same stored state as writing it once, for any category", async () => {
    await fc.assert(
      fc.asyncProperty(
        profileIdArb,
        categoryArb,
        dietitianLinkArb,
        dietitianLinkArb,
        async (profileId, _category, initialLink, targetValue) => {
          H.reset();
          seedUsers();
          H.seedProfile(profileId, initialLink);

          const firstWrite = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: targetValue,
            actingUserId: null,
          });
          expect(firstWrite.ok).toBe(true);
          const stateAfterFirst = await getDietitianLink(profileId);
          expect(stateAfterFirst).toBe(targetValue);

          const secondWrite = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: targetValue,
            actingUserId: null,
          });
          expect(secondWrite.ok).toBe(true);
          const stateAfterSecond = await getDietitianLink(profileId);

          // Same stored state as after the first write — idempotence (Req 6.6).
          expect(stateAfterSecond).toBe(stateAfterFirst);
          if (secondWrite.ok) {
            expect(secondWrite.changed).toBe(false);
            expect(secondWrite.previousDietitianId).toBe(targetValue);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects a candidate that is not a Dietitian with the pinned message and stores nothing, for any category", async () => {
    await fc.assert(
      fc.asyncProperty(
        profileIdArb,
        categoryArb,
        dietitianLinkArb,
        nonDietitianCandidateArb,
        async (profileId, _category, initialLink, candidateId) => {
          H.reset();
          seedUsers();
          H.seedProfile(profileId, initialLink);

          const result = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: candidateId,
            actingUserId: null,
          });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("NOT_A_DIETITIAN");
            expect(result.message).toBe(SELECTED_USER_IS_NOT_A_DIETITIAN);
            expect(result.message).toBe("Selected user is not a dietitian");
          }

          // Nothing was stored — the link is exactly what it was before the call.
          const stored = await getDietitianLink(profileId);
          expect(stored).toBe(initialLink);
          // No audit entry was written for a rejected write either.
          expect(db.activityLogs.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
