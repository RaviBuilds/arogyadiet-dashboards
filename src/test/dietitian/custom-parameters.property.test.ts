// src/test/dietitian/custom-parameters.property.test.ts
// Feature: dietitian-management, Property 18
//
// Property 18: Custom_Parameter lists validate and serialize round-trip.
//
// For any list of Custom_Parameters, serializing then deserializing yields an
// equal list in the same order (Req 12.8); and the list is accepted iff it has
// at most 20 entries, every label is 1–60 characters after trimming, every
// value is 1–200 characters and every unit is 0–20 characters (Req 12.3), and
// no two labels are equal after trimming and case folding — rejections
// returning the pinned `Custom parameter label is required` for an empty label
// (Req 12.4) and the pinned `Custom parameter labels must be unique` for a
// duplicate (Req 12.5). More than 20 entries is rejected (Req 12.6).
//
// Inputs come from the shared arbitraries so the trimming, case-folding and
// cap edge cases are exercised by construction. Length-boundary lists are built
// here as single-entry lists from a non-whitespace, single-code-unit alphabet,
// so a generated character count is exactly the trimmed `String.length` and no
// incidental duplicate label can decide the outcome instead of the bound.
//
// **Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CUSTOM_PARAMETER_LABEL_MAX_LENGTH,
  CUSTOM_PARAMETER_LABEL_TOO_LONG,
  CUSTOM_PARAMETER_UNIT_MAX_LENGTH,
  CUSTOM_PARAMETER_UNIT_TOO_LONG,
  CUSTOM_PARAMETER_VALUE_MAX_LENGTH,
  CUSTOM_PARAMETER_VALUE_REQUIRED,
  CUSTOM_PARAMETER_VALUE_TOO_LONG,
  MAX_CUSTOM_PARAMETERS,
  TOO_MANY_CUSTOM_PARAMETERS,
  customParameterLabelKey,
  deserializeCustomParameters,
  serializeCustomParameters,
  validateCustomParameters,
} from "@/lib/dietitian/customParameters";
import {
  CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE,
  CUSTOM_PARAMETER_LABEL_REQUIRED,
} from "@/lib/dietitian/messages";
import {
  MAX_CUSTOM_PARAMETERS as REFERENCE_MAX_CUSTOM_PARAMETERS,
  customParameterUnitArb,
  customParameterValueArb,
  duplicateLabelCustomParameterListArb,
  labelKey,
  uniqueCustomParameterListArb,
} from "@/test/dietitian/arbitraries";
import type { CustomParameter } from "@/types/dietitian";

const NUM_RUNS = 200;

// ─── Local generators for the length bounds (Req 12.3) ───────────────────────

/**
 * Single-UTF-16-code-unit, non-whitespace characters: a string built from this
 * alphabet has `length` equal to its character count and is unchanged by
 * trimming, so a boundary length is exact.
 */
const TEXT_ALPHABET = ["a", "Q", "7", "-", "é", "ñ", "क", "文"] as const;

function stringOfLength(seed: readonly string[], length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += seed[i % seed.length];
  return out;
}

function textOfLengthArb(length: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...TEXT_ALPHABET), { minLength: 1, maxLength: 8 })
    .map((seed) => stringOfLength(seed, length));
}

/** Whitespace runs used as padding — trimming must remove all of them. */
const WHITESPACE_ARB: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), { maxLength: 5 })
  .map((chars) => chars.join(""));

/** Wraps a core in optional leading and trailing whitespace. */
function paddedArb(core: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(WHITESPACE_ARB, core, WHITESPACE_ARB)
    .map(([lead, body, trail]) => `${lead}${body}${trail}`);
}

/** A length in `[min, max]`, biased to both boundaries. */
function inBoundLengthArb(min: number, max: number): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.constantFrom(min, min + 1, max - 1, max), weight: 3 },
    { arbitrary: fc.integer({ min, max }), weight: 2 },
  );
}

/** A length strictly above `max`, biased to the first failing length. */
function overBoundLengthArb(max: number): fc.Arbitrary<number> {
  return fc.oneof(
    { arbitrary: fc.constantFrom(max + 1, max + 2), weight: 3 },
    { arbitrary: fc.integer({ min: max + 1, max: max + 120 }), weight: 2 },
  );
}

