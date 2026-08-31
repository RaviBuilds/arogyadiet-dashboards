// src/lib/auth/__tests__/operational-write-denial.property.test.ts
// Feature: dietitian-management, Property 4
//
// Property 4: Every operational write is denied to a Dietitian.
//
// For any Dietitian caller and any guarded write operation over the
// enumerated set — Customer_Record, address, subscription, payment, shop
// order, onboarding, Self_Log, and franchise-user create/edit/delete — the
// operation is rejected with an authorization error and leaves the stored
// state unchanged.
//
// Validates: Requirements 5.10, 16.5, 21.4, 25.4
//
// HOW THE ENUMERATED SET MAPS TO CODE:
//   - Customer_Record / address / subscription / payment / shop order
//     (shop_products) / onboarding (customers group) writes ALL funnel
//     through the single operations-group choke point `checkGroupManage`
//     (adminSubscriptionActions.ts, customerActions.ts, onboardingActions.ts,
//     inventoryActions.ts, dietitianAssignmentActions.ts, ...). `dietitian`
//     is an allow-list level that grants no operations group
//     (`hasGroupAccess`/`canManageGroup` are unconditionally `false` for it —
//     Req 26.5, 26.6), so proving `checkGroupManage` denies every group for a
//     Dietitian caller (core ADMIN or Franchise FRANCHISE_ADMIN) covers this
//     whole bucket in one property.
//   - Self_Log writes: there is no write function anywhere in
//     `healthLogRepository.ts` / `healthLogActions.ts` for `kit_daily_logs`,
//     `customer_health_logs` or `admin_health_logs` — checked structurally,
//     the same way `smoke.test.ts` checks architectural facts.
//   - Franchise-user create/edit/delete: `franchiseUserActions.ts` gates
//     every export on `resolveScope().scope.kind === "full_network"`, and
//     `resolveScope` never resolves a `FRANCHISE_ADMIN` (every Franchise
//     Dietitian's role) to `full_network` — checked as a property over
//     `resolveScope` plus a structural check of the gate itself.
//
// The contrasting half of the property — that a Dietitian's OWN legitimate
// actions (the Health_Log write path, the customer list/detail reads, the
// Report_Card reads) are NOT incorrectly denied — is checked via
// `checkDietitianScope`, the separate choke point those actions self-gate
// through, and a structural check that they never import the operations-group
// machinery that denies everything else.
//
// vitest + fast-check, >=100 runs.

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";

// `server-only` throws if imported outside an RSC bundle; stub it for tests.
vi.mock("server-only", () => ({}));

// redirect() normally throws a Next.js control-flow signal; not exercised by
// the functions under test here, but adminAccess.ts imports it at module
// load, so it must be mocked regardless.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

// Controllable fake Supabase SSR client: `users` resolves via .single()
// (checkGroupManage's getCurrentAdminContext AND checkDietitianScope's
// getCurrentDietitianContext both read it), `customer_profiles` via
// .maybeSingle() (checkDietitianScope's scope-row read).
const getUserMock = vi.fn();
const usersSingleMock = vi.fn();
const customerRowMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: usersSingleMock,
          maybeSingle: table === "customer_profiles" ? customerRowMock : usersSingleMock,
        }),
      }),
    }),
  }),
}));

// `resolveScope` (src/lib/auth/scope-resolver.ts) delegates to
// `resolveFranchiseContext` for the caller's role + franchise_id — mocked
// directly so the franchise-user choke-point property doesn't need a live
// session/franchise-feature-flag chain.
const resolveFranchiseContextMock = vi.fn();
vi.mock("@/lib/franchise/context", () => ({
  resolveFranchiseContext: (...args: unknown[]) => resolveFranchiseContextMock(...args),
}));

import {
  checkGroupManage,
  checkDietitianScope,
} from "@/lib/auth/adminAccess";
import {
  OPERATIONS_GROUPS,
  PERMISSION_LEVELS,
  type OperationsGroup,
  type PermissionLevel,
} from "@/lib/auth/adminAccessCore";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { CUSTOMER_NOT_IN_SCOPE } from "@/lib/dietitian/messages";

const NUM_RUNS = 150;
const REPO_ROOT = process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setUsersRow(opts: {
  roleCode: string;
  level: string | null;
  groups?: unknown;
  clinicId?: string | null;
  franchiseId?: string | null;
  isActive?: boolean;
}) {
  getUserMock.mockResolvedValue({ data: { user: { id: "auth-1" } } });
  usersSingleMock.mockResolvedValue({
    data: {
      id: "dietitian-user-1",
      admin_access_level: opts.level,
      admin_operations_access: opts.groups ?? null,
      franchise_id: opts.franchiseId ?? null,
      dietitian_clinic_id: opts.clinicId ?? null,
      is_active: opts.isActive ?? true,
      roles: { code: opts.roleCode },
    },
  });
}

