// src/test/dietitian/seed-plan.property.test.ts
// Feature: dietitian-management, Property 37
//
// Property 37: Seeding skips and reports pre-existing Dietitians.
//
// For any subset of the four seeded Dietitians already present in `users` — by
// email, by mobile, or by both, in any combination including all four and none
// — the seed plan skips exactly those, reports each with its conflict reason and
// the existing user id, creates exactly the remaining Dietitians, and leaves
// every existing row untouched.
//
// Under test: `scripts/lib/dietitian-seed-plan.mjs`, the pure decision half of
// `scripts/seed-dietitians.mjs`. No database is contacted: the pre-existing rows
// are generated and handed to the planner directly, frozen so that any write
// attempt would throw.
//
// **Validates: Requirements 4.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CONFLICT_REASON_EMAIL,
  CONFLICT_REASON_MOBILE,
  DIETITIANS,
  planDietitianSeed,
  seedLookupValues,
} from "../../../scripts/lib/dietitian-seed-plan.mjs";

const NUM_RUNS = 200;

/** How a seeded Dietitian may already be present on a `users` row. */
type Presence =
  /** No conflicting row at all. */
  | "absent"
  /** Same email, a different (non-colliding) mobile. */
  | "email"
  /** Same mobile, a different (non-colliding) email. */
  | "mobile"
  /** Same mobile on a row that carries no email at all. */
  | "mobileNoEmail"
  /** Same email and same mobile. */
  | "both";

interface ExistingRow {
  id: string;
  email: string | null;
  mobile: string | null;
}

interface Scenario {
  presence: Presence[];
  rows: ExistingRow[];
}

/**
 * Mobiles that can never collide with a seeded Dietitian: every seeded mobile
 * starts with `9`, these start with `70`.
 */
function foreignMobile(index: number): string {
  return `70${String(index).padStart(8, "0")}`;
}

/** Emails that can never collide with a seeded Dietitian (all `@gmail.com`). */
function foreignEmail(index: number): string {
  return `other${index}@example.com`;
}

/** Builds the pre-existing `users` rows implied by a presence assignment. */
function buildRows(
  presence: Presence[],
  upperCaseEmail: boolean[],
  unrelatedCount: number,
  reverse: boolean,
): ExistingRow[] {
  const rows: ExistingRow[] = [];

  DIETITIANS.forEach((dietitian, index) => {
    const id = `existing-${index}`;
    const email = upperCaseEmail[index]
      ? String(dietitian.email).toUpperCase()
      : String(dietitian.email);

    switch (presence[index]) {
      case "absent":
        return;
      case "email":
        rows.push({ id, email, mobile: foreignMobile(index) });
        return;
      case "mobile":
        rows.push({ id, email: foreignEmail(index), mobile: dietitian.mobile });
        return;
      case "mobileNoEmail":
        rows.push({ id, email: null, mobile: dietitian.mobile });
        return;
      case "both":
        rows.push({ id, email, mobile: dietitian.mobile });
        return;
    }
  });

  for (let k = 0; k < unrelatedCount; k += 1) {
    rows.push({
      id: `unrelated-${k}`,
      email: foreignEmail(100 + k),
      mobile: foreignMobile(100 + k),
    });
  }

  const ordered = reverse ? rows.reverse() : rows;
  return ordered.map((row) => Object.freeze({ ...row })) as ExistingRow[];
}

const presenceArb = fc.constantFrom<Presence>(
  "absent",
  "email",
  "mobile",
  "mobileNoEmail",
  "both",
);

/** Arbitrary pre-existing-row configuration over the four seeded Dietitians. */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    presence: fc.array(presenceArb, {
      minLength: DIETITIANS.length,
      maxLength: DIETITIANS.length,
    }),
    upperCaseEmail: fc.array(fc.boolean(), {
      minLength: DIETITIANS.length,
      maxLength: DIETITIANS.length,
    }),
    unrelatedCount: fc.integer({ min: 0, max: 3 }),
    reverse: fc.boolean(),
  })
  .map(({ presence, upperCaseEmail, unrelatedCount, reverse }) => ({
    presence,
    rows: buildRows(presence, upperCaseEmail, unrelatedCount, reverse),
  }));

/** Reference model: which Dietitians are skipped, and with what reason. */
function expectedSkip(presence: Presence): { skipped: boolean; reason?: string } {
  switch (presence) {
    case "absent":
      return { skipped: false };
    case "email":
    case "both":
      return { skipped: true, reason: CONFLICT_REASON_EMAIL };
    case "mobile":
    case "mobileNoEmail":
      return { skipped: true, reason: CONFLICT_REASON_MOBILE };
  }
}

