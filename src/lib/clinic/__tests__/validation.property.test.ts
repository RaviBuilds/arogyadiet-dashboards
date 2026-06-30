// src/lib/clinic/__tests__/validation.property.test.ts
//
// Property-based tests for the pure clinic-domain validators in
// `src/lib/clinic/validation.ts`. Each property below is verified against an
// INDEPENDENT reference (re-derived from the design's acceptance criteria,
// never re-using the implementation) across fast-check generated inputs with a
// minimum of 100 runs each.
//
// Covers spec `core-clinic-architecture` Properties 1, 2, 6, 8, and 11.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateCityName,
  validateBusinessInput,
  validateClinicInput,
  isValidPincode,
  isCoreClinic,
  CITY_NAME_MAX,
  BUSINESS_NAME_MAX,
  LATITUDE_MIN,
  LATITUDE_MAX,
  LONGITUDE_MIN,
  LONGITUDE_MAX,
  type CityNameValidationResult,
  type BusinessValidationError,
  type ClinicValidationError,
  type ClinicValidatableInput,
  type ClinicLengthBounds,
} from "@/lib/clinic/validation";

// ─── Shared generators ───────────────────────────────────────────────────────

/** A single character drawn from a broad printable + unicode set. */
const charArb = fc.oneof(
  fc.constantFrom(" ", "\t", "\n", "a", "Z", "0", "9", "é", "城", "-", "."),
  fc.string({ minLength: 1, maxLength: 1 }),
);

/** A string whose trimmed length is controllable: mixes content + whitespace. */
const looseNameArb = fc.oneof(
  fc.string(), // arbitrary
  fc.string().map((s) => `  ${s}  `), // padded with whitespace
  fc.constantFrom("", "   ", "\t\n"), // blank cases
  // Strings right around the max boundary so length checks are exercised.
  fc
    .integer({ min: 95, max: 125 })
    .chain((n) => fc.array(charArb, { minLength: n, maxLength: n }))
    .map((cs) => cs.join("")),
);

// ─────────────────────────────────────────────────────────────────────────────
// Feature: core-clinic-architecture, Property 1: City name validity and case-insensitive uniqueness
// ─────────────────────────────────────────────────────────────────────────────
//
// For any candidate city name and any set of existing city names, the
// city-name validator accepts the candidate iff it is non-empty, at most 100
// characters, and not a case-insensitive duplicate of any OTHER existing name
// (a city editing to its own current name is allowed); rejection reports the
// specific reason (empty, too long, or duplicate).
//
// Validates: Requirements 1.1, 1.3, 1.4

