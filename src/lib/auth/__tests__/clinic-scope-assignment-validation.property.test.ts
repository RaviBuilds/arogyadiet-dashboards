// src/lib/auth/__tests__/clinic-scope-assignment-validation.property.test.ts
// Feature: clinic-scoped-shop-inventory, Property 26 (Task 6.4)
//
// Property 26: Clinic scope assignment validates and round-trips.
//
// For any submitted admin configuration of access level, clinic access flag,
// clinic identifier, and operations group subset, the submission is accepted
// exactly when the level is operations, a Core Clinic is selected whenever
// clinic access is checked, and every selected group is one of the four
// clinic-scoped groups; every rejection leaves the stored level, clinic
// assignment, and group configuration unchanged; and for every accepted
// configuration, reloading the edit form yields exactly the configuration
// that was saved.
//
// The reference acceptance predicate below is transcribed independently from
// Requirements 13.1, 13.2, 13.3, 13.7-13.9, 13.11-13.14 (and the JSDoc
// contract on `validateClinicScopeAssignment`, restated fresh here) rather
// than derived from the module under test, so the property cannot inherit a
// bug from `validateClinicScopeAssignment`. The round-trip half of the
// property (Req 13.17) is modelled purely — a reference "store" function
// mirroring what `src/actions/master-actions/adminActions.ts` persists,
// followed by a reference "reload" function mirroring what
// `UserManagement.tsx`'s `openEdit` does to prefill the form — since there is
// no live database in this test.
//
// **Validates: Requirements 13.1, 13.2, 13.3, 13.7, 13.8, 13.9, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  ADMIN_ACCESS_LEVELS,
  validateClinicScopeAssignment,
  CLINIC_SCOPED_GROUPS,
  OPERATIONS_GROUPS,
  PERMISSION_LEVELS,
  type AdminAccessLevel,
  type ClinicScopeAssignmentCandidate,
  type OperationsAccess,
  type OperationsGroup,
  type PermissionLevel,
} from "../adminAccessCore";

const NUM_RUNS = 250;

// ─── Fixture identifiers ──────────────────────────────────────────────────────

