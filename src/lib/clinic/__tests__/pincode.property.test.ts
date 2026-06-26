// Feature: core-clinic-architecture, Property 9: Pincode format validation
//
// Property tests for `isValidPincode` (src/lib/clinic/validation.ts).
//
// Property 9: Pincode format validation
//   For any string, the pincode validator accepts it if and only if it
//   consists of exactly six numeric digits; strings with non-digit
//   characters, wrong length (fewer/more than 6 digits), embedded spaces,
//   or empty are rejected.
//
// Validates: Requirements 5.4

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isValidPincode } from "../validation";

// ─── Arbitrary generators ──────────────────────────────────────────────────

/** Exactly six numeric digits — the only accepted shape. */
const arbValidPincode = fc.stringMatching(/^[0-9]{6}$/);

/** A single ASCII digit character. */
const arbDigit = fc.integer({ min: 0, max: 9 }).map((n) => String(n));

/** Any string that is NOT exactly six numeric digits (the rejected space). */
const arbInvalidPincode = fc
  .string()
  .filter((s) => !/^[0-9]{6}$/.test(s));

// ─── Property Tests ────────────────────────────────────────────────────────

describe("Property 9: Pincode format validation - isValidPincode", () => {
  it("accepts any string of exactly six numeric digits", () => {
    fc.assert(
      fc.property(arbValidPincode, (pincode) => {
        expect(isValidPincode(pincode)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("accepts iff exactly six digits, and rejects every other string", () => {
    // Universal biconditional: accepted <=> matches /^[0-9]{6}$/.
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        const expected = /^[0-9]{6}$/.test(s);
        expect(isValidPincode(s)).toBe(expected);
      }),
      { numRuns: 500 }
    );
  });

  it("rejects strings that are not exactly six numeric digits", () => {
    fc.assert(
      fc.property(arbInvalidPincode, (invalid) => {
        expect(isValidPincode(invalid)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  it("rejects digit strings of any length other than six", () => {
    fc.assert(
      fc.property(
        fc
          .array(arbDigit, { minLength: 0, maxLength: 20 })
          .filter((arr) => arr.length !== 6)
          .map((arr) => arr.join("")),
        (digits) => {
          expect(isValidPincode(digits)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects six-character strings containing at least one non-digit", () => {
    // Build length-6 strings from a charset that includes non-digits, keep
    // only those with a non-digit so the length is right but content is not.
    fc.assert(
      fc.property(
        fc
          .array(
            fc.constantFrom(
              ..."0123456789abcXYZ !@#-. ".split("")
            ),
            { minLength: 6, maxLength: 6 }
          )
          .map((arr) => arr.join(""))
          .filter((s) => !/^[0-9]{6}$/.test(s)),
        (mixed) => {
          expect(isValidPincode(mixed)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects six-digit values with an embedded space", () => {
    fc.assert(
      fc.property(
        fc.tuple(arbDigit, arbDigit, arbDigit, arbDigit, arbDigit),
        fc.integer({ min: 0, max: 5 }),
        (fiveDigits, spaceIndex) => {
          // Insert a space among 5 digits -> length 6, contains a space.
          const chars = [...fiveDigits];
          chars.splice(spaceIndex, 0, " ");
          const withSpace = chars.join("");
          expect(isValidPincode(withSpace)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects the empty string", () => {
    expect(isValidPincode("")).toBe(false);
  });
});
