// src/test/customer-pin-auth/pin-utilities.property.test.ts
// Feature: customer-pin-auth, Property 11 & Property 12: PIN utilities
//
// Property 11: PIN format validation rejects non-6-digit-numeric strings
// For any string that does NOT match /^\d{6}$/, isValidPinFormat returns false.
// For any string that DOES match /^\d{6}$/, isValidPinFormat returns true.
//
// Property 12: Auto-generate always produces valid PIN format
// For any invocation of generateTemporaryPin(), the result is exactly 6
// characters, all numeric digits, and passes isValidPinFormat.
//
// Validates: Requirements 3.5, 4.2, 6.2, 6.3, 7.3

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isValidPinFormat, generateTemporaryPin } from "@/lib/pin/pinUtils";

// ─── Arbitrary generators ───────────────────────────────────────────────────

/** Generates valid 6-digit PINs: integers in [0, 999999] zero-padded to 6 chars */
const validPin = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => n.toString().padStart(6, "0"));

// ─── Property 11: PIN format validation ─────────────────────────────────────

describe("Property 11: PIN format validation rejects non-6-digit-numeric strings", () => {
  it("returns true for any string matching /^\\d{6}$/", () => {
    /**
     * **Validates: Requirements 3.5, 4.2, 6.3, 7.3**
     */
    fc.assert(
      fc.property(validPin, (pin) => {
        expect(isValidPinFormat(pin)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("returns false for arbitrary strings that do NOT match /^\\d{6}$/", () => {
    /**
     * **Validates: Requirements 3.5, 4.2, 6.3, 7.3**
     */
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^\d{6}$/.test(s)),
        (input) => {
          expect(isValidPinFormat(input)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns false for non-string inputs (integers)", () => {
    /**
     * **Validates: Requirements 3.5, 4.2, 6.3, 7.3**
     */
    fc.assert(
      fc.property(fc.integer(), (input) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidPinFormat(input as any)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("returns false for non-string inputs (arrays)", () => {
    /**
     * **Validates: Requirements 3.5, 4.2, 6.3, 7.3**
     */
    fc.assert(
      fc.property(fc.array(fc.anything()), (input) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidPinFormat(input as any)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("returns false for non-string inputs (anything)", () => {
    /**
     * **Validates: Requirements 3.5, 4.2, 6.3, 7.3**
     */
    fc.assert(
      fc.property(
        fc.anything().filter((v) => typeof v !== "string"),
        (input) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect(isValidPinFormat(input as any)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Auto-generate always produces valid PIN format ────────────

describe("Property 12: Auto-generate always produces valid PIN format", () => {
  it("generateTemporaryPin() always returns a 6-character numeric string that passes isValidPinFormat", () => {
    /**
     * **Validates: Requirements 6.2**
     */
    fc.assert(
      fc.property(fc.constant(null), () => {
        const pin = generateTemporaryPin();

        // Exactly 6 characters long
        expect(pin).toHaveLength(6);

        // All characters are numeric digits
        expect(pin).toMatch(/^\d{6}$/);

        // Passes the isValidPinFormat validation
        expect(isValidPinFormat(pin)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
