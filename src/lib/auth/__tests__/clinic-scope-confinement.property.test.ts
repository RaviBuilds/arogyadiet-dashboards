// src/lib/auth/__tests__/clinic-scope-confinement.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 17 (superseded — see note)
//
// Property 17: Clinic scope confines Shop Products reads, and now ALSO
// confines the Customers / Subscriptions / Riders workspace reads to the same
// assigned clinic.
//
// SUPERSEDED NOTE: this property originally asserted the Customers,
// Subscriptions and Riders workspace pages NEVER filtered by
// `admin_clinic_id` ("clinic scope confines Shop Products and nothing else").
// That was a deliberate design choice at the time, but it left a real gap: a
// frontdesk admin scoped to one clinic (e.g. Madhapur) could still see every
// other clinic's and franchise's customer/subscription/rider data through
// those three workspaces, because they were explicitly never filtered. This
// has been widened — the Customers, Subscriptions and Riders pages now DO
// confine their queries to `admin_clinic_id` for a Clinic_Scoped_Admin, via
// the same `resolveReadableClinicId` chokepoint Shop Products already used.
// An Unscoped_Operations_Admin (and MASTER_ADMIN) is completely unaffected —
// `resolveReadableClinicId(null, requested)` still always passes through.
//
// For any clinic-scoped admin and any requested clinic identifier, a Clinic
// Shop Stock or Clinic Shop Ledger read resolves to the admin's assigned
// clinic when the request matches it or names nothing, and is rejected
// otherwise; and for any customer, subscription, or rider data set, the rows
// returned to that admin are now ALSO confined to the assigned clinic — no
// wider than Shop Products, and never leaking another clinic's or
// franchise's rows.
//
// Validates: Requirements 12.1, 12.9, 14.4, 14.5, 14.6, 14.7 (14.1-14.3, 14.9
// — the old "and nothing else" requirements — are superseded by the new
// clinic-confinement behavior described above)
//
// HOW THIS IS COVERED:
//   - The Shop Products / ledger confinement half is exercised twice: once
//     directly over the pure chokepoint `resolveReadableClinicId` against a
//     reference predicate transcribed independently from Req 14.6/14.7/12.9,
//     and once end to end through `checkClinicScope`/`assertClinicScope`
//     (which resolve the caller's context via the mocked Supabase SSR client
//     and then delegate to the same chokepoint) — proving the real
//     context-resolution path agrees with the pure model.
//   - The Customers / Subscriptions / Riders confinement half is a structural
//     fact, not a runtime one (those pages read via the service-role client,
//     which bypasses RLS): each workspace page must resolve `clinicId` from
//     `getCurrentAdminContext()` and apply an `admin_clinic_id`/`clinic_id`
//     filter when it is set. Checked the same way
//     `operational-write-denial.property.test.ts` checks architectural facts —
//     `readFileSync` + regex assertions on the source, not a live property.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";

// `server-only` throws if imported outside an RSC bundle; stub it for tests.
vi.mock("server-only", () => ({}));

// redirect() normally throws a Next.js control-flow signal; not exercised by
// checkClinicScope/assertClinicScope, but adminAccess.ts imports it at module
// load, so it must be mocked regardless.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

// Controllable fake Supabase SSR client: `users` resolves via .single(), which
// is all `getCurrentAdminContext` (the resolver behind checkClinicScope /
// assertClinicScope) reads.
const getUserMock = vi.fn();
const usersSingleMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: usersSingleMock,
        }),
      }),
    }),
  }),
}));

import {
  checkClinicScope,
  assertClinicScope,
  ClinicScopeDeniedError,
} from "@/lib/auth/adminAccess";
import { resolveReadableClinicId } from "@/lib/auth/adminAccessCore";