/** A whitespace-only (i.e. empty after trimming) label, plus the empty string. */
const BLANK_LABEL_ARB: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constant(""), weight: 1 },
  {
    arbitrary: fc
      .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
        minLength: 1,
        maxLength: 8,
      })
      .map((chars) => chars.join("")),
    weight: 3,
  },
);

/** Pads every field of a list without changing any trimmed value. */
const paddedListArb: fc.Arbitrary<{
  padded: CustomParameter[];
  expected: CustomParameter[];
}> = uniqueCustomParameterListArb({ maxLength: 8 }).chain((list) =>
  fc
    .tuple(
      fc.array(fc.tuple(WHITESPACE_ARB, WHITESPACE_ARB), {
        minLength: list.length,
        maxLength: list.length,
      }),
      fc.array(fc.tuple(WHITESPACE_ARB, WHITESPACE_ARB), {
        minLength: list.length,
        maxLength: list.length,
      }),
    )
    .map(([labelPads, unitPads]) => ({
      padded: list.map((parameter, index) => ({
        label: `${labelPads[index][0]}${parameter.label}${labelPads[index][1]}`,
        value: `${unitPads[index][0]}${parameter.value}${unitPads[index][1]}`,
        unit: `${unitPads[index][1]}${parameter.unit}${unitPads[index][0]}`,
      })),
      expected: list.map(({ label, value, unit }) => ({ label, value, unit })),
    })),
);

/** Asserts a rejection carrying exactly the expected message. */
function expectRejection(raw: unknown, message: string): void {
  const result = validateCustomParameters(raw);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe(message);
}

// ─── The property ────────────────────────────────────────────────────────────

