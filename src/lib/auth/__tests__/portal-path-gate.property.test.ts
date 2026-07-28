// src/lib/auth/__tests__/portal-path-gate.property.test.ts
// Feature: dietitian-management, Property 2
//
// Property 2: The portal path gate is total, allow-listed for Dietitians, and
// unchanged for every other level.
//
// For any resolved access configuration, portal base (`/admin` or `/franchise`)
// and arbitrary path value, `isPortalPathAllowed` returns exactly one boolean
// decision:
//   - a Dietitian is permitted iff the canonicalised path matches one of the
//     Dietitian allow-list prefixes at a path-segment boundary (Req 5.4);
//   - `/franchise` paths canonicalise onto `/admin`, so both portal bases decide
//     identically for the same suffix (Req 21.5, 21.7);
//   - for every pre-existing access level the decision is byte-identical to the
//     pre-feature area/group gate, regardless of the portal base
//     (Req 26.5, 26.6).
//
// The reference side of every property (the prefix tables, the canonicaliser and
// the pre-feature gate) is re-declared locally from the requirements and from
// the pre-feature implementation, so the reference cannot inherit a bug from the
// module under test.
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 21.5, 21.7, 21.9, 21.10, 26.5, 26.6

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  DIETITIAN_ALLOWED_PREFIXES,
  isAdminPathAllowed,
  isDietitianLevel,
  isPortalPathAllowed,
  landingRouteFor,
  toCanonicalPath,
  type AccessConfiguration,
  type AdminAccessLevel,
  type OperationsGroup,
  type PermissionLevel,
  type PortalBase,
} from "../adminAccessCore";
import {
  accessConfigurationArb,
  accessLevelArb,
  operationsGroupsArb,
  TEST_ACCESS_LEVELS,
  type AccessConfigurationSample,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference tables (re-declared, not imported) ────────────────────────────

/** Dietitian allow-list, from Req 5.4 (Customers, Log Customer, profile). */
const REFERENCE_DIETITIAN_PREFIXES = [
  "/admin/customers",
  "/admin/log-customer",
  "/admin/profile",
] as const;

/** Pre-feature inventory-area prefixes. */
const REFERENCE_INVENTORY_PREFIXES = ["/admin/inventory"] as const;

/** Pre-feature operations-area prefixes. */
const REFERENCE_OPERATIONS_PREFIXES = [
  "/admin/dashboard",
  "/admin/customers",
  "/admin/subscriptions",
  "/admin/riders",
  "/admin/operations",
  "/admin/kitchen-shop",
  "/admin/franchises",
] as const;

/** Pre-feature operations-group route prefixes. */
const REFERENCE_GROUP_PREFIX: Record<OperationsGroup, string> = {
  customers: "/admin/customers",
  subscriptions: "/admin/subscriptions",
  riders: "/admin/riders",
  operations: "/admin/operations",
  franchises: "/admin/franchises",
  shop_products: "/admin/kitchen-shop",
};

// ─── Reference implementations ───────────────────────────────────────────────

function refMatchesAtBoundary(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function refLongestMatch(pathname: string, prefixes: readonly string[]): number {
  let best = -1;
  for (const prefix of prefixes) {
    if (refMatchesAtBoundary(pathname, prefix) && prefix.length > best) {
      best = prefix.length;
    }
  }
  return best;
}

function refIsUsablePath(pathname: unknown): pathname is string {
  return (
    typeof pathname === "string" &&
    pathname.length > 0 &&
    pathname.startsWith("/")
  );
}

/** Mirrors `toCanonicalPath`: identity on `/admin`, re-bases `/franchise`. */
function refCanonical(pathname: string, base: PortalBase): string {
  if (base === "/admin") return pathname;
  if (pathname === base) return "/admin";
  if (pathname.startsWith(base + "/")) return "/admin" + pathname.slice(base.length);
  return pathname;
}

function refClassifyArea(pathname: unknown): "inventory" | "operations" | null {
  if (!refIsUsablePath(pathname)) return null;
  const inventoryLen = refLongestMatch(pathname, REFERENCE_INVENTORY_PREFIXES);
  const operationsLen = refLongestMatch(pathname, REFERENCE_OPERATIONS_PREFIXES);
  if (inventoryLen === -1 && operationsLen === -1) return null;
  return inventoryLen >= operationsLen ? "inventory" : "operations";
}

function refClassifyGroup(pathname: unknown): OperationsGroup | null {
  if (!refIsUsablePath(pathname)) return null;
  let best: OperationsGroup | null = null;
  let bestLen = -1;
  for (const group of Object.keys(REFERENCE_GROUP_PREFIX) as OperationsGroup[]) {
    const prefix = REFERENCE_GROUP_PREFIX[group];
    if (refMatchesAtBoundary(pathname, prefix) && prefix.length > bestLen) {
      best = group;
      bestLen = prefix.length;
    }
  }
  return best;
}

/** Pre-feature `hasGroupAccess` (no `dietitian` level existed). */
function refHasGroupAccess(
  config: { level: string; groups: Partial<Record<OperationsGroup, PermissionLevel>> },
  group: OperationsGroup,
): boolean {
  if (config.level === "inventory_operations") return true;
  if (config.level === "operations") return config.groups[group] !== undefined;
  return false;
}

/**
 * The pre-feature configuration-aware `/admin` gate, verbatim: neutral paths are
 * allowed, inventory-area paths need the inventory level, operations group pages
 * are gated per group, and operations-neutral pages need operations or full.
 */
function refPreFeatureGate(
  config: { level: string; groups: Partial<Record<OperationsGroup, PermissionLevel>> },
  pathname: unknown,
): boolean {
  const area = refClassifyArea(pathname);
  if (area === null) return true;
  if (area === "inventory") {
    return config.level === "inventory" || config.level === "inventory_operations";
  }
  const group = refClassifyGroup(pathname);
  if (group !== null) return refHasGroupAccess(config, group);
  return config.level === "operations" || config.level === "inventory_operations";
}

/** The pre-feature coarse level-only area gate (legacy `isAdminPathAllowed`). */
function refLegacyLevelGate(level: AdminAccessLevel, pathname: unknown): boolean {
  const area = refClassifyArea(pathname);
  if (area === null) return true;
  if (level === "inventory") return area === "inventory";
  if (level === "operations") return area === "operations";
  if (level === "inventory_operations") return true;
  return false;
}

/** The reference Dietitian allow-list decision for a raw path + portal base. */
function refDietitianAllowed(pathname: unknown, base: PortalBase): boolean {
  if (typeof pathname !== "string") return false;
  const canonical = refCanonical(pathname, base);
  if (!refIsUsablePath(canonical)) return false;
  return REFERENCE_DIETITIAN_PREFIXES.some((prefix) =>
    refMatchesAtBoundary(canonical, prefix),
  );
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const portalBaseArb: fc.Arbitrary<PortalBase> = fc.constantFrom<PortalBase>(
  "/admin",
  "/franchise",
);

/**
 * Path segments: the real workspaces, plus near-misses that share a prefix
 * without a segment boundary (`customersfoo`), case variants, empty segments and
 * traversal noise.
 */
const PATH_SEGMENTS = [
  "customers",
  "log-customer",
  "profile",
  "inventory",
  "dashboard",
  "subscriptions",
  "riders",
  "operations",
  "kitchen-shop",
  "franchises",
  "login",
  "settings",
  "report-card",
  "123",
  "customersfoo",
  "log-customerx",
  "profile-settings",
  "inventoryy",
  "Customers",
  "PROFILE",
  "..",
  "%2e%2e",
  "",
] as const;

/** A `/`-joined suffix appended after the portal base; `""` for the base itself. */
const suffixArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...PATH_SEGMENTS), { maxLength: 3 })
  .map((segments) => segments.map((segment) => "/" + segment).join(""));

/** A pathname built under one of the two portal bases. */
const portalPathArb: fc.Arbitrary<string> = fc
  .tuple(portalBaseArb, suffixArb)
  .map(([base, suffix]) => base + suffix);

/** Adversarial path strings: relative, doubled slashes, query/fragment, unicode. */
const adversarialPathArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  " ",
  "/",
  "//",
  "admin/customers",
  "//admin/customers",
  "/adminx/customers",
  "/ADMIN/customers",
  "/admin//customers",
  "/admin/customers/../inventory",
  "/admin/customers?tab=1",
  "/admin/customers#frag",
  "/franchisex/customers",
  "/franchise/../admin/inventory",
  "\\admin\\customers",
  "/日本/admin/customers",
  "/unauthorized",
);

