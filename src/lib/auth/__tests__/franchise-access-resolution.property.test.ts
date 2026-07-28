// src/lib/auth/__tests__/franchise-access-resolution.property.test.ts
// Feature: dietitian-management, Property 35
//
// Property 35: The Franchise_Owner resolves to full access; other franchise
// users resolve to their stored level.
//
// For any franchise user, the effective access configuration is
// `inventory_operations` iff that user's `users.id` equals
// `franchises.owner_user_id` for its Franchise, and otherwise equals the
// configuration resolved from the stored `admin_access_level` and
// `admin_operations_access`; and access to the Dietitian Activity page is
// granted iff the effective configuration grants the customers group.
//
// Validates: Requirements 21.6, 24.3
//
// ── Why a transcribed reference ─────────────────────────────────────────────
// The rule lives in two non-unit-testable places: the `franchies` branch of
// `src/middleware.ts` (an edge-runtime function that needs a NextRequest and a
// Supabase session) and `src/app/franchise/(main)/layout.tsx` (an async Server
// Component that reads `cookies()` / `headers()`). Neither can be invoked in a
// vitest process, so `resolveFranchiseAccess` below is a TRANSCRIPTION of the
// shipped decision, verbatim as of task 3.5:
//
//   middleware.ts (franchies branch):
//     const isFranchiseOwner =
//       typeof franchise?.owner_user_id === "string" &&
//       franchise.owner_user_id === franchiseUser.id;
//     const franchiseConfig: AccessConfiguration = isFranchiseOwner
//       ? { level: "inventory_operations", groups: {} }
//       : config;                          // resolveAccessConfiguration(...)
//
//   franchise/(main)/layout.tsx:
//     const isFranchiseOwner =
//       typeof franchise?.owner_user_id === "string" &&
//       franchise.owner_user_id === userProfileData?.id;
//     const config: AccessConfiguration = isFranchiseOwner
//       ? { level: "inventory_operations", groups: {} }
//       : resolveAccessConfiguration(
//           userProfileData?.admin_access_level,
//           userProfileData?.admin_operations_access,
//         );
//
// The transcription composes only the pure primitives both call sites use
// (`resolveAccessConfiguration`, `isPortalPathAllowed` on the `/franchise`
// base, `landingRouteFor`, `hasGroupAccess`). If either shipped file later
// diverges from this reference, the divergence is invisible to this test file —
// so the block above must be re-checked whenever the franchise branch of the
// middleware or the franchise layout changes.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  hasGroupAccess,
  isPortalPathAllowed,
  landingRouteFor,
  resolveAccessConfiguration,
  type AccessConfiguration,
} from "../adminAccessCore";
import {
  accessLevelArb,
  DIETITIAN_IDS,
  FRANCHISE_IDS,
  fixtureUuid,
  operationsGroupsArb,
  rawAccessLevelArb,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── The transcribed decision under test ─────────────────────────────────────

/** The `users` columns both call sites select for a franchise user. */
interface FranchiseUserRow {
  id: string;
  franchise_id: string;
  admin_access_level: unknown;
  admin_operations_access: unknown;
}

/** The `franchises` columns both call sites select. */
interface FranchiseRow {
  id: string;
  status: string | null;
  owner_user_id: unknown;
}

/** Verbatim transcription of the shipped Franchise_Owner override (Req 21.6). */
function resolveFranchiseAccess(
  user: FranchiseUserRow,
  franchise: FranchiseRow | null | undefined,
): AccessConfiguration {
  const isFranchiseOwner =
    typeof franchise?.owner_user_id === "string" &&
    franchise.owner_user_id === user.id;
  return isFranchiseOwner
    ? { level: "inventory_operations", groups: {} }
    : resolveAccessConfiguration(
        user.admin_access_level,
        user.admin_operations_access,
      );
}

/**
 * Req 24.3 — the Dietitian Activity page is reachable only by a franchise user
 * whose effective configuration grants the customers group.
 */
const FRANCHISE_ACTIVITY_PATH = "/franchise/dietitian-activity";

function canOpenFranchiseActivityPage(config: AccessConfiguration): boolean {
  return hasGroupAccess(config, "customers");
}

// ─── Fixtures and generators ─────────────────────────────────────────────────

const FRANCHISE_USER_IDS = [
  fixtureUuid(55, 1),
  fixtureUuid(55, 2),
  ...DIETITIAN_IDS,
] as const;

const franchiseUserIdArb = fc.constantFrom(...FRANCHISE_USER_IDS);

/** Franchise rows the layout tolerates: a real owner, no owner, a stray value. */
const ownerValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: franchiseUserIdArb as fc.Arbitrary<unknown>, weight: 4 },
  { arbitrary: fc.constantFrom<unknown>(null, undefined), weight: 2 },
  { arbitrary: fc.constantFrom<unknown>(0, 1, true, {}, []), weight: 1 },
);