describe("Property 18: Custom_Parameter lists validate and serialize round-trip", () => {
  it("agrees with the reference cap and label key used by the generators", () => {
    expect(MAX_CUSTOM_PARAMETERS).toBe(REFERENCE_MAX_CUSTOM_PARAMETERS);
    fc.assert(
      fc.property(uniqueCustomParameterListArb({ maxLength: 6 }), (list) => {
        for (const parameter of list) {
          expect(customParameterLabelKey(parameter.label)).toBe(
            labelKey(parameter.label),
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts every valid list and survives serialize → deserialize unchanged and in order", () => {
    fc.assert(
      fc.property(uniqueCustomParameterListArb(), (list) => {
        const result = validateCustomParameters(list);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Validation preserves the submitted order and every field.
        expect(result.value).toEqual(list);

        // Round-trip through the JSONB form (Req 12.8).
        const serialized = serializeCustomParameters(result.value);
        expect(serialized).toEqual(result.value);
        expect(deserializeCustomParameters(serialized)).toEqual(result.value);

        // …and through the JSON text a JSONB column round-trips as.
        expect(
          deserializeCustomParameters(JSON.stringify(serialized)),
        ).toEqual(result.value);

        // Order is preserved position by position, not just as a multiset.
        deserializeCustomParameters(serialized).forEach((parameter, index) => {
          expect(parameter.label).toBe(list[index].label);
        });

        // Serializing does not alias the caller's list.
        expect(serialized).not.toBe(result.value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("trims every field and keeps the order (Req 12.2, 12.3)", () => {
    fc.assert(
      fc.property(paddedListArb, ({ padded, expected }) => {
        const result = validateCustomParameters(padded);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toEqual(expected);
        expect(deserializeCustomParameters(
          serializeCustomParameters(result.value),
        )).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects an empty or whitespace-only label with the pinned message (Req 12.4)", () => {
    fc.assert(
      fc.property(
        uniqueCustomParameterListArb({ maxLength: 6 }),
        BLANK_LABEL_ARB,
        customParameterValueArb,
        customParameterUnitArb,
        fc.nat(),
        (base, label, value, unit, insertPick) => {
          const list = [...base];
          list.splice(insertPick % (list.length + 1), 0, {
            label,
            value,
            unit,
          });
          expectRejection(list, CUSTOM_PARAMETER_LABEL_REQUIRED);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects case- and whitespace-variant duplicate labels with the pinned message (Req 12.5)", () => {
    fc.assert(
      fc.property(duplicateLabelCustomParameterListArb, (list) => {
        // Pre-condition on the generator: two entries share a label key.
        const keys = list.map((parameter) => labelKey(parameter.label));
        expect(new Set(keys).size).toBeLessThan(keys.length);

        expectRejection(list, CUSTOM_PARAMETER_LABELS_MUST_BE_UNIQUE);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a list of more than 20 entries (Req 12.6)", () => {
    fc.assert(
      fc.property(
        uniqueCustomParameterListArb({
          minLength: MAX_CUSTOM_PARAMETERS + 1,
          maxLength: MAX_CUSTOM_PARAMETERS + 6,
        }),
        (list) => {
          expect(list.length).toBeGreaterThan(MAX_CUSTOM_PARAMETERS);
          expectRejection(list, TOO_MANY_CUSTOM_PARAMETERS);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts exactly 20 entries (Req 12.6 boundary)", () => {
    fc.assert(
      fc.property(
        uniqueCustomParameterListArb({
          minLength: MAX_CUSTOM_PARAMETERS,
          maxLength: MAX_CUSTOM_PARAMETERS,
        }),
        (list) => {
          const result = validateCustomParameters(list);
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toHaveLength(MAX_CUSTOM_PARAMETERS);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts labels, values and units inside their length bounds (Req 12.3)", () => {
    fc.assert(
      fc.property(
        inBoundLengthArb(1, CUSTOM_PARAMETER_LABEL_MAX_LENGTH).chain((n) =>
          paddedArb(textOfLengthArb(n)).map((label) => ({ label, n })),
        ),
        inBoundLengthArb(1, CUSTOM_PARAMETER_VALUE_MAX_LENGTH).chain((n) =>
          paddedArb(textOfLengthArb(n)).map((value) => ({ value, n })),
        ),
        inBoundLengthArb(0, CUSTOM_PARAMETER_UNIT_MAX_LENGTH).chain((n) =>
          paddedArb(n === 0 ? fc.constant("") : textOfLengthArb(n)).map(
            (unit) => ({ unit, n }),
          ),
        ),
        (labelCase, valueCase, unitCase) => {
          const entry: CustomParameter = {
            label: labelCase.label,
            value: valueCase.value,
            unit: unitCase.unit,
          };
          const result = validateCustomParameters([entry]);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value[0].label.length).toBe(labelCase.n);
          expect(result.value[0].value.length).toBe(valueCase.n);
          expect(result.value[0].unit.length).toBe(unitCase.n);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a label, value or unit past its length bound (Req 12.3)", () => {
    const overLongLabelArb = overBoundLengthArb(
      CUSTOM_PARAMETER_LABEL_MAX_LENGTH,
    ).chain((n) =>
      paddedArb(textOfLengthArb(n)).map((label) => ({
        entry: { label, value: "v", unit: "" },
        message: CUSTOM_PARAMETER_LABEL_TOO_LONG,
      })),
    );
    const overLongValueArb = overBoundLengthArb(
      CUSTOM_PARAMETER_VALUE_MAX_LENGTH,
    ).chain((n) =>
      paddedArb(textOfLengthArb(n)).map((value) => ({
        entry: { label: "HbA1c", value, unit: "" },
        message: CUSTOM_PARAMETER_VALUE_TOO_LONG,
      })),
    );
    const overLongUnitArb = overBoundLengthArb(
      CUSTOM_PARAMETER_UNIT_MAX_LENGTH,
    ).chain((n) =>
      paddedArb(textOfLengthArb(n)).map((unit) => ({
        entry: { label: "HbA1c", value: "v", unit },
        message: CUSTOM_PARAMETER_UNIT_TOO_LONG,
      })),
    );
    const blankValueArb = BLANK_LABEL_ARB.map((value) => ({
      entry: { label: "HbA1c", value, unit: "" },
      message: CUSTOM_PARAMETER_VALUE_REQUIRED,
    }));

    fc.assert(
      fc.property(
        fc.oneof(
          overLongLabelArb,
          overLongValueArb,
          overLongUnitArb,
          blankValueArb,
        ),
        ({ entry, message }) => {
          expectRejection([entry], message);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
