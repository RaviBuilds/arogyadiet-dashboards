// Feature: core-clinic-architecture, Property 4: Clinic input validation identifies every offending field
//
// Property test for `validateClinicInput` (src/lib/clinic/validation.ts).
//
// Property 4: Clinic input validation identifies every offending field
//   For any clinic create/edit input, the validator returns no errors iff the
//   name is non-empty within its declared maximum, the address is non-empty
//   within its declared maximum, the latitude is present and within -90..90
//   inclusive, the longitude is present and within -180..180 inclusive, and the
//   kitchen reference is present; otherwise it returns an error for each
//   offending field (and only those) and persists no record.
//
// Validates: Requirements 3.5, 3.6, 3.7, 14.2, 14.3

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateClinicInput,
  CLINIC_CREATE_BOUNDS,
  CLINIC_FORM_BOUNDS,
  LATITUDE_MIN,
  LATITUDE_MAX,
  LONGITUDE_MIN,
  LONGITUDE_MAX,
  type ClinicLengthBounds,
  type ClinicValidatableInput,
  type ClinicValidationError,
} from "../validation";

// ─── Field-level generators ─────────────────────────────────────────────────
//
// Each generator yields a `{ value, error }` pair: the value to place on the
// input and the single error the validator must report for that field (or
// `null` when the value is valid). The expected error set is the union of the
// per-field errors, which lets the property assert "exactly one error per
// offending field and none for valid fields".

type FieldGen<V, F extends string> = fc.Arbitrary<{
  value: V;
  error: ClinicValidationError | null;
}>;

/** Non-blank text of a given length (survives trimming as non-empty). */
const textOfLength = (n: number): string => "a".repeat(n);

/** Blank-ish strings that trim to empty. */
const arbBlank = fc.constantFrom("", " ", "   ", "\t", "\n", "  \t \n ");

/** A present-but-invalid (rejected) latitude/longitude requires a finite OOR number. */

function nameGen(bounds: ClinicLengthBounds): FieldGen<string, "name"> {
  return fc.oneof(
    // valid: 1..nameMax non-blank chars
    fc
      .integer({ min: 1, max: bounds.nameMax })
      .map((n) => ({ value: textOfLength(n), error: null })),
    // empty
    arbBlank.map((value) => ({
      value,
      error: { field: "name", reason: "empty" } as ClinicValidationError,
    })),
    // too_long: strictly greater than nameMax after trim
    fc
      .integer({ min: bounds.nameMax + 1, max: bounds.nameMax + 50 })
      .map((n) => ({
        value: textOfLength(n),
        error: { field: "name", reason: "too_long" } as ClinicValidationError,
      }))
  );
}

function addressGen(bounds: ClinicLengthBounds): FieldGen<string, "address"> {
  return fc.oneof(
    fc
      .integer({ min: 1, max: bounds.addressMax })
      .map((n) => ({ value: textOfLength(n), error: null })),
    arbBlank.map((value) => ({
      value,
      error: { field: "address", reason: "empty" } as ClinicValidationError,
    })),
    fc
      .integer({ min: bounds.addressMax + 1, max: bounds.addressMax + 50 })
      .map((n) => ({
        value: textOfLength(n),
        error: {
          field: "address",
          reason: "too_long",
        } as ClinicValidationError,
      }))
  );
}

function coordinateGen(
  field: "latitude" | "longitude",
  min: number,
  max: number
): FieldGen<number | null | undefined, "latitude" | "longitude"> {
  return fc.oneof(
    // valid: finite number within [min, max] inclusive
    fc
      .double({ min, max, noNaN: true })
      .map((value) => ({ value, error: null })),
    // missing: null / undefined / NaN are all treated as "missing"
    fc.constantFrom<(number | null | undefined)[]>(
      null,
      undefined,
      NaN
    ).map((value) => ({
      value,
      error: { field, reason: "missing" } as ClinicValidationError,
    })),
    // out_of_range: finite but below min or above max
    fc
      .oneof(
        fc.double({ min: min - 1000, max: min - 0.0001, noNaN: true }),
        fc.double({ min: max + 0.0001, max: max + 1000, noNaN: true })
      )
      .map((value) => ({
        value,
        error: { field, reason: "out_of_range" } as ClinicValidationError,
      }))
  );
}

