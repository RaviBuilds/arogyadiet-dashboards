// Feature: core-clinic-architecture, Property 8: Pincode move is atomic and single-homed
//
// Property test for the atomic, single-homed pincode move performed by
// `movePincode` (src/actions/admin-actions/serviceAreaActions.ts).
//
// Property 8: Pincode move is atomic and single-homed
//   For any pincode associated with a source clinic, a SUCCESSFUL move
//   associates it ONLY with the destination clinic; if the move FAILS it
//   remains ONLY with the source clinic. In no observable state is the pincode
//   associated with BOTH clinics at once.
//
// The authoritative move is the Postgres RPC `move_pincode_and_reassign`,
// invoked by `movePincode` via `createAdminClient().rpc(...)`. A live Supabase
// connection is unavailable in unit tests, so the RPC is modeled against an
// IN-MEMORY transactional store: `@/lib/supabase/admin` is mocked so that
//   - `.rpc("move_pincode_and_reassign", args)` atomically re-homes the
//     pincode in a Map<pincode, clinicId> (modeling
//     `UPDATE ... SET clinic_id = to WHERE pincode = ? AND clinic_id = from`),
//   - a fault-injection mode makes the RPC return an error WITHOUT mutating the
//     store (modeling a transactional ROLLBACK), and
//   - the `clinics` / `rider_service_areas` lookups resolve so both clinics
//     exist and there are no rider mappings.
// Auth (`@/lib/supabase/server`) resolves an ADMIN, and `next/cache` /
// `@/lib/logger` are stubbed.
//
// Validates: Requirements 4.4, 5.7

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ─── Shared in-memory state (declared before the admin mock factory) ─────────
//
// pincodeStore models `rider_service_areas`: exactly one clinic per pincode
// (the `uq_service_area_pincode` invariant), so a pincode is inherently
// single-homed. rpcControl injects a transactional failure for a given run.

const pincodeStore = new Map<string, string>();
const rpcControl = { shouldFail: false, reassignedCount: 0 };

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub Next.js cache revalidation (no-op outside a request scope).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

// Stub the admin action logger.
vi.mock("@/lib/logger", () => ({
  logAdminAction: async () => {},
}));

// Authorize every call as a global ADMIN. `movePincode` awaits `createClient()`
// then reads the auth user and the user's role.
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
          }),
        }),
      }),
    }),
  }),
}));

// Mock the service-role admin client. A small chainable query builder routes by
// table; the RPC performs the atomic move (or injected rollback) on the store.
vi.mock("@/lib/supabase/admin", () => {
  function makeQuery(table: string) {
    const filters: Record<string, unknown> = {};

    const resolveSingle = () => {
      if (table === "clinics") {
        // Both source and destination clinics always exist.
        const id = filters["id"] as string;
        return { data: { id, name: `Clinic ${id}` }, error: null };
      }
      if (table === "rider_service_areas") {
        // findPincodeOwnerClinic: report the current owner from the store.
        const pincode = filters["pincode"] as string;
        const clinicId = pincodeStore.get(pincode) ?? null;
        return { data: { clinic_id: clinicId, clinics: null }, error: null };
      }
      return { data: null, error: null };
    };

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      limit: () => builder,
      // Terminal for fetchPincodeRiderMappings: no rider mappings.
      not: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve(resolveSingle()),
      single: () => Promise.resolve(resolveSingle()),
      // Allow the builder to be awaited directly if used as a thenable.
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
    };
    return builder;
  }

  const createAdminClient = () => ({
    from: (table: string) => makeQuery(table),
    rpc: async (fnName: string, args: Record<string, any>) => {
      if (fnName !== "move_pincode_and_reassign") {
        return { data: null, error: null };
      }
      const { p_pincode, p_from_clinic, p_to_clinic } = args;

      // Fault injection: the transaction fails and rolls back — the store is
      // left UNCHANGED (the pincode stays homed to the source clinic).
      if (rpcControl.shouldFail) {
        return {
          data: null,
          error: { message: "injected transactional failure", code: "P0001" },
        };
      }

      // Atomic move: re-home only when the pincode is currently at the source
      // (models `WHERE pincode = ? AND clinic_id = from`). Single Map value =>
      // the pincode can never be associated with both clinics at once.
      if (pincodeStore.get(p_pincode) === p_from_clinic) {
        pincodeStore.set(p_pincode, p_to_clinic);
      }
      return { data: rpcControl.reassignedCount, error: null };
    },
  });

  return { createAdminClient };
});

// Import AFTER the mocks are registered so the action binds to the fakes.
import { movePincode } from "../serviceAreaActions";

// ─── Generators ────────────────────────────────────────────────────────────

const arbPincode = fc.stringMatching(/^[0-9]{6}$/);

// Distinct source/destination clinic ids so "only source" vs "only destination"
// are observably different outcomes.
const arbDistinctClinics = fc
  .tuple(fc.uuid(), fc.uuid())
  .filter(([from, to]) => from !== to);

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Pincode move is atomic and single-homed - Property 8", () => {
  beforeEach(() => {
    pincodeStore.clear();
    rpcControl.shouldFail = false;
    rpcControl.reassignedCount = 0;
  });

  it("a successful move homes the pincode only to the destination; a failed move leaves it only at the source; never both", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPincode,
        arbDistinctClinics,
        fc.boolean(),
        fc.nat({ max: 1000 }),
        async (pincode, [fromClinic, toClinic], shouldFail, reassignedCount) => {
          // Arrange: the pincode starts homed to the SOURCE clinic.
          pincodeStore.clear();
          pincodeStore.set(pincode, fromClinic);
          rpcControl.shouldFail = shouldFail;
          rpcControl.reassignedCount = reassignedCount;

          // Act.
          const result = await movePincode(pincode, fromClinic, toClinic);

          // Assert: the pincode is associated with exactly ONE clinic.
          const owner = pincodeStore.get(pincode);
          expect(owner === fromClinic || owner === toClinic).toBe(true);

          if (shouldFail) {
            // Failure: rolled back — homed ONLY to the source.
            expect(result.success).toBe(false);
            expect(owner).toBe(fromClinic);
            expect(owner).not.toBe(toClinic);
          } else {
            // Success: homed ONLY to the destination.
            expect(result.success).toBe(true);
            expect(owner).toBe(toClinic);
            expect(owner).not.toBe(fromClinic);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