describe("Property 1: City name validity and case-insensitive uniqueness", () => {
  /** Independent reference for the city-name validator. */
  function referenceCityName(
    name: string,
    existingNamesLower: Set<string>,
    currentNameLower?: string,
  ): CityNameValidationResult {
    const trimmed = (name ?? "").trim();
    if (trimmed.length === 0) return { ok: false, reason: "empty" };
    if (trimmed.length > CITY_NAME_MAX) return { ok: false, reason: "too_long" };
    const lower = trimmed.toLowerCase();
    if (currentNameLower !== undefined && lower === currentNameLower) {
      return { ok: true };
    }
    if (existingNamesLower.has(lower)) return { ok: false, reason: "duplicate" };
    return { ok: true };
  }

  const existingNamesArb = fc
    .array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 })
    .map((names) => names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0));

  it("matches the independent reference (create + edit modes), boundary-rich", () => {
    fc.assert(
      fc.property(
        looseNameArb,
        existingNamesArb,
        fc.boolean(),
        (candidate, existing, injectDuplicate) => {
          // Optionally inject the candidate's normalized form so duplicate
          // detection is actually exercised.
          const lowerCandidate = (candidate ?? "").trim().toLowerCase();
          const existingList =
            injectDuplicate && lowerCandidate.length > 0
              ? [...existing, lowerCandidate]
              : existing;
          const existingSet = new Set(existingList);

          // Create mode (no current name).
          expect(validateCityName(candidate, existingSet)).toEqual(
            referenceCityName(candidate, existingSet),
          );

          // Edit mode: self-rename to the candidate's own current value is allowed.
          const currentLower =
            lowerCandidate.length > 0 ? lowerCandidate : undefined;
          expect(validateCityName(candidate, existingSet, currentLower)).toEqual(
            referenceCityName(candidate, existingSet, currentLower),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a self-rename is accepted even when the name collides with the existing set", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (raw) => {
        const trimmed = raw.trim();
        fc.pre(trimmed.length > 0 && trimmed.length <= CITY_NAME_MAX);
        const lower = trimmed.toLowerCase();
        // The set contains the name, but currentNameLower equals it → allowed.
        const existing = new Set([lower]);
        expect(validateCityName(raw, existing, lower)).toEqual({ ok: true });
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: core-clinic-architecture, Property 2: Business input validation identifies the offending field
// ─────────────────────────────────────────────────────────────────────────────
//
// For any candidate business input, the business validator accepts it iff its
// name (after trimming) is between 1 and 100 characters and its type is exactly
// one of `Core` or `Franchise`; otherwise it returns an error identifying the
// specific failing field (empty name, length exceeded, or invalid type).
//
// Validates: Requirements 20.1, 20.3, 20.4

describe("Property 2: Business input validation identifies the offending field", () => {
  function referenceBusiness(input: {
    name: string;
    type: string;
  }): BusinessValidationError[] {
    const errors: BusinessValidationError[] = [];
    const name = (input.name ?? "").trim();
    if (name.length === 0) errors.push({ field: "name", reason: "empty" });
    else if (name.length > BUSINESS_NAME_MAX)
      errors.push({ field: "name", reason: "too_long" });
    if (input.type !== "Core" && input.type !== "Franchise")
      errors.push({ field: "type", reason: "invalid" });
    return errors;
  }

  const typeArb = fc.oneof(
    fc.constantFrom("Core", "Franchise"), // valid
    fc.constantFrom("core", "FRANCHISE", "", "Other", "Both"), // invalid
    fc.string(),
  );

  it("matches the independent reference for arbitrary name/type inputs", () => {
    fc.assert(
      fc.property(looseNameArb, typeArb, (name, type) => {
        const input = { name, type };
        expect(validateBusinessInput(input)).toEqual(referenceBusiness(input));
      }),
      { numRuns: 100 },
    );
  });

  it("accepts iff name trims to 1..100 chars AND type is Core|Franchise", () => {
    fc.assert(
      fc.property(looseNameArb, typeArb, (name, type) => {
        const errors = validateBusinessInput({ name, type });
        const trimmed = name.trim();
        const nameOk = trimmed.length >= 1 && trimmed.length <= BUSINESS_NAME_MAX;
        const typeOk = type === "Core" || type === "Franchise";
        expect(errors.length === 0).toBe(nameOk && typeOk);
        // When a field is wrong, an error names exactly that field.
        if (!nameOk) expect(errors.some((e) => e.field === "name")).toBe(true);
        if (!typeOk) expect(errors.some((e) => e.field === "type")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: core-clinic-architecture, Property 6: Clinic input validation identifies every offending field
// ─────────────────────────────────────────────────────────────────────────────
//
// For any clinic create/edit input and any declared name/address maximum bounds
// for the surface, the validator returns no errors iff name is non-empty within
// its max, address is non-empty within its max, latitude is present and within
// -90..90 inclusive, longitude is present and within -180..180 inclusive, and
// the kitchen reference is present; otherwise it returns an error for each
// offending field.
//
// Validates: Requirements 3.5, 3.6, 3.7, 14.2, 14.3, 21.5, 21.6

describe("Property 6: Clinic input validation identifies every offending field", () => {
  function isPresentNumber(v: number | null | undefined): v is number {
    return typeof v === "number" && Number.isFinite(v);
  }

  function referenceClinic(
    input: ClinicValidatableInput,
    bounds: ClinicLengthBounds,
  ): ClinicValidationError[] {
    const errors: ClinicValidationError[] = [];
    const name = (input.name ?? "").trim();
    if (name.length === 0) errors.push({ field: "name", reason: "empty" });
    else if (name.length > bounds.nameMax)
      errors.push({ field: "name", reason: "too_long" });

    const address = (input.address ?? "").trim();
    if (address.length === 0) errors.push({ field: "address", reason: "empty" });
    else if (address.length > bounds.addressMax)
      errors.push({ field: "address", reason: "too_long" });

    if (!isPresentNumber(input.latitude))
      errors.push({ field: "latitude", reason: "missing" });
    else if (input.latitude < LATITUDE_MIN || input.latitude > LATITUDE_MAX)
      errors.push({ field: "latitude", reason: "out_of_range" });

    if (!isPresentNumber(input.longitude))
      errors.push({ field: "longitude", reason: "missing" });
    else if (input.longitude < LONGITUDE_MIN || input.longitude > LONGITUDE_MAX)
      errors.push({ field: "longitude", reason: "out_of_range" });

    if (!input.kitchen_id || input.kitchen_id.trim().length === 0)
      errors.push({ field: "kitchen_id", reason: "missing" });

    return errors;
  }

  // Coordinates: mix present-valid, out-of-range, null, and non-finite.
  const coordArb = (min: number, max: number) =>
    fc.oneof(
      fc.double({ min, max, noNaN: true, noDefaultInfinity: true }), // in range
      fc.double({ min: max + 1, max: max + 1000, noNaN: true, noDefaultInfinity: true }), // above
      fc.double({ min: min - 1000, max: min - 1, noNaN: true, noDefaultInfinity: true }), // below
      fc.constant(null),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
    );

  const kitchenIdArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.constant(null),
    fc.constantFrom("", "   "),
  );

  const boundsArb = fc.record({
    nameMax: fc.integer({ min: 1, max: 500 }),
    addressMax: fc.integer({ min: 1, max: 1000 }),
  });

  const nullableNameArb = fc.oneof(looseNameArb, fc.constant(null));

  it("matches the independent reference across surfaces (parameterized bounds)", () => {
    fc.assert(
      fc.property(
        nullableNameArb,
        nullableNameArb,
        coordArb(LATITUDE_MIN, LATITUDE_MAX),
        coordArb(LONGITUDE_MIN, LONGITUDE_MAX),
        kitchenIdArb,
        boundsArb,
        (name, address, latitude, longitude, kitchen_id, bounds) => {
          const input: ClinicValidatableInput = {
            name,
            address,
            latitude,
            longitude,
            kitchen_id,
          };
          expect(validateClinicInput(input, bounds)).toEqual(
            referenceClinic(input, bounds),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports an error for every offending field simultaneously", () => {
    // An all-bad input must surface one error per field.
    const input: ClinicValidatableInput = {
      name: "",
      address: "",
      latitude: 999,
      longitude: -999,
      kitchen_id: null,
    };
    const errors = validateClinicInput(input, { nameMax: 120, addressMax: 255 });
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(
      ["address", "kitchen_id", "latitude", "longitude", "name"].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: core-clinic-architecture, Property 11: Pincode format validation
// ─────────────────────────────────────────────────────────────────────────────
//
// For any string, the pincode validator accepts it iff it consists of exactly
// six numeric digits.
//
// Validates: Requirement 5.4

describe("Property 11: Pincode format validation", () => {
  function referencePincode(value: string): boolean {
    if (value.length !== 6) return false;
    return [...value].every((c) => c >= "0" && c <= "9");
  }

  // Mix of digit-only strings of varied length, padded, and arbitrary text.
  const pincodeArb = fc.oneof(
    fc
      .integer({ min: 0, max: 12 })
      .chain((n) =>
        fc.array(fc.constantFrom(..."0123456789".split("")), {
          minLength: n,
          maxLength: n,
        }),
      )
      .map((cs) => cs.join("")),
    fc.string(), // arbitrary (letters, symbols, whitespace, unicode digits)
    fc.constantFrom("123456", "12345", "1234567", " 12345", "12 456", "abcdef", "१२३४५६"),
  );

  it("accepts iff the string is exactly six ASCII digits", () => {
    fc.assert(
      fc.property(pincodeArb, (value) => {
        expect(isValidPincode(value)).toBe(referencePincode(value));
      }),
      { numRuns: 100 },
    );
  });

  it("accepts any exactly-six-digit string", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(..."0123456789".split("")), {
          minLength: 6,
          maxLength: 6,
        }),
        (digits) => {
          expect(isValidPincode(digits.join(""))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: core-clinic-architecture, Property 8: Core Clinic classification
// ─────────────────────────────────────────────────────────────────────────────
//
// For any clinic, the clinic is classified as a Core Clinic iff its
// `franchise_id` is `NULL`.
//
// Validates: Requirements 3.4, 18.1

describe("Property 8: Core Clinic classification", () => {
  const franchiseIdArb = fc.oneof(
    fc.constant<string | null>(null),
    fc.string(), // any defined value, including ""
    fc.uuid(),
  );

  it("is Core iff franchise_id === null", () => {
    fc.assert(
      fc.property(franchiseIdArb, (franchiseId) => {
        expect(isCoreClinic(franchiseId)).toBe(franchiseId === null);
      }),
      { numRuns: 100 },
    );
  });

  it("a defined franchise id (including empty string) is never Core", () => {
    fc.assert(
      fc.property(fc.string(), (id) => {
        expect(isCoreClinic(id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
