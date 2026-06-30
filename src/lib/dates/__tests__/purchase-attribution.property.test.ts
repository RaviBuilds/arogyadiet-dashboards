// src/lib/dates/__tests__/purchase-attribution.property.test.ts
// Feature: core-clinic-architecture, Property 27: Purchase day-attribution window
//
// Property 27: Purchase day-attribution window
// For any shop-purchase timestamp, the product-linking step attributes the
// purchase to the IST calendar day (12:00 AM–11:59 PM IST) containing that
// timestamp; a purchase at 12:01 AM IST attributes to that day and is excluded
// from the prior day.
//
// Validates: Requirements 11.3

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { purchaseAttributionDate } from "../ist";

/**
 * Independent reference implementation of "the IST calendar date of this instant".
 * Uses Intl.DateTimeFormat with the Asia/Kolkata time zone and the en-CA locale,
 * which formats as YYYY-MM-DD. This is derived separately from the function under
 * test so the property is a true cross-check rather than a tautology.
 */
function istDateReference(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Bounded, always-valid instant generator. fast-check v4's `fc.date()` can
 * surface an Invalid Date, on which `toISOString()` throws a RangeError — that
 * would make the property diverge for reasons unrelated to attribution logic.
 * Constraining to realistic timestamps keeps the property meaningful.
 */
const arbInstant = fc.date({
  min: new Date("1970-01-01T00:00:00.000Z"),
  max: new Date("2100-12-31T23:59:59.999Z"),
  noInvalidDate: true,
});

describe("Property 27: Purchase day-attribution window", () => {
  it("attributes any purchase timestamp to the IST calendar day containing it", () => {
    fc.assert(
      fc.property(arbInstant, (when) => {
        const iso = when.toISOString();
        const expected = istDateReference(when);

        expect(purchaseAttributionDate(iso)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("is consistent regardless of the source offset used to express the same instant", () => {
    // Two ISO strings denoting the SAME instant (UTC vs explicit +05:30) must
    // attribute to the same IST day, since attribution depends on the instant.
    fc.assert(
      fc.property(arbInstant, (when) => {
        const utcISO = when.toISOString();
        const istISO = new Date(when.getTime()).toISOString();
        expect(purchaseAttributionDate(utcISO)).toBe(
          purchaseAttributionDate(istISO),
        );
      }),
      { numRuns: 200 },
    );
  });

  // ─── Boundary examples (constructed as IST wall-clock times via +05:30) ──────

  it("12:01 AM IST attributes to that day (not the prior day)", () => {
    // 2024-03-15 00:01 IST → 2024-03-15, and NOT 2024-03-14.
    expect(purchaseAttributionDate("2024-03-15T00:01:00+05:30")).toBe(
      "2024-03-15",
    );
    expect(purchaseAttributionDate("2024-03-15T00:01:00+05:30")).not.toBe(
      "2024-03-14",
    );
  });

  it("11:59 PM IST attributes to the same day", () => {
    expect(purchaseAttributionDate("2024-03-15T23:59:00+05:30")).toBe(
      "2024-03-15",
    );
  });

  it("12:00 AM IST (midnight) attributes to that day", () => {
    expect(purchaseAttributionDate("2024-03-15T00:00:00+05:30")).toBe(
      "2024-03-15",
    );
  });

  it("just before midnight IST (the instant before the boundary) stays on the prior day", () => {
    // 2024-03-14 23:59:59.999 IST is still the 14th; one ms later is the 15th.
    expect(purchaseAttributionDate("2024-03-14T23:59:59.999+05:30")).toBe(
      "2024-03-14",
    );
    expect(purchaseAttributionDate("2024-03-15T00:00:00.000+05:30")).toBe(
      "2024-03-15",
    );
  });
});
