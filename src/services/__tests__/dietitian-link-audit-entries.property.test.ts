/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/__tests__/dietitian-link-audit-entries.property.test.ts
// Feature: dietitian-management, Property 10
//
// Property 10: Dietitian_Link audit entries record both endpoints.
//
//   For any sequence of Dietitian_Link changes on a Customer_Record, the
//   audit trail contains exactly one entry per change, each identifying the
//   acting user, the Customer_Record, the previous Dietitian and the new
//   Dietitian.
//
// Validates: Requirements 6.8
//
// `AssignmentService.setDietitianLink` performs I/O via `@/lib/supabase/admin`'s
// `createAdminClient`, writing the audit trail as one `admin_activity_logs`
// insert per changed write (`recordDietitianLinkChange`, private to
// `AssignmentService.ts`). We MOCK that dependency with the same in-memory
// `customer_profiles`/`users`/`admin_activity_logs` fake (the `vi.hoisted`
// pattern shared with `src/services/__tests__/dietitian-link-writes.property.test.ts`
// and `src/services/__tests__/onboardingService.property.test.ts`) so the
// audit-write logic runs deterministically, with no real database involved.
//
// vitest + fast-check, >=100 runs.

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

  /** Seed a `users` row with a given `admin_access_level`. */
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
import { setDietitianLink } from "@/services/AssignmentService";

const { db } = H;

// ─── Generators ────────────────────────────────────────────────────────────────
const DIETITIAN_IDS = ["dietitian-1", "dietitian-2", "dietitian-3"] as const;
const ACTING_USER_IDS = ["admin-1", "admin-2", "admin-3"] as const;

const profileIdArb = fc.uuid();

/** A Dietitian_Link value, including the empty (`null`) link (Req 6.2). */
const dietitianLinkArb = fc.oneof(
  { arbitrary: fc.constant<string | null>(null), weight: 2 },
  { arbitrary: fc.constantFrom(...DIETITIAN_IDS), weight: 3 },
);

/** The acting user for one write, including a system-initiated `null` actor. */
const actingUserArb = fc.oneof(
  { arbitrary: fc.constant<string | null>(null), weight: 1 },
  { arbitrary: fc.constantFrom(...ACTING_USER_IDS), weight: 2 },
);

/** One step of a Dietitian_Link change sequence: who wrote, and what value. */
const stepArb = fc.record({
  actingUserId: actingUserArb,
  dietitianUserId: dietitianLinkArb,
});

/** A sequence of 1..12 successive Dietitian_Link writes on one Customer_Record. */
const sequenceArb = fc.array(stepArb, { minLength: 1, maxLength: 12 });

/** Seeds every Dietitian `users` row fresh for one property run. */
function seedUsers() {
  for (const id of DIETITIAN_IDS) H.seedUser(id, "dietitian");
}

beforeEach(() => {
  H.reset();
});

// ─── Property 10: Dietitian_Link audit entries record both endpoints ───────────
// Validates: Requirements 6.8
describe("Property 10: Dietitian_Link audit entries record both endpoints", () => {
  it(
    "for any sequence of Dietitian_Link writes, the audit trail contains exactly one entry per " +
      "actual change, each naming the acting user, the Customer_Record, the previous Dietitian and " +
      "the new Dietitian",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          profileIdArb,
          dietitianLinkArb,
          sequenceArb,
          async (profileId, initialLink, sequence) => {
            H.reset();
            seedUsers();
            H.seedProfile(profileId, initialLink);

            // Expected audit entries, built alongside the real calls from the
            // caller's point of view (i.e. independent of the SUT's internals).
            const expectedEntries: Array<{
              actingUserId: string | null;
              previousDietitianId: string | null;
              dietitianId: string | null;
            }> = [];

            let currentLink = initialLink;

            for (const step of sequence) {
              const previousLink = currentLink;

              const result = await setDietitianLink({
                customerProfileId: profileId,
                dietitianUserId: step.dietitianUserId,
                actingUserId: step.actingUserId,
              });

              expect(result.ok).toBe(true);
              if (!result.ok) continue;

              // The stored value always reflects the write (every candidate here
              // is either a seeded Dietitian or `null`, so nothing is rejected).
              expect(result.dietitianId).toBe(step.dietitianUserId);
              currentLink = result.dietitianId;

              const actuallyChanged = previousLink !== step.dietitianUserId;
              expect(result.changed).toBe(actuallyChanged);

              if (actuallyChanged) {
                expectedEntries.push({
                  actingUserId: step.actingUserId,
                  previousDietitianId: previousLink,
                  dietitianId: step.dietitianUserId,
                });
              }
            }

            // Exactly one audit entry per actual change — no more, no fewer.
            expect(db.activityLogs.length).toBe(expectedEntries.length);

            db.activityLogs.forEach((entry, i) => {
              const expected = expectedEntries[i];
              // Identifies the acting user (Req 6.8).
              expect(entry.admin_id).toBe(expected.actingUserId);
              // Identifies the Customer_Record.
              expect(entry.entity_id).toBe(profileId);
              expect(entry.entity_type).toBe("customer");
              // Identifies the previous Dietitian and the new Dietitian.
              expect(entry.details.previous_dietitian_id).toBe(
                expected.previousDietitianId,
              );
              expect(entry.details.dietitian_id).toBe(expected.dietitianId);
            });
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it("writing an unchanged value mid-sequence records no additional entry for that step", async () => {
    await fc.assert(
      fc.asyncProperty(
        profileIdArb,
        dietitianLinkArb,
        actingUserArb,
        actingUserArb,
        async (profileId, link, firstActor, secondActor) => {
          H.reset();
          seedUsers();
          H.seedProfile(profileId, null);

          // First write establishes `link` (records an entry iff link !== null).
          const first = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: link,
            actingUserId: firstActor,
          });
          expect(first.ok).toBe(true);

          const entriesAfterFirst = db.activityLogs.length;

          // Second write repeats the exact same value, by a possibly different actor.
          const second = await setDietitianLink({
            customerProfileId: profileId,
            dietitianUserId: link,
            actingUserId: secondActor,
          });
          expect(second.ok).toBe(true);
          if (second.ok) {
            expect(second.changed).toBe(false);
          }

          // No new entry was appended for the no-op second write.
          expect(db.activityLogs.length).toBe(entriesAfterFirst);
        },
      ),
      { numRuns: 100 },
    );
  });
});
