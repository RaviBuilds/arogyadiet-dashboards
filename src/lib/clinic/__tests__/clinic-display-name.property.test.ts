// src/lib/clinic/__tests__/clinic-display-name.property.test.ts
// Feature: core-clinic-architecture, Property 34: Clinic display name or placeholder
//
// Property 34: Clinic display name or placeholder
// For any rider or customer record, the displayed Clinic value is the linked
// clinic's name when a clinic is linked, and a placeholder (e.g. "—"/"Unassigned")
// when no clinic is linked.
//
// Validates: Requirements 16.3, 16.7

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { clinicDisplayName } from "../visibility";

// ─── Arbitrary generators ──────────────────────────────────────────────────

// A clinic name that is present and non-empty after trimming (the "linked" case).
const arbPresentName = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

// Whitespace-only strings — treated as "no clinic" (blank after trim).
const arbWhitespace = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), { minLength: 1 })
  .map((chars) => chars.join(""));

// All the "unlinked" representations: whitespace-only, empty string, null, undefined.
const arbUnlinked = fc.oneof(
  arbWhitespace,
  fc.constant(""),
  fc.constant(null),
  fc.constant(undefined)
);

// Either a linked name or an unlinked representation.
const arbClinicName = fc.oneof(arbPresentName, arbUnlinked);

// An optional placeholder string (sometimes provided, sometimes omitted).
const arbOptionalPlaceholder = fc.option(fc.string(), { nil: undefined });

// ─── Property Tests ────────────────────────────────────────────────────────

describe("clinicDisplayName - Property 34: Clinic display name or placeholder", () => {
  it("returns the clinic name when a clinic is linked (non-empty after trim)", () => {
    fc.assert(
      fc.property(arbPresentName, arbOptionalPlaceholder, (name, placeholder) => {
        const result =
          placeholder === undefined
            ? clinicDisplayName(name)
            : clinicDisplayName(name, placeholder);
        // When linked, the actual name is returned regardless of any placeholder.
        expect(result).toBe(name);
      }),
      { numRuns: 200 }
    );
  });

  it("returns the placeholder when no clinic is linked", () => {
    fc.assert(
      fc.property(arbUnlinked, arbOptionalPlaceholder, (unlinked, placeholder) => {
        const result =
          placeholder === undefined
            ? clinicDisplayName(unlinked)
            : clinicDisplayName(unlinked, placeholder);
        // Default "Unassigned" when none passed, otherwise the provided placeholder.
        const expected = placeholder === undefined ? "Unassigned" : placeholder;
        expect(result).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it("always returns either the linked name or the resolved placeholder", () => {
    fc.assert(
      fc.property(arbClinicName, arbOptionalPlaceholder, (name, placeholder) => {
        const result =
          placeholder === undefined
            ? clinicDisplayName(name)
            : clinicDisplayName(name, placeholder);
        const resolvedPlaceholder =
          placeholder === undefined ? "Unassigned" : placeholder;

        if (name != null && name.trim().length > 0) {
          expect(result).toBe(name);
        } else {
          expect(result).toBe(resolvedPlaceholder);
        }
      }),
      { numRuns: 200 }
    );
  });
});
