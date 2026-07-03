// src/lib/onboarding/__tests__/routing.property.test.ts
// Feature: customer-mobile-onboarding, Property 7: Routing eligibility follows start date
//
// Property 7: Routing eligibility follows start date
// For any onboarded subscription with start date S and any current date D, the
// subscription is included in delivery routing if and only if D >= S.
//
// Validates: Requirements 6.7, 6.8

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isRoutable } from "@/lib/onboarding/routing";

// ─── Arbitrary generators ───────────────────────────────────────────────────
// The routing rule operates on the calendar-date portion (YYYY-MM-DD, IST
// operational day). We generate real calendar dates by picking a day offset
// from a fixed epoch and formatting the resulting date as YYYY-MM-DD. This
// covers a wide, valid date space (month/year boundaries, leap years) rather
// than arbitrary strings.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Fixed epoch so runs are deterministic: 2000-01-01 UTC.
const EPOCH_MS = Date.UTC(2000, 0, 1);

/** Formats a day offset from the epoch as a YYYY-MM-DD calendar-date string. */
function dateFromOffset(dayOffset: number): string {
  const d = new Date(EPOCH_MS + dayOffset * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ~55 years of day offsets (0..20000), plenty of boundary variety.
const arbDayOffset = fc.integer({ min: 0, max: 20000 });
const arbDate = arbDayOffset.map(dateFromOffset);

// A time-of-day suffix to prove the rule ignores any accidental time component.
const arbTimeSuffix = fc.constantFrom(
  "",
  "T00:00:00",
  "T09:30:00",
  "T17:00:00+05:30",
  "T23:59:59Z",
);

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Property 7: Routing eligibility follows start date", () => {
  it("isRoutable(S, D) is true if and only if D >= S (by calendar date)", () => {
    fc.assert(
      fc.property(
        arbDayOffset,
        arbDayOffset,
        (startOffset, currentOffset) => {
          const startDate = dateFromOffset(startOffset);
          const currentDate = dateFromOffset(currentOffset);

          // Independent reference: on/after the start date is routable, before
          // it is excluded (Req 6.7 / 6.8).
          const expected = currentOffset >= startOffset;

          expect(isRoutable(startDate, currentDate)).toBe(expected);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("is exactly true on the boundary (D == S) — start date is included", () => {
    fc.assert(
      fc.property(arbDate, (date) => {
        // On the start date itself, routing is enabled (Req 6.7).
        expect(isRoutable(date, date)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("excludes the subscription strictly before the start date (Req 6.8)", () => {
    fc.assert(
      fc.property(
        arbDayOffset,
        fc.integer({ min: 1, max: 5000 }),
        (startOffset, gap) => {
          const startDate = dateFromOffset(startOffset + gap);
          const currentDate = dateFromOffset(startOffset);
          // current date is strictly before start date → excluded.
          expect(isRoutable(startDate, currentDate)).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("ignores any time component, comparing only the calendar date", () => {
    fc.assert(
      fc.property(
        arbDayOffset,
        arbDayOffset,
        arbTimeSuffix,
        arbTimeSuffix,
        (startOffset, currentOffset, startSuffix, currentSuffix) => {
          const startDate = dateFromOffset(startOffset) + startSuffix;
          const currentDate = dateFromOffset(currentOffset) + currentSuffix;

          const expected = currentOffset >= startOffset;

          expect(isRoutable(startDate, currentDate)).toBe(expected);
        },
      ),
      { numRuns: 25 },
    );
  });
});