/** Non-string path values the gate must tolerate without throwing. */
const nonStringPathArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  null,
  undefined,
  0,
  1,
  Number.NaN,
  true,
  false,
  {},
  [],
  ["/admin/customers"],
  { pathname: "/admin/customers" },
);

/** The full adversarial input space for the gate's first argument. */
const anyPathArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: portalPathArb as fc.Arbitrary<unknown>, weight: 6 },
  { arbitrary: adversarialPathArb as fc.Arbitrary<unknown>, weight: 3 },
  { arbitrary: fc.string() as fc.Arbitrary<unknown>, weight: 1 },
  { arbitrary: nonStringPathArb, weight: 2 },
);

/** Any string path (the subset where canonicalisation is defined). */
const anyStringPathArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: portalPathArb, weight: 6 },
  { arbitrary: adversarialPathArb, weight: 3 },
  { arbitrary: fc.string(), weight: 1 },
);

/**
 * A Dietitian configuration. Groups are drawn from `operationsGroupsArb` even
 * though a resolved Dietitian always has an empty map, so the property also
 * shows stray group grants can never widen the allow-list (Req 1.5, 5.4).
 */
const dietitianConfigArb: fc.Arbitrary<AccessConfiguration> =
  operationsGroupsArb.map((groups: Partial<Record<OperationsGroup, PermissionLevel>>) => ({
    level: "dietitian" as const,
    groups,
  }));