function kitchenGen(): FieldGen<string | null | undefined, "kitchen_id"> {
  return fc.oneof(
    // valid: any non-blank identifier
    fc.uuid().map((value) => ({ value, error: null })),
    // missing: null / undefined / blank
    fc.constantFrom<(string | null | undefined)[]>(
      null,
      undefined,
      "",
      "   ",
      "\t"
    ).map((value) => ({
      value,
      error: { field: "kitchen_id", reason: "missing" } as ClinicValidationError,
    }))
  );
}

/**
 * Build a generator of a full clinic input plus the exact ordered list of
 * expected errors. The expected order matches the validator's push order:
 * name, address, latitude, longitude, kitchen_id.
 */
function clinicCaseGen(bounds: ClinicLengthBounds): fc.Arbitrary<{
  input: ClinicValidatableInput;
  expected: ClinicValidationError[];
}> {
  return fc
    .record({
      name: nameGen(bounds),
      address: addressGen(bounds),
      latitude: coordinateGen("latitude", LATITUDE_MIN, LATITUDE_MAX),
      longitude: coordinateGen("longitude", LONGITUDE_MIN, LONGITUDE_MAX),
      kitchen_id: kitchenGen(),
    })
    .map((fields) => {
      const input: ClinicValidatableInput = {
        name: fields.name.value,
        address: fields.address.value,
        latitude: fields.latitude.value,
        longitude: fields.longitude.value,
        kitchen_id: fields.kitchen_id.value,
      };
      const expected: ClinicValidationError[] = [
        fields.name.error,
        fields.address.error,
        fields.latitude.error,
        fields.longitude.error,
        fields.kitchen_id.error,
      ].filter((e): e is ClinicValidationError => e !== null);
      return { input, expected };
    });
}

const BOUND_PRESETS: Array<{ label: string; bounds: ClinicLengthBounds }> = [
  { label: "CLINIC_CREATE_BOUNDS", bounds: CLINIC_CREATE_BOUNDS },
  { label: "CLINIC_FORM_BOUNDS", bounds: CLINIC_FORM_BOUNDS },
];

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("validateClinicInput - Property 4: identifies every offending field", () => {
  for (const { label, bounds } of BOUND_PRESETS) {
    describe(`with ${label}`, () => {
      it("returns exactly one error per offending field and none for valid fields", () => {
        fc.assert(
          fc.property(clinicCaseGen(bounds), ({ input, expected }) => {
            const errors = validateClinicInput(input, bounds);

            // Exactly one error per offending field, in validator order.
            expect(errors).toEqual(expected);

            // No field appears more than once.
            const fields = errors.map((e) => e.field);
            expect(new Set(fields).size).toBe(fields.length);

            // A field is reported if and only if it is offending.
            expect(errors.length).toBe(expected.length);
          }),
          { numRuns: 300 }
        );
      });

      it("returns [] for a fully valid input", () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 1, max: bounds.nameMax }),
            fc.integer({ min: 1, max: bounds.addressMax }),
            fc.double({ min: LATITUDE_MIN, max: LATITUDE_MAX, noNaN: true }),
            fc.double({ min: LONGITUDE_MIN, max: LONGITUDE_MAX, noNaN: true }),
            fc.uuid(),
            (nameLen, addressLen, latitude, longitude, kitchenId) => {
              const errors = validateClinicInput(
                {
                  name: textOfLength(nameLen),
                  address: textOfLength(addressLen),
                  latitude,
                  longitude,
                  kitchen_id: kitchenId,
                },
                bounds
              );
              expect(errors).toEqual([]);
            }
          ),
          { numRuns: 200 }
        );
      });
    });
  }

  it("reports all five fields when every field is offending", () => {
    const errors = validateClinicInput(
      {
        name: "",
        address: "   ",
        latitude: null,
        longitude: 999,
        kitchen_id: null,
      },
      CLINIC_CREATE_BOUNDS
    );
    expect(errors).toEqual([
      { field: "name", reason: "empty" },
      { field: "address", reason: "empty" },
      { field: "latitude", reason: "missing" },
      { field: "longitude", reason: "out_of_range" },
      { field: "kitchen_id", reason: "missing" },
    ]);
  });
});