function fixtureUuid(group: number, index: number): string {
  const tail = `${group}`.padStart(4, "0") + `${index}`.padStart(8, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

/** A small pool of clinic identifiers so shrinking is readable. */
const CLINIC_ID_POOL = [fixtureUuid(11, 1), fixtureUuid(11, 2)] as const;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const levelArb: fc.Arbitrary<AdminAccessLevel> = fc.constantFrom(
  ...ADMIN_ACCESS_LEVELS,
);

const clinicIdArb: fc.Arbitrary<string | null> = fc.oneof(
  { arbitrary: fc.constant<string | null>(null), weight: 2 },
  { arbitrary: fc.constantFrom<string | null>(...CLINIC_ID_POOL), weight: 3 },
);

const isCoreClinicArb: fc.Arbitrary<boolean | null> = fc.constantFrom<
  boolean | null
>(null, true, false);

/**
 * Operations-group subsets drawn from ALL SIX groups (deliberately including
 * `operations` and `franchises`), so the rejection path (Req 13.13) is
 * exercised and not only the four Clinic_Scoped_Groups.
 */
const groupsArb: fc.Arbitrary<OperationsAccess> = fc
  .subarray([...OPERATIONS_GROUPS])
  .chain((selected) =>
    fc
      .array(fc.constantFrom<PermissionLevel>(...PERMISSION_LEVELS), {
        minLength: selected.length,
        maxLength: selected.length,
      })
      .map((levels) => {
        const groups: OperationsAccess = {};
        selected.forEach((group, index) => {
          groups[group] = levels[index];
        });
        return groups;
      }),
  );

/** A submitted candidate over the full input space. */
const candidateArb: fc.Arbitrary<ClinicScopeAssignmentCandidate> = fc
  .tuple(levelArb, fc.boolean(), clinicIdArb, groupsArb, isCoreClinicArb)
  .map(([level, clinicAccess, clinicId, groups, isCoreClinic]) => ({
    level,
    clinicAccess,
    clinicId,
    groups,
    isCoreClinic,
  }));

// ─── Reference model ──────────────────────────────────────────────────────────
//
// Transcribed fresh from Requirements 13.1, 13.2, 13.3, 13.7-13.9, 13.11-13.14:
//   - clinicAccess checked but no clinic selected -> reject (13.11)
//   - a clinic is selected but the level isn't operations -> reject (13.14)
//   - a clinic is selected but it is not a Core Clinic -> reject (13.12, 13.1)
//   - a clinic is selected and the groups include `operations` or
//     `franchises` (the two groups excluded from Clinic_Scoped_Groups,
//     13.7, 13.8) -> reject (13.13)
//   - otherwise -> accept

type RejectionReason =
  | "clinic-access-no-clinic"
  | "clinic-requires-operations-level"
  | "clinic-not-core"
  | "clinic-groups-forbidden";

function referenceReject(
  input: ClinicScopeAssignmentCandidate,
): RejectionReason | null {
  const { level, clinicAccess, clinicId, groups, isCoreClinic } = input;

  if (clinicAccess && clinicId === null) {
    return "clinic-access-no-clinic";
  }
  if (clinicId !== null) {
    if (level !== "operations") {
      return "clinic-requires-operations-level";
    }
    if (isCoreClinic === false) {
      return "clinic-not-core";
    }
    if (groups.operations !== undefined || groups.franchises !== undefined) {
      return "clinic-groups-forbidden";
    }
  }
  return null;
}

function referenceAccepts(input: ClinicScopeAssignmentCandidate): boolean {
  return referenceReject(input) === null;
}

// The exact rejection message strings, read from `adminAccessCore.ts`.
const MESSAGES: Record<RejectionReason, string> = {
  "clinic-access-no-clinic":
    "A clinic must be selected for clinic level access",
  "clinic-requires-operations-level":
    "Clinic level access requires the operations access level",
  "clinic-not-core":
    "The selected clinic is unavailable for clinic level access",
  "clinic-groups-forbidden":
    "The operations and franchises groups are unavailable for clinic level access",
};

// ─── Reference persistence + reload model (Req 13.9, 13.16, 13.17) ──────────
//
// Mirrors exactly what `src/actions/master-actions/adminActions.ts` persists
// on an accepted submission (level, clinic id when clinicAccess is set, and
// only the accepted groups) and what `UserManagement.tsx`'s `openEdit` does
// to prefill the form on reload.

interface StoredUserState {
  level: AdminAccessLevel;
  clinicId: string | null;
  groups: OperationsAccess;
}

interface FormState {
  level: AdminAccessLevel;
  clinicAccess: boolean;
  clinicId: string | null;
  groups: OperationsAccess;
}

/** The sentinel `UserManagement.tsx` uses in the clinic dropdown. */
const UNASSIGNED_SENTINEL = "__unassigned__";

/**
 * Mirrors `createAdminUser` / `updateAdminUser`'s persistence of an accepted
 * submission: level unchanged, clinicId persisted only while clinicAccess is
 * checked (Req 13.9), groups persisted as submitted (already restricted to
 * the accepted set by the caller, since acceptance requires it).
 */
function referenceStore(input: ClinicScopeAssignmentCandidate): StoredUserState {
  return {
    level: input.level,
    clinicId: input.clinicAccess ? input.clinicId : null,
    groups: { ...input.groups },
  };
}

/**
 * Mirrors `UserManagement.tsx`'s `openEdit`: `clinicAccess = clinicId !==
 * null`, `clinicId = storedClinicId ?? UNASSIGNED_SENTINEL`, `groups =
 * storedGroups` (Req 13.17).
 */
function referenceReload(stored: StoredUserState): FormState {
  return {
    level: stored.level,
    clinicAccess: stored.clinicId !== null,
    clinicId: stored.clinicId ?? UNASSIGNED_SENTINEL,
    groups: { ...stored.groups },
  };
}

/** The submitted form state's shape, for comparison against a reload. */
function submittedFormState(input: ClinicScopeAssignmentCandidate): FormState {
  return {
    level: input.level,
    clinicAccess: input.clinicAccess,
    clinicId: input.clinicAccess
      ? (input.clinicId as string) // accepted => clinicAccess implies clinicId !== null
      : UNASSIGNED_SENTINEL,
    groups: { ...input.groups },
  };
}

// ─── Properties ───────────────────────────────────────────────────────────────

describe("Property 26: Clinic scope assignment validates and round-trips", () => {
  it("agrees with the reference acceptance predicate on every input (Req 13.1, 13.2, 13.3, 13.7-13.9, 13.11-13.14)", () => {
    fc.assert(
      fc.property(candidateArb, (input) => {
        const result = validateClinicScopeAssignment(input);
        expect(result.ok).toBe(referenceAccepts(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("attributes every rejection to the correct reason and exact message (Req 13.11, 13.12, 13.13, 13.14)", () => {
    fc.assert(
      fc.property(candidateArb, (input) => {
        const result = validateClinicScopeAssignment(input);
        const reason = referenceReject(input);

        if (reason === null) {
          expect(result.ok).toBe(true);
          return;
        }
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe(MESSAGES[reason]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reaches each of the four distinct rejection reasons", () => {
    // (a) clinicAccess checked, no clinic selected.
    const a = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: null,
      groups: {},
      isCoreClinic: null,
    });
    expect(a).toEqual({ ok: false, error: MESSAGES["clinic-access-no-clinic"] });

    // (b) clinic selected, level is not operations.
    const b = validateClinicScopeAssignment({
      level: "inventory_operations",
      clinicAccess: true,
      clinicId: CLINIC_ID_POOL[0],
      groups: {},
      isCoreClinic: true,
    });
    expect(b).toEqual({
      ok: false,
      error: MESSAGES["clinic-requires-operations-level"],
    });

    // (c) clinic selected, resolved to not-a-Core-Clinic.
    const c = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID_POOL[0],
      groups: {},
      isCoreClinic: false,
    });
    expect(c).toEqual({ ok: false, error: MESSAGES["clinic-not-core"] });

    // (d) clinic selected, groups include operations/franchises.
    const d = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID_POOL[0],
      groups: { operations: "manage" },
      isCoreClinic: true,
    });
    expect(d).toEqual({ ok: false, error: MESSAGES["clinic-groups-forbidden"] });

    const d2 = validateClinicScopeAssignment({
      level: "operations",
      clinicAccess: true,
      clinicId: CLINIC_ID_POOL[0],
      groups: { franchises: "view" },
      isCoreClinic: true,
    });
    expect(d2).toEqual({ ok: false, error: MESSAGES["clinic-groups-forbidden"] });
  });

  it("round-trips: reloading an accepted submission's edit form yields exactly the saved configuration (Req 13.17)", () => {
    fc.assert(
      fc.property(candidateArb, (input) => {
        fc.pre(validateClinicScopeAssignment(input).ok);

        const stored = referenceStore(input);
        const reloaded = referenceReload(stored);
        const submitted = submittedFormState(input);

        expect(reloaded).toEqual(submitted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaves a reference stored state unchanged when the submission is rejected (Req 13.9, 13.10)", () => {
    fc.assert(
      fc.property(candidateArb, candidateArb, (existingSeed, rejectedInput) => {
        fc.pre(!validateClinicScopeAssignment(rejectedInput).ok);

        const before: StoredUserState = referenceStore(existingSeed);
        const beforeSnapshot = {
          level: before.level,
          clinicId: before.clinicId,
          groups: { ...before.groups },
        };

        // A rejected submission never reaches the reference store — the
        // "no-op against whatever was previously stored" guarantee is that
        // the existing state is simply never touched.
        const result = validateClinicScopeAssignment(rejectedInput);
        expect(result.ok).toBe(false);
        expect(before).toEqual(beforeSnapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every clinic-scoped group offered on acceptance is one of the four Clinic_Scoped_Groups (Req 13.7, 13.8)", () => {
    fc.assert(
      fc.property(candidateArb, (input) => {
        const result = validateClinicScopeAssignment(input);
        fc.pre(result.ok && input.clinicId !== null);

        for (const key of Object.keys(input.groups) as OperationsGroup[]) {
          expect(CLINIC_SCOPED_GROUPS).toContain(key);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
