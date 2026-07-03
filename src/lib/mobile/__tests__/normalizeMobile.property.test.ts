// src/lib/mobile/__tests__/normalizeMobile.property.test.ts
// Feature: customer-mobile-onboarding, Property 1: Mobile normalization is canonical and idempotent
//
// Property 1: Mobile normalization is canonical and idempotent — For any input
// string, `normalizeMobile` either rejects it as invalid or produces a
// canonical 10-digit `[6-9]\d{9}` value; and normalizing an already-normalized
// value yields the same value (`normalize(normalize(x)) == normalize(x)`).
//
// The module under test (src/lib/mobile/normalizeMobile.ts) is PURE: it has no
// Supabase / network / IO imports, so it is exercised here in complete
// isolation across many generated inputs.
//
// Validates: Requirements 2.11, 3.2

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeMobile } from "@/lib/mobile/normalizeMobile";

// ─── Reference rule ──────────────────────────────────────────────────────────
//
// The canonical Indian mobile form (Req 2.11 / 3.2): exactly 10 digits, first
// digit 6-9. Re-stated independently of the implementation so the test does not
// simply mirror the module's own regex object.
const CANONICAL = /^[6-9]\d{9}$/;

// ─── Arbitrary generators ─────────────────────────────────────────────────────
//
// We intelligently constrain the input space to the shapes a human actually
// types, so a meaningful fraction of runs exercise the `ok: true` branch while
// still covering rejection.

// A canonical 10-digit subscriber number (first digit 6-9).
const arbCanonical: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 6, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);

// Random whitespace runs a human might sprinkle in (spaces/tabs/newlines).
const arbWhitespace: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n"), { minLength: 0, maxLength: 3 })
  .map((chars) => chars.join(""));

// A canonical number decorated with the common human noise the normalizer is
// meant to strip: optional whitespace, optional `+91` / `91` / `0` prefixes,
// and interior spaces. All of these must still normalize to `arbCanonical`.
const arbDecoratedValid: fc.Arbitrary<{ raw: string; expected: string }> =
  fc.record({
    canonical: arbCanonical,
    prefix: fc.constantFrom("", "+91", "91", "0", "0091", "+91 "),
    ws1: arbWhitespace,
    ws2: arbWhitespace,
  }).map(({ canonical, prefix, ws1, ws2 }) => {
    // Insert an optional interior space so grouped inputs like `98765 43210`
    // are covered.
    const split = 5;
    const grouped = `${canonical.slice(0, split)}${ws2}${canonical.slice(split)}`;
    return { raw: `${ws1}${prefix}${grouped}`, expected: canonical };
  });

// Fully arbitrary strings — the vast majority reject, exercising the total /
// never-throws contract and the `ok: false` branch.
const arbAnyString: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", " ") }),
);

// Any input the function might receive.
const arbInput: fc.Arbitrary<string> = fc.oneof(
  arbCanonical,
  arbDecoratedValid.map((d) => d.raw),
  arbAnyString,
);

describe("Property 1: Mobile normalization is canonical and idempotent", () => {
  it("either rejects input or returns a canonical [6-9]\\d{9} value", () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const result = normalizeMobile(raw);
        if (result.ok) {
          // A successful normalization is always canonical.
          expect(result.value).toMatch(CANONICAL);
        }
        // (An `ok: false` result carries no value and needs no shape check.)
      }),
      { numRuns: 25 },
    );
  });

  it("is idempotent: normalize(normalize(x)) == normalize(x)", () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const once = normalizeMobile(raw);
        if (once.ok) {
          // Feeding a canonical value back in yields the identical value.
          const twice = normalizeMobile(once.value);
          expect(twice.ok).toBe(true);
          expect(twice.ok && twice.value).toBe(once.value);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("normalizes decorated human input back to the underlying canonical number", () => {
    fc.assert(
      fc.property(arbDecoratedValid, ({ raw, expected }) => {
        const result = normalizeMobile(raw);
        expect(result.ok).toBe(true);
        expect(result.ok && result.value).toBe(expected);
      }),
      { numRuns: 25 },
    );
  });
});
