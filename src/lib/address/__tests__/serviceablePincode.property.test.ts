// src/lib/address/__tests__/serviceablePincode.property.test.ts
// Feature: customer-mobile-onboarding, Property 17: Serviceable-pincode gate for captured address
//
// Property 17: Serviceable-pincode gate for captured address
// For any selected pincode and any franchise serviceable-pincode set, the captured
// address is savable iff the pincode is in the serviceable set AND the flat number
// is present; an out-of-area pincode surfaces a not-serviceable warning and blocks
// the save.
//
// Validates: Requirements 5.6, 5.8

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isServiceable,
  canSaveAddress,
  notServiceableMessage,
} from "@/lib/address/serviceablePincode";

// ─── Arbitrary generators ───────────────────────────────────────────────────

/** A valid 6-digit pincode string (leading digit 1-9, consistent with India). */
const arbValidPincode = fc
  .integer({ min: 100000, max: 999999 })
  .map((n) => String(n));

/** A syntactically invalid pincode (wrong length or non-numeric). */
const arbInvalidPincode = fc.oneof(
  fc.integer({ min: 0, max: 99999 }).map((n) => String(n)), // too short
  fc.integer({ min: 1000000, max: 99999999 }).map((n) => String(n)), // too long
  fc.string({ minLength: 0, maxLength: 6 }).filter((s) => !/^\d{6}$/.test(s.trim())),
);

/** A flat number that is present (non-empty after trimming). */
const arbPresentFlat = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** A flat number treated as absent (empty or whitespace-only). */
const arbAbsentFlat = fc.constantFrom("", " ", "   ", "\t", "\n", "  \t ");

/** A service-area set built from valid pincodes (may be empty). */
const arbServiceArea = fc.uniqueArray(arbValidPincode, { minLength: 0, maxLength: 20 });

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Property 17: Serviceable-pincode gate for captured address", () => {
  it("canSave is true iff pincode is serviceable AND flat number is present", () => {
    fc.assert(
      fc.property(
        arbValidPincode,
        arbServiceArea,
        fc.oneof(arbPresentFlat, arbAbsentFlat),
        (pincode, serviceArea, flatNumber) => {
          const serviceAreaPincodes = new Set(serviceArea);
          const decision = canSaveAddress({
            pincode,
            flatNumber,
            serviceAreaPincodes,
          });

          // Independent reference computation of the two gate conditions.
          const serviceable = serviceAreaPincodes.has(pincode);
          const flatPresent = flatNumber.trim().length > 0;
          const expected = serviceable && flatPresent;

          expect(decision.canSave).toBe(expected);
          // isServiceable must agree with membership for a valid pincode.
          expect(isServiceable(pincode, serviceAreaPincodes)).toBe(serviceable);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("an out-of-area pincode blocks the save and reports PINCODE_NOT_SERVICEABLE", () => {
    fc.assert(
      fc.property(
        arbValidPincode,
        arbServiceArea,
        arbPresentFlat,
        (pincode, serviceArea, flatNumber) => {
          // Force the pincode to be outside the serviceable set.
          const serviceAreaPincodes = new Set(
            serviceArea.filter((p) => p !== pincode),
          );

          const decision = canSaveAddress({
            pincode,
            flatNumber,
            serviceAreaPincodes,
          });

          expect(isServiceable(pincode, serviceAreaPincodes)).toBe(false);
          expect(decision.canSave).toBe(false);
          expect(decision.errors).toContain("PINCODE_NOT_SERVICEABLE");
          // The warning names the offending pincode (Req 5.6).
          expect(notServiceableMessage(pincode)).toContain(pincode);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("a serviceable pincode with a present flat number is savable with no errors", () => {
    fc.assert(
      fc.property(
        arbServiceArea,
        arbValidPincode,
        arbPresentFlat,
        (serviceArea, pincode, flatNumber) => {
          // Guarantee the pincode is in the serviceable set.
          const serviceAreaPincodes = new Set([...serviceArea, pincode]);

          const decision = canSaveAddress({
            pincode,
            flatNumber,
            serviceAreaPincodes,
          });

          expect(isServiceable(pincode, serviceAreaPincodes)).toBe(true);
          expect(decision.canSave).toBe(true);
          expect(decision.errors).toEqual([]);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("an empty flat number blocks the save and reports FLAT_NUMBER_REQUIRED (Req 5.8)", () => {
    fc.assert(
      fc.property(
        arbValidPincode,
        arbServiceArea,
        arbAbsentFlat,
        (pincode, serviceArea, flatNumber) => {
          // Even a serviceable pincode cannot save without a flat number.
          const serviceAreaPincodes = new Set([...serviceArea, pincode]);

          const decision = canSaveAddress({
            pincode,
            flatNumber,
            serviceAreaPincodes,
          });

          expect(decision.canSave).toBe(false);
          expect(decision.errors).toContain("FLAT_NUMBER_REQUIRED");
        },
      ),
      { numRuns: 25 },
    );
  });

  it("an invalid-format pincode is never serviceable and blocks the save", () => {
    fc.assert(
      fc.property(
        arbInvalidPincode,
        arbServiceArea,
        arbPresentFlat,
        (pincode, serviceArea, flatNumber) => {
          const serviceAreaPincodes = new Set(serviceArea);

          expect(isServiceable(pincode, serviceAreaPincodes)).toBe(false);

          const decision = canSaveAddress({
            pincode,
            flatNumber,
            serviceAreaPincodes,
          });
          expect(decision.canSave).toBe(false);
          expect(decision.errors).toContain("PINCODE_NOT_SERVICEABLE");
        },
      ),
      { numRuns: 25 },
    );
  });
});