describe("Property 37: Seeding skips and reports pre-existing Dietitians", () => {
  it("skips exactly the pre-existing Dietitians and creates exactly the rest", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    fc.assert(
      fc.property(scenarioArb, ({ presence, rows }) => {
        const plan = planDietitianSeed(DIETITIANS, rows);

        const expectedSkippedNames = DIETITIANS.filter(
          (_, i) => expectedSkip(presence[i]).skipped,
        ).map((d) => d.fullName);
        const expectedCreatedNames = DIETITIANS.filter(
          (_, i) => !expectedSkip(presence[i]).skipped,
        ).map((d) => d.fullName);

        expect(plan.skipped.map((s) => s.dietitian.fullName)).toEqual(
          expectedSkippedNames,
        );
        expect(plan.toCreate.map((c) => c.dietitian.fullName)).toEqual(
          expectedCreatedNames,
        );

        // The partition is exact: every Dietitian is decided exactly once.
        expect(plan.decisions.length).toBe(DIETITIANS.length);
        expect(plan.skipped.length + plan.toCreate.length).toBe(
          DIETITIANS.length,
        );
        expect(plan.decisions.map((d) => d.dietitian.fullName)).toEqual(
          DIETITIANS.map((d) => d.fullName),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reports each skipped Dietitian with its conflict reason and existing user id", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    fc.assert(
      fc.property(scenarioArb, ({ presence, rows }) => {
        const plan = planDietitianSeed(DIETITIANS, rows);

        DIETITIANS.forEach((dietitian, index) => {
          const expected = expectedSkip(presence[index]);
          const decision = plan.decisions[index];

          if (!expected.skipped) {
            expect(decision.action).toBe("create");
            expect(decision.email).toBe(dietitian.email.toLowerCase());
            return;
          }

          expect(decision.action).toBe("skip");
          if (decision.action !== "skip") {
            throw new Error(`expected a skip decision for ${dietitian.email}`);
          }
          expect(decision.reason).toBe(expected.reason);
          expect(decision.existingUserId).toBe(`existing-${index}`);
          expect(rows.some((row) => row.id === decision.existingUserId)).toBe(
            true,
          );
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("matches a colliding mobile under a different email, and a colliding email under a different mobile", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: DIETITIANS.length - 1 }),
        fc.constantFrom<Presence>("email", "mobile", "mobileNoEmail"),
        (index, presenceKind) => {
          const presence: Presence[] = DIETITIANS.map((_, i) =>
            i === index ? presenceKind : "absent",
          );
          const rows = buildRows(
            presence,
            DIETITIANS.map(() => false),
            0,
            false,
          );

          const plan = planDietitianSeed(DIETITIANS, rows);
          const decision = plan.decisions[index];

          expect(plan.skipped.length).toBe(1);
          expect(decision.action).toBe("skip");
          if (decision.action !== "skip") {
            throw new Error(
              `expected a skip decision for ${DIETITIANS[index].email}`,
            );
          }
          expect(decision.reason).toBe(expectedSkip(presenceKind).reason);
          expect(decision.existingUserId).toBe(`existing-${index}`);

          // The single conflicting field is enough — the other field differs.
          const row = rows.find((r) => r.id === `existing-${index}`)!;
          if (presenceKind === "email") {
            expect(row.mobile).not.toBe(DIETITIANS[index].mobile);
          } else {
            expect(row.email === null || row.email !== DIETITIANS[index].email).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("never modifies a pre-existing row", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    fc.assert(
      fc.property(scenarioArb, ({ rows }) => {
        const before = JSON.stringify(rows);
        planDietitianSeed(DIETITIANS, rows);
        // The rows are frozen, so a write would have thrown; the snapshot check
        // also catches any reordering or added field.
        expect(JSON.stringify(rows)).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is idempotent: re-planning after the created rows exist skips all four", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    fc.assert(
      fc.property(scenarioArb, ({ rows }) => {
        const first = planDietitianSeed(DIETITIANS, rows);

        // Same input, same plan.
        expect(planDietitianSeed(DIETITIANS, rows)).toEqual(first);

        // Second run, with the first run's creations now materialised.
        const afterFirstRun = [
          ...rows,
          ...first.toCreate.map((decision, k) => ({
            id: `created-${k}`,
            email: decision.email,
            mobile: decision.dietitian.mobile,
          })),
        ];
        const second = planDietitianSeed(DIETITIANS, afterFirstRun);

        expect(second.toCreate).toEqual([]);
        expect(second.skipped.length).toBe(DIETITIANS.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("creates all four when no row exists, and skips all four when every row exists", () => {
    /**
     * **Validates: Requirements 4.6**
     */
    const noneExist = planDietitianSeed(DIETITIANS, []);
    expect(noneExist.skipped).toEqual([]);
    expect(noneExist.toCreate.length).toBe(DIETITIANS.length);

    const allExist = planDietitianSeed(
      DIETITIANS,
      buildRows(
        DIETITIANS.map(() => "both" as Presence),
        DIETITIANS.map(() => false),
        0,
        false,
      ),
    );
    expect(allExist.toCreate).toEqual([]);
    expect(allExist.skipped.length).toBe(DIETITIANS.length);

    // The conflict query looks up every seeded email and mobile.
    const { emails, mobiles } = seedLookupValues(DIETITIANS);
    expect(emails).toEqual(DIETITIANS.map((d) => d.email.toLowerCase()));
    expect(mobiles).toEqual(DIETITIANS.map((d) => d.mobile));
  });
});
