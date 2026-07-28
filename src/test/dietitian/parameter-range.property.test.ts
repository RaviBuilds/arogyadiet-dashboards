// src/test/dietitian/parameter-range.property.test.ts
// Feature: dietitian-management, Property 16
//
// Property 16: Parameter range validation rejects out-of-range values and names
// the range.
//
// For any parameter in the field set and any submitted value, the submission is
// accepted iff every provided value lies within that parameter's validated
// range, and a rejection message names the offending parameter and both of its
// bounds. A submission in which every parameter except the Closing_Comment is
// empty is accepted.
//
// The expected truth is derived from `REFERENCE_HEALTH_LOG_FIELDS` /
// `BP_RANGES` in `src/test/dietitian/arbitraries.ts`, which are transcribed
// from Requirements 11.6–11.10 rather than imported from
// `src/lib/dietitian/fieldSets.ts`. The generators draw from the *shipped*
// table (`fieldSetFor(category)`), so a range that drifts from the requirement
// is caught instead of being inherited by both sides.
//
// **Validates: Requirements 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { healthLogSchemaFor } from "@/validations/healthLogSchema";
import { fieldSetFor, type FieldDefinition } from "@/lib/dietitian/fieldSets";
import type { CustomerCategory, ParameterValue } from "@/types/dietitian";
import {
  BP_RANGES as REFERENCE_BP_RANGES,
  CUSTOMER_CATEGORIES,
  customerCategoryArb,
  emptyParameterMapArb,
  fixtureUuid,
  istDateArb,
  outOfRangeParameterMapArb,
  outOfRangeParameterValueArb,
  parameterValueArb,
  referenceFieldSetFor,
  sparseParameterMapArb,
  type TestFieldSpec,
} from "@/test/dietitian/arbitraries";

const NUM_RUNS = 200;

// ─── Reference model ─────────────────────────────────────────────────────────

/** The reference range table indexed by storage key. */
function referenceFieldByKey(key: string): TestFieldSpec | undefined {
  return referenceFieldSetFor("ACCOMMODATION").find((field) => field.key === key);
}

/**
 * The out-of-range wording required by Req 11.11 — the parameter's label and
 * both of its permitted bounds, with the unit when the parameter has one.
 * Composed here rather than imported, so the assertion is independent of the
 * formatter under test.
 */
function expectedRangeMessage(
  label: string,
  min: number,
  max: number,
  unit?: string,
): string {
  const base = `${label} must be between ${min} and ${max}`;
  const trimmedUnit = unit?.trim() ?? "";
  return trimmedUnit ? `${base} ${trimmedUnit}` : base;
}

/**
 * The canonical form the schema must return for an accepted sparse map: an
 * `enum`/`text` value is trimmed, and a value that is blank after trimming
 * leaves no key at all (Req 11.5).
 */
function expectedParameters(
  fields: readonly FieldDefinition[],
  submitted: Record<string, ParameterValue>,
): Record<string, ParameterValue> {
  const allowed = new Map(fields.map((field) => [field.key, field]));
  const out: Record<string, ParameterValue> = {};

  for (const [key, value] of Object.entries(submitted)) {
    const field = allowed.get(key);
    if (field === undefined) continue;

    if (field.kind === "enum" || field.kind === "text") {
      const trimmed = (value as { value: string }).value.trim();
      if (trimmed.length === 0) continue;
      out[key] = { value: trimmed };
      continue;
    }
    out[key] = value;
  }
  return out;
}

// ─── Envelope: everything a submission carries besides `parameters` ──────────

const closingCommentArb: fc.Arbitrary<string> = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "Reviewed the plan with the customer",
      "Weight stable, continue the current diet",
      "प्रगति संतोषजनक है",
    ),
    weight: 3,
  },
  {
    arbitrary: fc
      .string({ minLength: 1, maxLength: 120 })
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    weight: 1,
  },
);

interface Envelope {
  customerProfileId: string;
  logDate: string;
  closingComment: string;
}

const envelopeArb: fc.Arbitrary<Envelope> = fc.record({
  customerProfileId: fc
    .integer({ min: 1, max: 999 })
    .map((n) => fixtureUuid(44, n)),
  logDate: istDateArb,
  closingComment: closingCommentArb,
});

