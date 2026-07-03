// src/lib/onboarding/__tests__/cutoff.property.test.ts
// Feature: customer-mobile-onboarding, Property 9: Earliest selectable start date from cutoff
//
// Property 9: For any current timestamp evaluated in the Cutoff_Time zone
// (17:00 IST), the earliest selectable subscription start date is:
//   - today + 1 day  when `now` is BEFORE  17:00 IST   (Req 7.5)
//   - today + 2 days when `now` is AT/AFTER 17:00 IST   (Req 7.6)
// and `isStartDateAllowed(startDate, now)` returns true IFF `startDate` is on or
// after that earliest selectable date.                     (Req 7.7)
//
// Validates: Requirements 7.5, 7.6, 7.7
//
// The rule lives in the PURE functions `earliestStartDate` / `isStartDateAllowed`
// in src/lib/onboarding/cutoff.ts. We verify them against an INDEPENDENT
// reference that derives the IST hour/date from `now` via Intl.DateTimeFormat
// (Asia/Kolkata), rather than re-using the implementation's helpers.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  earliestStartDate,
  isStartDateAllowed,
  ONBOARDING_CUTOFF_HOUR_IST,
} from "@/lib/onboarding/cutoff";

const CUTOFF_HOUR_IST = 17; // 5:00 PM IST

// ─── Independent IST reference (derives parts via Intl, not the impl) ─────────

/** Returns { date: "YYYY-MM-DD", hour: 0..23 } in Asia/Kolkata for an instant. */
function istReference(instant: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // Some locales render midnight as "24"; normalize to 0..23.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

/** Adds whole calendar days to a YYYY-MM-DD string via UTC arithmetic. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

/** Independent expectation for the earliest selectable start date at `now`. */
function expectedEarliest(now: Date): string {
  const { date: istToday, hour } = istReference(now);
  const daysToAdd = hour >= CUTOFF_HOUR_IST ? 2 : 1;
  return addDays(istToday, daysToAdd);
}

// Reasonable range of instants spanning multiple years (IST has no DST).
const arbNow = fc.date({
  min: new Date("2020-01-01T00:00:00.000Z"),
  max: new Date("2030-12-31T23:59:59.000Z"),
  noInvalidDate: true,
});

describe("Property 9: Earliest selectable start date from cutoff", () => {
  it("earliestStartDate is today+1 before the cutoff and today+2 at/after (IST)", () => {
    fc.assert(
      fc.property(arbNow, (now) => {
        expect(earliestStartDate(now)).toBe(expectedEarliest(now));
      }),
      { numRuns: 25 },
    );
  });

  it("isStartDateAllowed accepts a start date iff it is on/after the earliest date", () => {
    fc.assert(
      fc.property(arbNow, fc.integer({ min: -5, max: 5 }), (now, offset) => {
        // Build a candidate start date near the boundary relative to IST "today".
        const { date: istToday } = istReference(now);
        const startDate = addDays(istToday, offset);
        const earliest = expectedEarliest(now);

        expect(isStartDateAllowed(startDate, now)).toBe(startDate >= earliest);
      }),
      { numRuns: 25 },
    );
  });

  it("isStartDateAllowed matches the earliest-date boundary for arbitrary start dates", () => {
    const arbStartDate = fc
      .date({
        min: new Date("2019-01-01T00:00:00.000Z"),
        max: new Date("2031-12-31T00:00:00.000Z"),
        noInvalidDate: true,
      })
      .map((d) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d),
      );

    fc.assert(
      fc.property(arbNow, arbStartDate, (now, startDate) => {
        const earliest = expectedEarliest(now);
        expect(isStartDateAllowed(startDate, now)).toBe(startDate >= earliest);
        // The earliest selectable date itself is always allowed.
        expect(isStartDateAllowed(earliest, now)).toBe(true);
        // The day before the earliest selectable date is never allowed.
        expect(isStartDateAllowed(addDays(earliest, -1), now)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  // ─── Focused examples (IST = UTC+5:30, no DST) ─────────────────────────────
  // 16:00 IST = 10:30 UTC, 17:00 IST = 11:30 UTC on the same calendar day.

  it("before 17:00 IST: earliest start date is tomorrow (today+1)", () => {
    const now = new Date("2025-06-15T10:30:00.000Z"); // 16:00 IST, 15 Jun
    expect(earliestStartDate(now)).toBe("2025-06-16");
    expect(isStartDateAllowed("2025-06-16", now)).toBe(true);
    expect(isStartDateAllowed("2025-06-15", now)).toBe(false);
  });

  it("at/after 17:00 IST: earliest start date is day-after-tomorrow (today+2)", () => {
    const at = new Date("2025-06-15T11:30:00.000Z"); // exactly 17:00 IST
    const after = new Date("2025-06-15T13:00:00.000Z"); // 18:30 IST
    expect(earliestStartDate(at)).toBe("2025-06-17");
    expect(earliestStartDate(after)).toBe("2025-06-17");
    expect(isStartDateAllowed("2025-06-16", at)).toBe(false);
    expect(isStartDateAllowed("2025-06-17", at)).toBe(true);
  });

  it("cutoff hour crossing the IST calendar-day boundary shifts the date", () => {
    // 23:30 UTC on 15 Jun = 05:00 IST on 16 Jun (before cutoff) → today+1 = 17 Jun.
    const earlyMorningIST = new Date("2025-06-15T23:30:00.000Z");
    expect(earliestStartDate(earlyMorningIST)).toBe("2025-06-17");
  });

  it("the configured cutoff hour matches the operational 5 PM IST deadline", () => {
    expect(ONBOARDING_CUTOFF_HOUR_IST).toBe(CUTOFF_HOUR_IST);
  });
});
