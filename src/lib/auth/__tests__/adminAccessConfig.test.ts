// src/lib/auth/__tests__/adminAccessConfig.test.ts
//
// Property tests for the per-group admin access configuration model
// (admin-access-control, Properties 1–7). The pure primitives under test live
// in `adminAccessCore.ts` and require no Supabase connection.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ADMIN_ACCESS_LEVELS,
  OPERATIONS_GROUPS,
  PERMISSION_LEVELS,
  GROUP_ROUTE_PREFIX,
  type AdminAccessLevel,
  type OperationsGroup,
  type PermissionLevel,
  type OperationsAccess,
  type AccessConfiguration,
  resolveAccessConfiguration,
  validateOperationsAccessInput,
  classifyOperationsGroup,
  classifyAdminPath,
  hasGroupAccess,
  canManageGroup,
  isAdminPathAllowed,
} from "../adminAccessCore";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbLevel = fc.constantFrom<AdminAccessLevel>(...ADMIN_ACCESS_LEVELS);
const arbGroup = fc.constantFrom<OperationsGroup>(...OPERATIONS_GROUPS);
const arbPermission = fc.constantFrom<PermissionLevel>(...PERMISSION_LEVELS);

/** A (possibly empty) well-formed per-group permission map. */
const arbOperationsAccess: fc.Arbitrary<OperationsAccess> = fc.dictionary(
  arbGroup,
  arbPermission,
) as fc.Arbitrary<OperationsAccess>;

/** An always-valid AccessConfiguration. */
const arbConfig: fc.Arbitrary<AccessConfiguration> = fc.oneof(
  fc.constant<AccessConfiguration>({ level: "inventory", groups: {} }),
  fc.constant<AccessConfiguration>({ level: "inventory_operations", groups: {} }),
  arbOperationsAccess.map<AccessConfiguration>((groups) => ({
    level: "operations",
    groups,
  })),
);

const seg = fc.stringMatching(/^[a-z0-9-]{1,12}$/);

/** A group page path plus the group it belongs to. */
const arbGroupPath = fc
  .tuple(arbGroup, fc.array(seg, { maxLength: 4 }))
  .map(([group, segs]) => {
    const base = GROUP_ROUTE_PREFIX[group];
    return { group, path: segs.length ? `${base}/${segs.join("/")}` : base };
  });

const arbInventoryPath = fc.oneof(
  fc.constant("/admin/inventory"),
  fc.array(seg, { minLength: 1, maxLength: 4 }).map((s) => "/admin/inventory/" + s.join("/")),
);

// Neutral: absolute admin paths that are neither inventory nor an operations
// area (e.g. /admin/profile) — classifyAdminPath returns null.
const arbNeutralPath = fc
  .array(seg, { minLength: 1, maxLength: 4 })
  .map((s) => "/" + s.join("/"))
  .filter((p) => classifyAdminPath(p) === null);

// ─── Property 1: Total & safe resolution ──────────────────────────────────────