function setCustomerRow(
  row: null | { clinic_id?: string | null; franchise_id?: string | null; dietitian_id?: string | null },
) {
  customerRowMock.mockResolvedValue({
    data:
      row === null
        ? null
        : {
            id: "customer-1",
            clinic_id: row.clinic_id ?? null,
            franchise_id: row.franchise_id ?? null,
            dietitian_id: row.dietitian_id ?? null,
          },
  });
}

/** Every match of `.from("<table>")` on the source, tail truncated at the next statement boundary. */
function statementTailsFor(source: string, table: string): string[] {
  const pattern = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)([\\s\\S]{0,400})`, "g");
  const tails: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    tails.push(match[1].split(";")[0]);
  }
  return tails;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Generators ──────────────────────────────────────────────────────────────

/** The two role codes a Dietitian account may carry (core vs Franchise). */
const dietitianRoleArb: fc.Arbitrary<"ADMIN" | "FRANCHISE_ADMIN"> = fc.constantFrom(
  "ADMIN",
  "FRANCHISE_ADMIN",
);

const operationsGroupArb: fc.Arbitrary<OperationsGroup> = fc.constantFrom(...OPERATIONS_GROUPS);

/**
 * An arbitrary (possibly nonsensical) stray `admin_operations_access` payload.
 * `resolveAccessConfiguration` ignores this entirely for the `dietitian`
 * level (Req 1.5) — passing arbitrary groups through proves a stray grant can
 * never widen a Dietitian's write access.
 */
const strayGroupsArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 },
  {
    arbitrary: fc
      .array(
        fc.tuple(
          fc.constantFrom(...OPERATIONS_GROUPS),
          fc.constantFrom(...PERMISSION_LEVELS),
        ),
        { maxLength: 6 },
      )
      .map((entries) => Object.fromEntries(entries) as Partial<Record<OperationsGroup, PermissionLevel>>),
    weight: 3,
  },
);

// ─── Property 4, part 1: the operations-group choke point ───────────────────
//
// Covers Customer_Record, address, subscription, payment, shop order
// (shop_products) and onboarding (customers) writes — every one of those
// server actions calls `checkGroupManage(group)` before touching the database
// (Req 5.10, 16.5, 21.4's operational-write half).

describe("Property 4: Every operational write is denied to a Dietitian", () => {
  it("checkGroupManage denies every operations group to a Dietitian caller, core or franchise (Req 5.10, 16.5, 21.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        dietitianRoleArb,
        operationsGroupArb,
        strayGroupsArb,
        async (roleCode, group, strayGroups) => {
          setUsersRow({ roleCode, level: "dietitian", groups: strayGroups });

          const result = await checkGroupManage(group);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(typeof result.error).toBe("string");
            expect(result.error.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("contrast: the same choke point permits a non-Dietitian full-access ADMIN on every group", async () => {
    // Proves the denial above is specific to the Dietitian level/role, not an
    // artifact of the mock — the identical call succeeds for an ordinary admin.
    await fc.assert(
      fc.asyncProperty(operationsGroupArb, async (group) => {
        setUsersRow({ roleCode: "ADMIN", level: "inventory_operations" });
        const result = await checkGroupManage(group);
        expect(result.ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property 4, part 2: the Dietitian's own write path stays open ─────────
  //
  // `checkDietitianScope` is the separate choke point `submitHealthLog`,
  // `dietitianCustomerActions` and `reportCardActions` self-gate through
  // (never `checkGroupManage`) — so the denial above must not swallow a
  // Dietitian's OWN legitimate, in-scope actions (Req 5.8).

  it("checkDietitianScope permits an in-scope customer for both a core and a Franchise Dietitian (legitimate Health_Log write path stays open)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.boolean(),
        async (clinicId, franchiseId, customerProfileId, isFranchise) => {
          if (isFranchise) {
            // Franchise Dietitian scope is ALSO assignment-only as of
            // franchise-scoped-access Task 11: the in-scope customer must be
            // both in the tenant AND linked to this Dietitian
            // (id "dietitian-user-1"). The tenant alone no longer suffices.
            setUsersRow({ roleCode: "FRANCHISE_ADMIN", level: "dietitian", franchiseId });
            setCustomerRow({
              franchise_id: franchiseId,
              dietitian_id: "dietitian-user-1",
            });
          } else {
            // Core Dietitian scope is assignment-only: the in-scope customer
            // must be linked to this Dietitian (id "dietitian-user-1"), not
            // merely share the linked Clinic.
            setUsersRow({ roleCode: "ADMIN", level: "dietitian", clinicId });
            setCustomerRow({ clinic_id: clinicId, dietitian_id: "dietitian-user-1" });
          }

          const result = await checkDietitianScope(customerProfileId);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("checkDietitianScope denies an out-of-scope customer with the pinned message, never a silent pass-through", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), fc.uuid(), fc.uuid(), async (clinicId, otherClinicId, otherFranchiseId, customerProfileId) => {
        fc.pre(clinicId !== otherClinicId);
        setUsersRow({ roleCode: "ADMIN", level: "dietitian", clinicId });
        setCustomerRow({ clinic_id: otherClinicId, franchise_id: otherFranchiseId, dietitian_id: null });

        const result = await checkDietitianScope(customerProfileId);
        expect(result).toEqual({ ok: false, error: CUSTOMER_NOT_IN_SCOPE });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property 4, part 3: franchise-user create/edit/delete stays unreachable
  //
  // Every Franchise Dietitian's role is FRANCHISE_ADMIN. `resolveScope` never
  // resolves that role to `full_network`, and `franchiseUserActions.ts` gates
  // `createFranchiseUser` / `createFranchiseDietitian` / `listFranchiseUsers`
  // on exactly that (Req 21.4).

  it("resolveScope never grants full_network to a Franchise Dietitian's role, for any franchise_id (Req 21.4)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(fc.uuid(), { nil: null }), async (franchiseId) => {
        resolveFranchiseContextMock.mockResolvedValue({
          role: "FRANCHISE_ADMIN",
          franchise_id: franchiseId,
          franchise_name: null,
          is_franchise_scoped: true,
        });

        const result = await resolveScope();

        if (result.ok) {
          expect(result.scope.kind).not.toBe("full_network");
        } else {
          expect(result.reason).toBe("no_franchise");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("franchiseUserActions gates every export on scope.kind === \"full_network\" (Req 21.4)", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "src", "actions", "master-actions", "franchiseUserActions.ts"),
      "utf8",
    );

    expect(source).toMatch(/export async function createFranchiseUser/);
    expect(source).toMatch(/export async function createFranchiseDietitian/);
    expect(source).toMatch(/export async function listFranchiseUsers/);
    // The shared gate every one of the three calls before any read/write.
    expect(source).toMatch(/result\.scope\.kind !== "full_network"/);
    expect(source).toMatch(/assertFullNetworkScope\(\)/);

    // The franchise portal itself has no franchise-user CRUD at all — the
    // module boundary rules forbid importing this master-only action there.
    const franchiseActionFiles = [
      "franchiseAssistedOrderActions.ts",
      "franchiseCustomerActions.ts",
      "franchiseCustomerManagementActions.ts",
      "franchiseDietitianActivityActions.ts",
      "franchiseDisputeActions.ts",
      "franchiseInventoryActions.ts",
      "franchiseMarketingActions.ts",
      "franchiseOperationsActions.ts",
      "franchisePincodeRequestActions.ts",
      "franchiseRiderActions.ts",
      "franchiseServiceAreaActions.ts",
      "franchiseSubscriptionActions.ts",
    ];
    for (const file of franchiseActionFiles) {
      const franchiseSource = readFileSync(
        path.join(REPO_ROOT, "src", "actions", "franchise-actions", file),
        "utf8",
      );
      expect(franchiseSource).not.toMatch(/createFranchiseUser|createFranchiseDietitian/);
    }
  });

  // ─── Property 4, part 4: no write path to a Self_Log at all (Req 25.4) ─────

  it("has no write path to any Self_Log source table (Req 25.4)", () => {
    const repoSource = readFileSync(
      path.join(REPO_ROOT, "src", "repositories", "dietitian", "healthLogRepository.ts"),
      "utf8",
    );
    const actionSource = readFileSync(
      path.join(REPO_ROOT, "src", "actions", "dietitian-actions", "healthLogActions.ts"),
      "utf8",
    );

    const selfLogTables = ["kit_daily_logs", "customer_health_logs", "admin_health_logs"];
    for (const source of [repoSource, actionSource]) {
      for (const table of selfLogTables) {
        for (const tail of statementTailsFor(source, table)) {
          expect(tail).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
        }
      }
    }

    // The only writer of `health_logs` always stamps author_type DIETITIAN —
    // there is no branch that could persist a Self_Log through this path.
    expect(repoSource).toMatch(/author_type:\s*"DIETITIAN"/);
    expect(actionSource).not.toMatch(/export async function\s+(write|save|create|update|delete)\w*SelfLog/i);
  });

  it("dietitian-actions self-gate through checkDietitianScope/guardDietitianPage, never the operations-group choke point (structural contrast)", () => {
    const files = [
      "dietitianCustomerActions.ts",
      "healthLogActions.ts",
      "reportCardActions.ts",
    ];
    for (const file of files) {
      const source = readFileSync(
        path.join(REPO_ROOT, "src", "actions", "dietitian-actions", file),
        "utf8",
      );
      expect(source).not.toMatch(/checkGroupManage|assertGroupManage|assertAdminAccess/);
    }
  });
});
