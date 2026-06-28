// src/lib/dates/__tests__/cutoff.property.test.ts
// Feature: core-clinic-architecture, Property 26: Next-day cutoff enforcement
//
// Property 26: For any customer attempt to edit the meal planner / change
// address / pause for the next delivery day, the operation is locked iff the
// attempt occurs at or after the 5:00 PM IST cutoff for that delivery day.
//
// Validates: Requirements 11.2
//
// The rule is captured by the PURE predicate `isPastNextDayCutoff(now, deliveryDate)`
// in src/lib/dates/ist.ts. We verify it against an INDEPENDENT reference that
// derives the IST hour/date from `now` via Intl.DateTimeFormat (Asia/Kolkata),
// rather than re-using the implementation's helpers.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isPastNextDayCutoff } from "@/lib/dates/ist";

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

/** Independent expectation: is editing `deliveryDate` locked at instant `now`? */
function expectedLocked(now: Date, deliveryDate: string): boolean {
  const { date: istToday, hour } = istReference(now);
  const daysToAdd = hour >= CUTOFF_HOUR_IST ? 2 : 1;
  const earliestEditable = addDays(istToday, daysToAdd);
  return deliveryDate < earliestEditable;
}

// Reasonable range of instants spanning multiple years (and DST-free IST).
const arbNow = fc.date({
  min: new Date("2020-01-01T00:00:00.000Z"),
  max: new Date("2030-12-31T23:59:59.000Z"),
  noInvalidDate: true,
});

describe("Property 26: Next-day cutoff enforcement", () => {
  it("locks edits iff deliveryDate precedes the earliest editable day (offset-based, boundary-rich)", () => {
    fc.assert(
      fc.property(arbNow, fc.integer({ min: -5, max: 5 }), (now, offset) => {
        // Build a deliveryDate near the cutoff boundary relative to IST "today".
        const { date: istToday } = istReference(now);
        const deliveryDate = addDays(istToday, offset);

        expect(isPastNextDayCutoff(now, deliveryDate)).toBe(
          expectedLocked(now, deliveryDate),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("matches the independent reference for arbitrary delivery dates", () => {
    const arbDeliveryDate = fc
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
      fc.property(arbNow, arbDeliveryDate, (now, deliveryDate) => {
        expect(isPastNextDayCutoff(now, deliveryDate)).toBe(
          expectedLocked(now, deliveryDate),
        );
      }),
      { numRuns: 300 },
    );
  });

  // ─── Focused examples (IST = UTC+5:30, no DST) ─────────────────────────────
  // 16:00 IST = 10:30 UTC, 17:00 IST = 11:30 UTC on the same calendar day.

  it("before 17:00 IST: tomorrow's delivery is editable (not locked)", () => {
    const now = new Date("2025-06-15T10:30:00.000Z"); // 16:00 IST, 15 Jun
    expect(isPastNextDayCutoff(now, "2025-06-16")).toBe(false);
  });

  it("at/after 17:00 IST: tomorrow's delivery is locked", () => {
    const at = new Date("2025-06-15T11:30:00.000Z"); // exactly 17:00 IST
    const after = new Date("2025-06-15T13:00:00.000Z"); // 18:30 IST
    expect(isPastNextDayCutoff(at, "2025-06-16")).toBe(true);
    expect(isPastNextDayCutoff(after, "2025-06-16")).toBe(true);
  });

  it("day-after-tomorrow is editable both before and after the cutoff", () => {
    const before = new Date("2025-06-15T10:30:00.000Z"); // 16:00 IST
    const after = new Date("2025-06-15T11:30:00.000Z"); // 17:00 IST
    expect(isPastNextDayCutoff(before, "2025-06-17")).toBe(false);
    expect(isPastNextDayCutoff(after, "2025-06-17")).toBe(false);
  });

  it("today (and earlier) is always locked", () => {
    const before = new Date("2025-06-15T10:30:00.000Z"); // 16:00 IST
    const after = new Date("2025-06-15T11:30:00.000Z"); // 17:00 IST
    expect(isPastNextDayCutoff(before, "2025-06-15")).toBe(true);
    expect(isPastNextDayCutoff(before, "2025-06-10")).toBe(true);
    expect(isPastNextDayCutoff(after, "2025-06-15")).toBe(true);
  });
});