describe("Property 1: total & safe resolution", () => {
  it("never throws and always returns a valid configuration for any input", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (rawLevel, rawGroups) => {
        const config = resolveAccessConfiguration(rawLevel, rawGroups);
        expect(ADMIN_ACCESS_LEVELS).toContain(config.level);
        for (const [key, value] of Object.entries(config.groups)) {
          expect(OPERATIONS_GROUPS).toContain(key);
          expect(PERMISSION_LEVELS).toContain(value);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("keeps well-formed operations groups verbatim and drops malformed entries", () => {
    fc.assert(
      fc.property(arbOperationsAccess, (groups) => {
        const config = resolveAccessConfiguration("operations", groups);
        expect(config.groups).toEqual(groups);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 2: Non-operations carries no groups ─────────────────────────────

describe("Property 2: non-operations carries no groups", () => {
  it("forces groups to {} whenever the resolved level is not operations", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("inventory", "inventory_operations"),
        fc.anything(),
        (level, rawGroups) => {
          const config = resolveAccessConfiguration(level, rawGroups);
          expect(config.level).toBe(level);
          expect(config.groups).toEqual({});
        },
      ),
      { numRuns: 300 },
    );
  });

  it("any unknown/invalid level resolves to full access with no groups", () => {
    fc.assert(
      fc.property(
        fc.anything().filter(
          (raw) =>
            !(
              typeof raw === "string" &&
              (ADMIN_ACCESS_LEVELS as readonly string[]).includes(raw)
            ),
        ),
        arbOperationsAccess,
        (rawLevel, groups) => {
          const config = resolveAccessConfiguration(rawLevel, groups);
          expect(config.level).toBe("inventory_operations");
          expect(config.groups).toEqual({});
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ─── Property 3: Manage implies access ────────────────────────────────────────

describe("Property 3: manage implies access", () => {
  it("canManageGroup ⇒ hasGroupAccess for every config and group", () => {
    fc.assert(
      fc.property(arbConfig, arbGroup, (config, group) => {
        if (canManageGroup(config, group)) {
          expect(hasGroupAccess(config, group)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a view group has access but not manage", () => {
    fc.assert(
      fc.property(arbOperationsAccess, arbGroup, (groups, group) => {
        const config: AccessConfiguration = {
          level: "operations",
          groups: { ...groups, [group]: "view" },
        };
        expect(hasGroupAccess(config, group)).toBe(true);
        expect(canManageGroup(config, group)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 4: Full access is total ─────────────────────────────────────────

describe("Property 4: full access is total", () => {
  const full: AccessConfiguration = { level: "inventory_operations", groups: {} };

  it("grants access and manage to every group", () => {
    fc.assert(
      fc.property(arbGroup, (group) => {
        expect(hasGroupAccess(full, group)).toBe(true);
        expect(canManageGroup(full, group)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("permits every admin path (inventory, group, neutral)", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbInventoryPath, arbGroupPath.map((g) => g.path), arbNeutralPath),
        (path) => {
          expect(isAdminPathAllowed(full, path)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ─── Property 5: Inventory isolation ──────────────────────────────────────────

describe("Property 5: inventory isolation", () => {
  const inv: AccessConfiguration = { level: "inventory", groups: {} };

  it("permits inventory and neutral paths, denies every group route", () => {
    fc.assert(
      fc.property(arbInventoryPath, (path) => {
        expect(isAdminPathAllowed(inv, path)).toBe(true);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(arbNeutralPath, (path) => {
        expect(isAdminPathAllowed(inv, path)).toBe(true);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(arbGroupPath, ({ path }) => {
        expect(isAdminPathAllowed(inv, path)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 6: Operations gate matches config ───────────────────────────────

describe("Property 6: operations gate matches config", () => {
  it("allows a group route iff the group is in the config; inventory always denied", () => {
    fc.assert(
      fc.property(arbOperationsAccess, (groups) => {
        const config: AccessConfiguration = { level: "operations", groups };
        for (const group of OPERATIONS_GROUPS) {
          const prefix = GROUP_ROUTE_PREFIX[group];
          expect(isAdminPathAllowed(config, prefix)).toBe(group in groups);
        }
        expect(isAdminPathAllowed(config, "/admin/inventory")).toBe(false);
      }),
      { numRuns: 400 },
    );
  });
});

// ─── Property 7: Path classification boundary-safety ──────────────────────────

describe("Property 7: path classification boundary-safety", () => {
  it("maps any sub-path of a group prefix to that group", () => {
    fc.assert(
      fc.property(arbGroupPath, ({ group, path }) => {
        expect(classifyOperationsGroup(path)).toBe(group);
      }),
      { numRuns: 400 },
    );
  });

  it("does not match on partial-segment prefixes and is case-sensitive", () => {
    fc.assert(
      fc.property(arbGroup, seg, (group, suffix) => {
        const prefix = GROUP_ROUTE_PREFIX[group];
        // Same prefix with extra characters in the SAME segment must not match.
        expect(classifyOperationsGroup(prefix + suffix)).not.toBe(group);
        // Upper-cased prefix must not match (case-sensitive).
        expect(classifyOperationsGroup(prefix.toUpperCase())).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it("returns null for non-string / empty / non-absolute paths", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(""), fc.constant(null), fc.constant(undefined), fc.integer(), fc.stringMatching(/^[a-z]{1,6}$/)),
        (path) => {
          expect(classifyOperationsGroup(path as unknown)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 8: Serialization round-trip ─────────────────────────────────────

describe("Property 8: serialization round-trip", () => {
  it("resolves a JSON-stringified operations map back to an equal map", () => {
    fc.assert(
      fc.property(arbOperationsAccess, (groups) => {
        const json = JSON.stringify(groups);
        const config = resolveAccessConfiguration("operations", json);
        expect(config.level).toBe("operations");
        expect(config.groups).toEqual(groups);
      }),
      { numRuns: 300 },
    );
  });

  it("resolves a pre-parsed operations object back to an equal map", () => {
    fc.assert(
      fc.property(arbOperationsAccess, (groups) => {
        const config = resolveAccessConfiguration("operations", groups);
        expect(config.groups).toEqual(groups);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 9: Validation rejects empties/invalids ──────────────────────────

describe("Property 9: validation rejects empties/invalids", () => {
  it("accepts every non-empty well-formed map verbatim", () => {
    fc.assert(
      fc.property(
        arbOperationsAccess.filter((g) => Object.keys(g).length > 0),
        (groups) => {
          const result = validateOperationsAccessInput(groups);
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toEqual(groups);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects an empty selection", () => {
    expect(validateOperationsAccessInput({}).ok).toBe(false);
  });

  it("rejects maps containing an unknown group key", () => {
    fc.assert(
      fc.property(
        arbOperationsAccess,
        fc.stringMatching(/^[a-z_]{1,15}$/).filter((k) => !(OPERATIONS_GROUPS as readonly string[]).includes(k)),
        arbPermission,
        (groups, badKey, perm) => {
          const result = validateOperationsAccessInput({ ...groups, [badKey]: perm });
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects maps containing an invalid permission value", () => {
    fc.assert(
      fc.property(
        arbGroup,
        fc.anything().filter((v) => v !== "manage" && v !== "view"),
        (group, badPerm) => {
          const result = validateOperationsAccessInput({ [group]: badPerm });
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, [], "x", 5, true]) {
      expect(validateOperationsAccessInput(bad as unknown).ok).toBe(false);
    }
  });
});