interface FranchiseUserSample {
  user: FranchiseUserRow;
  franchise: FranchiseRow;
}

const franchiseUserSampleArb: fc.Arbitrary<FranchiseUserSample> = fc
  .record({
    userId: franchiseUserIdArb,
    franchiseId: fc.constantFrom(...FRANCHISE_IDS),
    rawLevel: rawAccessLevelArb,
    groups: operationsGroupsArb,
    ownerUserId: ownerValueArb,
    status: fc.constantFrom<string | null>("active", null),
  })
  .map(({ userId, franchiseId, rawLevel, groups, ownerUserId, status }) => ({
    user: {
      id: userId,
      franchise_id: franchiseId,
      admin_access_level: rawLevel,
      admin_operations_access: groups,
    },
    franchise: { id: franchiseId, status, owner_user_id: ownerUserId },
  }));

/** Every route the franchise portal serves, plus the pages this feature adds. */
const FRANCHISE_ROUTES = [
  "/franchise",
  "/franchise/dashboard",
  "/franchise/customers",
  "/franchise/customers/quick-onboard",
  `/franchise/customers/${fixtureUuid(44, 7)}`,
  `/franchise/customers/${fixtureUuid(44, 7)}/report-card`,
  "/franchise/log-customer",
  "/franchise/dietitian-activity",
  "/franchise/subscriptions",
  "/franchise/riders",
  "/franchise/operations",
  "/franchise/orders",
  "/franchise/inventory",
  "/franchise/inventory/ledger",
  "/franchise/reports",
  "/franchise/disputes",
  "/franchise/shop-products",
  "/franchise/profile",
] as const;

const franchiseRouteArb = fc.constantFrom(...FRANCHISE_ROUTES);

/** The Dietitian allow-list expressed on the `/franchise` base (Req 5.4, 21.5). */
const FRANCHISE_DIETITIAN_PREFIXES = [
  "/franchise/customers",
  "/franchise/log-customer",
  "/franchise/profile",
] as const;