function submit(
  category: CustomerCategory,
  envelope: Envelope,
  parameters: unknown,
) {
  return healthLogSchemaFor(category).safeParse({
    customerProfileId: envelope.customerProfileId,
    logDate: envelope.logDate,
    parameters,
    customParameters: [],
    closingComment: envelope.closingComment,
  });
}

/** Every issue message reported against `parameters.{key}`. */
function messagesFor(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  key: string,
): string[] {
  return issues
    .filter(
      (issue) =>
        issue.path.length === 2 &&
        issue.path[0] === "parameters" &&
        issue.path[1] === key,
    )
    .map((issue) => issue.message);
}

// ─── Property 16 ─────────────────────────────────────────────────────────────

describe("Property 16: parameter range validation rejects out-of-range values and names the range", () => {
  it("the applied ranges are exactly the ranges pinned by Requirements 11.6-11.10", () => {
    /**
     * **Validates: Requirements 11.6, 11.7, 11.8, 11.9, 11.10**
     */
    const pinned: {
      key: string;
      label: string;
      min: number;
      max: number;
      unit?: string;
    }[] = [
      { key: "weight", label: "Weight", min: 20, max: 300, unit: "kg" },
      {
        key: "fasting_sugar",
        label: "Fasting Sugar",
        min: 30,
        max: 600,
        unit: "mg/dL",
      },
      { key: "pbs", label: "PBS", min: 30, max: 600, unit: "mg/dL" },
      { key: "step_count", label: "Step count", min: 0, max: 100000 },
      {
        key: "water_intake",
        label: "Water Intake",
        min: 0,
        max: 15,
        unit: "litres",
      },
      { key: "sleep", label: "Sleep", min: 0, max: 24, unit: "hrs" },
    ];

    for (const category of CUSTOMER_CATEGORIES) {
      const shipped = fieldSetFor(category);

      for (const expected of pinned) {
        const field = shipped.find((f) => f.key === expected.key);
        expect(field, `${expected.key} missing from the ${category} field set`)
          .toBeDefined();
        expect(field!.label).toBe(expected.label);
        expect(field!.min).toBe(expected.min);
        expect(field!.max).toBe(expected.max);
        if (expected.unit !== undefined) expect(field!.unit).toBe(expected.unit);
      }

      // BP carries two numbers, so its bounds live in `BP_RANGES` (Req 11.7).
      const bp = shipped.find((f) => f.key === "bp");
      expect(bp?.kind).toBe("bp");
      expect(REFERENCE_BP_RANGES.systolic).toEqual({ min: 60, max: 250 });
      expect(REFERENCE_BP_RANGES.diastolic).toEqual({ min: 40, max: 150 });

      // Every numeric parameter of the shipped table agrees with the reference
      // table, which is what lets the properties below derive their bounds.
      for (const field of shipped) {
        if (field.kind !== "number") continue;
        const reference = referenceFieldByKey(field.key);
        expect(reference, `${field.key} is not in the reference table`)
          .toBeDefined();
        expect({
          label: field.label,
          min: field.min,
          max: field.max,
          unit: field.unit,
        }).toEqual({
          label: reference!.label,
          min: reference!.min,
          max: reference!.max,
          unit: reference!.unit,
        });
      }
    }
  });

  it("accepts every sparse map whose values are all in range, and returns them normalized", () => {
    /**
     * **Validates: Requirements 11.5, 11.6, 11.7, 11.8, 11.9, 11.10**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) =>
          fc.record({
            category: fc.constant(category),
            envelope: envelopeArb,
            parameters: sparseParameterMapArb(category, {
              fields: fieldSetFor(category),
            }),
          }),
        ),
        ({ category, envelope, parameters }) => {
          const result = submit(category, envelope, parameters);

          expect(
            result.success,
            result.success ? "" : JSON.stringify(result.error.issues),
          ).toBe(true);
          if (!result.success) return;

          expect(result.data.parameters).toEqual(
            expectedParameters(fieldSetFor(category), parameters),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts every value at and just inside each boundary", () => {
    /**
     * **Validates: Requirements 11.6, 11.7, 11.8, 11.9, 11.10**
     */
    const numericChoiceArb = fc.constantFrom(
      "min",
      "max",
      "just-inside-min",
      "just-inside-max",
      "mid",
    );

    const numericValue = (
      field: TestFieldSpec,
      choice: string,
    ): number => {
      const min = field.min!;
      const max = field.max!;
      switch (choice) {
        case "min":
          return min;
        case "max":
          return max;
        case "just-inside-min":
          return Number((min + 0.1).toFixed(1));
        case "just-inside-max":
          return Number((max - 0.1).toFixed(1));
        default:
          return Number(((min + max) / 2).toFixed(1));
      }
    };

    const bpChoiceArb = fc.constantFrom(
      "min",
      "max",
      "just-inside-min",
      "just-inside-max",
      "mid",
    );

    const bpValue = (
      range: { min: number; max: number },
      choice: string,
    ): number => {
      switch (choice) {
        case "min":
          return range.min;
        case "max":
          return range.max;
        case "just-inside-min":
          return range.min + 1;
        case "just-inside-max":
          return range.max - 1;
        default:
          return Math.round((range.min + range.max) / 2);
      }
    };

    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) => {
          const numericFields = fieldSetFor(category).filter(
            (field) => field.kind === "number",
          );
          return fc.record({
            category: fc.constant(category),
            envelope: envelopeArb,
            choices: fc.array(numericChoiceArb, {
              minLength: numericFields.length,
              maxLength: numericFields.length,
            }),
            bpChoices: fc.tuple(bpChoiceArb, bpChoiceArb),
          });
        }),
        ({ category, envelope, choices, bpChoices }) => {
          const fields = fieldSetFor(category);
          const numericFields = fields.filter(
            (field) => field.kind === "number",
          );

          const parameters: Record<string, ParameterValue> = {};
          numericFields.forEach((field, index) => {
            const reference = referenceFieldByKey(field.key)!;
            parameters[field.key] = {
              value: numericValue(reference, choices[index]),
              unit: reference.unit ?? null,
            };
          });

          const systolic = bpValue(REFERENCE_BP_RANGES.systolic, bpChoices[0]);
          const diastolic = bpValue(
            REFERENCE_BP_RANGES.diastolic,
            bpChoices[1],
          );
          parameters.bp = { systolic, diastolic, unit: "mmHg" };

          const result = submit(category, envelope, parameters);
          expect(
            result.success,
            result.success ? "" : JSON.stringify(result.error.issues),
          ).toBe(true);
          if (!result.success) return;
          expect(result.data.parameters).toEqual(parameters);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects any out-of-range value with a message naming the parameter and both bounds", () => {
    /**
     * **Validates: Requirements 11.6, 11.7, 11.8, 11.9, 11.10, 11.11**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) =>
          fc.record({
            category: fc.constant(category),
            envelope: envelopeArb,
            sample: outOfRangeParameterMapArb(category, {
              fields: fieldSetFor(category),
            }),
          }),
        ),
        ({ category, envelope, sample }) => {
          const result = submit(category, envelope, sample.parameters);
          expect(result.success).toBe(false);
          if (result.success) return;

          const messages = messagesFor(
            result.error.issues,
            sample.offendingField.key,
          );
          expect(messages.length).toBeGreaterThan(0);

          if (sample.offendingField.kind === "bp") {
            // Both halves are out of range, so both are named (Req 11.7).
            const bpValue = sample.parameters.bp as {
              systolic: number;
              diastolic: number;
            };
            const halves = [
              {
                label: "BP systolic",
                value: bpValue.systolic,
                range: REFERENCE_BP_RANGES.systolic,
              },
              {
                label: "BP diastolic",
                value: bpValue.diastolic,
                range: REFERENCE_BP_RANGES.diastolic,
              },
            ];
            for (const half of halves) {
              const isOutOfRange =
                half.value < half.range.min || half.value > half.range.max;
              if (!isOutOfRange) continue;
              const expected = expectedRangeMessage(
                half.label,
                half.range.min,
                half.range.max,
                "mmHg",
              );
              expect(messages).toContain(expected);
            }
            return;
          }

          const reference = referenceFieldByKey(sample.offendingField.key)!;
          const message = messages[0];
          // Req 11.11: the message names the parameter and its permitted range.
          expect(message).toContain(reference.label);
          expect(message).toContain(String(reference.min));
          expect(message).toContain(String(reference.max));
          if (reference.unit) expect(message).toContain(reference.unit);
          expect(message).toBe(
            expectedRangeMessage(
              reference.label,
              reference.min!,
              reference.max!,
              reference.unit,
            ),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects an out-of-range value in any single parameter, one parameter at a time", () => {
    /**
     * **Validates: Requirements 11.6, 11.7, 11.8, 11.9, 11.10, 11.11**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) => {
          const rangedFields = fieldSetFor(category).filter(
            (field) => field.kind === "number" || field.kind === "bp",
          );
          return fc
            .constantFrom(...rangedFields)
            .chain((field) =>
              fc.record({
                category: fc.constant(category),
                envelope: envelopeArb,
                field: fc.constant(field),
                badValue: outOfRangeParameterValueArb(field),
              }),
            );
        }),
        ({ category, envelope, field, badValue }) => {
          // The offending parameter is the only one submitted, so acceptance
          // can only mean the range was not applied at all.
          const result = submit(category, envelope, { [field.key]: badValue });
          expect(result.success).toBe(false);
          if (result.success) return;

          const messages = messagesFor(result.error.issues, field.key);
          expect(messages.length).toBeGreaterThan(0);

          const label =
            field.kind === "bp"
              ? "BP"
              : referenceFieldByKey(field.key)!.label;
          expect(messages.some((message) => message.includes(label))).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts a submission in which every parameter except the Closing_Comment is empty", () => {
    /**
     * **Validates: Requirements 11.5**
     */
    fc.assert(
      fc.property(
        customerCategoryArb,
        envelopeArb,
        emptyParameterMapArb,
        (category, envelope, parameters) => {
          const result = submit(category, envelope, parameters);
          expect(
            result.success,
            result.success ? "" : JSON.stringify(result.error.issues),
          ).toBe(true);
          if (!result.success) return;
          expect(result.data.parameters).toEqual({});
          expect(result.data.closingComment).toBe(
            envelope.closingComment.trim(),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("treats a blank submitted value as no value, so a blank-only map is accepted", () => {
    /**
     * **Validates: Requirements 11.5**
     */
    const blankRawArb = fc.constantFrom<unknown>(
      "",
      "   ",
      "\t\n",
      null,
      undefined,
      { value: "" },
      { value: "  " },
      { value: null },
      { systolic: "", diastolic: "" },
    );

    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) => {
          const fields = fieldSetFor(category);
          return fc.record({
            category: fc.constant(category),
            envelope: envelopeArb,
            blanks: fc.array(blankRawArb, {
              minLength: fields.length,
              maxLength: fields.length,
            }),
          });
        }),
        ({ category, envelope, blanks }) => {
          const fields = fieldSetFor(category);
          const parameters: Record<string, unknown> = {};
          fields.forEach((field, index) => {
            parameters[field.key] = blanks[index];
          });

          const result = submit(category, envelope, parameters);
          expect(
            result.success,
            result.success ? "" : JSON.stringify(result.error.issues),
          ).toBe(true);
          if (!result.success) return;
          expect(result.data.parameters).toEqual({});
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts a single in-range parameter for every parameter of the field set", () => {
    /**
     * **Validates: Requirements 11.5, 11.6, 11.7, 11.8, 11.9, 11.10**
     */
    fc.assert(
      fc.property(
        customerCategoryArb.chain((category) =>
          fc
            .constantFrom(...fieldSetFor(category))
            .chain((field) =>
              fc.record({
                category: fc.constant(category),
                envelope: envelopeArb,
                field: fc.constant(field),
                value: parameterValueArb(field),
              }),
            ),
        ),
        ({ category, envelope, field, value }) => {
          const result = submit(category, envelope, { [field.key]: value });
          expect(
            result.success,
            result.success ? "" : JSON.stringify(result.error.issues),
          ).toBe(true);
          if (!result.success) return;

          expect(result.data.parameters).toEqual(
            expectedParameters(fieldSetFor(category), { [field.key]: value }),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