const NUM_RUNS = 150;
const REPO_ROOT = process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sets up the mocked session as an `operations`-level admin with the given Clinic_Scope_Assignment. */
function setOperationsAdmin(clinicId: string | null) {
  getUserMock.mockResolvedValue({ data: { user: { id: "auth-1" } } });
  usersSingleMock.mockResolvedValue({
    data: {
      id: "admin-1",
      admin_access_level: "operations",
      admin_operations_access: null,
      admin_clinic_id: clinicId,
      roles: { code: "ADMIN" },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A small pool of uuid-like clinic ids, reused for both the assigned clinic
 * and the requested clinic, so matches and mismatches both occur frequently.
 */
const CLINIC_POOL = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
] as const;

const arbClinicId: fc.Arbitrary<string> = fc.constantFrom(...CLINIC_POOL);

/** An assigned Clinic_Scope_Assignment: null (unscoped admin) or a pool clinic. */
const arbAssigned: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  arbClinicId,
);

/** A requested clinic id: null (no clinic named) or a pool clinic. */
const arbRequested: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  arbClinicId,
);

// ─── Reference predicate ────────────────────────────────────────────────────
//
// Transcribed independently from Requirement 14.6/14.7/12.9's wording (not
// derived from the implementation):
//   - an Unscoped_Operations_Admin's request always passes through unfiltered
//     (Req 12.9's "no filter" default; 14.6's "requested clinic other than
//     the assignment" only applies to a scoped admin)
//   - a Clinic_Scoped_Admin's request is confined to the assignment when the
//     request matches it or names nothing
//   - a Clinic_Scoped_Admin's request naming a different clinic is rejected
//     (Req 14.6, 14.7)
type ReferenceResolution =
  | { ok: true; clinicId: string | null }
  | { ok: false };

function referenceResolve(
  assigned: string | null,
  requested: string | null,
): ReferenceResolution {
  if (assigned === null) {
    // Unscoped admin: no clinic-scope filter applies at all.
    return { ok: true, clinicId: requested };
  }
  // Clinic-scoped admin: request must match the assignment, or name nothing.
  if (requested === null || requested === assigned) {
    return { ok: true, clinicId: assigned };
  }
  return { ok: false };
}

// ─── Property 17, part 1: the pure chokepoint vs. the reference model ───────

describe("Property 17: Clinic scope confines Shop Products reads and nothing else", () => {
  it("resolveReadableClinicId agrees with the independently-transcribed reference predicate for every assignment and request (Req 12.9, 14.6, 14.7)", () => {
    fc.assert(
      fc.property(arbAssigned, arbRequested, (assigned, requested) => {
        const actual = resolveReadableClinicId(assigned, requested);
        const expected = referenceResolve(assigned, requested);

        expect(actual.ok).toBe(expected.ok);
        if (actual.ok && expected.ok) {
          expect(actual.clinicId).toBe(expected.clinicId);
        }
        if (!actual.ok) {
          expect(typeof actual.error).toBe("string");
          expect(actual.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("an unscoped admin's request always passes through unfiltered, for any requested clinic (Req 12.9)", () => {
    fc.assert(
      fc.property(arbRequested, (requested) => {
        const result = resolveReadableClinicId(null, requested);
        expect(result).toEqual({ ok: true, clinicId: requested });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a scoped admin's request is confined to the assignment when it matches or names nothing, and rejected otherwise (Req 14.6, 14.7)", () => {
    fc.assert(
      fc.property(arbClinicId, arbRequested, (assigned, requested) => {
        const result = resolveReadableClinicId(assigned, requested);
        if (requested === null || requested === assigned) {
          expect(result).toEqual({ ok: true, clinicId: assigned });
        } else {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property 17, part 2: the real context-resolution path agrees ─────────
  //
  // `checkClinicScope`/`assertClinicScope` resolve the caller's context
  // through the (mocked) Supabase SSR client and then delegate to
  // `resolveReadableClinicId` — this proves the end-to-end path carries the
  // same contract as the pure model, for both an unscoped and a clinic-scoped
  // `operations` admin.

  it("checkClinicScope end-to-end matches resolveReadableClinicId for any operations admin (unscoped or clinic-scoped) and any requested clinic (Req 12.1, 12.9, 14.4, 14.6, 14.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbAssigned, arbRequested, async (assigned, requested) => {
        setOperationsAdmin(assigned);

        const result = await checkClinicScope(requested);
        const expected = resolveReadableClinicId(assigned, requested);

        expect(result.ok).toBe(expected.ok);
        if (result.ok && expected.ok) {
          expect(result.clinicId).toBe(expected.clinicId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("assertClinicScope end-to-end mirrors checkClinicScope: resolves on ok, throws ClinicScopeDeniedError on rejection (Req 14.6, 14.7)", async () => {
    await fc.assert(
      fc.asyncProperty(arbAssigned, arbRequested, async (assigned, requested) => {
        setOperationsAdmin(assigned);

        const expected = resolveReadableClinicId(assigned, requested);
        if (expected.ok) {
          const clinicId = await assertClinicScope(requested);
          expect(clinicId).toBe(expected.clinicId);
        } else {
          await expect(assertClinicScope(requested)).rejects.toBeInstanceOf(
            ClinicScopeDeniedError,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property 17, part 3: Customers/Subscriptions/Riders confinement is
  // structural ──────────────────────────────────────────────────────────────
  //
  // Each of the customers, subscriptions and riders workspace listing pages
  // must resolve the admin's Clinic_Scope_Assignment (via
  // `getCurrentAdminContext()`, which is what carries `clinicId` — the
  // `admin_clinic_id` column) and apply a clinic filter to its query when
  // that assignment is set, so a Clinic_Scoped_Admin's read is confined to
  // their one clinic exactly like Shop Products.

  it("the customers, subscriptions and riders workspace pages resolve the admin's clinic scope and confine their queries to it (Req 14.4-14.7)", () => {
    const workspacePages = [
      path.join("src", "app", "admin", "(main)", "customers", "page.tsx"),
      path.join("src", "app", "admin", "(main)", "subscriptions", "page.tsx"),
      path.join("src", "app", "admin", "(main)", "riders", "page.tsx"),
    ];

    for (const relPath of workspacePages) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      // Resolves the admin's Clinic_Scope_Assignment via the same context
      // resolver Shop Products uses (either directly, or through
      // `guardCustomersWorkspace()`'s `clinicId` passthrough on Customers).
      expect(source).toMatch(/getCurrentAdminContext|guardCustomersWorkspace/);
      expect(source).toMatch(/clinicId/);
      // Applies a clinic-scoped filter (`clinic_id` on the confined table, or
      // the embedded `customer_profiles.clinic_id` filter used by
      // Subscriptions) rather than reading every clinic unconditionally.
      expect(source).toMatch(/\.eq\(\s*["'](clinic_id|customer_profiles\.clinic_id)["']/);
    }
  });
});
