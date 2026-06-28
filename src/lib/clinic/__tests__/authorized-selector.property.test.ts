// Feature: core-clinic-architecture, Property 38: Selector restricted to authorized clinics
//
// Property tests for `authorizedClinicOptions` in src/lib/clinic/visibility.ts.
//
// Property 38: Selector restricted to authorized clinics
//   For any authenticated user, the clinic selector options in the operational
//   views equal the set of clinics the user is authorized to access. When the
//   user is authorized for "all" clinics, every clinic is selectable; otherwise
//   only the clinics whose id is in the authorized set are selectable, in the
//   original order, and authorized ids that don't correspond to a real clinic
//   produce no extra entries.
//
// Validates: Requirements 17.9

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { authorizedClinicOptions } from "../visibility";

// ─── Arbitrary generators ──────────────────────────────────────────────────

type Clinic = { id: string; name: string };

/**
 * An array of clinics with unique ids. We generate a set of unique ids first,
 * then attach an arbitrary name to each so the result models "every clinic
 * that exists" with no duplicate id.
 */
const arbAllClinics: fc.Arbitrary<Clinic[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 20 })
  .chain((ids) =>
    fc
      .tuple(...ids.map(() => fc.string({ maxLength: 12 })))
      .map((names) =>
        ids.map((id, i) => ({ id, name: names[i] ?? "" }))
      )
  );

/**
 * Ids that are guaranteed NOT to be real clinic ids (the generator above only
 * produces ids of length 1-8, so prefixing keeps these outside that space and
 * they must be ignored by `authorizedClinicOptions`).
 */
const arbForeignIds: fc.Arbitrary<string[]> = fc.array(
  fc.string({ maxLength: 6 }).map((s) => `foreign::${s}`),
  { maxLength: 10 }
);

const NUM_RUNS = 200;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 38: Selector restricted to authorized clinics", () => {
  it('"all" authorization returns exactly allClinics, same order (Req 17.9)', () => {
    fc.assert(
      fc.property(arbAllClinics, (allClinics) => {
        const result = authorizedClinicOptions(allClinics, "all");
        // Identity over the full clinic list — every clinic is selectable.
        expect(result).toEqual(allClinics);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("a subset authorization returns exactly the authorized clinics, original order preserved (Req 17.9)", () => {
    fc.assert(
      fc.property(
        arbAllClinics.chain((allClinics) => {
          const ids = allClinics.map((c) => c.id);
          // An arbitrary subset of the real clinic ids.
          const arbSubset =
            ids.length === 0
              ? fc.constant<string[]>([])
              : fc.subarray(ids);
          return fc.tuple(fc.constant(allClinics), arbSubset, arbForeignIds);
        }),
        ([allClinics, authorizedSubset, foreignIds]) => {
          // Authorized set = a real subset plus some ids that aren't clinics.
          const authorizedIds = [...authorizedSubset, ...foreignIds];
          const result = authorizedClinicOptions(allClinics, authorizedIds);

          const authorizedSet = new Set(authorizedIds);
          const expected = allClinics.filter((c) => authorizedSet.has(c.id));

          // Exactly the authorized clinics, in original order.
          expect(result).toEqual(expected);

          // Every returned clinic is authorized and real.
          for (const clinic of result) {
            expect(authorizedSet.has(clinic.id)).toBe(true);
            expect(allClinics).toContainEqual(clinic);
          }

          // Every unauthorized clinic is excluded.
          for (const clinic of allClinics) {
            if (!authorizedSet.has(clinic.id)) {
              expect(result).not.toContainEqual(clinic);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("foreign authorized ids (no matching clinic) produce no extra entries (Req 17.9)", () => {
    fc.assert(
      fc.property(arbAllClinics, arbForeignIds, (allClinics, foreignIds) => {
        // Authorize ONLY ids that don't correspond to any real clinic.
        const result = authorizedClinicOptions(allClinics, foreignIds);
        expect(result).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("result is always a subsequence of allClinics for any authorization", () => {
    fc.assert(
      fc.property(
        arbAllClinics,
        fc.oneof(
          fc.constant<"all">("all"),
          fc.array(fc.string({ maxLength: 8 }), { maxLength: 15 })
        ),
        (allClinics, authorization) => {
          const result = authorizedClinicOptions(allClinics, authorization);
          // Walk allClinics once, matching each result element in order.
          let i = 0;
          for (const clinic of allClinics) {
            if (i < result.length && result[i] === clinic) {
              i++;
            }
          }
          expect(i).toBe(result.length);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("empty clinic list yields empty options for any authorization", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<"all">("all"),
          fc.array(fc.string({ maxLength: 8 }), { maxLength: 10 })
        ),
        (authorization) => {
          expect(authorizedClinicOptions<Clinic>([], authorization)).toEqual([]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