/** Configurations for every pre-existing (non-Dietitian) access level. */
const nonDietitianConfigArb: fc.Arbitrary<AccessConfigurationSample> =
  accessConfigurationArb.filter((config) => config.level !== "dietitian");

// ─── Property tests ──────────────────────────────────────────────────────────

describe("Property 2: The portal path gate is total, allow-listed for Dietitians, and unchanged for every other level", () => {
  it("is total: every configuration, path value and portal base yields a boolean without throwing (Req 5.4, 21.5)", () => {
    fc.assert(
      fc.property(
        accessConfigurationArb,
        anyPathArb,
        portalBaseArb,
        (config, pathname, base) => {
          const decision = isPortalPathAllowed(
            config as AccessConfiguration,
            pathname,
            base,
          );
          expect(typeof decision).toBe("boolean");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("defaults to the /admin base and agrees with the explicit base (Req 26.5)", () => {
    fc.assert(
      fc.property(accessConfigurationArb, anyPathArb, (config, pathname) => {
        expect(isPortalPathAllowed(config as AccessConfiguration, pathname)).toBe(
          isPortalPathAllowed(config as AccessConfiguration, pathname, "/admin"),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("permits a Dietitian exactly on the allow-list prefixes, at a path-segment boundary (Req 5.4)", () => {
    fc.assert(
      fc.property(
        dietitianConfigArb,
        anyPathArb,
        portalBaseArb,
        (config, pathname, base) => {
          expect(isPortalPathAllowed(config, pathname, base)).toBe(
            refDietitianAllowed(pathname, base),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("allows every allow-list prefix and its sub-paths on both portal bases (Req 5.1, 5.2, 5.4)", () => {
    fc.assert(
      fc.property(
        dietitianConfigArb,
        fc.constantFrom(...DIETITIAN_ALLOWED_PREFIXES),
        fc.array(fc.constantFrom("123", "report-card", "edit"), { maxLength: 2 }),
        portalBaseArb,
        (config, prefix, tail, base) => {
          const suffix = prefix.slice("/admin".length) + tail.map((t) => "/" + t).join("");
          expect(isPortalPathAllowed(config, base + suffix, base)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies a Dietitian a path that only shares a prefix without a segment boundary (Req 5.3, 5.4)", () => {
    fc.assert(
      fc.property(
        dietitianConfigArb,
        fc.constantFrom(...DIETITIAN_ALLOWED_PREFIXES),
        fc.constantFrom("foo", "-x", "2", ".json", "s"),
        portalBaseArb,
        (config, prefix, glued, base) => {
          const suffix = prefix.slice("/admin".length) + glued;
          expect(isPortalPathAllowed(config, base + suffix, base)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies a Dietitian every path outside the allow-list, including non-string and non-absolute values (Req 5.3, 5.4)", () => {
    fc.assert(
      fc.property(
        dietitianConfigArb,
        anyPathArb,
        portalBaseArb,
        (config, pathname, base) => {
          fc.pre(!refDietitianAllowed(pathname, base));
          expect(isPortalPathAllowed(config, pathname, base)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the Dietitian redirect target reachable, so a denial cannot loop (Req 5.3, 21.7)", () => {
    fc.assert(
      fc.property(
        dietitianConfigArb,
        anyPathArb,
        portalBaseArb,
        (config, pathname, base) => {
          fc.pre(!isPortalPathAllowed(config, pathname, base));
          const landing = landingRouteFor("dietitian");
          expect(isPortalPathAllowed(config, base + landing, base)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("canonicalises /franchise onto /admin and is the identity on /admin (Req 21.5)", () => {
    fc.assert(
      fc.property(anyStringPathArb, portalBaseArb, (pathname, base) => {
        expect(toCanonicalPath(pathname, base)).toBe(refCanonical(pathname, base));
        expect(toCanonicalPath(pathname, "/admin")).toBe(pathname);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("decides identically for the same suffix under either portal base (Req 21.5, 21.7)", () => {
    fc.assert(
      fc.property(
        accessConfigurationArb,
        suffixArb,
        (config, suffix) => {
          const cfg = config as AccessConfiguration;
          expect(isPortalPathAllowed(cfg, "/franchise" + suffix, "/franchise")).toBe(
            isPortalPathAllowed(cfg, "/admin" + suffix, "/admin"),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaves every non-Dietitian level's decision identical to the pre-feature gate, on both bases (Req 26.5, 26.6)", () => {
    fc.assert(
      fc.property(
        nonDietitianConfigArb,
        anyPathArb,
        portalBaseArb,
        (config, pathname, base) => {
          const canonical =
            typeof pathname === "string" ? refCanonical(pathname, base) : pathname;
          expect(
            isPortalPathAllowed(config as AccessConfiguration, pathname, base),
          ).toBe(refPreFeatureGate(config, canonical));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps isAdminPathAllowed byte-identical for pre-existing configuration callers (Req 26.5, 26.6)", () => {
    fc.assert(
      fc.property(nonDietitianConfigArb, anyPathArb, (config, pathname) => {
        expect(isAdminPathAllowed(config as AccessConfiguration, pathname)).toBe(
          refPreFeatureGate(config, pathname),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the legacy level-only isAdminPathAllowed overload unchanged (Req 26.5, 26.6)", () => {
    const legacyLevelArb = fc.constantFrom(
      ...TEST_ACCESS_LEVELS.filter((level) => level !== "dietitian"),
    );
    fc.assert(
      fc.property(legacyLevelArb, anyPathArb, (level, pathname) => {
        expect(isAdminPathAllowed(level as AdminAccessLevel, pathname)).toBe(
          refLegacyLevelGate(level as AdminAccessLevel, pathname),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("identifies the Dietitian level from either a bare level or a configuration (Req 5.4)", () => {
    fc.assert(
      fc.property(accessLevelArb, operationsGroupsArb, (level, groups) => {
        const expected = level === "dietitian";
        expect(isDietitianLevel(level as AdminAccessLevel)).toBe(expected);
        expect(
          isDietitianLevel({
            level,
            groups,
          } as AccessConfiguration),
        ).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
