// Feature: core-clinic-architecture, Property 1: City name validity and case-insensitive uniqueness
//
// Property tests for `validateCityName` in src/lib/clinic/validation.ts.
//
// Property 1: City name validity and case-insensitive uniqueness
// Validates: Requirements 1.1, 1.3, 1.4
//
// For any candidate city name and any set of existing city names, the validator
// accepts the candidate if and only if it is non-empty (after trimming), at most
// CITY_NAME_MAX characters, and not a case-insensitive duplicate of any OTHER
// existing name. A city editing to its own current name (case-insensitively) is
// always allowed. Rejection reports the specific reason (empty / too_long /
// duplicate).

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateCityName, CITY_NAME_MAX } from "../validation";

// ─── Generators ─────────────────────────────────────────────────────────────

// A name whose trimmed form is non-empty and within CITY_NAME_MAX (valid length).
const arbValidName = fc
  .string({ minLength: 1, maxLength: CITY_NAME_MAX })
  .filter((s) => s.trim().length > 0 && s.trim().length <= CITY_NAME_MAX);

// A name that is empty or whitespace-only after trimming.
const arbBlankName = fc
  .stringMatching(/^[ \t\n\r]*$/)
  .filter((s) => s.trim().length === 0);

// A name strictly longer than CITY_NAME_MAX once trimmed (uses non-space chars).
const arbTooLongName = fc
  .string({ minLength: CITY_NAME_MAX + 1, maxLength: CITY_NAME_MAX + 50 })
  .map((s) => s.replace(/\s/g, "x")) // ensure trimming cannot shrink below the limit
  .filter((s) => s.trim().length > CITY_NAME_MAX);

// A set of existing names (lowercased), as stored by callers.
const arbExistingLowerSet = fc
  .array(arbValidName, { maxLength: 30 })
  .map((arr) => new Set(arr.map((n) => n.trim().toLowerCase())));

// Random casing transform of a string, to exercise case-insensitivity.
function randomCase(s: string, seed: number): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += (seed >> (i % 31)) & 1 ? ch.toUpperCase() : ch.toLowerCase();
  }
  return out;
}

describe("Property 1: City name validity and case-insensitive uniqueness", () => {
  it("accepts a non-empty, within-bounds name that is not a duplicate of another existing name", () => {
    fc.assert(
      fc.property(arbValidName, arbExistingLowerSet, (name, existing) => {
        const lower = name.trim().toLowerCase();
        // Only assert the accept direction when the candidate is NOT an existing other name.
        fc.pre(!existing.has(lower));

        const result = validateCityName(name, existing);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("rejects a case-insensitive duplicate of an existing OTHER name with reason 'duplicate'", () => {
    fc.assert(
      fc.property(
        arbValidName,
        arbExistingLowerSet,
        fc.integer(),
        (name, existing, seed) => {
          const lower = name.trim().toLowerCase();
          // Force the candidate to collide with an existing name.
          const existingWithDup = new Set(existing);
          existingWithDup.add(lower);

          // Submit the candidate in arbitrary casing; it must still be a duplicate.
          const recased = randomCase(name.trim(), seed);
          const result = validateCityName(recased, existingWithDup);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("duplicate");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("always allows a self-rename to the record's own current (lowercased) name, even when it is in the existing set", () => {
    fc.assert(
      fc.property(
        arbValidName,
        arbExistingLowerSet,
        fc.integer(),
        (name, existing, seed) => {
          const currentLower = name.trim().toLowerCase();
          // The current name is present among existing names (as it would be for an edit).
          const existingWithSelf = new Set(existing);
          existingWithSelf.add(currentLower);

          // Submit any-casing variant of the record's own current name.
          const recased = randomCase(name.trim(), seed);
          const result = validateCityName(recased, existingWithSelf, currentLower);

          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects empty/whitespace-only names with reason 'empty'", () => {
    fc.assert(
      fc.property(arbBlankName, arbExistingLowerSet, (blank, existing) => {
        const result = validateCityName(blank, existing);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("empty");
        }
      }),
      { numRuns: 200 }
    );
  });

  it("rejects over-length names with reason 'too_long'", () => {
    fc.assert(
      fc.property(arbTooLongName, arbExistingLowerSet, (longName, existing) => {
        const result = validateCityName(longName, existing);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("too_long");
        }
      }),
      { numRuns: 200 }
    );
  });

  it("acceptance is exactly: non-empty, within bounds, and not a duplicate of another name", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: CITY_NAME_MAX + 20 }),
        arbExistingLowerSet,
        (name, existing) => {
          const trimmed = (name ?? "").trim();
          const lower = trimmed.toLowerCase();
          const expectedOk =
            trimmed.length > 0 &&
            trimmed.length <= CITY_NAME_MAX &&
            !existing.has(lower);

          const result = validateCityName(name, existing);
          expect(result.ok).toBe(expectedOk);
        }
      ),
      { numRuns: 300 }
    );
  });
});