function isFranchiseDietitianRouteAllowed(pathname: string): boolean {
  return FRANCHISE_DIETITIAN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

// ─── Property tests ──────────────────────────────────────────────────────────

describe("Property 35: Franchise access resolution", () => {
  it("resolves to full access exactly when the user id matches owner_user_id (Req 21.6)", () => {
    fc.assert(
      fc.property(franchiseUserSampleArb, ({ user, franchise }) => {
        const config = resolveFranchiseAccess(user, franchise);
        const isOwner = franchise.owner_user_id === user.id;

        if (isOwner) {
          expect(config).toEqual({ level: "inventory_operations", groups: {} });
        } else {
          expect(config).toEqual(
            resolveAccessConfiguration(
              user.admin_access_level,
              user.admin_operations_access,
            ),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("gives the owner full access regardless of the stored level, including dietitian (Req 21.6)", () => {
    fc.assert(
      fc.property(
        franchiseUserIdArb,
        fc.constantFrom(...FRANCHISE_IDS),
        rawAccessLevelArb,
        operationsGroupsArb,
        (userId, franchiseId, rawLevel, groups) => {
          const config = resolveFranchiseAccess(
            {
              id: userId,
              franchise_id: franchiseId,
              admin_access_level: rawLevel,
              admin_operations_access: groups,
            },
            { id: franchiseId, status: "active", owner_user_id: userId },
          );
          expect(config).toEqual({ level: "inventory_operations", groups: {} });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("gives the owner full access even when the stored level is dietitian (Req 21.6)", () => {
    fc.assert(
      fc.property(franchiseUserIdArb, (userId) => {
        const franchiseId = FRANCHISE_IDS[0];
        const owner = resolveFranchiseAccess(
          {
            id: userId,
            franchise_id: franchiseId,
            admin_access_level: "dietitian",
            admin_operations_access: null,
          },
          { id: franchiseId, status: "active", owner_user_id: userId },
        );
        expect(owner.level).toBe("inventory_operations");

        // The same stored level, for a user who is NOT the owner, stays a
        // Dietitian — the override is keyed on identity, nothing else.
        const other = resolveFranchiseAccess(
          {
            id: userId,
            franchise_id: franchiseId,
            admin_access_level: "dietitian",
            admin_operations_access: null,
          },
          { id: franchiseId, status: "active", owner_user_id: fixtureUuid(55, 9) },
        );
        expect(other.level).toBe("dietitian");
        expect(other.groups).toEqual({});
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves a non-owner to their stored level, coercing NULL and unrecognised values to inventory_operations (Req 21.6)", () => {
    fc.assert(
      fc.property(
        franchiseUserSampleArb.filter(
          ({ user, franchise }) => franchise.owner_user_id !== user.id,
        ),
        ({ user, franchise }) => {
          const config = resolveFranchiseAccess(user, franchise);
          const raw = user.admin_access_level;
          const recognised =
            typeof raw === "string" &&
            ["inventory", "operations", "inventory_operations", "dietitian"].includes(
              raw,
            );

          if (recognised) {
            expect(config.level).toBe(raw);
          } else {
            // Pre-existing franchise users carry no `admin_access_level`; they
            // must keep full access.
            expect(config.level).toBe("inventory_operations");
            expect(config.groups).toEqual({});
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("lets the Franchise_Owner reach every franchise route, and confines a Franchise Dietitian to the allow-list (Req 21.6)", () => {
    fc.assert(
      fc.property(
        franchiseUserIdArb,
        rawAccessLevelArb,
        franchiseRouteArb,
        (userId, rawLevel, pathname) => {
          const franchiseId = FRANCHISE_IDS[0];

          const ownerConfig = resolveFranchiseAccess(
            {
              id: userId,
              franchise_id: franchiseId,
              admin_access_level: rawLevel,
              admin_operations_access: null,
            },
            { id: franchiseId, status: "active", owner_user_id: userId },
          );
          expect(isPortalPathAllowed(ownerConfig, pathname, "/franchise")).toBe(
            true,
          );
          expect(landingRouteFor(ownerConfig.level)).toBe("/dashboard");

          const dietitianConfig = resolveFranchiseAccess(
            {
              id: userId,
              franchise_id: franchiseId,
              admin_access_level: "dietitian",
              admin_operations_access: null,
            },
            { id: franchiseId, status: "active", owner_user_id: fixtureUuid(55, 9) },
          );
          expect(
            isPortalPathAllowed(dietitianConfig, pathname, "/franchise"),
          ).toBe(isFranchiseDietitianRouteAllowed(pathname));
          expect(landingRouteFor(dietitianConfig.level)).toBe("/customers");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("grants the franchise Dietitian Activity page exactly when the effective configuration grants the customers group (Req 24.3)", () => {
    fc.assert(
      fc.property(franchiseUserSampleArb, ({ user, franchise }) => {
        const config = resolveFranchiseAccess(user, franchise);
        const isOwner = franchise.owner_user_id === user.id;
        const granted = canOpenFranchiseActivityPage(config);

        if (isOwner) {
          // Req 24.1 — the report is always available to the Franchise_Owner.
          expect(granted).toBe(true);
        } else if (config.level === "inventory_operations") {
          expect(granted).toBe(true);
        } else if (config.level === "operations") {
          expect(granted).toBe(config.groups.customers !== undefined);
        } else {
          // inventory / dietitian grant no operations group at all.
          expect(granted).toBe(false);
        }

        // The page is a group-gated surface, not a path-classified one, so the
        // path gate must never be the only thing standing in the way.
        if (!granted && config.level !== "dietitian") {
          expect(
            isPortalPathAllowed(config, FRANCHISE_ACTIVITY_PATH, "/franchise") &&
              !granted,
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is stable under a missing or malformed franchise row (Req 21.6)", () => {
    fc.assert(
      fc.property(
        franchiseUserIdArb,
        accessLevelArb,
        fc.constantFrom<FranchiseRow | null | undefined>(
          null,
          undefined,
          { id: FRANCHISE_IDS[0], status: null, owner_user_id: null },
        ),
        (userId, level, franchise) => {
          const config = resolveFranchiseAccess(
            {
              id: userId,
              franchise_id: FRANCHISE_IDS[0],
              admin_access_level: level,
              admin_operations_access: null,
            },
            franchise,
          );
          // No owner to match, so the stored level governs unchanged.
          expect(config.level).toBe(level);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
